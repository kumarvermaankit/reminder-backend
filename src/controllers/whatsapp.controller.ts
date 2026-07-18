import { Controller, Post, Body, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { WhatsappService } from '../services/whatsapp.service';
import { AiService } from '../services/ai.service';
import { UserService } from '../services/user.service';
import { ReminderService } from '../services/reminder.service';
import { NoteService } from '../services/note.service';
import { PasswordService } from '../services/password.service';
import { UserContextService } from '../services/user-context.service';
import { TodoListService } from '../services/todo-list.service';
import { ListWorkflowService } from '../services/list-workflow.service';
import { StockService } from '../services/stock.service';
import { CricketService } from '../services/cricket.service';
import { IpoService } from '../services/ipo.service';
import { GoogleCalendarService } from '../services/google-calendar.service';
import { CalorieHandlerService } from '../services/calorie-handler.service';
import { RazorpayPaymentService } from '../services/razorpay-payment.service';
import { WORKFLOWS } from '../constants/workflows';
import { appendChatTips, appendChatTipsDetailed } from '../constants/chat-tips';
import {
  lookupTimezone, guessTimezoneFromLocation,
  getOffsetMinutes, parseTimeString, localTimeToUtc,
  resolveDisplayTimezone, formatRelativeTime,
} from '../utils/timezone';
import { SYSTEM_QUERY_PROMPT } from '../constants/ai-prompts';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  private readonly processedMessages = new Set<string>();

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly aiService: AiService,
    private readonly userService: UserService,
    private readonly reminderService: ReminderService,
    private readonly noteService: NoteService,
    private readonly passwordService: PasswordService,
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly listWorkflowService: ListWorkflowService,
    private readonly stockService: StockService,
    private readonly cricketService: CricketService,
    private readonly ipoService: IpoService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly calorieHandlerService: CalorieHandlerService,
    private readonly razorpayPaymentService: RazorpayPaymentService,
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
    this.logger.log(`=== MESSAGE RECEIVED: ${messages.length} message(s) from metadata phone=${phoneNumber}`);

    for (const message of messages) {
      const msgId = message.id;
      const from = message.from;
      if (this.processedMessages.has(msgId)) {
        this.logger.log(`Duplicate message ${msgId} from ${from} skipped`);
        continue;
      }
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 300000);

      const replyToMsgId = message.context?.id || null;
      const msgTimestamp = message.timestamp
        ? new Date(parseInt(message.timestamp) * 1000)
        : new Date();
      this.logger.log(`WhatsApp msg: from=${from} type=${message.type} msgId=${msgId} timestamp=${msgTimestamp.toISOString()}`);

      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        const btn = message.interactive.button_reply;
        this.logger.log(`Button reply: from=${from} id="${btn.id}" title="${btn.title}"`);
        await this.handleButtonReply(from, btn, phoneNumber, replyToMsgId);
      } else if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
        const list = message.interactive.list_reply;
        this.logger.log(`List reply: from=${from} id="${list.id}" title="${list.title}"`);
        await this.handleListReply(from, list, msgTimestamp, msgId);
      } else if (message.type === 'text') {
        const text = message.text.body;
        this.logger.log(`Text message: from=${from} text="${text}"`);
        await this.processWhatsAppMessage(from, text, phoneNumber, replyToMsgId, msgTimestamp, msgId);
      } else {
        this.logger.log(`Unhandled message type: ${message.type} from=${from}`);
      }
    }
  }

  private async handleListReply(
    userPhone: string,
    listReply: { id: string; title: string },
    msgTimestamp?: Date,
    incomingMessageId?: string,
  ) {
    try {
      if (incomingMessageId) {
        await this.whatsappService.sendTypingIndicator(incomingMessageId);
      }

      let user = await this.userService.getUserByPhone(userPhone);
      if (!user) {
        user = await this.userService.createUser({
          phone: userPhone,
          name: 'there',
          email: `user_${userPhone}@reminder.app`,
          preferredContactMethod: 'whatsapp',
          timezone: 'UTC',
          isActive: true,
        });
      }

      await this.userService.updateUser(user.id, { lastMessageTime: new Date() });

      await this.userContextService.pushMessage(user.id, 'user', `[menu] ${listReply.title}`);

      const handled = await this.listWorkflowService.handleListReply(
        userPhone,
        user.id,
        listReply.id,
        user.timezone,
      );
      if (!handled) {
        const body = 'Sorry, that menu option is no longer valid. Tap 📋 *Menu* below to open the menu again.';
        await this.whatsappService.sendMessage(userPhone, body);
        await this.userContextService.pushMessage(user.id, 'assistant', body);
      }
    } catch (error) {
      this.logger.error('Error handling list reply:', error);
    }
  }

  private async handleButtonReply(
    userPhone: string,
    buttonReply: { id: string; title: string },
    businessPhone: string,
    replyToMsgId?: string,
  ) {
    try {
      if (this.listWorkflowService.isWorkflowButton(buttonReply.id)) {
        let user = await this.userService.getUserByPhone(userPhone);
        if (!user) {
          user = await this.userService.createUser({
            phone: userPhone,
            name: 'there',
            email: `user_${userPhone}@reminder.app`,
            preferredContactMethod: 'whatsapp',
            timezone: 'UTC',
            isActive: true,
          });
        }
        await this.userService.updateUser(user.id, { lastMessageTime: new Date() });
        await this.userContextService.pushMessage(user.id, 'user', `[button] ${buttonReply.title}`);
        await this.listWorkflowService.handleButton(userPhone, user.id, buttonReply.id);
        return;
      }

      // Menu button from the footer on every reply
      if (buttonReply.id === 'menu_btn') {
        let user = await this.userService.getUserByPhone(userPhone);
        if (!user) {
          user = await this.userService.createUser({
            phone: userPhone,
            name: 'there',
            email: `user_${userPhone}@reminder.app`,
            preferredContactMethod: 'whatsapp',
            timezone: 'UTC',
            isActive: true,
          });
        }
        await this.userService.updateUser(user.id, { lastMessageTime: new Date() });
        await this.userContextService.pushMessage(user.id, 'user', `[button] ${buttonReply.title}`);
        await this.listWorkflowService.sendSlideUpMenu(userPhone, user.id);
        return;
      }

      // Route menu action buttons (e.g. from inactivity ping) to the list workflow
      const menuRowIds = ['menu_view_list', 'menu_show_reminders', 'menu_create_reminder'];
      if (menuRowIds.includes(buttonReply.id)) {
        let user = await this.userService.getUserByPhone(userPhone);
        if (!user) {
          user = await this.userService.createUser({
            phone: userPhone,
            name: 'there',
            email: `user_${userPhone}@reminder.app`,
            preferredContactMethod: 'whatsapp',
            timezone: 'UTC',
            isActive: true,
          });
        }
        await this.userService.updateUser(user.id, { lastMessageTime: new Date() });
        await this.userContextService.pushMessage(user.id, 'user', `[button] ${buttonReply.title}`);
        await this.listWorkflowService.handleListReply(userPhone, user.id, buttonReply.id, user.timezone);
        return;
      }

      const [action, scheduleId] = buttonReply.id.split(':');
      if (!scheduleId) {
        this.logger.warn(`Invalid button reply id: ${buttonReply.id}`);
        return;
      }

      const schedule = await this.reminderService.getScheduleById(scheduleId);
      if (!schedule || !schedule.reminder) {
        this.logger.warn(`Schedule ${scheduleId} not found for button reply`);
        return;
      }

      const reminder = schedule.reminder;

      // Load user for timezone-aware display
      const reminderUser = await this.userService.getUserById(reminder.userId);
      const tz = reminderUser?.timezone || 'UTC';

      let botResponse: string;

      if (action === 'done') {
        // If linked to a todo item, complete it too
        if (reminder.todoItemId) {
          try {
            const result = await this.todoListService.completeItem(reminder.todoItemId, reminder.userId);
            if (result.listDeleted) {
              botResponse = `✅ Marked "${reminder.title}" as done and cleaned up the empty list!`;
            } else {
              botResponse = `✅ Marked "${reminder.title}" as done!`;
            }
          } catch {
            // fall through — still mark the reminder done even if todo item can't be found
            botResponse = `✅ Marked "${reminder.title}" as done!`;
          }
        } else {
          botResponse = `✅ Marked "${reminder.title}" as done!`;
        }
        await this.reminderService.markAsCompleted(reminder.id);
        await this.reminderService.deleteReminder(reminder.id);
        await this.reminderService.deleteAllSchedulesForReminder(reminder.id);
      } else if (action === 'snooze_5') {
        const nextTime = new Date(Date.now() + 5 * 60 * 1000);
        await this.reminderService.createSchedule(reminder.id, nextTime);
        const timeStr = nextTime.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
        botResponse = `⏰ Snoozed "${reminder.title}" for 5 minutes. I'll remind you again at ${timeStr}.`;
      } else if (action === 'snooze_10') {
        const nextTime = new Date(Date.now() + 10 * 60 * 1000);
        await this.reminderService.createSchedule(reminder.id, nextTime);
        const timeStr = nextTime.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
          botResponse = `⏰ Snoozed "${reminder.title}" for 10 minutes. I'll remind you again at ${timeStr}.`;
        } else {
          botResponse = "Got it!";
        }
        await this.whatsappService.sendWithMenu(userPhone, botResponse);
      await this.userContextService.pushMessage(reminder.userId, 'assistant', botResponse);
    } catch (error) {
      this.logger.error('Error handling button reply:', error);
    }
  }

  private async processWhatsAppMessage(
    userPhone: string,
    message: string,
    businessPhone: string,
    replyToMsgId?: string,
    msgTimestamp?: Date,
    incomingMessageId?: string,
  ) {
    try {
      this.logger.log(`Processing message from ${userPhone}: "${message}"`);

      if (incomingMessageId) {
        await this.whatsappService.sendTypingIndicator(incomingMessageId);
      }

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
      
      // Track last message time for inactivity ping
      await this.userService.updateUser(user.id, { lastMessageTime: msgTimestamp || new Date() });
      
      console.log("msgTimestamp", msgTimestamp);
      // // Auto-detect timezone from WhatsApp message timestamp + greeting
      // if (user.timezone === 'UTC' && msgTimestamp) {
      //   const inferred = this.userService.inferTimezone(msgTimestamp, message);
      //   if (inferred && inferred !== 'UTC') {
      //     this.logger.log(`Inferred timezone "${inferred}" for user ${user.id} from message timestamp + greeting`);
      //     user = await this.userService.updateUser(user.id, { timezone: inferred });
      //   }
      // }

      // Push user message to conversation history
      await this.userContextService.pushMessage(user.id, 'user', message);

      // List creation/edit wizards, menu, slash commands — before onboarding / AI
      if (await this.listWorkflowService.handleEditWorkflow(userPhone, user.id, message)) {
        return;
      }
      if (await this.listWorkflowService.handleCreateWorkflow(userPhone, user.id, message)) {
        return;
      }
      if (await this.listWorkflowService.handleMenuText(userPhone, user.id, message)) {
        return;
      }
      if (await this.listWorkflowService.handleSlashCommand(
        userPhone, user.id, message, user.timezone,
      )) {
        return;
      }

      // Calorie tracking setup workflow
      const calorieWf = await this.userContextService.getCalorieWorkflow(user.id);
      if (calorieWf) {
        const result = await this.calorieHandlerService.handleWorkflowStep(userPhone, user.id, message, calorieWf);
        if (result) {
          await this.sendAssistantReply(userPhone, user.id, result);
          return;
        }
      }

      // Onboarding: check if user hasn't set their name yet
      const greetings = ['hi', 'hello', 'hey', 'hii', 'heyy', 'start'];
      const isGreeting = greetings.includes(message.toLowerCase().trim());

      if (user.name === 'there' && isGreeting) {
        const botMsg = `Hi there! 👋 I'm your Reminder Assistant.\n\nTo get started, could you tell me your name and timezone?\n\nFor example: "I'm John from Mumbai" or "I'm John, IST" or "John, UTC+5:30"`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // Extract name and location from response (e.g. "I'm John from Mumbai")
      const infoMatch = message.match(/(?:i(?:'| a)m\s+)?(\w+)\s+(?:from|in|at)\s+(.+)/i);
      if (infoMatch && user.name === 'there') {
        const newName = infoMatch[1];
        const location = infoMatch[2].trim();
        await this.userService.updateUser(user.id, { name: newName });
        user.name = newName;

        const tz = lookupTimezone(location) || guessTimezoneFromLocation(location);
        if (tz) {
          await this.userService.updateUser(user.id, { timezone: tz });
          user.timezone = tz;
          const botMsg = `Nice to meet you, ${newName}! 🌍 I've set your timezone to ${tz} based on your location.\n\nNow, what would you like me to remind you about?`;
          await this.whatsappService.sendMessage(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        } else {
          const botMsg = `Nice to meet you, ${newName}! 🎉 What would you like me to remind you about?`;
          await this.whatsappService.sendMessage(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        }
        return;
      }

      // Simple name-only intro (no location) — asks for city next
      const nameMatch = message.match(/i(?:'| a)m\s+(\w+)/i);
      if (nameMatch && user.name === 'there') {
        const newName = nameMatch[1];
        await this.userService.updateUser(user.id, { name: newName });
        user.name = newName;
        const botMsg = `Nice to meet you, ${newName}! 🎉 Also, what's your timezone? (e.g., IST, UTC+5:30, or your city name)`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // Check if user has a pending reminder message and replies with a city/timezone
      const pendingMsg = await this.userContextService.getPendingTimezoneMessage(user.id);
      if (pendingMsg && user.timezone === 'UTC') {
        const tz = lookupTimezone(message) || guessTimezoneFromLocation(message);
        if (tz) {
          await this.userService.updateUser(user.id, { timezone: tz });
          user.timezone = tz;
          await this.userContextService.clearPendingTimezoneMessage(user.id);
          this.logger.log(`Timezone set to ${tz}, re-processing pending message: "${pendingMsg}"`);
          message = pendingMsg;
        } else {
          const botMsg = `I'm not sure which timezone that is. Try a city name (e.g. "Mumbai", "New York") or timezone code (e.g. "IST", "UTC+5:30").`;
          await this.whatsappService.sendMessage(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
          return;
        }
      }

      // Handle city-only response after name was set (e.g. user says "Mumbai" or "from Mumbai")
      if (user.name !== 'there' && user.timezone === 'UTC') {
        const cityMatch = message.match(/(?:i(?:'| a)m\s+)?(?:from|in|at\s+)?(.+)/i);
        if (cityMatch) {
          const location = cityMatch[1].trim().toLowerCase();
          const tz = lookupTimezone(location) || guessTimezoneFromLocation(location);
          if (tz) {
            await this.userService.updateUser(user.id, { timezone: tz });
            user.timezone = tz;
            const botMsg = `🌍 Got it! I've set your timezone to ${tz}.\n\nNow, what would you like me to remind you about?`;
            await this.whatsappService.sendMessage(userPhone, botMsg);
            await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
            return;
          }
        }
      }

      // Check for timezone update request
      const tzMatch = message.match(/(?:timezone|tz|time zone)\s+(?:is\s+)?(.+)/i);
      if (tzMatch) {
        const tz = tzMatch[1].trim();
        const validTz = lookupTimezone(tz);
        if (validTz) {
          await this.userService.updateUser(user.id, { timezone: validTz });
          user.timezone = validTz;
          const botMsg = `Got it! Your timezone is set to ${validTz}.`;
          await this.whatsappService.sendMessage(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
          return;
        } else {
          const botMsg = `I'm not sure which timezone that is. Try something like "timezone is Asia/Kolkata" or "timezone is America/New_York".`;
          await this.whatsappService.sendMessage(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
          return;
        }
      }

      // Get conversation history and pending reminders for AI context
      const conversation = await this.userContextService.getConversation(user.id);
      const pendingReminders = await this.reminderService.getPendingRemindersForUser(user.id);
      this.logger.log(`User has ${pendingReminders.length} pending reminders`);

      // Check for pending list selection (user responded with a number or numbers)
      const pendingSelection = await this.userContextService.getPendingListSelection(user.id);
      if (pendingSelection) {
        // ── confirm_delete_list: multi-select with "all" / "cancel" support ──
        if (pendingSelection.actionType === 'confirm_delete_list') {
          const trimmed = message.trim().toLowerCase();
          if (trimmed === 'cancel') {
            await this.userContextService.clearPendingListSelection(user.id);
            const botMsg = '👍 Deletion cancelled.';
            await this.sendAssistantReply(userPhone, user.id, botMsg);
            return;
          }
          if (trimmed === 'all') {
            await this.userContextService.clearPendingListSelection(user.id);
            const count = await this.todoListService.deleteLists(pendingSelection.listIds);
            const botMsg = `🗑️ Deleted ${count} list(s)!`;
            await this.sendAssistantReply(userPhone, user.id, botMsg);
            return;
          }
          // Parse numbers from the reply, understanding intent
          const allNums = trimmed.split(/[, ]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0 && n <= pendingSelection.listIds.length);
          if (allNums.length === 0) {
            const botMsg = `Please reply with the numbers you want to *keep*, "all", or "cancel".`;
            await this.sendAssistantReply(userPhone, user.id, botMsg);
            return;
          }
          await this.userContextService.clearPendingListSelection(user.id);
          // If user said "delete X, Y", those are the ones to delete
          // If user said "keep X, Y" or just "X, Y", those are the ones to keep
          const wantsDelete = /\b(delete|remove|trash)\b/.test(trimmed);
          const deleteIds = wantsDelete
            ? allNums.map(n => pendingSelection.listIds[n - 1])
            : pendingSelection.listIds.filter((_, i) => !allNums.includes(i + 1));
          const count = await this.todoListService.deleteLists(deleteIds);
          const kept = pendingSelection.listIds.length - count;
          const botMsg = count === 0
            ? 'No lists were deleted.'
            : `🗑️ Deleted ${count} list(s), kept ${kept}.`;
          await this.sendAssistantReply(userPhone, user.id, botMsg);
          return;
        }

        // ── Other action types: single number selection ──
        const selectionNum = parseInt(message.trim(), 10);
        if (selectionNum > 0 && selectionNum <= pendingSelection.listIds.length) {
          this.logger.log(`Resolving list selection: ${selectionNum} (${pendingSelection.actionType})`);
          await this.userContextService.clearPendingListSelection(user.id);
          const selectedId = pendingSelection.listIds[selectionNum - 1];
          const list = await this.todoListService.getList(selectedId, user.id);
          let selRes: string;
          switch (pendingSelection.actionType) {
          case 'get_todo':
            selRes = this.todoListService.formatList(list, user.timezone);
            break;
          case 'complete_todo_item':
            selRes = await this.handlePendingListCompleteTodo(list, pendingSelection, user);
            break;
          case 'edit_todo_item':
            selRes = await this.handlePendingListEditTodo(list, pendingSelection, user);
            break;
          case 'edit_todo_list':
            await this.listWorkflowService.startEditList(userPhone, user.id, selectedId);
            selRes = '';
            break;
          case 'delete_list':
            await this.todoListService.deleteList(selectedId, user.id);
            selRes = `🗑️ Deleted "${pendingSelection.title}" list!`;
            break;
          default:
            selRes = this.todoListService.formatList(list, user.timezone);
        }
        await this.sendAssistantReply(userPhone, user.id, selRes);
        return;
      }
      } // closes outer if (pendingSelection)

      // ── Pending payment plan selection ──
      const pendingPlan = await this.userContextService.getPendingPaymentPlan(user.id);
      if (pendingPlan) {
        const trimmed = message.trim();
        if (trimmed.toLowerCase() === 'cancel') {
          await this.userContextService.clearPendingPaymentPlan(user.id);
          await this.sendAssistantReply(userPhone, user.id, '👍 Payment cancelled.');
          return;
        }
        if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
          const plans = ['helper', 'assistant', 'manager'];
          const planId = plans[parseInt(trimmed, 10) - 1];
          await this.userContextService.clearPendingPaymentPlan(user.id);
          const planConfig = this.razorpayPaymentService.getPlanConfig(planId);
          if (!planConfig) {
            await this.sendAssistantReply(userPhone, user.id, 'Invalid plan. Please try again.');
            return;
          }
          const currency = this.razorpayPaymentService.getCurrencyForCountry(user.country || 'IN');
          const monthlyPricing = planConfig.pricing_monthly[currency] || planConfig.pricing_monthly['USD'];
          const yearlyPricing = planConfig.pricing_yearly[currency] || planConfig.pricing_yearly['USD'];
          const monthlyDisplay = (monthlyPricing / 100).toLocaleString('en-IN');
          const yearlyDisplay = (yearlyPricing / 100).toLocaleString('en-IN');
          const currencySymbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency;

          const msg =
            `🛒 *${planConfig.name}* plan selected\n\n` +
            `💰 *Monthly:* ${currencySymbol}${monthlyDisplay}/mo\n` +
            `💎 *Yearly:* ${currencySymbol}${yearlyDisplay}/yr (save ~${Math.round((1 - yearlyPricing / (monthlyPricing * 12)) * 100)}%)\n\n` +
            `Reply with *M* for monthly or *Y* for yearly, or *cancel* to abort.`;

          await this.userContextService.setPendingPaymentPlan(user.id, `confirm_${planId}`);
          await this.sendAssistantReply(userPhone, user.id, msg);
          return;
        }
        if (pendingPlan.startsWith('confirm_')) {
          const planId = pendingPlan.replace('confirm_', '');
          if (trimmed.toUpperCase() === 'M' || trimmed.toUpperCase() === 'Y') {
            const interval = trimmed.toUpperCase() === 'M' ? 'monthly' : 'yearly';
            await this.userContextService.clearPendingPaymentPlan(user.id);
            const planConfig = this.razorpayPaymentService.getPlanConfig(planId);
            if (!planConfig) {
              await this.sendAssistantReply(userPhone, user.id, 'Invalid plan. Please try again.');
              return;
            }
            const currency = this.razorpayPaymentService.getCurrencyForCountry(user.country || 'IN');
            const amount = interval === 'yearly'
              ? (planConfig.pricing_yearly[currency] || planConfig.pricing_yearly['USD'])
              : (planConfig.pricing_monthly[currency] || planConfig.pricing_monthly['USD']);
            const displayAmount = (amount / 100).toLocaleString('en-IN');
            const currencySymbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency;

            const url = await this.razorpayPaymentService.createPaymentLink(
              amount, user.id, `${planConfig.name} (${interval})`, planId as any, interval,
            );
            if (!url) {
              await this.sendAssistantReply(userPhone, user.id, "Sorry, I couldn't create a payment link. Please try again later.");
              return;
            }
            await this.sendAssistantReply(
              userPhone, user.id,
              `🔗 Click here to complete your *${planConfig.name}* (${interval}) payment of ${currencySymbol}${displayAmount}:\n\n${url}\n\nOnce done, your plan will be activated automatically.`,
            );
            return;
          }
          await this.sendAssistantReply(userPhone, user.id, 'Reply with *M* for monthly or *Y* for yearly, or *cancel* to abort.');
          return;
        }
        await this.userContextService.clearPendingPaymentPlan(user.id);
      }

      // Handle simple greetings without AI call
      const greetingMatch = message.trim().match(/^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening))[.!]*$/i);
      if (greetingMatch && user.name !== 'there') {
        const botMsg = appendChatTipsDetailed(
          `Hi ${user.name}! 😊 How can I help you today?`,
        );
        await this.sendAssistantReply(userPhone, user.id, botMsg, false);
        return;
      }

      // Check if user is marking a reminder as done (before full AI parse)
      if (pendingReminders.length > 0) {
        const completionCheck = await this.aiService.detectTaskCompletion(message, pendingReminders);
        if (completionCheck.completed && completionCheck.reminderId) {
          this.logger.log(`Completion detected: reminderId=${completionCheck.reminderId}`);
          const reminder = pendingReminders.find(r => r.id === completionCheck.reminderId);
          await this.reminderService.markAsCompleted(completionCheck.reminderId);
          await this.reminderService.deleteReminder(completionCheck.reminderId);
          await this.reminderService.deleteAllSchedulesForReminder(completionCheck.reminderId);
          const botMsg = reminder
            ? `✅ Marked "${reminder.title}" as done!`
            : completionCheck.response || '✅ Done!';
          await this.sendAssistantReply(userPhone, user.id, botMsg);
          return;
        }
      }

      // Parse message via AI with full context
      this.logger.log('Parsing message via AI...');
      const parsed = await this.aiService.parseReminderInput(
        message, user.id, conversation, pendingReminders, msgTimestamp, user.timezone,
      );
      this.logger.log(`AI parsed: actionType=${parsed.actionType}, confidence=${parsed.confidence}, localTime="${parsed.localTime || ''}"`);

      // ── Timezone check + time conversion ────────────────────────────────────
      // Convert local wall-clock time to UTC for reminder/list actions
      if ((parsed.localTime || parsed.dayOfWeek) && msgTimestamp) {
        if (user.timezone === 'UTC') {
          await this.userContextService.setPendingTimezoneMessage(user.id, message);
          const botMsg = `I see you want a reminder at ${parsed.localTime || parsed.dayOfWeek}! First, what's your city or timezone? (e.g. "Mumbai", "New York", "IST")`;
          await this.whatsappService.sendWithMenu(userPhone, botMsg);
          await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
          return;
        }
        const offsetMin = getOffsetMinutes(user.timezone, msgTimestamp);
        const dayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

        // Start with msgTimestamp converted to user's local date
        const localNow = new Date(msgTimestamp.getTime() + offsetMin * 60000);
        let hours = 9, minutes = 0; // default time
        let year = localNow.getUTCFullYear();
        let month = localNow.getUTCMonth();
        let day = localNow.getUTCDate();

        // If AI provided a specific date (e.g. "2026-07-28"), use it instead of today
        if (parsed.reminderDate) {
          const d = new Date(parsed.reminderDate);
          if (!isNaN(d.getTime())) {
            year = d.getUTCFullYear();
            month = d.getUTCMonth();
            day = d.getUTCDate();
          }
        }

        if (parsed.localTime) {
          const parsedTime = parseTimeString(parsed.localTime);
          if (parsedTime) { hours = parsedTime.h; minutes = parsedTime.m; }
        }

        // Build the target date in user's local time
        let targetLocal = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

        // If dayOfWeek, adjust to next occurrence
        if (parsed.dayOfWeek) {
          const targetDay = dayMap[parsed.dayOfWeek.toLowerCase()];
          if (targetDay !== undefined) {
            const currentDay = localNow.getUTCDay();
            let daysUntil = (targetDay - currentDay + 7) % 7;
            if (daysUntil === 0) daysUntil = 7; // next week
            targetLocal.setUTCDate(targetLocal.getUTCDate() + daysUntil);
            this.logger.log(`dayOfWeek: "${parsed.dayOfWeek}" → next in ${daysUntil} days`);
            if (!parsed.intervalMinutes) parsed.intervalMinutes = 10080;
          }
        } else if (!parsed.reminderDate) {
          // No dayOfWeek and no specific date: if the computed time is in the past, advance to next day
          if (targetLocal <= localNow) {
            targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
          }
        }

        // Convert back to UTC
        const utcDate = new Date(targetLocal.getTime() - offsetMin * 60000);
        this.logger.log(`Time: localTime="${parsed.localTime}" dayOfWeek="${parsed.dayOfWeek}" offset=${offsetMin}min targetLocal=${targetLocal.toISOString()} → utc=${utcDate.toISOString()}`);
        parsed.reminderDate = utcDate;
      }

      // Save user's name if AI extracted one
      if (parsed.userName && (user.name === 'there' || user.name.startsWith('WhatsApp User'))) {
        this.logger.log(`Updating user name to "${parsed.userName}"`);
        await this.userService.updateUser(user.id, { name: parsed.userName });
        user.name = parsed.userName;
      }

      // Resolve date-based list references to the proper daily list title
      if (parsed.todoListTitle) {
        const lower = parsed.todoListTitle.toLowerCase();
        if (/^(daily|today|today's|todolist|todo)$/.test(lower)) {
          parsed.todoListTitle = this.userService.dailyListTitle(user.timezone, 0);
        } else if (/^(yesterday|yesterday's|yday)$/.test(lower)) {
          parsed.todoListTitle = this.userService.dailyListTitle(user.timezone, -1);
        } else if (/^(tomorrow|tomorrow's)$/.test(lower)) {
          parsed.todoListTitle = this.userService.dailyListTitle(user.timezone, 1);
        }
      }

      // Dispatch based on action type
      let botResponse: string;

      switch (parsed.actionType) {
        case 'complete_reminder':
          botResponse = await this.handleCompleteReminder(parsed, pendingReminders, user);
          break;
        case 'save_note':
          botResponse = await this.handleSaveNote(parsed, user);
          break;
        case 'get_note':
          botResponse = await this.handleGetNote(parsed, user);
          break;
        case 'save_password':
          botResponse = await this.handleSavePassword(parsed, user);
          break;
        case 'create_todo':
          botResponse = await this.handleCreateTodo(parsed, user, msgTimestamp);
          break;
        case 'add_todo_item':
          botResponse = await this.handleAddTodoItem(parsed, user, msgTimestamp);
          break;
        case 'get_todo':
          botResponse = await this.handleGetTodo(parsed, user);
          break;
        case 'complete_todo_item':
          botResponse = await this.handleCompleteTodoItem(parsed, user);
          break;
        case 'edit_todo_item':
          botResponse = await this.handleEditTodoItem(parsed, user);
          break;
        case 'edit_todo_list':
          botResponse = await this.handleEditTodoList(parsed, user);
          break;
        case 'delete_list':
          botResponse = await this.handleDeleteList(parsed, user);
          break;
        case 'get_password':
          botResponse = await this.handleGetPassword(parsed, user);
          break;
        case 'update_settings':
          botResponse = await this.handleUpdateSettings(parsed, user);
          break;
        case 'system_query':
          botResponse = await this.handleSystemQuery(message);
          break;
        case 'check_stock':
          botResponse = await this.handleCheckStock(parsed);
          break;
        case 'check_cricket':
          botResponse = await this.handleCheckCricket(parsed);
          break;
        case 'check_ipo':
          botResponse = await this.handleCheckIpo(parsed);
          break;
        case 'stock_alert':
          botResponse = await this.handleStockAlert(parsed, user, msgTimestamp);
          break;
        case 'match_alert':
          botResponse = await this.handleMatchAlert(parsed, user, msgTimestamp);
          break;
        case 'ipo_alert':
          botResponse = await this.handleIpoAlert(parsed, user, msgTimestamp);
          break;
        case 'connect_calendar':
          botResponse = await this.handleConnectCalendar(user);
          break;
        case 'create_event':
          botResponse = await this.handleCreateEvent(parsed, user, msgTimestamp);
          break;
        case 'list_events':
          botResponse = await this.handleListEvents(user);
          break;
        case 'calorie_setup':
          botResponse = await this.calorieHandlerService.handleSetup(parsed, user);
          break;
        case 'log_food':
          botResponse = await this.calorieHandlerService.handleLogFood(parsed, user);
          break;
        case 'calorie_status':
          botResponse = await this.calorieHandlerService.handleStatus(user);
          break;
        case 'diet_advice':
          botResponse = await this.calorieHandlerService.handleDietAdvice(user);
          break;
        case 'make_payment':
          botResponse = await this.handlePayment(user);
          break;
        default:
          botResponse = await this.handleCreateReminderOrFallback(parsed, user, msgTimestamp);
      }

      const withCompactTips =
        botResponse.includes('Examples you can try') ? false : true;
      await this.sendAssistantReply(userPhone, user.id, botResponse, withCompactTips);

    } catch (error) {
      this.logger.error('Error processing WhatsApp message:', error);
      const user = await this.userService.getUserByPhone(userPhone);
      const errMsg = appendChatTips('Sorry, I had trouble processing that. Please try again!');
      if (user) {
        await this.sendAssistantReply(userPhone, user.id, errMsg, false);
      } else {
        await this.whatsappService.sendMessage(userPhone, errMsg);
      }
    }
  }

  private resolveOrdinal(ref: string, items: any[]): any | null {
    const lower = ref.toLowerCase();
    if (/^(first|1st|#1|top)\b/.test(lower)) return items[0] || null;
    if (/^(second|2nd|#2)\b/.test(lower)) return items[1] || null;
    if (/^(third|3rd|#3)\b/.test(lower)) return items[2] || null;
    if (/^last\b/.test(lower)) return items[items.length - 1] || null;
    const nth = lower.match(/^(\d+)(?:st|nd|rd|th)\b/);
    if (nth) {
      const idx = parseInt(nth[1], 10) - 1;
      if (idx >= 0 && idx < items.length) return items[idx];
    }
    return null;
  }

  private async handlePendingListCompleteTodo(
    list: any,
    pendingSelection: any,
    user: any,
  ): Promise<string> {
    const targets = pendingSelection.itemTargets || [];
    let doneCount = 0;
    let listDeleted = false;
    const pending = list.items.filter(i => !i.isCompleted);
    for (const target of targets) {
      let match = this.resolveOrdinal(target, pending);
      if (!match) {
        match = pending.find(i =>
          i.content.toLowerCase().includes(target.toLowerCase())
        );
      }
      if (match) {
        const result = await this.todoListService.completeItem(match.id, user.id);
        doneCount++;
        if (result.listDeleted) listDeleted = true;
      }
    }
    return listDeleted
      ? `✅ All items done in ${list.title}! The list has been cleaned up. 🎉`
      : doneCount > 0
        ? `✅ Marked ${doneCount} item(s) as done in ${list.title}!`
        : `I couldn't find those items in the ${list.title} list.`;
  }

  private async handlePendingListEditTodo(
    list: any,
    pendingSelection: any,
    user: any,
  ): Promise<string> {
    const ref = pendingSelection.itemRef || '';
    const newContent = pendingSelection.newContent || '';
    const pending = list.items.filter(i => !i.isCompleted);
    let match = this.resolveOrdinal(ref, pending);
    if (!match) {
      match = pending.find(i => i.content.toLowerCase().includes(ref.toLowerCase())) || null;
    }
    if (match) {
      await this.todoListService.updateItem(match.id, user.id, newContent);
      return `✅ Updated "${ref}" to "${newContent}" in ${list.title}!`;
    }
    return `I couldn't find "${ref}" in the ${list.title} list.`;
  }

  private async handleCompleteReminder(
    parsed: any,
    pendingReminders: any[],
    user: any,
  ): Promise<string> {
    if (parsed.reminderId && pendingReminders.some(r => r.id === parsed.reminderId)) {
      this.logger.log(`AI matched reminder ID ${parsed.reminderId} for completion`);
      const reminder = pendingReminders.find(r => r.id === parsed.reminderId);
      await this.reminderService.markAsCompleted(parsed.reminderId);
      await this.reminderService.deleteReminder(parsed.reminderId);
      await this.reminderService.deleteAllSchedulesForReminder(parsed.reminderId);
      return `✅ Marked "${reminder.title}" as done!`;
    }
    return "I'm not sure which reminder you're referring to. Please tell me the name of the reminder you'd like to mark as done.";
  }

  private async handleSaveNote(parsed: any, user: any): Promise<string> {
    if (parsed.noteKey && parsed.noteContent) {
      try {
        await this.noteService.createNote(user.id, parsed.noteKey, parsed.noteContent);
        return `✅ Saved "${parsed.noteKey}" for you!`;
      } catch (e) {
        this.logger.error('Failed to save note:', e);
        return 'Sorry, I could not save that note.';
      }
    }
    return "What would you like me to save? Tell me a title and some content.";
  }

  private async handleGetNote(parsed: any, user: any): Promise<string> {
    if (parsed.noteKey) {
      const notes = await this.noteService.searchNotes(user.id, parsed.noteKey);
      if (notes.length > 0) {
        return notes.map(n => `📝 *${n.title}*:\n${n.content}`).join('\n\n');
      }
      return `I couldn't find a note matching "${parsed.noteKey}". Try asking with a different title — say "list my notes" to see what you have.`;
    }
    const all = await this.noteService.getAllNotesByUser(user.id);
    if (all.length > 0) {
      return `Here are your notes:\n${all.map(n => `• ${n.title}`).join('\n')}\n\nAsk for one by name!`;
    }
    return "You don't have any saved notes yet. Save one by saying 'remember that my email is xyz'.";
  }

  private async handleSavePassword(parsed: any, user: any): Promise<string> {
    if (parsed.serviceName && parsed.password) {
      try {
        const saved = await this.passwordService.savePassword(
          user.id, parsed.serviceName, '', parsed.password
        );
        return `🔐 Saved password for *${parsed.serviceName}* (${saved.createdAt.toLocaleString()})`;
      } catch (e) {
        this.logger.error('Failed to save password:', e);
        return 'Sorry, I could not save that password.';
      }
    }
    return "Please tell me the service name and password you'd like to save. For example: 'save my facebook password as abc123'";
  }

  private async handleCreateTodo(
    parsed: any,
    user: any,
    msgTimestamp?: Date,
  ): Promise<string> {
    if (parsed.todoListTitle) {
      try {
        const list = await this.todoListService.createList(user.id, parsed.todoListTitle);
        const items = parsed.todoItemContents || [];
        if (items.length > 0) {
          for (const item of items) {
            const saved = await this.todoListService.addItem(list.id, user.id, item, parsed.reminderDate);
            if (parsed.reminderDate) {
              await this.reminderService.createReminder({
                userId: user.id,
                title: parsed.title || item,
                description: `In ${parsed.todoListTitle} list`,
                reminderDate: parsed.reminderDate,
                todoItemId: saved.id,
                msgTimestamp,
              });
            }
          }
          const reminderNote = parsed.reminderDate ? ` 🔔 I'll remind you about it.` : '';
          return `📋 Created "${parsed.todoListTitle}" with ${items.length} items!${reminderNote}`;
        }
        return `📋 Created a new list "${parsed.todoListTitle}"! Add items by saying "add ... to ${parsed.todoListTitle}".`;
      } catch (e) {
        this.logger.error('Failed to create todo list:', e);
        return 'Sorry, I could not create that list.';
      }
    }
    return "What would you like to call your new list?";
  }

  private async handleAddTodoItem(
    parsed: any,
    user: any,
    msgTimestamp?: Date,
  ): Promise<string> {
    const listTitle = parsed.todoListTitle || 'general';
    const items = parsed.todoItemContents || (parsed.todoItemContent ? [parsed.todoItemContent] : parsed.noteKey ? [parsed.noteKey] : []);
    if (items.length > 0) {
      try {
        let list = await this.todoListService.findListByTitle(user.id, listTitle);
        if (!list) {
          list = await this.todoListService.createList(user.id, listTitle);
        }
        for (const item of items) {
          const saved = await this.todoListService.addItem(list.id, user.id, item, parsed.reminderDate);
          if (parsed.reminderDate) {
            await this.reminderService.createReminder({
              userId: user.id,
              title: parsed.title || item,
              description: `In ${listTitle} list`,
              reminderDate: parsed.reminderDate,
              todoItemId: saved.id,
              msgTimestamp,
            });
          }
        }
        const label = items.length === 1 ? items[0] : `${items.length} items`;
        const reminderNote = parsed.reminderDate ? ` 🔔 I'll remind you about ${items.length === 1 ? 'it' : 'them'}.` : '';
        return `✅ Added "${label}" to ${listTitle} list!${reminderNote}`;
      } catch (e) {
        this.logger.error('Failed to add todo item:', e);
        return 'Sorry, I could not add that item.';
      }
    }
    return "What would you like to add to the list?";
  }

  private async handleGetTodo(parsed: any, user: any): Promise<string> {
    if (parsed.todoListTitle) {
      try {
        const lists = await this.todoListService.findListsByTitle(user.id, parsed.todoListTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            return this.todoListService.formatList(lists[0], user.timezone);
          }
          await this.userContextService.setPendingListSelection(user.id, {
            title: parsed.todoListTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'get_todo',
          });
          return `I found ${lists.length} lists called "${parsed.todoListTitle}":\n\n${lists.map((l, i) =>
            `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
          ).join('\n')}\n\nReply with the number to pick one.`;
        }
        return `I don't have a list called "${parsed.todoListTitle}".`;
      } catch (e) {
        this.logger.error('Failed to get todo list:', e);
        return 'Sorry, I could not retrieve that list.';
      }
    }
    const lists = await this.todoListService.getLists(user.id);
    if (lists.length > 0) {
      return `Here are your lists:\n${lists.map(l => `• ${l.title}`).join('\n')}\n\nAsk to see one by name!`;
    }
    return "You don't have any lists yet. Create one by saying something like 'start a shopping list'.";
  }

  private async handleCompleteTodoItem(parsed: any, user: any): Promise<string> {
    const listTitle = parsed.todoListTitle || 'general';
    const items = parsed.todoItemContents || (parsed.todoItemContent ? [parsed.todoItemContent] : parsed.noteKey ? [parsed.noteKey] : []);
    if (items.length > 0) {
      try {
        const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            let doneCount = 0;
            let listDeleted = false;
            const allItems = await this.todoListService.getItems(lists[0].id, user.id);
            const pending = allItems.filter(i => !i.isCompleted);
            for (const target of items) {
              let match = this.resolveOrdinal(target, pending);
              if (!match) {
                match = pending.find(i =>
                  i.content.toLowerCase().includes(target.toLowerCase())
                );
              }
              if (match) {
                const result = await this.todoListService.completeItem(match.id, user.id);
                doneCount++;
                if (result.listDeleted) listDeleted = true;
              }
            }
            if (listDeleted) {
              return `✅ All items done in ${listTitle}! The list has been cleaned up. 🎉`;
            }
            if (doneCount > 0) {
              return `✅ Marked ${doneCount} item(s) as done in ${listTitle}!`;
            }
            return `I couldn't find those items in the ${listTitle} list.`;
          }
          await this.userContextService.setPendingListSelection(user.id, {
            title: listTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'complete_todo_item',
            itemTargets: items,
          });
          return `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
            `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
          ).join('\n')}\n\nWhich list has the items you want to mark done? Reply with the number.`;
        }
        return `I don't have a list called "${listTitle}".`;
      } catch (e) {
        this.logger.error('Failed to complete todo item:', e);
        return 'Sorry, I could not mark that item as done.';
      }
    }
    return "Which item would you like to mark as done?";
  }

  private async handleEditTodoItem(parsed: any, user: any): Promise<string> {
    const listTitle = parsed.todoListTitle || 'general';
    const targetRef = parsed.todoItemContent || (parsed.todoItemContents ? parsed.todoItemContents[0] : '');
    const newContent = parsed.noteContent;
    if (targetRef && newContent) {
      try {
        const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            const allItems = await this.todoListService.getItems(lists[0].id, user.id);
            const pending = allItems.filter(i => !i.isCompleted);
            let match = this.resolveOrdinal(targetRef, pending);
            if (!match) {
              match = pending.find(i =>
                i.content.toLowerCase().includes(targetRef.toLowerCase())
              ) || allItems.find(i =>
                i.content.toLowerCase().includes(targetRef.toLowerCase())
              );
            }
            if (match) {
              await this.todoListService.updateItem(match.id, user.id, newContent);
              return `✅ Updated "${targetRef}" to "${newContent}" in ${lists[0].title}!`;
            }
            return `I couldn't find "${targetRef}" in the ${listTitle} list.`;
          }
          await this.userContextService.setPendingListSelection(user.id, {
            title: listTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'edit_todo_item',
            itemRef: targetRef,
            newContent,
          });
          return `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
            `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
          ).join('\n')}\n\nWhich list has the item you want to edit? Reply with the number.`;
        }
        return `I don't have a list called "${listTitle}".`;
      } catch (e) {
        this.logger.error('Failed to edit todo item:', e);
        return 'Sorry, I could not edit that item.';
      }
    }
    return "Please tell me which item to edit and what to change it to. For example: 'edit first item as buy milk'.";
  }

  private async handleEditTodoList(parsed: any, user: any): Promise<string> {
    const listTitle = parsed.todoListTitle || '';
    if (!listTitle) {
      return "Which list would you like to edit? Say *\"edit my shopping list\"*.";
    }
    try {
      const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
      if (lists.length === 0) {
        return `I don't have a list called "${listTitle}".`;
      }
      if (lists.length === 1) {
        await this.listWorkflowService.startEditList(user.phone, user.id, lists[0].id);
        return '';
      }
      // Multiple lists with the same name
      await this.userContextService.setPendingListSelection(user.id, {
        title: listTitle,
        listIds: lists.map(l => l.id),
        listDates: lists.map(l => l.createdAt.toLocaleDateString()),
        actionType: 'edit_todo_list',
      });
      return `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
        `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
      ).join('\n')}\n\nWhich one would you like to edit? Reply with the number.`;
    } catch (e) {
      this.logger.error('Failed to start edit list flow:', e);
      return 'Sorry, I could not start editing that list.';
    }
  }

  private async handleDeleteList(parsed: any, user: any): Promise<string> {
    try {
      // Helper: show confirmation for matched lists
      const showConfirm = async (lists: any[], reason: string): Promise<string> => {
        if (lists.length === 0) return `I couldn't find any lists${reason}.`;
        if (lists.length === 1) {
          await this.todoListService.deleteList(lists[0].id, user.id);
          return `🗑️ Deleted "${lists[0].title}"!`;
        }
        // Multiple matches — ask for confirmation
        const itemCounts = lists.map(l => l.items?.filter(i => !i.isCompleted)?.length || 0);
        await this.userContextService.setPendingListSelection(user.id, {
          title: reason,
          listIds: lists.map(l => l.id),
          listDates: lists.map(l => l.createdAt.toLocaleDateString()),
          listTitles: lists.map(l => l.title),
          listItemCounts: itemCounts,
          actionType: 'confirm_delete_list',
        });
        const lines = lists.map((l, i) =>
          `*${i + 1}.* ${l.title} (${itemCounts[i]} pending) — created ${l.createdAt.toLocaleDateString()}`
        ).join('\n');
        return `Found ${lists.length} list(s):\n\n${lines}\n\nReply with the numbers you want to *keep* (e.g. "1, 3"), "all" to delete everything, or "cancel" to cancel.`;
      };

      // Pattern-based delete: "delete all daily lists"
      if (parsed.deletePattern) {
        const pattern = parsed.deletePattern.trim().toLowerCase();
        const lists = await this.todoListService.findListsByPattern(user.id, pattern);
        return showConfirm(lists, ` matching "${parsed.deletePattern}"`);
      }

      // Multiple list names: "delete shopping list and work list"
      const titles: string[] = parsed.todoListTitles?.length
        ? parsed.todoListTitles
        : parsed.todoListTitle
          ? [parsed.todoListTitle]
          : [];

      if (titles.length === 0) {
        return "Which list would you like to delete? Say *\"delete my shopping list\"*.";
      }

      if (titles.length > 1) {
        // Collect all lists matching the given titles
        let allLists: any[] = [];
        let notFound: string[] = [];
        for (const title of titles) {
          const lists = await this.todoListService.findListsByTitle(user.id, title);
          if (lists.length === 0) {
            notFound.push(title);
          } else {
            allLists = allLists.concat(lists);
          }
        }
        const msg = await showConfirm(allLists, '');
        if (notFound.length > 0) {
          return `Couldn't find: ${notFound.join(', ')}\n\n${msg}`;
        }
        return msg;
      }

      // Single title (original flow)
      const listTitle = titles[0];
      const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
      if (lists.length > 0) {
        if (lists.length === 1) {
          await this.todoListService.deleteList(lists[0].id, user.id);
          return `🗑️ Deleted "${listTitle}" list!`;
        }
        // Multiple lists with the same exact name — ask which one
        await this.userContextService.setPendingListSelection(user.id, {
          title: listTitle,
          listIds: lists.map(l => l.id),
          listDates: lists.map(l => l.createdAt.toLocaleDateString()),
          actionType: 'delete_list',
        });
        return `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
          `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
        ).join('\n')}\n\nWhich one do you want to delete? Reply with the number.`;
      }
      return `I don't have a list called "${listTitle}".`;
    } catch (e) {
      this.logger.error('Failed to delete list:', e);
      return 'Sorry, I could not delete that list.';
    }
  }

  private async handleGetPassword(parsed: any, user: any): Promise<string> {
    if (parsed.serviceName) {
      const entries = await this.passwordService.getPasswordsByService(user.id, parsed.serviceName);
      if (entries.length > 0) {
        const response = entries.map((e, i) =>
          `*${i + 1}. ${e.service}* — saved ${e.createdAt.toLocaleString()}\nPassword: \`${e.encryptedPassword}\``
        ).join('\n\n');
        return `🔑 Passwords for *${parsed.serviceName}*:\n\n${response}`;
      }
      return `I don't have any passwords saved for "${parsed.serviceName}".`;
    }
    return "Which service's password would you like to retrieve?";
  }

  private async handleUpdateSettings(parsed: any, user: any): Promise<string> {
    if (parsed.dailyPromptTime) {
      const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (timePattern.test(parsed.dailyPromptTime)) {
        await this.userService.updateUser(user.id, { dailyPromptTime: parsed.dailyPromptTime });
        return `✅ Your daily prompt time has been set to ${parsed.dailyPromptTime}. I'll check in with you each day then!`;
      }
      return `I couldn't understand that time. Please use HH:mm format, like 09:00 or 14:30.`;
    }
    return `Your daily prompt is currently set to ${user.dailyPromptTime || '09:00'}. Say "set daily prompt to 8am" to change it.`;
  }

  private async handleCheckStock(parsed: any): Promise<string> {
    const query = parsed.stockSymbol || parsed.title || '';
    if (!query) return "Which stock would you like to check? (e.g. 'price of Reliance' or 'check Tata Motors')";
    const quote = await this.stockService.getQuote(query);
    if (!quote) return `Sorry, I couldn't find data for "${query}". Try a different name (e.g. "reliance", "tata motors", "infy").`;
    return this.stockService.formatQuote(quote);
  }

  private async handleCheckCricket(parsed: any): Promise<string> {
    const query = parsed.matchQuery || parsed.title || '';
    const matches = await this.cricketService.getLiveScores();
    if (matches.length === 0) return "No live matches right now. Check back later! 🏏";
    if (query) {
      const match = await this.cricketService.searchMatch(query);
      if (match) {
        const detailed = await this.cricketService.getDetailedMatch(match.id);
        if (detailed && detailed.batsmanStriker) return this.cricketService.formatDetailedMatch(detailed);
        return this.cricketService.formatMatch(match);
      }
      return `I couldn't find a match matching "${query}". Here are all live matches:\n\n${matches.map(m => this.cricketService.formatMatchBrief(m)).join('\n\n')}`;
    }
    if (matches.length === 1) {
      const detailed = await this.cricketService.getDetailedMatch(matches[0].id);
      if (detailed && detailed.batsmanStriker) return this.cricketService.formatDetailedMatch(detailed);
      return this.cricketService.formatMatch(matches[0]);
    }
    return `*Live Matches:*\n\n${matches.map(m => this.cricketService.formatMatchBrief(m)).join('\n\n')}`;
  }

  private async handleCheckIpo(parsed: any): Promise<string> {
    const query = (parsed.matchQuery || '').toLowerCase();
    if (query && !['current', 'upcoming', 'mainboard', 'sme'].includes(query)) {
      const results = await this.ipoService.searchIPO(query);
      if (results.length > 0) {
        return results.map(r => this.ipoService.formatIpo(r)).join('\n\n');
      }
      return `I couldn't find an IPO matching "${query}". Try asking for "current IPOs" or "upcoming IPOs".`;
    }
    if (query === 'upcoming') {
      const ipos = await this.ipoService.getUpcomingIPOs();
      const mainboard = ipos.filter(i => i.type === 'mainboard' || i.type === 'filed');
      const sme = ipos.filter(i => i.type === 'sme');
      const parts: string[] = [];
      if (mainboard.length > 0) parts.push(this.ipoService.formatIpoList(mainboard, 'Upcoming Mainboard IPOs'));
      if (sme.length > 0) parts.push(this.ipoService.formatIpoList(sme, 'Upcoming SME IPOs'));
      return parts.length > 0 ? parts.join('\n\n---\n\n') : 'No upcoming IPOs found.';
    }
    const ipos = await this.ipoService.getCurrentIPOs();
    const mainboard = ipos.filter(i => i.type === 'mainboard');
    const sme = ipos.filter(i => i.type === 'sme');
    const parts: string[] = [];
    if (mainboard.length > 0) parts.push(this.ipoService.formatIpoList(mainboard, 'Current / Open IPOs'));
    if (sme.length > 0) parts.push(this.ipoService.formatIpoList(sme, 'Current SME IPOs'));
    return parts.length > 0 ? parts.join('\n\n---\n\n') : 'No current IPOs available.';
  }

  private async handleStockAlert(parsed: any, user: any, msgTimestamp?: Date): Promise<string> {
    const query = parsed.stockSymbol || parsed.title || '';
    if (!query) return "Which stock would you like to track? (e.g. 'alert me when Reliance hits 5000')";
    const title = parsed.targetPrice
      ? `Stock Alert: ${query} ${parsed.priceDirection || 'above'} ₹${parsed.targetPrice}`
      : `Stock Alert: ${query}`;
    const interval = parsed.intervalMinutes || 60;
    const now = msgTimestamp || new Date();
    const metadata = {
      category: 'finance',
      priority: 'medium',
      source: 'whatsapp',
      type: 'stock_alert',
      stockSymbol: query,
      targetPrice: parsed.targetPrice,
      priceDirection: parsed.priceDirection || 'above',
    };
    try {
      await this.reminderService.createReminder({
        userId: user.id,
        title,
        description: parsed.description || `Tracking ${query}`,
        reminderDate: new Date(now.getTime() + interval * 60 * 1000),
        msgTimestamp,
        isCompleted: false,
        isPersistent: true,
        reminderInterval: interval,
        maxReminderCount: 0,
        reminderCount: 0,
        metadata,
      });
      const detail = parsed.targetPrice
        ? ` when it goes ${parsed.priceDirection || 'above'} ₹${parsed.targetPrice}`
        : '';
      return `📈 I'll track *${query}*${detail} and send updates every ${interval} minutes! Say "done" to stop.`;
    } catch (e) {
      this.logger.error('Failed to create stock alert:', e);
      return 'Sorry, I could not set up that stock alert.';
    }
  }

  private async handleMatchAlert(parsed: any, user: any, msgTimestamp?: Date): Promise<string> {
    const query = parsed.matchQuery || parsed.title || '';
    if (!query) return "Which match would you like to follow? (e.g. 'send me India match updates every 15 min')";
    const interval = parsed.intervalMinutes || 30;
    const now = msgTimestamp || new Date();
    const metadata = {
      category: 'personal',
      priority: 'medium',
      source: 'whatsapp',
      type: 'match_alert',
      matchQuery: query,
    };
    try {
      await this.reminderService.createReminder({
        userId: user.id,
        title: `Match Alert: ${query}`,
        description: parsed.description || `Score updates for ${query}`,
        reminderDate: new Date(now.getTime() + interval * 60 * 1000),
        msgTimestamp,
        isCompleted: false,
        isPersistent: true,
        reminderInterval: interval,
        maxReminderCount: 0,
        reminderCount: 0,
        metadata,
      });
      return `🏏 I'll send you score updates for *${query}* every ${interval} minutes! Say "done" to stop.`;
    } catch (e) {
      this.logger.error('Failed to create match alert:', e);
      return 'Sorry, I could not set up that match alert.';
    }
  }

  private async handleIpoAlert(parsed: any, user: any, msgTimestamp?: Date): Promise<string> {
    const interval = parsed.intervalMinutes || 1440;
    const now = msgTimestamp || new Date();
    const metadata = {
      category: 'finance',
      priority: 'medium',
      source: 'whatsapp',
      type: 'ipo_alert',
    };
    try {
      await this.reminderService.createReminder({
        userId: user.id,
        title: 'IPO Deadline Alerts',
        description: parsed.description || 'Daily IPO deadline check',
        reminderDate: new Date(now.getTime() + interval * 60 * 1000),
        msgTimestamp,
        isCompleted: false,
        isPersistent: true,
        reminderInterval: interval,
        maxReminderCount: 0,
        reminderCount: 0,
        metadata,
      });
      return '📈 I\'ll check for IPO deadlines daily and remind you when an IPO is closing soon! Say "done" to stop alerts.';
    } catch (e) {
      this.logger.error('Failed to create IPO alert:', e);
      return 'Sorry, I could not set up that IPO alert.';
    }
  }

  private async handleConnectCalendar(user: any): Promise<string> {
    const connected = await this.googleCalendarService.isConnected(user.id);
    if (connected) {
      const email = await this.googleCalendarService.getConnectedEmail(user.id);
      return `✅ Your Google Calendar is already connected (${email}).\n\n• Say *"create a meeting tomorrow at 3pm"* to create an event\n• Say *"my events"* to see upcoming events`;
    }
    const authUrl = this.googleCalendarService.getAuthUrl(user.id, user.phone);
    return `🔗 Click the link below to connect your Google Calendar:\n\n${authUrl}\n\nYou'll be taken to Google to authorize access. After that, I'll confirm here!`;
  }

  private async handleCreateEvent(parsed: any, user: any, msgTimestamp?: Date): Promise<string> {
    const connected = await this.googleCalendarService.isConnected(user.id);
    if (!connected) {
      const authUrl = this.googleCalendarService.getAuthUrl(user.id, user.phone);
      return `First, connect your Google Calendar:\n\n${authUrl}\n\nThen say *"create a meeting tomorrow at 3pm"* again.`;
    }

    const title = parsed.title || 'Untitled Event';
    let start: Date;
    const nowRef = msgTimestamp || new Date();

    if (parsed.reminderDate && !isNaN(new Date(parsed.reminderDate).getTime())) {
      start = new Date(parsed.reminderDate);
    } else if (parsed.localTime) {
      const offsetMin = getOffsetMinutes(user.timezone, nowRef);
      const parsedTime = localTimeToUtc(parsed.localTime, offsetMin, nowRef);
      if (!parsedTime) return `I couldn't understand the time "${parsed.localTime}". Try something like "tomorrow at 3pm".`;
      start = parsedTime;
    } else if (parsed.intervalMinutes) {
      start = new Date(nowRef.getTime() + parsed.intervalMinutes * 60 * 1000);
    } else {
      start = new Date(nowRef.getTime() + 60 * 60 * 1000);
    }

    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const description = parsed.description || parsed.noteContent || '';
    const attendees = parsed.attendees || [];

    const event = await this.googleCalendarService.createEvent(user.id, {
      summary: title,
      description,
      start,
      end,
      attendees,
      addMeet: true,
    });

    if (!event) return 'Sorry, I could not create the event. Please try again.';

    const startStr = start.toLocaleString('en-US', {
      timeZone: user.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    let response = `✅ *Event Created*\n\n📅 *${title}*\n⏰ ${startStr}`;
    if (description) response += `\n📝 ${description}`;
    if (attendees.length > 0) response += `\n👥 ${attendees.join(', ')}`;
    if (event.meetLink) response += `\n\n📹 *Google Meet:* ${event.meetLink}`;
    return response;
  }

  private async handleListEvents(user: any): Promise<string> {
    const connected = await this.googleCalendarService.isConnected(user.id);
    if (!connected) {
      const authUrl = this.googleCalendarService.getAuthUrl(user.id, user.phone);
      return `First, connect your Google Calendar:\n\n${authUrl}\n\nThen say *"my events"* again.`;
    }

    const events = await this.googleCalendarService.listEvents(user.id, 10);
    if (events.length === 0) return "📅 No upcoming events found on your calendar.";

    const formatted = events.map((e, i) => {
      const startStr = e.start.toLocaleString('en-US', {
        timeZone: user.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      let line = `*${i + 1}. ${e.summary}*\n   🕐 ${startStr}`;
      if (e.meetLink) line += `\n   📹 [Join Meet](${e.meetLink})`;
      return line;
    }).join('\n\n');

    return `📅 *Upcoming Events*\n\n${formatted}`;
  }

  private async handleSystemQuery(message: string): Promise<string> {
    return this.aiService.generateBasicResponse(
      SYSTEM_QUERY_PROMPT(message, WORKFLOWS),
      undefined,
    );
  }

  private async handlePayment(user: any): Promise<string> {
    if (!this.razorpayPaymentService.isConfigured) {
      return "Payments are not configured yet. Please set up Razorpay keys first.";
    }

    const plans = this.razorpayPaymentService.getPlans(user.country || 'IN');

    const lines = plans.map((p, i) =>
      `${i + 1}. *${p.name}* — ₹${(p.price_monthly / 100).toLocaleString()}/mo\n` +
      `   ${p.features.slice(0, 3).join(' · ')}`
    );

    return `📋 *Choose a plan:*\n\n${lines.join('\n\n')}\n\n` +
      `Reply with the plan number (1 for *Helper*, 2 for *Assistant*, 3 for *Manager*) ` +
      `and I'll send you the payment link.`;
  }

  private async handleCreateReminderOrFallback(
    parsed: any,
    user: any,
    msgTimestamp?: Date,
  ): Promise<string> {
    if (parsed.actionType === 'create_reminder' && parsed.confidence > 0.7 && !parsed.needsClarification) {
      this.logger.log(`Creating reminder...`);
      try {
        const nowRef = msgTimestamp || new Date();
        const reminderDate = parsed.reminderDate && !isNaN(new Date(parsed.reminderDate).getTime())
          ? new Date(parsed.reminderDate)
          : parsed.intervalMinutes
            ? new Date(nowRef.getTime() + parsed.intervalMinutes * 60 * 1000)
            : new Date(nowRef.getTime() + 10 * 60 * 1000);
        const diffMs = reminderDate.getTime() - nowRef.getTime();
        this.logger.log(`Reminder scheduled for ${reminderDate.toISOString()} (${Math.round(diffMs / 60000)} min from msgTimestamp)`);

        // Check if user wants reminders for items in a list
        const listTitle = parsed.todoListTitle;
        if (listTitle) {
          const list = await this.todoListService.findListByTitle(user.id, listTitle);
          if (list && list.items) {
            const pending = list.items.filter(i => !i.isCompleted);
            if (pending.length > 0) {
              const itemRefs = parsed.todoItemContents || (parsed.todoItemContent ? [parsed.todoItemContent] : []);
              const targets = itemRefs.length > 0 ? itemRefs : null;
              let itemsToRemind: any[];
              if (targets) {
                itemsToRemind = [];
                for (const ref of targets) {
                  let match = this.resolveOrdinal(ref, pending);
                  if (!match) {
                    match = pending.find(i =>
                      i.content.toLowerCase().includes(ref.toLowerCase())
                    );
                  }
                  if (match && !itemsToRemind.some(i => i.id === match.id)) {
                    itemsToRemind.push(match);
                  }
                }
                if (itemsToRemind.length === 0) {
                  return `I couldn't find "${targets.join(', ')}" in the "${listTitle}" list.`;
                }
              } else {
                itemsToRemind = pending;
              }
              let count = 0;
              for (const item of itemsToRemind) {
                await this.reminderService.createReminder({
                  userId: user.id,
                  title: item.content,
                  description: `In ${listTitle} list`,
                  reminderDate,
                  msgTimestamp,
                  todoItemId: item.id,
                  isPersistent: false,
                });
                await this.todoListService.updateItemReminderAt(item.id, reminderDate);
                count++;
              }
              const displayTz = resolveDisplayTimezone(user.timezone, nowRef, reminderDate);
              const timeStr = formatRelativeTime(reminderDate, displayTz, nowRef);
              return `✅ Reminders set for ${count} item${count > 1 ? 's' : ''} in "${listTitle}" ${timeStr}!`;
            }
            return `All items in "${listTitle}" are already done!`;
          }
        }

        // Create the reminder
        const created = await this.reminderService.createReminder({
          userId: user.id,
          title: parsed.title,
          description: parsed.description || parsed.title || '',
          reminderDate,
          msgTimestamp,
          isCompleted: false,
          isPersistent: !!parsed.intervalMinutes,
          reminderInterval: parsed.intervalMinutes || 0,
          maxReminderCount: parsed.maxReminderCount || 0,
          reminderCount: 0,
          todoItemId: null,
          metadata: {
            category: parsed.category,
            priority: parsed.priority,
            recurring: parsed.recurring,
            source: 'whatsapp'
          }
        });

        // Auto-link reminder to a matching incomplete todo item
        if (parsed.title) {
          const matches = await this.todoListService.findItemsByContent(user.id, parsed.title);
          if (matches.length > 0) {
            const match = matches[0];
            await this.reminderService.updateReminder(created.id, {
              todoItemId: match.id,
              description: `In ${match.list?.title || 'a list'} list`,
            });
            await this.todoListService.updateItemReminderAt(match.id, reminderDate);
          }
        }

        const displayTz = resolveDisplayTimezone(user.timezone, nowRef, reminderDate);
        const timeStr = formatRelativeTime(reminderDate, displayTz, nowRef);
        const repeatInfo = parsed.intervalMinutes
          ? ` (repeats every ${parsed.intervalMinutes} min)`
          : '';
        return `✅ Reminder set! I'll remind you to "${created.title}" ${timeStr}${repeatInfo}.`;
      } catch (e) {
        this.logger.error('Failed to save reminder:', e);
        return "I understood your reminder but had trouble saving it. Please try again!";
      }
    }
    if (parsed.needsClarification && parsed.clarificationQuestion) {
      return parsed.clarificationQuestion;
    }
    return appendChatTipsDetailed(
      "I'm not sure I understood that. Say what you need in your own words — see examples below.",
    );
  }

  /** One-time (or repeat) setup: register /view_list, /lists, /help on your WhatsApp number */
  @Post('setup/commands')
  async setupChatCommands() {
    const ok = await this.listWorkflowService.registerChatCommands();
    let current: unknown = null;
    if (ok) {
      try {
        current = await this.whatsappService.getConversationalAutomation();
      } catch {
        // non-fatal
      }
    }
    return {
      success: ok,
      message: ok
        ? 'Chat commands registered. Users can type menu, /menu, or / in the chat.'
        : 'Failed — check logs, API version (v20+), and token permissions.',
      conversational_automation: current,
    };
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

  private async sendAssistantReply(
    userPhone: string,
    userId: string,
    text: string,
    withTips = true,
  ): Promise<void> {
    const body = withTips ? appendChatTips(text) : text;
    await this.whatsappService.sendWithMenu(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }
}
