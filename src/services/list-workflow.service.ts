import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsappService, WhatsAppChatCommand } from './whatsapp.service';
import { TodoListService } from './todo-list.service';
import { UserContextService } from './user-context.service';
import { UserService } from './user.service';

/** Slash commands registered on the business phone (type "/" in chat). */
export const CHAT_COMMANDS: WhatsAppChatCommand[] = [
  { command_name: 'view_list', command_description: "View today's to-do list" },
  { command_name: 'lists', command_description: 'View all your lists' },
  { command_name: 'help', command_description: 'What this assistant can do' },
  { command_name: 'menu', command_description: 'Open the slide-up menu' },
];

/** Row ids for interactive list messages (list_reply webhook). */
export const MENU_ROW = {
  viewList: 'menu_view_list',
  allLists: 'menu_all_lists',
  help: 'menu_help',
  openList: (listId: string) => `list_open:${listId}`,
} as const;

@Injectable()
export class ListWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(ListWorkflowService.name);

  constructor(
    private readonly userContextService: UserContextService,
    private readonly todoListService: TodoListService,
    private readonly whatsappService: WhatsappService,
    private readonly userService: UserService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WHATSAPP_REGISTER_COMMANDS === 'false') return;
    const ok = await this.registerChatCommands();
    if (!ok) {
      this.logger.warn(
        'Chat commands not registered at startup. Call POST /whatsapp/setup/commands after deploy, ' +
          'or set commands in WhatsApp Manager → Phone number → Automations → Commands.',
      );
    }
  }

  async registerChatCommands(): Promise<boolean> {
    return this.whatsappService.configureConversationalCommands(CHAT_COMMANDS);
  }

  /** Slide-up interactive list (tap "Menu" on the message). */
  async sendSlideUpMenu(userPhone: string, userId: string): Promise<void> {
    const body = 'What would you like to do?';
    await this.whatsappService.sendInteractiveListMessage(
      userPhone,
      body,
      'Menu',
      [
        {
          title: 'Quick actions',
          rows: [
            {
              id: MENU_ROW.viewList,
              title: "Today's list",
              description: 'View your daily to-do list',
            },
            {
              id: MENU_ROW.allLists,
              title: 'All lists',
              description: 'Browse or open a list',
            },
            {
              id: MENU_ROW.help,
              title: 'Help',
              description: 'Reminders, lists, notes',
            },
          ],
        },
      ],
      'Reminder Assistant',
    );
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  /** @returns true if user asked for menu (skip AI) */
  async handleMenuText(userPhone: string, userId: string, message: string): Promise<boolean> {
    if (!/^(menu)$/i.test(message.trim())) return false;
    await this.sendSlideUpMenu(userPhone, userId);
    return true;
  }

  /** @returns true if message was a slash command (skip AI) */
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

    if (cmd === 'view_list' || cmd === 'lists' || cmd === 'help') {
      await this.runMenuAction(cmd, userPhone, userId, timezone);
      return true;
    }

    return false;
  }

  /** @returns true if list_reply row was handled */
  async handleListReply(
    userPhone: string,
    userId: string,
    rowId: string,
    timezone: string = 'UTC',
  ): Promise<boolean> {
    this.logger.log(`List menu selection: ${rowId} from user ${userId}`);

    if (rowId === MENU_ROW.viewList) {
      await this.runMenuAction('view_list', userPhone, userId, timezone);
      return true;
    }
    if (rowId === MENU_ROW.allLists) {
      await this.sendListsSlideUpMenu(userPhone, userId);
      return true;
    }
    if (rowId === MENU_ROW.help) {
      await this.runMenuAction('help', userPhone, userId, timezone);
      return true;
    }
    if (rowId.startsWith('list_open:')) {
      const listId = rowId.slice('list_open:'.length);
      await this.sendSingleList(userPhone, userId, listId);
      return true;
    }

    return false;
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

  /** Second-level slide-up: pick a list to open (max 10). */
  private async sendListsSlideUpMenu(userPhone: string, userId: string): Promise<void> {
    const lists = await this.todoListService.getLists(userId);
    if (lists.length === 0) {
      const body =
        "You don't have any lists yet.\n\n" +
        'Say *"start a groceries list"* or *"add milk to shopping"* — same as chatting normally.';
      await this.whatsappService.sendMessage(userPhone, body);
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
      const list = await this.todoListService.getList(listId, userId);
      const body = this.todoListService.formatList(list);
      await this.whatsappService.sendMessage(userPhone, body);
      await this.userContextService.pushMessage(userId, 'assistant', body);
    } catch {
      const body = "That list wasn't found. Type *menu* to try again.";
      await this.whatsappService.sendMessage(userPhone, body);
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
    const body = this.todoListService.formatList(list);
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendHelp(userPhone: string, userId: string): Promise<void> {
    const body =
      '*Menu* — type *menu* or /menu for the slide-up picker\n' +
      '*Commands* — type / for view_list, lists, help\n\n' +
      '*Or chat naturally:*\n' +
      '• "remind me to call mom at 3pm"\n' +
      '• "add eggs to shopping list"\n' +
      '• "show my shopping list"\n' +
      '• "remember my wifi password is ..."';
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }
}
