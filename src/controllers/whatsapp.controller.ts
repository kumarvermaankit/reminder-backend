import { Controller, Post, Body, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { WhatsappService } from '../services/whatsapp.service';
import { AiService } from '../services/ai.service';
import { UserService } from '../services/user.service';
import { ReminderService } from '../services/reminder.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

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
      this.logger.log(`Processing message from ${userPhone}: "${message}"`);

      // Find or create user
      let user = await this.userService.getUserByPhone(userPhone);
      
      if (!user) {
        this.logger.log(`No user found for ${userPhone}, creating new user`);
        user = await this.userService.createUser({
          phone: userPhone,
          name: 'there',
          email: `user_${userPhone}@reminder.app`,
          preferredContactMethod: 'whatsapp',
          timezone: 'UTC',
          isActive: true
        });
        this.logger.log(`Created user ${user.id} for ${userPhone}`);
      } else {
        this.logger.log(`Found existing user ${user.id}`);
      }

      // Check for timezone update request
      const tzMatch = message.match(/(?:timezone|tz|time zone)\s+(?:is\s+)?(.+)/i);
      if (tzMatch) {
        const tz = tzMatch[1].trim();
        const validTz = this.lookupTimezone(tz);
        if (validTz) {
          await this.userService.updateUser(user.id, { timezone: validTz });
          user.timezone = validTz;
          await this.whatsappService.sendMessage(userPhone, `Got it! Your timezone is set to ${validTz}.`);
          return;
        } else {
          await this.whatsappService.sendMessage(userPhone, `I'm not sure which timezone that is. Try something like "timezone is Asia/Kolkata" or "timezone is America/New_York".`);
          return;
        }
      }

      // Check if user is talking about completing a task
      this.logger.log('Checking for task completion...');
      const userReminders = await this.reminderService.getPendingRemindersForUser(user.id);
      this.logger.log(`User has ${userReminders.length} pending reminders`);

      // Skip completion check if no pending reminders exist
      let completionCheck: { completed: boolean; reminderId?: string; response?: string } = { completed: false, response: '' };

      if (userReminders.length > 0) {
        // Simple keyword match for "done" when there's only one reminder
        const doneKeywords = ['done', 'im done', 'i am done', 'finished', 'complete', 'completed', 'stop', 'cancel'];
        const isDoneRequest = doneKeywords.some(k => message.toLowerCase().trim() === k);

        if (isDoneRequest && userReminders.length === 1) {
          this.logger.log(`Simple keyword match - marking single reminder as done`);
          completionCheck = {
            completed: true,
            reminderId: userReminders[0].id,
            response: "Got it! Marked as done.",
          };
        } else if (isDoneRequest && userReminders.length > 1) {
          // Match last reminder
          const last = userReminders[userReminders.length - 1];
          this.logger.log(`Simple keyword match - marking last reminder as done`);
          completionCheck = {
            completed: true,
            reminderId: last.id,
            response: `Got it! Marked "${last.title}" as done.`,
          };
        } else {
          completionCheck = await this.aiService.detectTaskCompletion(message, userReminders);
        }
      }
      this.logger.log(`Completion check: completed=${completionCheck.completed}`);

      if (completionCheck.completed && completionCheck.reminderId) {
        this.logger.log(`Marking reminder ${completionCheck.reminderId} as completed`);
        await this.reminderService.markAsCompleted(completionCheck.reminderId);
        await this.reminderService.deleteReminder(completionCheck.reminderId);
        await this.whatsappService.sendMessage(userPhone, completionCheck.response || "Got it! Marked as done.");
        return;
      }

      // Try to parse as a reminder
      this.logger.log('Parsing message as reminder via AI...');
      const parsedReminder = await this.aiService.parseReminderInput(message, user.id, user.timezone);
      this.logger.log(`AI parsed: title="${parsedReminder.title}", confidence=${parsedReminder.confidence}, needsClarification=${parsedReminder.needsClarification}, intervalMinutes=${parsedReminder.intervalMinutes}`);

      // Save user's name if AI extracted one
      if (parsedReminder.userName && (user.name === 'there' || user.name.startsWith('WhatsApp User'))) {
        this.logger.log(`Updating user name to "${parsedReminder.userName}"`);
        await this.userService.updateUser(user.id, { name: parsedReminder.userName });
        user.name = parsedReminder.userName;
      }

      // If it's not a reminder at all (very low confidence + needs clarification), respond conversationally
      const isCasualChat = parsedReminder.confidence < 0.3 && parsedReminder.needsClarification;
      this.logger.log(`isCasualChat=${isCasualChat}`);
      
      // Generate AI response - don't pass parsedReminder for casual chat
      const aiResponse = await this.aiService.generateBasicResponse(
        message, 
        isCasualChat ? undefined : parsedReminder
      );
      this.logger.log(`AI response: "${aiResponse.substring(0, 100)}..."`);
      
      // Create reminder if confident enough and no clarification needed
      if (parsedReminder.confidence > 0.7 && !parsedReminder.needsClarification) {
        this.logger.log(`Confidence high enough. Creating reminder...`);
        
        try {
          const createdReminder = await this.reminderService.createReminder({
            userId: user.id,
            title: parsedReminder.title,
            description: parsedReminder.description,
            reminderDate: parsedReminder.reminderDate,
            isCompleted: false,
          isPersistent: true,
          reminderInterval: parsedReminder.intervalMinutes || 30,
            reminderCount: 0,
            metadata: {
              category: parsedReminder.category,
              priority: parsedReminder.priority,
              recurring: parsedReminder.recurring,
              source: 'whatsapp'
            }
          });
          this.logger.log(`Reminder saved to DB with id=${createdReminder.id}, title="${createdReminder.title}", date=${createdReminder.reminderDate}`);

          // Send confirmation with reminder details
          const timeStr = this.formatRelativeTime(createdReminder.reminderDate);
          const confirmationMessage = `${aiResponse}\n\nReminder Details:\nTitle: ${createdReminder.title}\nTime: ${timeStr}\n\nI'll remind you when it's time!`;
          await this.whatsappService.sendMessage(userPhone, confirmationMessage);
          this.logger.log('Confirmation sent to user');
        } catch (dbError) {
          this.logger.error(`Failed to save reminder to DB:`, dbError);
          await this.whatsappService.sendMessage(userPhone, "I understood your reminder but had trouble saving it. Please try again!");
        }
      } else {
        this.logger.log(`Confidence too low (${parsedReminder.confidence}) or needs clarification - not creating reminder`);
        await this.whatsappService.sendMessage(userPhone, aiResponse);
      }

    } catch (error) {
      this.logger.error('Error processing WhatsApp message:', error);
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

  @Get('debug/reminders')
  async debugAllReminders() {
    try {
      const reminders = await this.reminderService.getReminders();
      const schedules = await this.reminderService.getAllSchedules();
      return {
        totalReminders: reminders.length,
        reminders: reminders.map(r => ({
          id: r.id,
          title: r.title,
          date: r.reminderDate,
          completed: r.isCompleted,
          persistent: r.isPersistent,
          count: r.reminderCount,
        })),
        totalSchedules: schedules.length,
        schedules: schedules.map(s => ({
          id: s.id,
          reminderId: s.reminderId,
          scheduledTime: s.scheduledTime,
          completed: s.isCompleted,
          retries: s.retryCount,
        })),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  private lookupTimezone(input: string): string | null {
    const aliases: Record<string, string> = {
      'ist': 'Asia/Kolkata',
      'pst': 'America/Los_Angeles',
      'pdt': 'America/Los_Angeles',
      'cst': 'America/Chicago',
      'cdt': 'America/Chicago',
      'est': 'America/New_York',
      'edt': 'America/New_York',
      'gmt': 'GMT',
      'utc': 'UTC',
      'aest': 'Australia/Sydney',
      'aedt': 'Australia/Sydney',
      'cet': 'Europe/Paris',
      'bst': 'Europe/London',
    };
    const key = input.toLowerCase().trim();
    if (aliases[key]) return aliases[key];
    // Check if it's a valid IANA timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: input });
      return input;
    } catch {
      return null;
    }
  }

  private formatRelativeTime(date: Date): string {
    const now = Date.now();
    const diffMs = date.getTime() - now;
    const diffMin = Math.round(diffMs / 60000);
    const diffHrs = Math.round(diffMs / 3600000);

    if (diffMin < 1) return 'in less than a minute';
    if (diffMin < 60) return `in ${diffMin} minutes`;
    if (diffHrs < 24) return `today at ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    if (diffHrs < 48) return `tomorrow at ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
