import { Controller, Post, Body, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WhatsappService } from '../services/whatsapp.service';
import { AiService } from '../services/ai.service';
import { UserService } from '../services/user.service';
import { ReminderService } from '../services/reminder.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly aiService: AiService,
    private readonly userService: UserService,
    private readonly reminderService: ReminderService,
  ) {}

  @Post('webhook')
  async handleWebhook(@Body() body: any) {
    try {
      // Handle WhatsApp webhook payload
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages') {
              await this.handleMessage(change.value);
            }
          }
        }
      }
      
      return { status: 'received' };
    } catch (error) {
      console.error('Webhook error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @Get('webhook')
  async verifyWebhook(@Query() query: any, @Res() res: Response) {
    // WhatsApp webhook verification
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.set('Content-Type', 'text/plain');
      res.status(200).send(challenge);
    } else {
      res.status(403).json({ status: 'error', message: 'Verification failed' });
    }
  }

  private async handleMessage(messageData: any) {
    const messages = messageData.messages;
    if (!messages || !Array.isArray(messages)) {
      return; // Status updates etc. have no messages array
    }

    const phoneNumber = messageData.metadata?.display_phone_number;

    for (const message of messages) {
      if (message.type === 'text') {
        const from = message.from; // User's phone number
        const text = message.text.body;

        // Process the message
        await this.processWhatsAppMessage(from, text, phoneNumber);
      }
    }
  }

  private async processWhatsAppMessage(userPhone: string, message: string, businessPhone: string) {
    try {
      // Find or create user
      let user = await this.userService.getUserByPhone(userPhone);
      
      if (!user) {
        // Create new user
        user = await this.userService.createUser({
          phone: userPhone,
          name: `WhatsApp User ${userPhone}`,
          email: `user_${userPhone}@reminder.app`,
          preferredContactMethod: 'whatsapp',
          timezone: 'UTC',
          isActive: true
        });
      }

      // Check if user is talking about completing a task
      const userReminders = await this.reminderService.getPendingRemindersForUser(user.id);
      const completionCheck = await this.aiService.detectTaskCompletion(message, userReminders);

      if (completionCheck.completed && completionCheck.reminderId) {
        // Mark reminder as completed and delete it
        await this.reminderService.markAsCompleted(completionCheck.reminderId);
        await this.reminderService.deleteReminder(completionCheck.reminderId);
        
        // Send confirmation
        await this.whatsappService.sendMessage(userPhone, completionCheck.response);
        return;
      }

      // Try to parse as a reminder
      const parsedReminder = await this.aiService.parseReminderInput(message, user.id);
      
      // If it's not a reminder at all (very low confidence + needs clarification), respond conversationally
      const isCasualChat = parsedReminder.confidence < 0.3 && parsedReminder.needsClarification;
      
      // Generate AI response - don't pass parsedReminder for casual chat
      const aiResponse = await this.aiService.generateBasicResponse(
        message, 
        isCasualChat ? undefined : parsedReminder
      );
      
      // Create reminder if confident enough and no clarification needed
      if (parsedReminder.confidence > 0.7 && !parsedReminder.needsClarification) {
        const createdReminder = await this.reminderService.createReminder({
          userId: user.id,
          title: parsedReminder.title,
          description: parsedReminder.description,
          reminderDate: parsedReminder.reminderDate,
          isCompleted: false,
          isPersistent: true,
          reminderInterval: 30,
          reminderCount: 0,
          metadata: {
            category: parsedReminder.category,
            priority: parsedReminder.priority,
            recurring: parsedReminder.recurring,
            source: 'whatsapp'
          }
        });

        // Send confirmation with reminder details
        const confirmationMessage = `${aiResponse}\n\nReminder Details:\nTitle: ${createdReminder.title}\nTime: ${createdReminder.reminderDate.toLocaleString()}\n\nI'll remind you when it's time!`;
        await this.whatsappService.sendMessage(userPhone, confirmationMessage);
      } else {
        // Just send the AI response (might ask for clarification)
        await this.whatsappService.sendMessage(userPhone, aiResponse);
      }

    } catch (error) {
      console.error('Error processing WhatsApp message:', error);
      // Send error message to user
      await this.whatsappService.sendMessage(userPhone, "Sorry, I had trouble processing that. Please try again!");
    }
  }

  @Post('test/send')
  async sendTestMessage(@Body() body: { phone: string; message: string }) {
    try {
      await this.whatsappService.sendMessage(body.phone, body.message);
      return { success: true, message: 'Test message sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Get('test/user')
  async getTestUser(@Query('phone') phone: string) {
    try {
      const user = await this.userService.getUserByPhone(phone);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const reminders = await this.reminderService.getPendingRemindersForUser(user.id);
      return {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          timezone: user.timezone
        },
        pendingReminders: reminders.map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          reminderDate: r.reminderDate,
          reminderCount: r.reminderCount
        }))
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
