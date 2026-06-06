import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsappService, WhatsAppChatCommand } from './whatsapp.service';
import { TodoListService } from './todo-list.service';
import { UserContextService } from './user-context.service';
import { UserService } from './user.service';
import { ReminderService } from './reminder.service';
import { appendChatTips } from '../constants/chat-tips';
import { MENU_ROW, getMenuSections, getEditListSections } from '../constants/menu-sections';

export const CHAT_COMMANDS: WhatsAppChatCommand[] = [
  { command_name: 'view_list', command_description: "View today's to-do list" },
  { command_name: 'lists', command_description: 'View all your lists' },
  { command_name: 'create_list', command_description: 'Create a list and add items' },
  { command_name: 'help', command_description: 'What this assistant can do' },
  { command_name: 'menu', command_description: 'Open the slide-up menu' },
];

export const CREATE_BTN = {
  addItem: 'create_add_item',
  finish: 'create_finish',
  viewList: 'create_view_list',
} as const;

export const DAILY_LIST_BTN = 'daily_list_create';

@Injectable()
export class ListWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(ListWorkflowService.name);

  constructor(
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly whatsappService: WhatsappService,
    private readonly userService: UserService,
    private readonly reminderService: ReminderService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WHATSAPP_REGISTER_COMMANDS === 'false') return;
    const ok = await this.registerChatCommands();
    if (!ok) {
      this.logger.warn(
        'Chat commands not registered at startup. Call POST /whatsapp/setup/commands after deploy.',
      );
    }
  }

  async registerChatCommands(): Promise<boolean> {
    return this.whatsappService.configureConversationalCommands(CHAT_COMMANDS);
  }

  isWorkflowButton(buttonId: string): boolean {
    return (
      buttonId === DAILY_LIST_BTN ||
      buttonId === CREATE_BTN.addItem ||
      buttonId === CREATE_BTN.finish ||
      buttonId === CREATE_BTN.viewList ||
      buttonId === MENU_ROW.editAddItems ||
      buttonId === MENU_ROW.editFinish
    );
  }

  async sendSlideUpMenu(userPhone: string, userId: string): Promise<void> {
    await this.whatsappService.sendInteractiveListMessage(
      userPhone,
      '☝️ Tap an option below',
      'Open menu',
      getMenuSections(),
      'Reminder Assistant',
    );
  }

  async handleMenuText(userPhone: string, userId: string, message: string): Promise<boolean> {
    const t = message.trim().toLowerCase();
    if (t === 'menu') {
      await this.sendSlideUpMenu(userPhone, userId);
      return true;
    }
    if (t === 'create list' || t === 'new list') {
      await this.startCreateList(userPhone, userId);
      return true;
    }
    return false;
  }

  /** Active edit-list wizard (skip AI). */
  async handleEditWorkflow(
    userPhone: string,
    userId: string,
    message: string,
  ): Promise<boolean> {
    const workflow = await this.userContextService.getListWorkflow(userId);
    if (!workflow || !workflow.state.startsWith('editing')) return false;

    const trimmed = message.trim();
    if (/^cancel$/i.test(trimmed)) {
      await this.userContextService.clearListWorkflow(userId);
      const body = 'Cancelled. Tap 📋 *Menu* when you need me again.';
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    // ── Rename sub-flow ────────────────────────────────────────────────────
    if (workflow.state === 'editing_list_rename' && workflow.listId) {
      const newTitle = trimmed.slice(0, 80);
      if (!newTitle) {
        await this.whatsappService.sendWithMenu(userPhone, 'Please send a new name for the list, or *cancel*.');
        return true;
      }
      await this.todoListService.renameList(workflow.listId, userId, newTitle);
      await this.userContextService.clearListWorkflow(userId);
      const body = `✏️ Renamed to *${newTitle}*!`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    // ── Add-items sub-flow (reuses item-adding logic) ──────────────────────
    if (workflow.state === 'editing_list' && workflow.editAddingItems && workflow.listId && workflow.listTitle) {
      const items = this.parseItemLines(trimmed);
      if (items.length === 0) {
        await this.whatsappService.sendWithMenu(
          userPhone,
          'Send an item name, several comma-separated items, or tap *Finish*.',
        );
        return true;
      }

      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';

      let count = workflow.itemCount || 0;
      let reminderCount = 0;
      for (const content of items) {
        const { cleanContent, parsedTime } = this.parseTimeFromItem(content);
        const saved = await this.todoListService.addItem(workflow.listId, userId, cleanContent);
        count++;
        if (parsedTime) {
          const reminderDate = this.computeReminderDate(parsedTime, tz);
          if (reminderDate) {
            await this.reminderService.createReminder({
              userId,
              title: cleanContent,
              description: `In ${workflow.listTitle} list`,
              reminderDate,
              todoItemId: saved.id,
            });
            await this.todoListService.updateItemReminderAt(saved.id, reminderDate);
            reminderCount++;
          }
        }
      }

      await this.userContextService.setListWorkflow(userId, {
        ...workflow,
        itemCount: count,
        awaitingItemInput: false,
      });

      const added = items.length === 1 ? `✅ Added *${items[0]}*` : `✅ Added ${items.length} items`;
      const reminderNote = reminderCount > 0 ? ` 🔔 (${reminderCount} with reminders)` : '';
      await this.whatsappService.sendWithMenu(
        userPhone,
        `${added} to *${workflow.listTitle}* (${count} total)${reminderNote}. Keep sending items or choose:`,
      );
      await this.sendEditAddingButtons(userPhone, userId, workflow.listTitle, workflow.listId, count);
      return true;
    }

    // ── Attach-reminder time sub-flow ──────────────────────────────────────
    if (workflow.state === 'editing_list_reminder_time' && workflow.editTargetItemId) {
      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';

      const timeMatch = trimmed.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
      if (!timeMatch) {
        await this.whatsappService.sendWithMenu(
          userPhone,
          "Please tell me the time. Example: *5pm* or *7:30am* or type *cancel*.",
        );
        return true;
      }

      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2] || '0', 10);
      const mer = timeMatch[3]?.toLowerCase();
      if (mer === 'pm' && h < 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
      if (h > 23 || m > 59) {
        await this.whatsappService.sendWithMenu(userPhone, "That doesn't look like a valid time. Try *5pm* or *7:30am*.");
        return true;
      }

      const reminderDate = this.computeReminderDate({ hours: h, minutes: m }, tz);
      if (!reminderDate) {
        await this.whatsappService.sendWithMenu(userPhone, 'Could not parse that time. Try again or *cancel*.');
        return true;
      }

      await this.todoListService.updateItemReminderAt(workflow.editTargetItemId, reminderDate);

      const item = await this.todoListService.getItemById(workflow.editTargetItemId);
      const itemTitle = item?.content || 'item';

      await this.reminderService.createReminder({
        userId,
        title: itemTitle,
        description: `In ${workflow.listTitle || 'list'} list`,
        reminderDate,
        todoItemId: workflow.editTargetItemId,
      });

      await this.userContextService.clearListWorkflow(userId);
      const timeStr = reminderDate.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      const body = `🔔 Reminder set for *${itemTitle}* at ${timeStr}!`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    return false;
  }

  /** Active create-list wizard (skip AI). */
  async handleCreateWorkflow(
    userPhone: string,
    userId: string,
    message: string,
  ): Promise<boolean> {
    const workflow = await this.userContextService.getListWorkflow(userId);
    if (!workflow) return false;

    const trimmed = message.trim();
    if (/^cancel$/i.test(trimmed)) {
      await this.userContextService.clearListWorkflow(userId);
      const body = 'Cancelled. Tap 📋 *Menu* when you need me again.';
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    if (workflow.state === 'awaiting_create_name') {
      const title = trimmed.slice(0, 80);
      if (!title) {
        await this.whatsappService.sendWithMenu(userPhone, 'Please send a list name, or *cancel*.');
        return true;
      }
      const list = await this.todoListService.createList(userId, title);
      await this.userContextService.setListWorkflow(userId, {
        state: 'adding_create_items',
        listId: list.id,
        listTitle: list.title,
        itemCount: 0,
        awaitingItemInput: false,
      });
      const body =
        `📁 Created *${list.title}*.\n\n` +
        `Send items as messages (one per line, or comma-separated).\n` +
        `Add "at 5pm" to any item to set a reminder (e.g. "buy milk at 5pm").\n` +
        `Or tap *Add item* below, then type each item. Tap *Finish* when done.`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      await this.sendCreateItemButtons(userPhone, userId, list.title, 0);
      return true;
    }

    if (workflow.state === 'adding_create_items' && workflow.listId && workflow.listTitle) {
      const items = this.parseItemLines(trimmed);
      if (items.length === 0) {
        await this.whatsappService.sendWithMenu(
          userPhone,
          'Send an item name, several comma-separated items, or tap *Finish*.',
        );
        return true;
      }

      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';

      let count = workflow.itemCount || 0;
      let reminderCount = 0;
      for (const content of items) {
        const { cleanContent, parsedTime } = this.parseTimeFromItem(content);
        const saved = await this.todoListService.addItem(workflow.listId, userId, cleanContent);
        count++;
        if (parsedTime) {
          const reminderDate = this.computeReminderDate(parsedTime, tz);
          if (reminderDate) {
            await this.reminderService.createReminder({
              userId,
              title: cleanContent,
              description: `In ${workflow.listTitle} list`,
              reminderDate,
              todoItemId: saved.id,
            });
            await this.todoListService.updateItemReminderAt(saved.id, reminderDate);
            reminderCount++;
          }
        }
      }

      await this.userContextService.setListWorkflow(userId, {
        ...workflow,
        itemCount: count,
        awaitingItemInput: false,
      });

      const added =
        items.length === 1
          ? `✅ Added *${items[0]}*`
          : `✅ Added ${items.length} items`;
      const reminderNote = reminderCount > 0
        ? ` 🔔 (${reminderCount} with reminders)`
        : '';
      await this.whatsappService.sendWithMenu(
        userPhone,
        `${added} to *${workflow.listTitle}* (${count} total)${reminderNote}. Send more or tap a button below:`,
      );
      await this.sendCreateItemButtons(userPhone, userId, workflow.listTitle, count);
      return true;
    }

    return false;
  }

  async handleButton(userPhone: string, userId: string, buttonId: string): Promise<boolean> {
    if (!this.isWorkflowButton(buttonId)) return false;

    // Handle daily list creation button — pre-fills the daily title
    if (buttonId === DAILY_LIST_BTN) {
      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';
      const todayTitle = new Date().toLocaleDateString('en-US', {
        timeZone: tz, month: 'long', day: 'numeric',
      }) + ' Daily List';
      let list = await this.todoListService.findListByTitle(userId, todayTitle);
      if (!list) {
        list = await this.todoListService.createList(userId, todayTitle);
      }
      await this.userContextService.setListWorkflow(userId, {
        state: 'adding_create_items',
        listId: list.id,
        listTitle: todayTitle,
        itemCount: 0,
      });
      await this.sendCreateItemButtons(userPhone, userId, todayTitle, 0);
      await this.userContextService.pushMessage(userId, 'assistant', `Daily list "${todayTitle}" is ready!`);
      return true;
    }

    const workflow = await this.userContextService.getListWorkflow(userId);

    // ── Edit add-items button ──────────────────────────────────────────────
    if (buttonId === MENU_ROW.editAddItems) {
      if (!workflow || workflow.state !== 'editing_list' || !workflow.listId) {
        await this.whatsappService.sendWithMenu(userPhone, 'No list is being edited right now.');
        return true;
      }
      await this.userContextService.setListWorkflow(userId, {
        ...workflow,
        editAddingItems: true,
        awaitingItemInput: false,
      });
      const body =
        `Send items to add to *${workflow.listTitle}* (one per line or comma-separated).\n` +
        `Add "at 5pm" to any item to set a reminder. Tap *Finish* when done.`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      await this.sendEditAddingButtons(userPhone, userId, workflow.listTitle, workflow.listId, workflow.itemCount || 0);
      return true;
    }

    // ── Edit finish button ──────────────────────────────────────────────────
    if (buttonId === MENU_ROW.editFinish) {
      if (!workflow || workflow.state !== 'editing_list' || !workflow.listId) {
        await this.whatsappService.sendWithMenu(userPhone, 'No list is being edited right now.');
        return true;
      }
      await this.finishEditList(userPhone, userId, workflow.listId);
      return true;
    }

    // ── Create-list buttons ─────────────────────────────────────────────────
    if (!workflow || workflow.state !== 'adding_create_items' || !workflow.listId) {
      await this.whatsappService.sendWithMenu(
        userPhone,
        'No list creation in progress. Tap 📋 *Menu* → *Create list* to start.',
      );
      return true;
    }

    if (buttonId === CREATE_BTN.addItem) {
      await this.userContextService.setListWorkflow(userId, {
        ...workflow,
        awaitingItemInput: true,
      });
      const body = `Type the item to add to *${workflow.listTitle}*.\n\n_Add "at 5pm" to set a reminder, or send several separated by commas._`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    if (buttonId === CREATE_BTN.viewList) {
      await this.sendSingleList(userPhone, userId, workflow.listId);
      await this.sendCreateItemButtons(
        userPhone,
        userId,
        workflow.listTitle,
        workflow.itemCount || 0,
      );
      return true;
    }

    if (buttonId === CREATE_BTN.finish) {
      await this.finishCreateList(userPhone, userId, workflow.listId, workflow.listTitle);
      return true;
    }

    return false;
  }

  async handleSlashCommand(
    userPhone: string,
    userId: string,
    message: string,
    timezone: string = 'UTC',
  ): Promise<boolean> {
    const trimmed = message.trim();
    const match = trimmed.match(/^\/(\w+)(?:@\S+)?(?:\s+.*)?$/);
    if (!match) return false;

    const cmd = match[1].toLowerCase();
    this.logger.log(`Chat command: /${cmd} from user ${userId}`);

    if (cmd === 'menu') {
      await this.sendSlideUpMenu(userPhone, userId);
      return true;
    }
    if (cmd === 'create_list') {
      await this.startCreateList(userPhone, userId);
      return true;
    }
    if (cmd === 'view_list' || cmd === 'lists' || cmd === 'help') {
      await this.runMenuAction(cmd, userPhone, userId, timezone);
      return true;
    }
    return false;
  }

  async handleListReply(
    userPhone: string,
    userId: string,
    rowId: string,
    timezone: string = 'UTC',
  ): Promise<boolean> {
    this.logger.log(`List menu selection: ${rowId} from user ${userId}`);

    if (rowId === MENU_ROW.createList) {
      await this.startCreateList(userPhone, userId);
      return true;
    }
    if (rowId === MENU_ROW.viewList) {
      await this.runMenuAction('view_list', userPhone, userId, timezone);
      return true;
    }
    if (rowId === MENU_ROW.allLists) {
      await this.sendListsSlideUpMenu(userPhone, userId);
      return true;
    }
    if (rowId === MENU_ROW.createReminder) {
      const body = "⏰ *Create a reminder*\n\nTell me what to remind you about and when.\n\nExample: \"remind me at 5pm to buy milk\" or \"remind me every 30 min to stand up\"";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.showReminders) {
      const body = "⏰ *Your reminders*\n\nSay *\"show my reminders\"* and I'll list all your pending reminders!";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.createNote) {
      const body = "📝 *Save a note*\n\nTell me what to remember.\n\nExample: \"remember my email is abc@xyz.com\" or \"my address is 123 Main St\"";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.showNotes) {
      const body = "📝 *Find a note*\n\nAsk me what you want to retrieve.\n\nExample: \"what is my pan number?\" or \"show my notes\"";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.help) {
      await this.runMenuAction('help', userPhone, userId, timezone);
      return true;
    }
    if (rowId === MENU_ROW.currentIpo) {
      const body = "📈 *Current IPOs*\n\nSay *\"current IPOs\"* to see open IPOs accepting applications.";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.upcomingIpo) {
      const body = "📈 *Upcoming IPOs*\n\nSay *\"upcoming IPOs\"* to see IPOs launching soon.";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.editList) {
      await this.sendEditListPicker(userPhone, userId);
      return true;
    }
    if (rowId.startsWith('edit_list_open:')) {
      await this.startEditList(userPhone, userId, rowId.slice('edit_list_open:'.length));
      return true;
    }
    if (rowId.startsWith('list_open:')) {
      await this.sendSingleList(userPhone, userId, rowId.slice('list_open:'.length));
      return true;
    }
    // ── Edit sub-flow selections ────────────────────────────────────────────
    if (rowId === MENU_ROW.editRename) {
      const workflow = await this.userContextService.getListWorkflow(userId);
      if (!workflow || workflow.state !== 'editing_list') return false;
      await this.userContextService.setListWorkflow(userId, { ...workflow, state: 'editing_list_rename' });
      const body = '✏️ Send me the new name for the list, or type *cancel*.';
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }
    if (rowId === MENU_ROW.editAddItems) {
      const workflow = await this.userContextService.getListWorkflow(userId);
      if (!workflow || workflow.state !== 'editing_list') return false;
      await this.userContextService.setListWorkflow(userId, { ...workflow, editAddingItems: true });
      const body =
        `Send items to add to *${workflow.listTitle}* (one per line or comma-separated).\n` +
        `Add "at 5pm" to any item to set a reminder. Tap *Finish* when done.`;
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      await this.sendEditAddingButtons(userPhone, userId, workflow.listTitle, workflow.listId, workflow.itemCount || 0);
      return true;
    }
    if (rowId === MENU_ROW.editRemoveItem) {
      const workflow = await this.userContextService.getListWorkflow(userId);
      if (!workflow || workflow.state !== 'editing_list' || !workflow.listId) return false;
      await this.sendEditItemPicker(userPhone, userId, workflow.listId, 'remove');
      return true;
    }
    if (rowId === MENU_ROW.editAttachReminder) {
      const workflow = await this.userContextService.getListWorkflow(userId);
      if (!workflow || workflow.state !== 'editing_list' || !workflow.listId) return false;
      await this.sendEditItemPicker(userPhone, userId, workflow.listId, 'reminder');
      return true;
    }
    if (rowId.startsWith('edit_pick_item:')) {
      const workflow = await this.userContextService.getListWorkflow(userId);
      if (!workflow || workflow.state !== 'editing_list') return false;
      const itemId = rowId.slice('edit_pick_item:'.length);
      if (workflow.editAction === 'reminder') {
        await this.userContextService.setListWorkflow(userId, {
          ...workflow,
          state: 'editing_list_reminder_time',
          editTargetItemId: itemId,
        });
        const item = await this.todoListService.getItemById(itemId);
        const itemTitle = item?.content || 'item';
        const body = `🔔 What time for *${itemTitle}*?\n\nExample: *5pm* or *7:30am*`;
        await this.whatsappService.sendWithMenu(userPhone, body);
        await this.userContextService.pushMessage(userId, 'assistant', body);
      } else {
        try {
          await this.todoListService.deleteItem(itemId, userId);
          const item = await this.todoListService.getItemById(itemId);
          if (item?.reminderAt) {
            const reminders = await this.reminderService.getPendingRemindersForUser(userId);
            const linked = reminders.find(r => r.todoItemId === itemId);
            if (linked) {
              await this.reminderService.deleteReminder(linked.id);
            }
          }
          const body = `❌ Removed that item.`;
          await this.whatsappService.sendWithMenu(userPhone, body);
          await this.userContextService.pushMessage(userId, 'assistant', body);
        } catch {
          await this.whatsappService.sendWithMenu(userPhone, 'Could not find that item to remove.');
        }
      }
      return true;
    }
    return false;
  }

  private async startCreateList(userPhone: string, userId: string): Promise<void> {
    await this.userContextService.setListWorkflow(userId, { state: 'awaiting_create_name' });
    const body =
      '📝 *Create a new list*\n\n' +
      'What should we call it?\n' +
      '(e.g. Groceries, Packing, Work tasks)\n\n' +
      '_Reply with the name, or type *cancel*._';
    await this.whatsappService.sendWithMenu(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendCreateItemButtons(
    userPhone: string,
    userId: string,
    listTitle: string,
    itemCount: number,
  ): Promise<void> {
    const body =
      `*${listTitle}* — ${itemCount} item${itemCount === 1 ? '' : 's'} so far.\n` +
      `_Add "at 5pm" to any item to set a reminder._\n\n` +
      `Keep sending items, or choose:`;
    await this.whatsappService.sendInteractiveMessage(userPhone, body, [
      { id: CREATE_BTN.addItem, title: '➕ Add item' },
      { id: CREATE_BTN.finish, title: '✅ Finish' },
      { id: CREATE_BTN.viewList, title: '📋 View list' },
    ]);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async finishCreateList(
    userPhone: string,
    userId: string,
    listId: string,
    listTitle: string,
  ): Promise<void> {
    await this.userContextService.clearListWorkflow(userId);
    try {
      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';
      const list = await this.todoListService.getList(listId, userId);
      const body =
        `🎉 *${listTitle}* is ready!\n\n${this.todoListService.formatList(list, tz)}\n\n` +
        `_Add more anytime: "add … to ${listTitle}"_`;
      await this.sendWithTips(userPhone, userId, body);
    } catch {
      await this.sendWithTips(userPhone, userId, `✅ Finished *${listTitle}*. Type *menu* for more.`);
    }
  }

  /** Split "milk, eggs" or multiline into separate items. */
  private parseItemLines(text: string): string[] {
    const parts = text.includes('\n')
      ? text.split('\n')
      : text.includes(',')
        ? text.split(',')
        : [text];
    return parts.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 20);
  }

  /** Extract time from item text like "buy milk at 5pm" → { cleanContent: "buy milk", parsedTime: {hours:17,minutes:0} } */
  private parseTimeFromItem(text: string): { cleanContent: string; parsedTime: { hours: number; minutes: number } | null } {
    const match = text.match(/^(.+?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (match) {
      let h = parseInt(match[2], 10);
      const m = parseInt(match[3] || '0', 10);
      const mer = match[4]?.toLowerCase();
      if (mer === 'pm' && h < 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
      if (h > 23 || m > 59) return { cleanContent: text, parsedTime: null };
      return { cleanContent: match[1].trim(), parsedTime: { hours: h, minutes: m } };
    }
    return { cleanContent: text, parsedTime: null };
  }

  /** Compute a Date for the next occurrence of parsedTime in the user's timezone. */
  private computeReminderDate(
    parsedTime: { hours: number; minutes: number },
    timezone: string,
  ): Date | null {
    const now = new Date();
    const localMin = parsedTime.hours * 60 + parsedTime.minutes;

    // Get UTC offset in minutes for this timezone at the current time
    let offsetMin = 0;
    try {
      const tzStr = now.toLocaleString('en-US', {
        timeZone: timezone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const [datePart, timePart] = tzStr.split(', ');
      const [m, d, y] = datePart.split('/');
      const [h, mn, s] = timePart.split(':');
      const tzDate = new Date(`${y}-${m}-${d}T${h}:${mn}:${s}Z`);
      offsetMin = (tzDate.getTime() - now.getTime()) / 60000;
    } catch {
      offsetMin = 0;
    }

    // Convert local wall-clock time to UTC
    const utcMin = (localMin - offsetMin + 1440) % 1440;

    const utcDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Math.floor(utcMin / 60),
      utcMin % 60,
    ));

    if (utcDate <= now) {
      utcDate.setDate(utcDate.getDate() + 1);
    }
    return utcDate;
  }

  private async runMenuAction(
    action: string,
    userPhone: string,
    userId: string,
    timezone: string,
  ): Promise<void> {
    switch (action) {
      case 'view_list':
        await this.sendTodayList(userPhone, userId, timezone);
        break;
      case 'lists':
        await this.sendListsSlideUpMenu(userPhone, userId);
        break;
      case 'help':
        await this.sendHelp(userPhone, userId);
        break;
    }
  }

  private async sendListsSlideUpMenu(userPhone: string, userId: string): Promise<void> {
    const lists = await this.todoListService.getLists(userId);
    if (lists.length === 0) {
      const body =
        "You don't have any lists yet.\n\n" +
        'Type *menu* → *Create list*, or say *"start a groceries list"* in chat.';
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return;
    }

    const rows = lists.slice(0, 10).map((l) => {
      const pending = (l.items || []).filter((i) => !i.isCompleted).length;
      return {
        id: MENU_ROW.openList(l.id),
        title: l.title.slice(0, 24),
        description: `${pending} pending`.slice(0, 72),
      };
    });

    const body = 'Tap a list to open it:';
    await this.whatsappService.sendInteractiveListMessage(
      userPhone,
      body,
      'Open list',
      [{ title: 'Your lists', rows }],
    );
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendSingleList(userPhone: string, userId: string, listId: string): Promise<void> {
    try {
      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';
      const list = await this.todoListService.getList(listId, userId);
      const body = this.todoListService.formatList(list, tz);
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
    } catch {
      const body = "That list wasn't found. Tap 📋 *Menu* to try again.";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
    }
  }

  private async sendTodayList(userPhone: string, userId: string, timezone: string): Promise<void> {
    const todayTitle = this.userService.dailyListTitle(timezone, 0);
    let list = await this.todoListService.findListByTitle(userId, todayTitle);
    if (!list) {
      list = await this.todoListService.createList(userId, todayTitle);
    } else {
      list = await this.todoListService.getList(list.id, userId);
    }
    const body = this.todoListService.formatList(list, timezone);
    await this.whatsappService.sendWithMenu(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendHelp(userPhone: string, userId: string): Promise<void> {
    const body = appendChatTips(
      'Here’s a quick overview. Tap 📋 *Menu* or type */create_list* to start the list wizard.',
    );
    await this.whatsappService.sendWithMenu(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendWithTips(userPhone: string, userId: string, text: string): Promise<void> {
    const body = appendChatTips(text);
    await this.whatsappService.sendWithMenu(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  // ── Edit-list helper methods ─────────────────────────────────────────────

  private async sendEditListPicker(userPhone: string, userId: string): Promise<void> {
    const lists = await this.todoListService.getLists(userId);
    if (lists.length === 0) {
      const body = "You don't have any lists yet. Type *menu* → *Create list* to make one.";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return;
    }

    const rows = lists.slice(0, 10).map((l) => {
      const pending = (l.items || []).filter((i) => !i.isCompleted).length;
      return {
        id: MENU_ROW.editListOpen(l.id),
        title: l.title.slice(0, 24),
        description: `${pending} pending`.slice(0, 72),
      };
    });

    const body = 'Which list would you like to edit?';
    await this.whatsappService.sendInteractiveListMessage(
      userPhone,
      body,
      'Edit list',
      [{ title: 'Your lists', rows }],
    );
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  async startEditList(userPhone: string, userId: string, listId: string): Promise<void> {
    try {
      const list = await this.todoListService.getList(listId, userId);
      const pendingCount = (list.items || []).filter(i => !i.isCompleted).length;
      await this.userContextService.setListWorkflow(userId, {
        state: 'editing_list',
        listId: list.id,
        listTitle: list.title,
        itemCount: pendingCount,
      });

      const body = `✏️ Editing *${list.title}* (${pendingCount} item${pendingCount === 1 ? '' : 's'})\n\nChoose what to do:`;
      await this.whatsappService.sendInteractiveListMessage(
        userPhone,
        body,
        'Edit options',
        getEditListSections(),
      );
      await this.userContextService.pushMessage(userId, 'assistant', body);
    } catch {
      const body = "That list wasn't found. Tap 📋 *Menu* to try again.";
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
    }
  }

  private async sendEditItemPicker(
    userPhone: string,
    userId: string,
    listId: string,
    action: 'remove' | 'reminder',
  ): Promise<void> {
    const workflow = await this.userContextService.getListWorkflow(userId);
    if (!workflow) return;

    await this.userContextService.setListWorkflow(userId, { ...workflow, editAction: action });

    try {
      const list = await this.todoListService.getList(listId, userId);
      const pending = (list.items || []).filter(i => !i.isCompleted);
      if (pending.length === 0) {
        const body = "There are no pending items in this list.";
        await this.whatsappService.sendWithMenu(userPhone, body);
        await this.userContextService.pushMessage(userId, 'assistant', body);
        return;
      }

      const rows = pending.slice(0, 10).map((i) => ({
        id: MENU_ROW.editPickItem(i.id),
        title: i.content.slice(0, 24),
        description: i.reminderAt ? '🔔 Has reminder' : '',
      }));

      const verb = action === 'remove' ? 'Which item to remove?' : 'Which item should get a reminder?';
      await this.whatsappService.sendInteractiveListMessage(
        userPhone,
        verb,
        'Select item',
        [{ title: list.title, rows }],
      );
      await this.userContextService.pushMessage(userId, 'assistant', verb);
    } catch {
      const body = 'Could not load items for that list.';
      await this.whatsappService.sendWithMenu(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
    }
  }

  private async sendEditAddingButtons(
    userPhone: string,
    userId: string,
    listTitle: string,
    listId: string,
    itemCount: number,
  ): Promise<void> {
    const body =
      `*${listTitle}* — ${itemCount} item${itemCount === 1 ? '' : 's'} so far.\n` +
      `_Add "at 5pm" to any item to set a reminder._\n\n` +
      `Keep sending items, or choose:`;
    await this.whatsappService.sendInteractiveMessage(userPhone, body, [
      { id: MENU_ROW.editAddItems, title: '➕ Add item' },
      { id: MENU_ROW.editFinish, title: '✅ Done' },
    ]);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async finishEditList(userPhone: string, userId: string, listId: string): Promise<void> {
    await this.userContextService.clearListWorkflow(userId);
    try {
      const user = await this.userService.getUserById(userId);
      const tz = user?.timezone || 'UTC';
      const list = await this.todoListService.getList(listId, userId);
      const body = `✏️ Done editing *${list.title}*!\n\n${this.todoListService.formatList(list, tz)}`;
      await this.sendWithTips(userPhone, userId, body);
    } catch {
      await this.sendWithTips(userPhone, userId, 'Done editing! Tap 📋 *Menu* for more options.');
    }
  }
}
