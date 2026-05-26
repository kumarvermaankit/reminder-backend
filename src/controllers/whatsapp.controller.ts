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
import { WORKFLOWS } from '../constants/workflows';

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

      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        await this.handleButtonReply(from, message.interactive.button_reply, phoneNumber, replyToMsgId);
      } else if (message.type === 'text') {
        const text = message.text.body;
        await this.processWhatsAppMessage(from, text, phoneNumber, replyToMsgId);
      }
    }
  }

  private async handleButtonReply(
    userPhone: string,
    buttonReply: { id: string; title: string },
    businessPhone: string,
    replyToMsgId?: string,
  ) {
    try {
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
      let botResponse: string;

      if (action === 'done') {
        await this.reminderService.markAsCompleted(reminder.id);
        await this.reminderService.deleteReminder(reminder.id);
        await this.reminderService.deleteAllSchedulesForReminder(reminder.id);
        botResponse = `✅ Marked "${reminder.title}" as done!`;
      } else if (action === 'snooze_5') {
        const nextTime = new Date(Date.now() + 5 * 60 * 1000);
        await this.reminderService.createSchedule(reminder.id, nextTime);
        botResponse = `⏰ Snoozed "${reminder.title}" for 5 minutes. I'll remind you again at ${nextTime.toLocaleTimeString()}.`;
      } else if (action === 'snooze_10') {
        const nextTime = new Date(Date.now() + 10 * 60 * 1000);
        await this.reminderService.createSchedule(reminder.id, nextTime);
        botResponse = `⏰ Snoozed "${reminder.title}" for 10 minutes. I'll remind you again at ${nextTime.toLocaleTimeString()}.`;
      } else {
        botResponse = "Got it!";
      }

      await this.whatsappService.sendMessage(userPhone, botResponse);
      await this.userContextService.pushMessage(reminder.userId, 'assistant', botResponse);
    } catch (error) {
      this.logger.error('Error handling button reply:', error);
    }
  }

  private async processWhatsAppMessage(userPhone: string, message: string, businessPhone: string, replyToMsgId?: string) {
    try {
      this.logger.log(`Processing message from ${userPhone}: "${message}"`);

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

      // Push user message to conversation history
      await this.userContextService.pushMessage(user.id, 'user', message);

      // Onboarding: check if user hasn't set their name yet
      const greetings = ['hi', 'hello', 'hey', 'hii', 'heyy', 'start'];
      const isGreeting = greetings.includes(message.toLowerCase().trim());

      if (user.name === 'there' && isGreeting) {
        const botMsg = `Hi there! 👋 I'm your Reminder Assistant.\n\nTo get started, could you tell me your name and which city you're in?\n\nFor example: "I'm John from Mumbai"`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // Extract name and location from response
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

      // Handle simple greetings without AI call
      const greetingMatch = message.trim().match(/^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening))[.!]*$/i);
      if (greetingMatch && user.name !== 'there') {
        const botMsg = `Hi ${user.name}! 😊 How can I help you today? You can set a reminder, save a note, save a password, or create a todo list.`;
        await this.whatsappService.sendMessage(userPhone, botMsg);
        await this.userContextService.pushMessage(user.id, 'assistant', botMsg);
        return;
      }

      // Parse message via AI with full context
      this.logger.log('Parsing message via AI...');
      const parsed = await this.aiService.parseReminderInput(
        message, user.id, user.timezone, conversation, pendingReminders,
      );
      this.logger.log(`AI parsed: actionType=${parsed.actionType}, confidence=${parsed.confidence}`);

      // Save user's name if AI extracted one
      if (parsed.userName && (user.name === 'there' || user.name.startsWith('WhatsApp User'))) {
        this.logger.log(`Updating user name to "${parsed.userName}"`);
        await this.userService.updateUser(user.id, { name: parsed.userName });
        user.name = parsed.userName;
      }

      // Dispatch based on action type
      let botResponse: string;

      switch (parsed.actionType) {
        case 'complete_reminder': {
          if (parsed.reminderId && pendingReminders.some(r => r.id === parsed.reminderId)) {
            this.logger.log(`AI matched reminder ID ${parsed.reminderId} for completion`);
            const reminder = pendingReminders.find(r => r.id === parsed.reminderId);
            await this.reminderService.markAsCompleted(parsed.reminderId);
            await this.reminderService.deleteReminder(parsed.reminderId);
            await this.reminderService.deleteAllSchedulesForReminder(parsed.reminderId);
            botResponse = `✅ Marked "${reminder.title}" as done!`;
          } else {
            botResponse = "I'm not sure which reminder you're referring to. Please tell me the name of the reminder you'd like to mark as done.";
          }
          break;
        }

        case 'save_note': {
          if (parsed.noteKey && parsed.noteContent) {
            try {
              const note = await this.noteService.createNote(user.id, parsed.noteKey, parsed.noteContent);
              botResponse = `✅ Saved "${parsed.noteKey}" for you!`;
            } catch (e) {
              this.logger.error('Failed to save note:', e);
              botResponse = 'Sorry, I could not save that note.';
            }
          } else {
            botResponse = "What would you like me to save? Tell me a title and some content.";
          }
          break;
        }

        case 'get_note': {
          if (parsed.noteKey) {
            const notes = await this.noteService.searchNotes(user.id, parsed.noteKey);
            if (notes.length > 0) {
              botResponse = notes.map(n => `📝 *${n.title}*:\n${n.content}`).join('\n\n');
            } else {
              botResponse = `I couldn't find a note matching "${parsed.noteKey}". Try asking with a different title — say "list my notes" to see what you have.`;
            }
          } else {
            const all = await this.noteService.getAllNotesByUser(user.id);
            if (all.length > 0) {
              botResponse = `Here are your notes:\n${all.map(n => `• ${n.title}`).join('\n')}\n\nAsk for one by name!`;
            } else {
              botResponse = "You don't have any saved notes yet. Save one by saying 'remember that my email is xyz'.";
            }
          }
          break;
        }

        case 'save_password': {
          if (parsed.serviceName && parsed.password) {
            try {
              const saved = await this.passwordService.savePassword(
                user.id, parsed.serviceName, '', parsed.password
              );
              botResponse = `🔐 Saved password for *${parsed.serviceName}* (${saved.createdAt.toLocaleString()})`;
            } catch (e) {
              this.logger.error('Failed to save password:', e);
              botResponse = 'Sorry, I could not save that password.';
            }
          } else {
            botResponse = "Please tell me the service name and password you'd like to save. For example: 'save my facebook password as abc123'";
          }
          break;
        }

        case 'create_todo': {
          if (parsed.todoListTitle) {
            try {
              const list = await this.todoListService.createList(user.id, parsed.todoListTitle);
              const items = parsed.todoItemContents || [];
              if (items.length > 0) {
                for (const item of items) {
                  await this.todoListService.addItem(list.id, user.id, item);
                }
                botResponse = `📋 Created "${parsed.todoListTitle}" with ${items.length} items!`;
              } else {
                botResponse = `📋 Created a new list "${parsed.todoListTitle}"! Add items by saying "add ... to ${parsed.todoListTitle}".`;
              }
            } catch (e) {
              this.logger.error('Failed to create todo list:', e);
              botResponse = 'Sorry, I could not create that list.';
            }
          } else {
            botResponse = "What would you like to call your new list?";
          }
          break;
        }

        case 'add_todo_item': {
          const listTitle = parsed.todoListTitle || 'general';
          const items = parsed.todoItemContents || (parsed.todoItemContent ? [parsed.todoItemContent] : parsed.noteKey ? [parsed.noteKey] : []);
          if (items.length > 0) {
            try {
              let list = await this.todoListService.findListByTitle(user.id, listTitle);
              if (!list) {
                list = await this.todoListService.createList(user.id, listTitle);
              }
              for (const item of items) {
                await this.todoListService.addItem(list.id, user.id, item);
              }
              const label = items.length === 1 ? items[0] : `${items.length} items`;
              botResponse = `✅ Added "${label}" to ${listTitle} list!`;
            } catch (e) {
              this.logger.error('Failed to add todo item:', e);
              botResponse = 'Sorry, I could not add that item.';
            }
          } else {
            botResponse = "What would you like to add to the list?";
          }
          break;
        }

        case 'get_todo': {
          if (parsed.todoListTitle) {
            try {
              const lists = await this.todoListService.findListsByTitle(user.id, parsed.todoListTitle);
              if (lists.length > 0) {
                if (lists.length === 1) {
                  botResponse = this.todoListService.formatList(lists[0]);
                } else {
                  botResponse = `I found ${lists.length} lists called "${parsed.todoListTitle}":\n\n${lists.map((l, i) =>
                    `*${i + 1}.* ${l.title} (created ${l.createdAt.toLocaleDateString()})`
                  ).join('\n')}\n\nTell me which one by number or date.`;
                }
              } else {
                botResponse = `I don't have a list called "${parsed.todoListTitle}".`;
              }
            } catch (e) {
              this.logger.error('Failed to get todo list:', e);
              botResponse = 'Sorry, I could not retrieve that list.';
            }
          } else {
            const lists = await this.todoListService.getLists(user.id);
            if (lists.length > 0) {
              botResponse = `Here are your lists:\n${lists.map(l => `• ${l.title}`).join('\n')}\n\nAsk to see one by name!`;
            } else {
              botResponse = "You don't have any lists yet. Create one by saying something like 'start a shopping list'.";
            }
          }
          break;
        }

        case 'complete_todo_item': {
          const listTitle = parsed.todoListTitle || 'general';
          const items = parsed.todoItemContents || (parsed.todoItemContent ? [parsed.todoItemContent] : parsed.noteKey ? [parsed.noteKey] : []);
          if (items.length > 0) {
            try {
              const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
              if (lists.length > 0) {
                let doneCount = 0;
                for (const list of lists) {
                  const allItems = await this.todoListService.getItems(list.id, user.id);
                  const pending = allItems.filter(i => !i.isCompleted);
                  for (const target of items) {
                    const match = pending.find(i =>
                      i.content.toLowerCase().includes(target.toLowerCase())
                    );
                    if (match) {
                      await this.todoListService.completeItem(match.id, user.id);
                      doneCount++;
                    }
                  }
                }
                if (doneCount > 0) {
                  botResponse = `✅ Marked ${doneCount} item(s) as done in ${listTitle}!`;
                } else {
                  botResponse = `I couldn't find those items in any ${listTitle} list.`;
                }
              } else {
                botResponse = `I don't have a list called "${listTitle}".`;
              }
            } catch (e) {
              this.logger.error('Failed to complete todo item:', e);
              botResponse = 'Sorry, I could not mark that item as done.';
            }
          } else {
            botResponse = "Which item would you like to mark as done?";
          }
          break;
        }

        case 'edit_todo_item': {
          const listTitle = parsed.todoListTitle || 'general';
          const targetRef = parsed.todoItemContent || (parsed.todoItemContents ? parsed.todoItemContents[0] : '');
          const newContent = parsed.noteContent;
          if (targetRef && newContent) {
            try {
              const lists = await this.todoListService.findListsByTitle(user.id, listTitle);
              if (lists.length > 0) {
                let match: any = null;
                let matchedList: any = null;
                const lowerRef = targetRef.toLowerCase();

                for (const list of lists) {
                  const allItems = await this.todoListService.getItems(list.id, user.id);
                  const pending = allItems.filter(i => !i.isCompleted);
                  let found: any = null;

                  if (/^(first|1st|#1|top)\b/.test(lowerRef)) {
                    found = pending[0] || null;
                  } else if (/^(second|2nd|#2)\b/.test(lowerRef)) {
                    found = pending[1] || null;
                  } else if (/^(third|3rd|#3)\b/.test(lowerRef)) {
                    found = pending[2] || null;
                  } else if (/^last\b/.test(lowerRef)) {
                    found = pending[pending.length - 1] || null;
                  } else {
                    found = pending.find(i =>
                      i.content.toLowerCase().includes(lowerRef)
                    ) || allItems.find(i =>
                      i.content.toLowerCase().includes(lowerRef)
                    );
                  }

                  if (found) {
                    match = found;
                    matchedList = list;
                    break;
                  }
                }

                if (match) {
                  await this.todoListService.updateItem(match.id, user.id, newContent);
                  botResponse = `✅ Updated "${targetRef}" to "${newContent}" in ${matchedList.title}!`;
                } else {
                  botResponse = `I couldn't find "${targetRef}" in any ${listTitle} list.`;
                }
              } else {
                botResponse = `I don't have a list called "${listTitle}".`;
              }
            } catch (e) {
              this.logger.error('Failed to edit todo item:', e);
              botResponse = 'Sorry, I could not edit that item.';
            }
          } else {
            botResponse = "Please tell me which item to edit and what to change it to. For example: 'edit first item as buy milk'.";
          }
          break;
        }

        case 'get_password': {
          if (parsed.serviceName) {
            const entries = await this.passwordService.getPasswordsByService(user.id, parsed.serviceName);
            if (entries.length > 0) {
              botResponse = entries.map((e, i) =>
                `*${i + 1}. ${e.service}* — saved ${e.createdAt.toLocaleString()}\nPassword: \`${e.encryptedPassword}\``
              ).join('\n\n');
              botResponse = `🔑 Passwords for *${parsed.serviceName}*:\n\n${botResponse}`;
            } else {
              botResponse = `I don't have any passwords saved for "${parsed.serviceName}".`;
            }
          } else {
            botResponse = "Which service's password would you like to retrieve?";
          }
          break;
        }

        case 'system_query': {
          const workflowsResponse = await this.aiService.generateBasicResponse(
            `You are a helpful assistant for a reminder app. A user asked: "${message}". Answer their question politely and accurately based on these system capabilities:\n\n${WORKFLOWS}\n\nKeep it concise, friendly, and use emoji. Only answer what the system can actually do — don't make things up.`,
            undefined,
          );
          botResponse = workflowsResponse;
          break;
        }

        default: {
          // create_reminder or unknown
          if (parsed.actionType === 'create_reminder' && parsed.confidence > 0.7 && !parsed.needsClarification) {
            this.logger.log(`Creating reminder...`);
            try {
              // If no start date but recurring, first reminder fires after one interval
              const reminderDate = parsed.reminderDate
                ? new Date(parsed.reminderDate)
                : parsed.intervalMinutes
                  ? new Date(Date.now() + parsed.intervalMinutes * 60 * 1000)
                  : new Date(Date.now() + 10 * 60 * 1000);
              const created = await this.reminderService.createReminder({
                userId: user.id,
                title: parsed.title,
                description: parsed.description,
                reminderDate,
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
              const timeStr = this.formatRelativeTime(reminderDate);
              const repeatInfo = parsed.intervalMinutes
                ? ` (repeats every ${parsed.intervalMinutes} min)`
                : '';
              botResponse = `✅ Reminder set! I'll remind you to "${created.title}" ${timeStr}${repeatInfo}.`;
            } catch (e) {
              this.logger.error('Failed to save reminder:', e);
              botResponse = "I understood your reminder but had trouble saving it. Please try again!";
            }
          } else if (parsed.needsClarification && parsed.clarificationQuestion) {
            botResponse = parsed.clarificationQuestion;
          } else {
            botResponse = "I'm not sure I understood that. You can:\n• Set a reminder (\"remind me to...\")\n• Save a note (\"remember that...\")\n• Save a password (\"save my ... password as...\")\n• Create a todo list (\"start a shopping list\")";
          }
        }
      }

      // Send bot response and push to conversation history
      await this.whatsappService.sendMessage(userPhone, botResponse);
      await this.userContextService.pushMessage(user.id, 'assistant', botResponse);

    } catch (error) {
      this.logger.error('Error processing WhatsApp message:', error);
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
    try {
      Intl.DateTimeFormat(undefined, { timeZone: input });
      return input;
    } catch {
      return null;
    }
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
