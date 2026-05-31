import { Injectable, Logger } from '@nestjs/common';
import { ReminderService } from '../services/reminder.service';
import { NoteService } from '../services/note.service';
import { PasswordService } from '../services/password.service';
import { TodoListService } from '../services/todo-list.service';
import { AiService } from '../services/ai.service';
import { UserService } from '../services/user.service';
import { UserContextService } from '../services/user-context.service';
import { ActionType } from '../types/parsed-reminder.interface';
import { WORKFLOWS } from '../constants/workflows';
import { resolveDisplayTimezone, formatRelativeTime } from '../utils/timezone.util';

interface ActionContext {
  userPhone: string;
  userId: string;
  message: string;
  msgTimestamp?: Date;
  userTimezone: string;
  userName: string;
}

@Injectable()
export class WhatsappActionHandler {
  private readonly logger = new Logger(WhatsappActionHandler.name);

  constructor(
    private readonly reminderService: ReminderService,
    private readonly noteService: NoteService,
    private readonly passwordService: PasswordService,
    private readonly todoListService: TodoListService,
    private readonly aiService: AiService,
    private readonly userService: UserService,
    private readonly userContextService: UserContextService,
  ) {}

  async handleCompleteReminder(
    reminderId: string | undefined,
    pendingReminders: { id: string; title: string }[],
  ): Promise<string> {
    if (reminderId && pendingReminders.some(r => r.id === reminderId)) {
      this.logger.log(`AI matched reminder ID ${reminderId} for completion`);
      const reminder = pendingReminders.find(r => r.id === reminderId);
      await this.reminderService.markAsCompleted(reminderId);
      await this.reminderService.deleteReminder(reminderId);
      await this.reminderService.deleteAllSchedulesForReminder(reminderId);
      return `✅ Marked "${reminder.title}" as done!`;
    }
    return "I'm not sure which reminder you're referring to. Please tell me the name of the reminder you'd like to mark as done.";
  }

  async handleSaveNote(noteKey: string | undefined, noteContent: string | undefined, userId: string): Promise<string> {
    if (noteKey && noteContent) {
      try {
        await this.noteService.createNote(userId, noteKey, noteContent);
        return `✅ Saved "${noteKey}" for you!`;
      } catch (e) {
        this.logger.error('Failed to save note:', e);
        return 'Sorry, I could not save that note.';
      }
    }
    return "What would you like me to save? Tell me a title and some content.";
  }

  async handleGetNote(noteKey: string | undefined, userId: string): Promise<string> {
    if (noteKey) {
      const notes = await this.noteService.searchNotes(userId, noteKey);
      if (notes.length > 0) {
        return notes.map(n => `📝 *${n.title}*:\n${n.content}`).join('\n\n');
      }
      return `I couldn't find a note matching "${noteKey}". Try asking with a different title — say "list my notes" to see what you have.`;
    }
    const all = await this.noteService.getAllNotesByUser(userId);
    if (all.length > 0) {
      return `Here are your notes:\n${all.map(n => `• ${n.title}`).join('\n')}\n\nAsk for one by name!`;
    }
    return "You don't have any saved notes yet. Save one by saying 'remember that my email is xyz'.";
  }

  async handleSavePassword(serviceName: string | undefined, password: string | undefined, userId: string): Promise<string> {
    if (serviceName && password) {
      try {
        const saved = await this.passwordService.savePassword(userId, serviceName, '', password);
        return `🔐 Saved password for *${serviceName}* (${saved.createdAt.toLocaleString()})`;
      } catch (e) {
        this.logger.error('Failed to save password:', e);
        return 'Sorry, I could not save that password.';
      }
    }
    return "Please tell me the service name and password you'd like to save. For example: 'save my facebook password as abc123'";
  }

  async handleCreateTodo(
    todoListTitle: string | undefined,
    todoItemContents: string[] | undefined,
    parsed: { title?: string; reminderDate?: Date; msgTimestamp?: Date },
    userId: string,
  ): Promise<string> {
    if (todoListTitle) {
      try {
        const list = await this.todoListService.createList(userId, todoListTitle);
        const items = todoItemContents || [];
        if (items.length > 0) {
          for (const item of items) {
            const saved = await this.todoListService.addItem(list.id, userId, item, parsed.reminderDate);
            if (parsed.reminderDate) {
              await this.reminderService.createReminder({
                userId,
                title: parsed.title || item,
                description: `In ${todoListTitle} list`,
                reminderDate: parsed.reminderDate,
                todoItemId: saved.id,
                msgTimestamp: parsed.msgTimestamp,
              });
            }
          }
          const reminderNote = parsed.reminderDate ? ` 🔔 I'll remind you about it.` : '';
          return `📋 Created "${todoListTitle}" with ${items.length} items!${reminderNote}`;
        }
        return `📋 Created a new list "${todoListTitle}"! Add items by saying "add ... to ${todoListTitle}".`;
      } catch (e) {
        this.logger.error('Failed to create todo list:', e);
        return 'Sorry, I could not create that list.';
      }
    }
    return "What would you like to call your new list?";
  }

  async handleAddTodoItem(
    todoListTitle: string | undefined,
    todoItemContents: string[] | undefined,
    todoItemContent: string | undefined,
    noteKey: string | undefined,
    parsed: { title?: string; reminderDate?: Date; msgTimestamp?: Date },
    userId: string,
  ): Promise<string> {
    const listTitle = todoListTitle || 'general';
    const items = todoItemContents || (todoItemContent ? [todoItemContent] : noteKey ? [noteKey] : []);
    if (items.length > 0) {
      try {
        let list = await this.todoListService.findListByTitle(userId, listTitle);
        if (!list) {
          list = await this.todoListService.createList(userId, listTitle);
        }
        for (const item of items) {
          const saved = await this.todoListService.addItem(list.id, userId, item, parsed.reminderDate);
          if (parsed.reminderDate) {
            await this.reminderService.createReminder({
              userId,
              title: parsed.title || item,
              description: `In ${listTitle} list`,
              reminderDate: parsed.reminderDate,
              todoItemId: saved.id,
              msgTimestamp: parsed.msgTimestamp,
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

  async handleGetTodo(
    todoListTitle: string | undefined,
    userId: string,
  ): Promise<{ response: string; pendingSelection?: any }> {
    if (todoListTitle) {
      try {
        const lists = await this.todoListService.findListsByTitle(userId, todoListTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            return { response: this.todoListService.formatList(lists[0]) };
          }
          const pendingSelection = {
            title: todoListTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'get_todo' as ActionType,
          };
          return {
            response: `I found ${lists.length} lists called "${todoListTitle}":\n\n${lists.map((l, i) =>
              `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
            ).join('\n')}\n\nReply with the number to pick one.`,
            pendingSelection,
          };
        }
        return { response: `I don't have a list called "${todoListTitle}".` };
      } catch (e) {
        this.logger.error('Failed to get todo list:', e);
        return { response: 'Sorry, I could not retrieve that list.' };
      }
    }
    const lists = await this.todoListService.getLists(userId);
    if (lists.length > 0) {
      return { response: `Here are your lists:\n${lists.map(l => `• ${l.title}`).join('\n')}\n\nAsk to see one by name!` };
    }
    return { response: "You don't have any lists yet. Create one by saying something like 'start a shopping list'." };
  }

  async handleCompleteTodoItem(
    todoListTitle: string | undefined,
    todoItemContents: string[] | undefined,
    todoItemContent: string | undefined,
    noteKey: string | undefined,
    userId: string,
  ): Promise<{ response: string; pendingSelection?: any }> {
    const listTitle = todoListTitle || 'general';
    const items = todoItemContents || (todoItemContent ? [todoItemContent] : noteKey ? [noteKey] : []);
    if (items.length > 0) {
      try {
        const lists = await this.todoListService.findListsByTitle(userId, listTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            let doneCount = 0;
            let listDeleted = false;
            const allItems = await this.todoListService.getItems(lists[0].id, userId);
            const pending = allItems.filter(i => !i.isCompleted);
            for (const target of items) {
              const match = this.findItemByReference(pending, target);
              if (match) {
                const result = await this.todoListService.completeItem(match.id, userId);
                doneCount++;
                if (result.listDeleted) listDeleted = true;
              }
            }
            if (listDeleted) {
              return { response: `✅ All items done in ${listTitle}! The list has been cleaned up. 🎉` };
            } else if (doneCount > 0) {
              return { response: `✅ Marked ${doneCount} item(s) as done in ${listTitle}!` };
            }
            return { response: `I couldn't find those items in the ${listTitle} list.` };
          }
          const pendingSelection = {
            title: listTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'complete_todo_item' as ActionType,
            itemTargets: items,
          };
          return {
            response: `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
              `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
            ).join('\n')}\n\nWhich list has the items you want to mark done? Reply with the number.`,
            pendingSelection,
          };
        }
        return { response: `I don't have a list called "${listTitle}".` };
      } catch (e) {
        this.logger.error('Failed to complete todo item:', e);
        return { response: 'Sorry, I could not mark that item as done.' };
      }
    }
    return { response: "Which item would you like to mark as done?" };
  }

  async handleEditTodoItem(
    todoListTitle: string | undefined,
    todoItemContent: string | undefined,
    todoItemContents: string[] | undefined,
    noteContent: string | undefined,
    userId: string,
  ): Promise<{ response: string; pendingSelection?: any }> {
    const listTitle = todoListTitle || 'general';
    const targetRef = todoItemContent || (todoItemContents ? todoItemContents[0] : '');
    const newContent = noteContent;
    if (targetRef && newContent) {
      try {
        const lists = await this.todoListService.findListsByTitle(userId, listTitle);
        if (lists.length > 0) {
          if (lists.length === 1) {
            const allItems = await this.todoListService.getItems(lists[0].id, userId);
            const pending = allItems.filter(i => !i.isCompleted);
            let match = this.findItemByReference(pending, targetRef);
            if (!match) {
              match = allItems.find(i => i.content.toLowerCase().includes(targetRef.toLowerCase()));
            }
            if (match) {
              await this.todoListService.updateItem(match.id, userId, newContent);
              return { response: `✅ Updated "${targetRef}" to "${newContent}" in ${lists[0].title}!` };
            }
            return { response: `I couldn't find "${targetRef}" in the ${listTitle} list.` };
          }
          return {
            response: `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
              `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
            ).join('\n')}\n\nWhich list has the item you want to edit? Reply with the number.`,
            pendingSelection: {
              title: listTitle,
              listIds: lists.map(l => l.id),
              listDates: lists.map(l => l.createdAt.toLocaleDateString()),
              actionType: 'edit_todo_item' as ActionType,
              itemRef: targetRef,
              newContent,
            },
          };
        }
        return { response: `I don't have a list called "${listTitle}".` };
      } catch (e) {
        this.logger.error('Failed to edit todo item:', e);
        return { response: 'Sorry, I could not edit that item.' };
      }
    }
    return { response: "Please tell me which item to edit and what to change it to. For example: 'edit first item as buy milk'." };
  }

  async handleDeleteList(
    todoListTitle: string | undefined,
    userId: string,
  ): Promise<{ response: string; pendingSelection?: any }> {
    const listTitle = todoListTitle || 'general';
    try {
      const lists = await this.todoListService.findListsByTitle(userId, listTitle);
      if (lists.length > 0) {
        if (lists.length === 1) {
          await this.todoListService.deleteList(lists[0].id, userId);
          return { response: `🗑️ Deleted "${listTitle}" list!` };
        }
        return {
          response: `I found ${lists.length} lists called "${listTitle}":\n\n${lists.map((l, i) =>
            `*${i + 1}.* (created ${l.createdAt.toLocaleDateString()})`
          ).join('\n')}\n\nWhich one do you want to delete? Reply with the number.`,
          pendingSelection: {
            title: listTitle,
            listIds: lists.map(l => l.id),
            listDates: lists.map(l => l.createdAt.toLocaleDateString()),
            actionType: 'delete_list' as ActionType,
          },
        };
      }
      return { response: `I don't have a list called "${listTitle}".` };
    } catch (e) {
      this.logger.error('Failed to delete list:', e);
      return { response: 'Sorry, I could not delete that list.' };
    }
  }

  async handleGetPassword(serviceName: string | undefined, userId: string): Promise<string> {
    if (serviceName) {
      const entries = await this.passwordService.getPasswordsByService(userId, serviceName);
      if (entries.length > 0) {
        const formatted = entries.map((e, i) =>
          `*${i + 1}. ${e.service}* — saved ${e.createdAt.toLocaleString()}\nPassword: \`${e.encryptedPassword}\``
        ).join('\n\n');
        return `🔑 Passwords for *${serviceName}*:\n\n${formatted}`;
      }
      return `I don't have any passwords saved for "${serviceName}".`;
    }
    return "Which service's password would you like to retrieve?";
  }

  async handleUpdateSettings(
    dailyPromptTime: string | undefined,
    user: { id: string; dailyPromptTime?: string },
  ): Promise<string> {
    if (dailyPromptTime) {
      const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (timePattern.test(dailyPromptTime)) {
        await this.userService.updateUser(user.id, { dailyPromptTime });
        return `✅ Your daily prompt time has been set to ${dailyPromptTime}. I'll check in with you each day then!`;
      }
      return `I couldn't understand that time. Please use HH:mm format, like 09:00 or 14:30.`;
    }
    return `Your daily prompt is currently set to ${user.dailyPromptTime || '09:00'}. Say "set daily prompt to 8am" to change it.`;
  }

  async handleSystemQuery(message: string): Promise<string> {
    return this.aiService.generateBasicResponse(
      `You are a helpful assistant for a reminder app. A user asked: "${message}". Answer their question politely and accurately based on these system capabilities:\n\n${WORKFLOWS}\n\nKeep it concise, friendly, and use emoji. Only answer what the system can actually do — don't make things up.`,
      undefined,
    );
  }

  async handleCreateReminder(
    parsed: {
      title?: string;
      description?: string;
      reminderDate?: Date;
      intervalMinutes?: number;
      maxReminderCount?: number;
      category?: string;
      priority?: string;
      recurring?: any;
      needsClarification?: boolean;
      clarificationQuestion?: string;
      confidence?: number;
    },
    context: ActionContext,
    msgTimestamp?: Date,
  ): Promise<string> {
    const nowRef = msgTimestamp || new Date();
    const reminderDate = parsed.reminderDate && !isNaN(new Date(parsed.reminderDate).getTime())
      ? new Date(parsed.reminderDate)
      : parsed.intervalMinutes
        ? new Date(nowRef.getTime() + parsed.intervalMinutes * 60 * 1000)
        : new Date(nowRef.getTime() + 10 * 60 * 1000);

    const diffMs = reminderDate.getTime() - nowRef.getTime();
    this.logger.log(`Reminder scheduled for ${reminderDate.toISOString()} (${Math.round(diffMs / 60000)} min from msgTimestamp)`);

    const created = await this.reminderService.createReminder({
      userId: context.userId,
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
        source: 'whatsapp',
      },
    });
    const displayTz = resolveDisplayTimezone(context.userTimezone, nowRef, reminderDate);
    const timeStr = formatRelativeTime(reminderDate, displayTz, nowRef);
    const repeatInfo = parsed.intervalMinutes
      ? ` (repeats every ${parsed.intervalMinutes} min)`
      : '';
    return `✅ Reminder set! I'll remind you to "${created.title}" ${timeStr}${repeatInfo}.`;
  }

  private findItemByReference(items: any[], reference: string): any | null {
    const lowerRef = reference.toLowerCase();
    if (/^(first|1st|#1|top)\b/.test(lowerRef)) return items[0] || null;
    if (/^(second|2nd|#2)\b/.test(lowerRef)) return items[1] || null;
    if (/^(third|3rd|#3)\b/.test(lowerRef)) return items[2] || null;
    if (/^last\b/.test(lowerRef)) return items[items.length - 1] || null;
    return items.find(i => i.content.toLowerCase().includes(lowerRef)) || null;
  }
}
