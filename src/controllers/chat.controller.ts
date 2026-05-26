import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { AiService } from '../services/ai.service';
import { ReminderService } from '../services/reminder.service';
import { UserService } from '../services/user.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly aiService: AiService,
    private readonly reminderService: ReminderService,
    private readonly userService: UserService,
  ) {}

  @Post()
  async chat(@Body() body: { message: string; userId?: string }) {
    const { message, userId } = body;
    
    try {
      // First, check if user is talking about completing a task
      if (userId) {
        const userReminders = await this.reminderService.getPendingRemindersForUser(userId);
        const completionCheck = await this.aiService.detectTaskCompletion(message, userReminders);
        
        if (completionCheck.completed && completionCheck.reminderId) {
          // Mark reminder as completed and delete it
          await this.reminderService.markAsCompleted(completionCheck.reminderId);
          await this.reminderService.deleteReminder(completionCheck.reminderId);
          
          return {
            success: true,
            response: completionCheck.response,
            action: 'completed',
            reminderId: completionCheck.reminderId
          };
        }
      }
      
      // Try to parse as a reminder request
      const parsedReminder = await this.aiService.parseReminderInput(message, userId);
      
      // Static response based on what we parsed
      let response = "I'm not sure I understood that.";
      
      if (parsedReminder.needsClarification && parsedReminder.clarificationQuestion) {
        response = parsedReminder.clarificationQuestion;
      } else if (parsedReminder.confidence > 0.3 && parsedReminder.title) {
        response = `Got it! I'll help with that.`;
      }
      
      // Create reminder if confident enough and no clarification needed
      let createdReminder = null;
      let action = 'chat';
      
      if (parsedReminder.confidence > 0.7 && !parsedReminder.needsClarification && userId) {
        // Make it persistent by default
        createdReminder = await this.reminderService.createReminder({
          userId,
          title: parsedReminder.title,
          description: parsedReminder.description,
          reminderDate: parsedReminder.reminderDate,
          isCompleted: false,
          isPersistent: true, // Keep reminding until completed
          reminderInterval: 30, // Remind every 30 minutes
          reminderCount: 0,
          metadata: {
            category: parsedReminder.category,
            priority: parsedReminder.priority,
            recurring: parsedReminder.recurring,
            source: 'ai_chat'
          }
        });
        action = 'created';
      }
      
      return {
        success: true,
        response,
        action,
        createdReminder,
        needsClarification: parsedReminder.needsClarification,
        clarificationQuestion: parsedReminder.clarificationQuestion,
        parsedReminder
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        response: "Oops, I had trouble with that. Can you try again?",
        action: 'error'
      };
    }
  }

  @Get('examples')
  async getExamples() {
    return {
      success: true,
      examples: [
        "Remind me to call mom tomorrow",
        "I need to take my medicine every morning",
        "Don't forget the meeting at 3pm",
        "I'm done with that task now",
        "Cancel that reminder about the meeting",
        "Remind me to drink water every few hours"
      ]
    };
  }

  @Get('status/:userId')
  async getUserStatus(@Param('userId') userId: string) {
    try {
      const user = await this.userService.getUserById(userId);
      const pendingReminders = await this.reminderService.getPendingRemindersForUser(userId);
      
      return {
        success: true,
        user: {
          name: user.name,
          timezone: user.timezone
        },
        pendingReminders: pendingReminders.map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          reminderDate: r.reminderDate,
          reminderCount: r.reminderCount
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
