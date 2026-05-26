import { Injectable, Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { UserService } from './user.service';
import { TodoListService } from './todo-list.service';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly userService: UserService,
    private readonly todoListService: TodoListService,
  ) {}

  async sendReminder(schedule: ReminderSchedule): Promise<boolean> {
    try {
      const { reminder } = schedule;
      const user = await this.userService.getUserById(reminder.userId);
      
      if (!user) {
        this.logger.error(`User not found for reminder ${schedule.id}`);
        return false;
      }

      // Check if user is in quiet hours
      if (this.userService.isInQuietHours(user)) {
        this.logger.log(`User ${user.id} is in quiet hours, skipping reminder ${schedule.id}`);
        return false;
      }

      // Check daily reminder limit
      const todayReminders = await this.getTodayReminderCount(user.id);
      if (todayReminders >= user.maxDailyReminders) {
        this.logger.log(`User ${user.id} has reached daily limit, skipping reminder ${schedule.id}`);
        return false;
      }

      const message = this.formatReminderMessage(reminder.title, reminder.description, user.name, reminder.reminderCount);

      // Send based on user's preferred contact method
      let sent = false;
      switch (user.preferredContactMethod) {
        case 'whatsapp':
          if (user.phone) {
            const buttons = reminder.isPersistent
              ? [{ id: `done:${schedule.id}`, title: 'Done ✅' }]
              : [
                  { id: `done:${schedule.id}`, title: 'Done ✅' },
                  { id: `snooze_5:${schedule.id}`, title: 'Snooze 5 min' },
                  { id: `snooze_10:${schedule.id}`, title: 'Snooze 10 min' },
                ];
            await this.whatsappService.sendInteractiveMessage(user.phone, message, buttons);
            sent = true;
          }
          break;
        case 'email':
          // TODO: Implement email service
          this.logger.warn(`Email service not implemented for user ${user.id}`);
          break;
        case 'sms':
          // TODO: Implement SMS service
          this.logger.warn(`SMS service not implemented for user ${user.id}`);
          break;
      }

      if (sent) {
        this.logger.log(`Successfully sent reminder ${schedule.id} to user ${user.id} via ${user.preferredContactMethod}`);
        await this.incrementDailyReminderCount(user.id);

        // Track last 5 reminder IDs sent to this user (most recent first)
        const lastIds = user.lastReminderIds || [];
        lastIds.unshift(schedule.reminderId);
        if (lastIds.length > 5) lastIds.pop();
        await this.userService.updateUser(user.id, { lastReminderIds: lastIds });

        return true;
      } else {
        this.logger.error(`No valid contact method for user ${user.id}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to send reminder ${schedule.id}:`, error);
      throw error;
    }
  }

private formatReminderMessage(title: string, description: string, userName: string, reminderCount: number = 1): string {
    const safeCount = Math.max(1, reminderCount);
    const descStr = description ? ` - ${description}` : '';
    const greeting = (!userName || userName === 'there' || userName.startsWith('WhatsApp User'))
      ? 'Hi!'
      : `Hey ${userName}!`;
    const messages = [
      `${greeting} Quick reminder: ${title}${descStr}`,
      `${greeting} Don't forget: ${title}!${descStr}`,
      `${greeting} Just checking in about: ${title}${descStr}`,
      `${greeting} Time for: ${title}${descStr}`,
    ];
    
    // Rotate messages to avoid repetition
    const messageIndex = (safeCount - 1) % messages.length;
    let message = messages[messageIndex];
    
    // Add persistence indicator for repeated reminders
    if (reminderCount > 1) {
      message += `\n\n(Just checking in - let me know when you're done with this and I'll stop reminding you!)`;
    }
    
    return message;
  }

  async sendDailyPrompt(user: User): Promise<boolean> {
    try {
      const localToday = new Date().toLocaleDateString('en-CA', { timeZone: user.timezone });
      const greeting = (!user.name || user.name === 'there') ? 'there' : user.name;

      // Title = today's date in text format (e.g. "May 26")
      const dateTitle = new Date().toLocaleDateString('en-US', {
        timeZone: user.timezone, month: 'long', day: 'numeric',
      });

      // Auto-create daily todo list if it doesn't already exist
      let dailyList = await this.todoListService.findListByTitle(user.id, dateTitle);
      if (!dailyList) {
        dailyList = await this.todoListService.createList(user.id, dateTitle);
      }

      const itemCount = dailyList.items?.filter(i => !i.isCompleted)?.length || 0;
      const listStatus = itemCount > 0
        ? `You have ${itemCount} item${itemCount > 1 ? 's' : ''} on your *${dateTitle}* list already.`
        : `Your *${dateTitle}* list is ready and waiting for today's tasks!`;

      const message = [
        `☀️ Good morning, ${greeting}!`,
        '',
        listStatus,
        '',
        `Tell me what you need to do today and I'll add it to your *${dateTitle}* list with reminders if you'd like.`,
        '',
        `Example: "add review PR to ${dateTitle} list remind me at 3pm"`,
        'Or just list your tasks and I\'ll figure it out!',
      ].join('\n');

      await this.whatsappService.sendMessage(user.phone, message);
      await this.userService.updateUser(user.id, { lastDailyPromptDate: localToday });
      this.logger.log(`Daily prompt sent to user ${user.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send daily prompt to user ${user.id}:`, error);
      return false;
    }
  }

  async sendRetry(schedule: ReminderSchedule): Promise<boolean> {
    const retryDelay = Math.pow(2, schedule.retryCount) * 1000; // Exponential backoff
    
    this.logger.log(`Scheduling retry for reminder ${schedule.id} in ${retryDelay}ms`);
    
    // In a real implementation, you might use a job queue for retries
    // For now, we'll just wait and retry
    await new Promise(resolve => setTimeout(resolve, retryDelay));
    
    return this.sendReminder(schedule);
  }

  private async getTodayReminderCount(userId: string): Promise<number> {
    // This would typically query a daily reminder counter
    // For now, return 0 as a placeholder
    return 0;
  }

  private async incrementDailyReminderCount(userId: string): Promise<void> {
    // This would typically increment a daily reminder counter
    // For now, it's a placeholder
  }
}
