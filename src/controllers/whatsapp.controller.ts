import { Controller, Post, Body, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { WhatsappService } from '../services/whatsapp.service';
import { AiService } from '../services/ai.service';
import { UserService } from '../services/user.service';
import { ReminderService } from '../services/reminder.service';
import { UserContextService } from '../services/user-context.service';
import { TodoListService } from '../services/todo-list.service';
import { ListWorkflowService } from '../services/list-workflow.service';
import { WhatsappActionHandler } from './whatsapp-action-handler';
import { appendChatTips, appendChatTipsDetailed } from '../constants/chat-tips';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  private readonly processedMessages = new Set<string>();

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly aiService: AiService,
    private readonly userService: UserService,
    private readonly reminderService: ReminderService,
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly listWorkflowService: ListWorkflowService,
    private readonly actionHandler: WhatsappActionHandler,
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
      const msgId = message.id;
      if (this.processedMessages.has(msgId)) {
        this.logger.log(`Duplicate message ${msgId} skipped`);
        continue;
      }
      this.processedMessages.add(msgId);
      setTimeout(() => this.processedMessages.delete(msgId), 300000);

      const from = message.from;
      const replyToMsgId = message.context?.id || null;
      const msgTimestamp = message.timestamp
        ? new Date(parseInt(message.timestamp) * 1000)
        : new Date();
      this.logger.log(`WhatsApp msgTimestamp raw=${message.timestamp} parsed=${msgTimestamp.toISOString()}`);

      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        await this.handleButtonReply(from, message.interactive.button_reply, phoneNumber, replyToMsgId);
      } else if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
        await this.handleListReply(from, message.interactive.list_reply, msgTimestamp, msgId);
      } else if (message.type === 'text') {
        const text = message.text.body;
        await this.processWhatsAppMessage(from, text, phoneNumber, replyToMsgId, msgTimestamp, msgId);
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

      await this.userContextService.pushMessage(user.id, 'user', `[menu] ${listReply.title}`);

      const handled = await this.listWorkflowService.handleListReply(
        userPhone,
        user.id,
        listReply.id,
        user.timezone,
      );
      if (!handled) {
        const body = 'Sorry, that menu option is no longer valid. Type *menu* to open the menu again.';
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
        await this.userContextService.pushMessage(user.id, 'user', `[button] ${buttonReply.title}`);
        await this.listWorkflowService.handleButton(userPhone, user.id, buttonReply.id);
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

      await this.whatsappService.sendMessage(userPhone, botResponse);
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

      // Create-list wizard, menu, slash commands — before onboarding / AI
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

      // Onboarding: check if user hasn't set their name yet
      const greetings = ['hi', 'hello', 'hey', 'hii', 'heyy', 'start'];
      const isGreeting = greetings.includes(message.toLowerCase().trim());

      if (user.name === 'there' && isGreeting) {
        const botMsg = `Hi there! 👋 I'm your Reminder Assistant.\n\nTo get started, could you tell me your name and which city you're in?\n\nFor example: "I'm John from Mumbai"`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // // Extract name and location from response
      // const infoMatch = message.match(/(?:i(?:'| a)m\s+)?(\w+)\s+(?:from|in|at)\s+(.+)/i);
      // if (infoMatch && user.name === 'there') {
      //   const newName = infoMatch[1];
      //   const location = infoMatch[2].trim();
      //   await this.userService.updateUser(user.id, { name: newName });
      //   user.name = newName;

      //   const tz = this.lookupTimezone(location) || this.guessTimezoneFromLocation(location);
      //   if (tz) {
      //     await this.userService.updateUser(user.id, { timezone: tz });
      //     user.timezone = tz;
      //     const botMsg = `Nice to meet you, ${newName}! 🌍 I've set your timezone to ${tz} based on your location.\n\nNow, what would you like me to remind you about?`;
      //     await this.whatsappService.sendMessage(userPhone, botMsg);
      //     await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
      //   } else {
      //     const botMsg = `Nice to meet you, ${newName}! 🎉 What would you like me to remind you about?`;
      //     await this.whatsappService.sendMessage(userPhone, botMsg);
      //     await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
      //   }
      //   return;
      // }

      // Simple name-only intro (no location)
      const nameMatch = message.match(/i(?:'| a)m\s+(\w+)/i);
      if (nameMatch && user.name === 'there') {
        const newName = nameMatch[1];
        await this.userService.updateUser(user.id, { name: newName });
        user.name = newName;
        const botMsg = `Nice to meet you, ${newName}! 🎉 Also, which city are you in so I can set the right time for your reminders?`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // // Check for timezone update request
      // const tzMatch = message.match(/(?:timezone|tz|time zone)\s+(?:is\s+)?(.+)/i);
      // if (tzMatch) {
      //   const tz = tzMatch[1].trim();
      //   const validTz = this.lookupTimezone(tz);
      //   if (validTz) {
      //     await this.userService.updateUser(user.id, { timezone: validTz });
      //     user.timezone = validTz;
      //     const botMsg = `Got it! Your timezone is set to ${validTz}.`;
      //     await this.whatsappService.sendMessage(userPhone, botMsg);
      //     await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
      //     return;
      //   } else {
      //     const botMsg = `I'm not sure which timezone that is. Try something like "timezone is Asia/Kolkata" or "timezone is America/New_York".`;
      //     await this.whatsappService.sendMessage(userPhone, botMsg);
      //     await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
      //     return;
      //   }
      // }

      // Get conversation history and pending reminders for AI context
      const conversation = await this.userContextService.getConversation(user.id);
      const pendingReminders = await this.reminderService.getPendingRemindersForUser(user.id);
      this.logger.log(`User has ${pendingReminders.length} pending reminders`);

      // Check for pending list selection (user responded with a number)
      const pendingSelection = await this.userContextService.getPendingListSelection(user.id);
      const selectionNum = parseInt(message.trim(), 10);
      if (pendingSelection && selectionNum > 0 && selectionNum <= pendingSelection.listIds.length) {
        this.logger.log(`Resolving list selection: ${selectionNum} (${pendingSelection.actionType})`);
        await this.userContextService.clearPendingListSelection(user.id);
        const selRes = await this.handlePendingListSelection(pendingSelection, selectionNum, user.id);
        await this.sendAssistantReply(userPhone, user.id, selRes);
        return;
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

      // Parse message via AI with full context
      this.logger.log('Parsing message via AI...');
      const parsed = await this.aiService.parseReminderInput(
        message, user.id, user.timezone, conversation, pendingReminders, msgTimestamp,
      );
      this.logger.log(`AI parsed: actionType=${parsed.actionType}, confidence=${parsed.confidence}, reminderDate=${parsed.reminderDate || 'null'}`);

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
      let needsPendingSelection = false;
      let pendingSelectionData: any = null;

      if (parsed.actionType === 'complete_reminder') {
        botResponse = await this.actionHandler.handleCompleteReminder(parsed.reminderId, pendingReminders);
      } else if (parsed.actionType === 'save_note') {
        botResponse = await this.actionHandler.handleSaveNote(parsed.noteKey, parsed.noteContent, user.id);
      } else if (parsed.actionType === 'get_note') {
        botResponse = await this.actionHandler.handleGetNote(parsed.noteKey, user.id);
      } else if (parsed.actionType === 'save_password') {
        botResponse = await this.actionHandler.handleSavePassword(parsed.serviceName, parsed.password, user.id);
      } else if (parsed.actionType === 'create_todo') {
        botResponse = await this.actionHandler.handleCreateTodo(
          parsed.todoListTitle, parsed.todoItemContents,
          { title: parsed.title, reminderDate: parsed.reminderDate, msgTimestamp }, user.id,
        );
      } else if (parsed.actionType === 'add_todo_item') {
        botResponse = await this.actionHandler.handleAddTodoItem(
          parsed.todoListTitle, parsed.todoItemContents, parsed.todoItemContent, parsed.noteKey,
          { title: parsed.title, reminderDate: parsed.reminderDate, msgTimestamp }, user.id,
        );
      } else if (parsed.actionType === 'get_todo') {
        const result = await this.actionHandler.handleGetTodo(parsed.todoListTitle, user.id);
        botResponse = result.response;
        if (result.pendingSelection) {
          needsPendingSelection = true;
          pendingSelectionData = result.pendingSelection;
        }
      } else if (parsed.actionType === 'complete_todo_item') {
        const result = await this.actionHandler.handleCompleteTodoItem(
          parsed.todoListTitle, parsed.todoItemContents, parsed.todoItemContent, parsed.noteKey, user.id,
        );
        botResponse = result.response;
        if (result.pendingSelection) {
          needsPendingSelection = true;
          pendingSelectionData = result.pendingSelection;
        }
      } else if (parsed.actionType === 'edit_todo_item') {
        const result = await this.actionHandler.handleEditTodoItem(
          parsed.todoListTitle, parsed.todoItemContent, parsed.todoItemContents, parsed.noteContent, user.id,
        );
        botResponse = result.response;
        if (result.pendingSelection) {
          needsPendingSelection = true;
          pendingSelectionData = result.pendingSelection;
        }
      } else if (parsed.actionType === 'delete_list') {
        const result = await this.actionHandler.handleDeleteList(parsed.todoListTitle, user.id);
        botResponse = result.response;
        if (result.pendingSelection) {
          needsPendingSelection = true;
          pendingSelectionData = result.pendingSelection;
        }
      } else if (parsed.actionType === 'get_password') {
        botResponse = await this.actionHandler.handleGetPassword(parsed.serviceName, user.id);
      } else if (parsed.actionType === 'update_settings') {
        botResponse = await this.actionHandler.handleUpdateSettings(parsed.dailyPromptTime, user);
      } else if (parsed.actionType === 'system_query') {
        botResponse = await this.actionHandler.handleSystemQuery(message);
      } else if (parsed.actionType === 'create_reminder' && parsed.confidence > 0.7 && !parsed.needsClarification) {
        botResponse = await this.actionHandler.handleCreateReminder(parsed, {
          userPhone, userId: user.id, message, msgTimestamp, userTimezone: user.timezone, userName: user.name,
        }, msgTimestamp);
      } else if (parsed.needsClarification && parsed.clarificationQuestion) {
        botResponse = parsed.clarificationQuestion;
      } else {
        botResponse = appendChatTipsDetailed(
          "I'm not sure I understood that. Say what you need in your own words — see examples below.",
        );
      }

      if (needsPendingSelection && pendingSelectionData) {
        await this.userContextService.setPendingListSelection(user.id, pendingSelectionData);
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

  private async handlePendingListSelection(pendingSelection: any, selectionNum: number, userId: string): Promise<string> {
    const selectedId = pendingSelection.listIds[selectionNum - 1];
    const list = await this.todoListService.getList(selectedId, userId);

    if (pendingSelection.actionType === 'delete_list') {
      await this.todoListService.deleteList(selectedId, userId);
      return `🗑️ Deleted "${pendingSelection.title}" list!`;
    }
    if (pendingSelection.actionType === 'complete_todo_item') {
      const targets = pendingSelection.itemTargets || [];
      let doneCount = 0;
      let listDeleted = false;
      const pending = list.items.filter(i => !i.isCompleted);
      for (const target of targets) {
        const match = pending.find(i =>
          i.content.toLowerCase().includes(target.toLowerCase())
        );
        if (match) {
          const result = await this.todoListService.completeItem(match.id, userId);
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
    if (pendingSelection.actionType === 'edit_todo_item') {
      const ref = pendingSelection.itemRef || '';
      const newContent = pendingSelection.newContent || '';
      const pending = list.items.filter(i => !i.isCompleted);
      let match: any = null;
      const lowerRef = ref.toLowerCase();
      if (/^(first|1st|#1|top)\b/.test(lowerRef)) match = pending[0] || null;
      else if (/^(second|2nd|#2)\b/.test(lowerRef)) match = pending[1] || null;
      else if (/^(third|3rd|#3)\b/.test(lowerRef)) match = pending[2] || null;
      else if (/^last\b/.test(lowerRef)) match = pending[pending.length - 1] || null;
      else match = pending.find(i => i.content.toLowerCase().includes(lowerRef)) || null;
      if (match) {
        await this.todoListService.updateItem(match.id, userId, newContent);
        return `✅ Updated "${ref}" to "${newContent}" in ${list.title}!`;
      }
      return `I couldn't find "${ref}" in the ${list.title} list.`;
    }
    return this.todoListService.formatList(list);
  }

  /** Send text to user; appends example tips by default. */
  private async sendAssistantReply(
    userPhone: string,
    userId: string,
    text: string,
    withTips = true,
  ): Promise<void> {
    const body = withTips ? appendChatTips(text) : text;
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }
}
