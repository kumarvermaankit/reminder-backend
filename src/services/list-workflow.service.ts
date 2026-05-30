import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WhatsappService, WhatsAppChatCommand } from './whatsapp.service';
import { TodoListService } from './todo-list.service';
import { UserContextService } from './user-context.service';
import { UserService } from './user.service';

/** Slash commands registered on the business phone (type "/" in chat). */
export const CHAT_COMMANDS: WhatsAppChatCommand[] = [
  { command_name: 'view_list', command_description: 'View today\'s to-do list' },
  { command_name: 'lists', command_description: 'View all your lists' },
  { command_name: 'help', command_description: 'What this assistant can do' },
];

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

    switch (cmd) {
      case 'view_list':
        await this.sendTodayList(userPhone, userId, timezone);
        return true;
      case 'lists':
        await this.sendAllLists(userPhone, userId);
        return true;
      case 'help':
        await this.sendHelp(userPhone, userId);
        return true;
      default:
        return false;
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

  private async sendAllLists(userPhone: string, userId: string): Promise<void> {
    const lists = await this.todoListService.getLists(userId);
    let body: string;
    if (lists.length === 0) {
      body =
        "You don't have any lists yet.\n\n" +
        'Say something like *"start a groceries list"* or *"add milk to shopping list"* and I\'ll set it up.';
    } else {
      const lines = lists.slice(0, 20).map((l) => {
        const pending = (l.items || []).filter((i) => !i.isCompleted).length;
        return `• *${l.title}* (${pending} pending)`;
      });
      body = `📋 *Your lists:*\n\n${lines.join('\n')}\n\n` +
        '_Use /view_list for today\'s daily list, or ask me to open any list by name._';
    }
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }

  private async sendHelp(userPhone: string, userId: string): Promise<void> {
    const body =
      '*Quick commands* (tap Menu or type /)\n' +
      '• /view_list — today\'s daily list\n' +
      '• /lists — all your lists\n\n' +
      '*Or just chat naturally:*\n' +
      '• "remind me to call mom at 3pm"\n' +
      '• "add eggs to shopping list"\n' +
      '• "show my shopping list"\n' +
      '• "remember my wifi password is ..."';
    await this.whatsappService.sendMessage(userPhone, body);
    await this.userContextService.pushMessage(userId, 'assistant', body);
  }
}
