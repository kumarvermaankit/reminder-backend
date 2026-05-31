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
import { WORKFLOWS } from '../constants/workflows';
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
    private readonly noteService: NoteService,
    private readonly passwordService: PasswordService,
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly listWorkflowService: ListWorkflowService,
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

        const tz = this.lookupTimezone(location) || this.guessTimezoneFromLocation(location);
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

      // Handle city-only response after name was set (e.g. user says "Mumbai" or "from Mumbai")
      if (user.name !== 'there' && user.timezone === 'UTC') {
        const cityMatch = message.match(/(?:i(?:'| a)m\s+)?(?:from|in|at\s+)?(.+)/i);
        if (cityMatch) {
          const location = cityMatch[1].trim().toLowerCase();
          const tz = this.lookupTimezone(location) || this.guessTimezoneFromLocation(location);
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
        const validTz = this.lookupTimezone(tz);
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

      // Check for pending list selection (user responded with a number)
      const pendingSelection = await this.userContextService.getPendingListSelection(user.id);
      const selectionNum = parseInt(message.trim(), 10);
      if (pendingSelection && selectionNum > 0 && selectionNum <= pendingSelection.listIds.length) {
        this.logger.log(`Resolving list selection: ${selectionNum} (${pendingSelection.actionType})`);
        await this.userContextService.clearPendingListSelection(user.id);
        const selectedId = pendingSelection.listIds[selectionNum - 1];
        const list = await this.todoListService.getList(selectedId, user.id);
        let selRes: string;
        switch (pendingSelection.actionType) {
          case 'get_todo':
            selRes = this.todoListService.formatList(list);
            break;
          case 'complete_todo_item':
            selRes = await this.handlePendingListCompleteTodo(list, pendingSelection, user);
            break;
          case 'edit_todo_item':
            selRes = await this.handlePendingListEditTodo(list, pendingSelection, user);
            break;
          case 'delete_list':
            await this.todoListService.deleteList(selectedId, user.id);
            selRes = `🗑️ Deleted "${pendingSelection.title}" list!`;
            break;
          default:
            selRes = this.todoListService.formatList(list);
        }
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
      const match = pending.find(i =>
        i.content.toLowerCase().includes(target.toLowerCase())
      );
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
    let match: any = null;
    const lowerRef = ref.toLowerCase();
    if (/^(first|1st|#1|top)\b/.test(lowerRef)) match = pending[0] || null;
    else if (/^(second|2nd|#2)\b/.test(lowerRef)) match = pending[1] || null;
    else if (/^(third|3rd|#3)\b/.test(lowerRef)) match = pending[2] || null;
    else if (/^last\b/.test(lowerRef)) match = pending[pending.length - 1] || null;
    else match = pending.find(i => i.content.toLowerCase().includes(lowerRef)) || null;
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
            return this.todoListService.formatList(lists[0]);
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
              const lowerRef = target.toLowerCase();
              let match: any = null;
              if (/^(first|1st|#1|top)\b/.test(lowerRef)) {
                match = pending[0] || null;
              } else if (/^(second|2nd|#2)\b/.test(lowerRef)) {
                match = pending[1] || null;
              } else if (/^(third|3rd|#3)\b/.test(lowerRef)) {
                match = pending[2] || null;
              } else if (/^last\b/.test(lowerRef)) {
                match = pending[pending.length - 1] || null;
              } else {
                match = pending.find(i =>
                  i.content.toLowerCase().includes(lowerRef)
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
            let match: any = null;
            const lowerRef = targetRef.toLowerCase();
            if (/^(first|1st|#1|top)\b/.test(lowerRef)) {
              match = pending[0] || null;
            } else if (/^(second|2nd|#2)\b/.test(lowerRef)) {
              match = pending[1] || null;
            } else if (/^(third|3rd|#3)\b/.test(lowerRef)) {
              match = pending[2] || null;
            } else if (/^last\b/.test(lowerRef)) {
              match = pending[pending.length - 1] || null;
            } else {
              match = pending.find(i =>
                i.content.toLowerCase().includes(lowerRef)
              ) || allItems.find(i =>
                i.content.toLowerCase().includes(lowerRef)
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

  private async handleDeleteList(parsed: any, user: any): Promise<string> {
    const listTitle = parsed.todoListTitle || 'general';
    try {
      const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
      if (lists.length > 0) {
        if (lists.length === 1) {
          await this.todoListService.deleteList(lists[0].id, user.id);
          return `🗑️ Deleted "${listTitle}" list!`;
        }
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

  private async handleSystemQuery(message: string): Promise<string> {
    return this.aiService.generateBasicResponse(
      `You are a helpful assistant for a reminder app. A user asked: "${message}". Answer their question politely and accurately based on these system capabilities:\n\n${WORKFLOWS}\n\nKeep it concise, friendly, and use emoji. Only answer what the system can actually do — don't make things up.`,
      undefined,
    );
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
          metadata: {
            category: parsed.category,
            priority: parsed.priority,
            recurring: parsed.recurring,
            source: 'whatsapp'
          }
        });
        const displayTz = this.resolveDisplayTimezone(user.timezone, nowRef, reminderDate);
        const timeStr = this.formatRelativeTime(reminderDate, displayTz, nowRef);
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
    let key = input.toLowerCase().trim();

    // Strip common prefixes like "utc", "gmt", "etc/gmt"
    key = key.replace(/^(utc|gmt|etc\/gmt)\s*/i, '');
    if (aliases[key]) return aliases[key];

    // Try parsing numeric UTC offset (e.g. "+5:30", "+0530", "-5", "5:30")
    const offsetMatch = key.match(/^([+-])?\s*(\d{1,2})(?::(\d{2})|(\d{2}))?$/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '-' ? -1 : 1;
      const hours = parseInt(offsetMatch[2], 10);
      const minutes = parseInt(offsetMatch[3] || offsetMatch[4] || '0', 10);
      const totalMinutes = sign * (hours * 60 + minutes);
      const tz = this.commonOffsetToIana(totalMinutes);
      if (tz) return tz;
    }

    try {
      Intl.DateTimeFormat(undefined, { timeZone: input });
      return input;
    } catch {
      return null;
    }
  }

  /** Map a UTC offset in minutes to the most likely IANA timezone. */
  private commonOffsetToIana(offsetMinutes: number): string | null {
    const rounded = Math.round(offsetMinutes / 15) * 15;
    const map: Record<string, string> = {
      '-720': 'Pacific/Midway',
      '-660': 'Pacific/Honolulu',
      '-600': 'America/Anchorage',
      '-540': 'America/Los_Angeles',
      '-480': 'America/Denver',
      '-420': 'America/Chicago',
      '-360': 'America/New_York',
      '-300': 'America/Halifax',
      '-270': 'America/St_Johns',
      '-240': 'America/Sao_Paulo',
      '-180': 'America/Argentina/Buenos_Aires',
      '-60': 'Atlantic/Azores',
      '0': 'UTC',
      '60': 'Europe/Paris',
      '120': 'Europe/Athens',
      '180': 'Europe/Moscow',
      '210': 'Asia/Tehran',
      '240': 'Asia/Dubai',
      '270': 'Asia/Kabul',
      '300': 'Asia/Karachi',
      '330': 'Asia/Kolkata',
      '345': 'Asia/Kathmandu',
      '360': 'Asia/Dhaka',
      '390': 'Asia/Yangon',
      '420': 'Asia/Bangkok',
      '480': 'Asia/Shanghai',
      '510': 'Australia/Eucla',
      '540': 'Asia/Tokyo',
      '570': 'Australia/Adelaide',
      '600': 'Australia/Sydney',
      '630': 'Australia/Lord_Howe',
      '660': 'Pacific/Noumea',
      '720': 'Pacific/Auckland',
      '780': 'Pacific/Chatham',
    };
    return map[String(rounded)] || null;
  }

  private guessTimezoneFromLocation(location: string): string | null {
    const cityMap: Record<string, string> = {
      'mumbai': 'Asia/Kolkata',
      'delhi': 'Asia/Kolkata',
      'new delhi': 'Asia/Kolkata',
      'bangalore': 'Asia/Kolkata',
      'bengaluru': 'Asia/Kolkata',
      'chennai': 'Asia/Kolkata',
      'hyderabad': 'Asia/Kolkata',
      'kolkata': 'Asia/Kolkata',
      'pune': 'Asia/Kolkata',
      'ahmedabad': 'Asia/Kolkata',
      'jaipur': 'Asia/Kolkata',
      'london': 'Europe/London',
      'manchester': 'Europe/London',
      'new york': 'America/New_York',
      'nyc': 'America/New_York',
      'los angeles': 'America/Los_Angeles',
      'la': 'America/Los_Angeles',
      'san francisco': 'America/Los_Angeles',
      'chicago': 'America/Chicago',
      'dubai': 'Asia/Dubai',
      'singapore': 'Asia/Singapore',
      'sydney': 'Australia/Sydney',
      'melbourne': 'Australia/Sydney',
      'toronto': 'America/Toronto',
      'paris': 'Europe/Paris',
      'berlin': 'Europe/Berlin',
      'tokyo': 'Asia/Tokyo',
      'seoul': 'Asia/Seoul',
      'shanghai': 'Asia/Shanghai',
      'beijing': 'Asia/Shanghai',
    };
    const loc = location.toLowerCase().trim();
    return cityMap[loc] || null;
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

  private static readonly DISPLAY_TIMEZONES = [
    'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Dubai',
    'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Australia/Sydney', 'Pacific/Auckland', 'UTC',
  ];

  private localDateKey(d: Date, timeZone: string): string {
    return d.toLocaleDateString('en-CA', { timeZone });
  }

  private calendarDayDiff(fromKey: string, toKey: string): number {
    const from = new Date(`${fromKey}T12:00:00Z`);
    const to = new Date(`${toKey}T12:00:00Z`);
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  /** When profile timezone is UTC, pick IANA zone that best matches msg vs reminder calendar. */
  private resolveDisplayTimezone(
    userTimezone: string,
    msgRef: Date,
    targetDate: Date,
  ): string {
    if (userTimezone && userTimezone !== 'UTC') return userTimezone;

    let bestTz = 'UTC';
    let bestScore = -1;

    for (const timeZone of WhatsappController.DISPLAY_TIMEZONES) {
      if (timeZone === 'UTC') continue;
      const dayDiff = this.calendarDayDiff(
        this.localDateKey(msgRef, timeZone),
        this.localDateKey(targetDate, timeZone),
      );
      if (dayDiff < 0 || dayDiff > 14) continue;

      let score = dayDiff === 0 ? 15 : dayDiff === 1 ? 5 : 0;
      const localHour = Number(
        targetDate.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', hour12: false }),
      );
      if (localHour >= 7 && localHour <= 22) score += 10;
      else if (localHour < 6 || localHour >= 23) score -= 10;

      // Also check that msg time falls in reasonable hours for this timezone
      const msgHour = Number(
        msgRef.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', hour12: false }),
      );
      if (msgHour < 6 || msgHour >= 23) score -= 5;

      if (score > bestScore) {
        bestScore = score;
        bestTz = timeZone;
      }
    }
    return bestTz;
  }

  private formatRelativeTime(date: Date, timezone: string = 'UTC', nowRef?: Date): string {
    const now = nowRef || new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);

    const timeStr = date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const dayDiff = this.calendarDayDiff(
      this.localDateKey(now, timezone),
      this.localDateKey(date, timezone),
    );

    if (dayDiff === 0) {
      if (diffMin < 1) return 'in less than a minute';
      if (diffMin < 60) return `in ${diffMin} minutes`;
      return `today at ${timeStr}`;
    }
    if (dayDiff === 1) return `tomorrow at ${timeStr}`;
    if (dayDiff > 1 && dayDiff <= 7) {
      const weekday = date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });
      return `on ${weekday} at ${timeStr}`;
    }
    return date.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}
