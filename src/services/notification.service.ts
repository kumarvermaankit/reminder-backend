import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { WhatsappService } from './whatsapp.service';
import { UserService } from './user.service';
import { TodoListService } from './todo-list.service';
import { StockService } from './stock.service';
import { CricketService } from './cricket.service';
import { IpoService } from './ipo.service';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly userService: UserService,
    private readonly todoListService: TodoListService,
    private readonly stockService: StockService,
    private readonly cricketService: CricketService,
    private readonly ipoService: IpoService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

      const message = await this.buildMessage(reminder, user.name);
      if (!message) return false;

      // Send based on user's preferred contact method
      let sent = false;
      switch (user.preferredContactMethod) {
        case 'whatsapp':
          if (user.phone) {
            const lastMsg = user.lastMessageTime ? new Date(user.lastMessageTime).getTime() : 0;
            const hoursSinceLastMsg = (Date.now() - lastMsg) / (1000 * 60 * 60);
            const outsideWindow = hoursSinceLastMsg > 24;

            if (outsideWindow) {
              // Send via template (works outside 24h window)
              const bodyComponents = [{
                type: 'body',
                parameters: [{ type: 'text', text: message }],
              }];
              sent = await this.whatsappService.sendTemplateMessage(user.phone, 'notifications', 'en', bodyComponents);
            } else {
              // Send interactive message with buttons (within 24h window)
              const buttons = reminder.isPersistent
                ? [{ id: `done:${schedule.id}`, title: 'Done ✅' }]
                : [
                    { id: `done:${schedule.id}`, title: 'Done ✅' },
                    { id: `snooze_10:${schedule.id}`, title: 'Snooze 10 min' },
                  ];
              const allButtons = buttons.length < 3
                ? [...buttons, { id: 'menu_btn', title: '📋 Menu' }]
                : buttons;
              await this.whatsappService.sendInteractiveMessage(user.phone, message, allButtons);
            }
            sent = true;
          }
          break;
        case 'email':
          this.logger.warn(`Email service not implemented for user ${user.id}`);
          break;
        case 'sms':
          this.logger.warn(`SMS service not implemented for user ${user.id}`);
          break;
      }

      if (sent) {
        this.logger.log(`Successfully sent reminder ${schedule.id} to user ${user.id} via ${user.preferredContactMethod}`);
        await this.incrementDailyReminderCount(user.id);

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

  private async buildMessage(reminder: any, userName: string): Promise<string | null> {
    let meta = reminder.metadata || {};
    // Handle case where JSON column is returned as string
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = {}; }
    }
    // Inline live data for stock alerts
    if (meta.type === 'stock_alert') {
      const quote = await this.stockService.getQuote(meta.stockSymbol || reminder.title);
      if (!quote) return null;
      let triggered = '';
      if (meta.targetPrice) {
        const hitAbove = meta.priceDirection === 'above' && quote.price >= meta.targetPrice;
        const hitBelow = meta.priceDirection === 'below' && quote.price <= meta.targetPrice;
        if (hitAbove || hitBelow) {
          triggered = `\n\n🎯 *TARGET HIT!* ${quote.company} is now at ₹${quote.price.toFixed(2)}`;
        }
      }
      return `${this.greeting(userName)} 📈 *${quote.company}*
${this.stockService.formatQuote(quote)}${triggered}`;
    }
    // Inline live data for match alerts
    if (meta.type === 'match_alert') {
      const matches = await this.cricketService.getLiveScores();
      if (matches.length === 0) return `${this.greeting(userName)} 🏏 No live matches right now.`;
      const match = meta.matchQuery
        ? await this.cricketService.searchMatch(meta.matchQuery)
        : matches[0];
      if (!match) return `${this.greeting(userName)} 🏏 No live matches right now.`;
      const detailed = await this.cricketService.getDetailedMatch(match.id);
      if (detailed && detailed.batsmanStriker) {
        return `${this.greeting(userName)}\n${this.cricketService.formatDetailedMatch(detailed)}`;
      }
      return `${this.greeting(userName)} 🏏 *${match.title}*
📊 ${match.score}
_${match.status}_`;
    }
    // Inline live data for IPO deadline alerts
    if (meta.type === 'ipo_alert') {
      const ipos = await this.ipoService.getCurrentIPOs();
      const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
      const parseCloseDate = (dateStr: string): Date | null => {
        const parts = dateStr.match(/(\d+)\s*(June|July|May|April|March|January|February|August|September|October|November|December)/i);
        if (!parts) return null;
        const day = parseInt(parts[1], 10);
        const month = MONTHS[parts[2].toLowerCase()];
        if (month === undefined) return null;
        return new Date(new Date().getFullYear(), month, day, 23, 59, 59);
      };
      const closing = ipos.filter(i => {
        const closeDate = parseCloseDate(i.date.split('-').pop()?.trim() || '');
        if (!closeDate) return false;
        const diff = closeDate.getTime() - Date.now();
        return diff > 0 && diff <= 86400000 * 2;
      });
      if (closing.length === 0) {
        const open = ipos.filter(i => {
          const closeDate = parseCloseDate(i.date.split('-').pop()?.trim() || '');
          return closeDate && closeDate.getTime() > Date.now();
        }).slice(0, 3);
        let msg = `${this.greeting(userName)} 📈 *IPO Deadline Check*\n\n`;
        if (open.length > 0) {
          msg += `No IPOs closing today. Here are the open IPOs:\n\n`;
          msg += open.map(i => `• *${i.name}* — closes ${i.date}\n  ${i.size} | ${i.priceBand || 'N/A'}`).join('\n\n');
        } else {
          msg += `No IPOs are currently open for application.\n\nSay *"current IPOs"* or *"upcoming IPOs"* to browse.`;
        }
        return msg;
      }
      let msg = `${this.greeting(userName)} 🚨 *IPO Closing Soon!*\n\n`;
      msg += `The following IPO${closing.length > 1 ? 's are' : ' is'} closing today/tomorrow — don't miss out!\n\n`;
      msg += closing.map(i => `• *${i.name}* — closes ${i.date}\n  ${i.size} | ${i.priceBand || 'N/A'}`).join('\n\n');
      msg += `\n\nApply before it closes! Say "done" to stop IPO alerts.`;
      return msg;
    }
    // Normal reminders — show list context if linked to a todo item
    if (reminder.todoItemId) {
      try {
        const item = await this.todoListService.getItemById(reminder.todoItemId);
        if (item && item.list) {
          return this.formatReminderMessage(
            reminder.title,
            `In ${item.list.title} list`,
            userName,
            reminder.reminderCount,
          );
        }
      } catch {
        // fall through to normal message
      }
    }
    return this.formatReminderMessage(reminder.title, reminder.description, userName, reminder.reminderCount);
  }

  private greeting(userName: string): string {
    return (!userName || userName === 'there' || userName.startsWith('WhatsApp User'))
      ? 'Hi!'
      : `Hey ${userName}!`;
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

      const todayTitle = new Date().toLocaleDateString('en-US', {
        timeZone: user.timezone, month: 'long', day: 'numeric',
      }) + ' Daily List';

      const existing = await this.todoListService.findListByTitle(user.id, todayTitle);
      const itemCount = existing?.items?.filter(i => !i.isCompleted)?.length || 0;

      let message: string;
      const lastMsg = user.lastMessageTime ? new Date(user.lastMessageTime).getTime() : 0;
      const hoursSinceLastMsg = (Date.now() - lastMsg) / (1000 * 60 * 60);
      const outsideWindow = hoursSinceLastMsg > 24;

      if (itemCount > 0) {
        message = [
          `☀️ Good morning, ${greeting}!`,
          '',
          `You have ${itemCount} item${itemCount > 1 ? 's' : ''} on your *${todayTitle}* list.`,
          '',
          `Tell me what you need to do today and I'll add it to your list with reminders if you'd like.`,
          '',
          `Example: "add review PR to ${todayTitle} list remind me at 3pm"`,
        ].join('\n');
        if (outsideWindow) {
          const bodyComponents = [{
            type: 'body',
            parameters: [{ type: 'text', text: message }],
          }];
          await this.whatsappService.sendTemplateMessage(user.phone, 'notifications', 'en', bodyComponents);
        } else {
          await this.whatsappService.sendWithMenu(user.phone, message);
        }
      } else {
        message = [
          `☀️ Good morning, ${greeting}!`,
          '',
          `Tap the button below to create your *${todayTitle}* list for today!`,
        ].join('\n');
        if (outsideWindow) {
          const bodyComponents = [{
            type: 'body',
            parameters: [{ type: 'text', text: message }],
          }];
          await this.whatsappService.sendTemplateMessage(user.phone, 'notifications', 'en', bodyComponents);
        } else {
          await this.whatsappService.sendInteractiveMessage(user.phone, message, [
            { id: 'daily_list_create', title: '📋 Create Daily List' },
            { id: 'menu_btn', title: '📋 Menu' },
          ]);
        }
      }

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

  // ── Inactivity ping ────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async pingInactiveUsers(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 23 * 60 * 60 * 1000);
      const inactives = await this.userRepository.find({
        where: {
          isActive: true,
          lastMessageTime: LessThan(cutoff),
        },
      });
      for (const user of inactives) {
        try {
          const name = (!user.name || user.name === 'there') ? '' : user.name;
          const header = name
            ? `Hey ${name}! 👋 It's been a while — what would you like to do?`
            : `Hey there! 👋 It's been a while — what would you like to do?`;
          await this.whatsappService.sendInteractiveMessage(user.phone, header, [
            { id: 'menu_view_list', title: '📋 Today\'s List' },
            { id: 'menu_show_reminders', title: '⏰ My Reminders' },
            { id: 'menu_create_reminder', title: '➕ New Reminder' },
          ]);
          await this.userService.updateUser(user.id, { lastMessageTime: new Date() });
          this.logger.log(`Inactivity ping sent to user ${user.id}`);
        } catch (e) {
          this.logger.error(`Failed to ping inactive user ${user.id}:`, e);
        }
      }
    } catch (e) {
      this.logger.error('Error in pingInactiveUsers:', e);
    }
  }
}
