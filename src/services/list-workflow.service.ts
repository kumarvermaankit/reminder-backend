import { Injectable, Logger } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { TodoListService } from './todo-list.service';
import { UserContextService } from './user-context.service';

/** Button reply ids for guided list management (Strategy A). */
export const LIST_BTN = {
  menuNewList: 'menu_new_list',
  menuMyLists: 'menu_my_lists',
  add: (listId: string) => `list_add:${listId}`,
  view: (listId: string) => `list_view:${listId}`,
  del: (listId: string) => `list_del:${listId}`,
} as const;

@Injectable()
export class ListWorkflowService {
  private readonly logger = new Logger(ListWorkflowService.name);

  constructor(
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly whatsappService: WhatsappService,
  ) {}

  isListButton(buttonId: string): boolean {
    return (
      buttonId === LIST_BTN.menuNewList ||
      buttonId === LIST_BTN.menuMyLists ||
      buttonId.startsWith('list_add:') ||
      buttonId.startsWith('list_view:') ||
      buttonId.startsWith('list_del:')
    );
  }

  async sendMainMenu(userPhone: string, userId: string, userName?: string): Promise<void> {
    const greeting = userName && userName !== 'there' ? `Hi ${userName}! ` : '';
    const body =
      `${greeting}What would you like to do?\n\n` +
      `Tap *➕ Create New List* to start a list step-by-step, or *📋 My Lists* to see your lists.`;
    await this.whatsappService.sendInteractiveMessage(userPhone, body, [
      { id: LIST_BTN.menuNewList, title: '➕ Create New List' },
      { id: LIST_BTN.menuMyLists, title: '📋 My Lists' },
    ]);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  async startCreateList(userPhone: string, userId: string): Promise<void> {
    await this.userContextService.setListWorkflow(userId, { state: 'awaiting_list_name' });
    const body =
      'What is the name of your new list?\n\n' +
      '(e.g. Groceries, Packing List, Daily Goals)\n\n' +
      '_Reply with the name, or type *cancel* to stop._';
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  async sendListManageMenu(
    userPhone: string,
    userId: string,
    listId: string,
    listTitle: string,
    header?: string,
  ): Promise<void> {
    const body =
      (header ? `${header}\n\n` : '') +
      `📁 List *${listTitle}*\n\nTap a button below to quickly manage it:`;
    await this.whatsappService.sendInteractiveMessage(userPhone, body, [
      { id: LIST_BTN.add(listId), title: '➕ Add Item' },
      { id: LIST_BTN.view(listId), title: '📋 View List' },
      { id: LIST_BTN.del(listId), title: '❌ Delete List' },
    ]);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  /** @returns true if the button was handled */
  async handleButton(userPhone: string, userId: string, buttonId: string): Promise<boolean> {
    if (!this.isListButton(buttonId)) return false;

    try {
      if (buttonId === LIST_BTN.menuNewList) {
        await this.startCreateList(userPhone, userId);
        return true;
      }

      if (buttonId === LIST_BTN.menuMyLists) {
        await this.sendMyLists(userPhone, userId);
        return true;
      }

      const [action, listId] = buttonId.split(':');
      if (!listId) return false;

      const list = await this.todoListService.getList(listId, userId);

      if (action === 'list_add') {
        await this.userContextService.setListWorkflow(userId, {
          state: 'awaiting_item',
          listId: list.id,
          listTitle: list.title,
        });
        const body =
          `Type the item you want to add to *${list.title}*.\n\n` +
          `_Example: Milk_\n_Type *cancel* to stop._`;
        await this.whatsappService.sendMessage(userPhone, body);
        await this.userContextService.pushMessage(userId, 'assistant', body);
        return true;
      }

      if (action === 'list_view') {
        const formatted = this.todoListService.formatList(list);
        await this.whatsappService.sendMessage(userPhone, formatted);
        await this.userContextService.pushMessage(userId, 'assistant', formatted);
        await this.sendListManageMenu(userPhone, userId, list.id, list.title);
        return true;
      }

      if (action === 'list_del') {
        await this.todoListService.deleteList(list.id, userId);
        await this.userContextService.clearListWorkflow(userId);
        const body = `🗑️ Deleted list *${list.title}*.`;
        await this.whatsappService.sendMessage(userPhone, body);
        await this.userContextService.pushMessage(userId, 'assistant', body);
        await this.sendMainMenu(userPhone, userId);
        return true;
      }
    } catch (e) {
      this.logger.warn(`List button ${buttonId} failed: ${e.message}`);
      const body = "I couldn't find that list anymore. Try *menu* to start over.";
      await this.whatsappService.sendMessage(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    return false;
  }

  /** @returns true if message was consumed by list workflow (skip AI) */
  async handleTextMessage(userPhone: string, userId: string, message: string): Promise<boolean> {
    const trimmed = message.trim();
    if (/^(menu|lists|my lists)$/i.test(trimmed)) {
      await this.sendMainMenu(userPhone, userId);
      return true;
    }

    if (/^(create new list|new list)$/i.test(trimmed)) {
      await this.startCreateList(userPhone, userId);
      return true;
    }

    const workflow = await this.userContextService.getListWorkflow(userId);
    if (!workflow) return false;

    if (/^cancel$/i.test(trimmed)) {
      await this.userContextService.clearListWorkflow(userId);
      const body = 'Cancelled. Type *menu* anytime for list options.';
      await this.whatsappService.sendMessage(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return true;
    }

    if (workflow.state === 'awaiting_list_name') {
      const title = trimmed.slice(0, 80);
      if (!title) {
        await this.whatsappService.sendMessage(userPhone, 'Please send a list name, or *cancel*.');
        return true;
      }
      const list = await this.todoListService.createList(userId, title);
      await this.userContextService.clearListWorkflow(userId);
      await this.sendListManageMenu(
        userPhone,
        userId,
        list.id,
        list.title,
        `📁 List *${list.title}* created successfully!`,
      );
      return true;
    }

    if (workflow.state === 'awaiting_item' && workflow.listId && workflow.listTitle) {
      const content = trimmed.slice(0, 500);
      if (!content) {
        await this.whatsappService.sendMessage(userPhone, 'Please type an item name, or *cancel*.');
        return true;
      }
      await this.todoListService.addItem(workflow.listId, userId, content);
      await this.userContextService.setListWorkflow(userId, {
        state: 'awaiting_item',
        listId: workflow.listId,
        listTitle: workflow.listTitle,
      });
      await this.sendListManageMenu(
        userPhone,
        userId,
        workflow.listId,
        workflow.listTitle,
        `✅ Added *${content}*`,
      );
      return true;
    }

    return false;
  }

  private async sendMyLists(userPhone: string, userId: string): Promise<void> {
    const lists = await this.todoListService.getLists(userId);
    if (lists.length === 0) {
      const body = "You don't have any lists yet. Tap *➕ Create New List* to make one!";
      await this.whatsappService.sendInteractiveMessage(userPhone, body, [
        { id: LIST_BTN.menuNewList, title: '➕ Create New List' },
      ]);
      await this.userContextService.pushMessage(userId, 'assistant', body);
      return;
    }

    const lines = lists.slice(0, 15).map((l, i) => {
      const pending = (l.items || []).filter(it => !it.isCompleted).length;
      return `${i + 1}. *${l.title}* (${pending} pending)`;
    });
    const body = `📋 *Your lists:*\n\n${lines.join('\n')}\n\n_Open a list via chat, or create a new one:_`;
    await this.whatsappService.sendInteractiveMessage(userPhone, body, [
      { id: LIST_BTN.menuNewList, title: '➕ Create New List' },
    ]);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }
}
