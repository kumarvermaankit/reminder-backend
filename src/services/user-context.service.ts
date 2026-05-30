import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserContextEntity, ChatMessage } from '../entities/user-context.entity';

export interface PendingListSelection {
  title: string;
  listIds: string[];
  listDates: string[];
  actionType: string;
  itemRef?: string;
  newContent?: string;
  itemTargets?: string[];
}

/** Guided create-list flow (name → add multiple items via buttons). */
export interface ListWorkflow {
  state: 'awaiting_create_name' | 'adding_create_items';
  listId?: string;
  listTitle?: string;
  itemCount?: number;
  /** User tapped "Add item" — next text is an item (not a new list name). */
  awaitingItemInput?: boolean;
}

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);
  private readonly MAX_MESSAGES = 10;

  constructor(
    @InjectRepository(UserContextEntity)
    private readonly repo: Repository<UserContextEntity>,
  ) {}

  async pushMessage(userId: string, role: 'user' | 'assistant', text: string): Promise<void> {
    let ctx = await this.repo.findOne({ where: { userId } });
    const entry: ChatMessage = { role, text };
    if (!ctx) {
      ctx = this.repo.create({ userId, conversation: [entry] });
    } else {
      ctx.conversation.push(entry);
      if (ctx.conversation.length > this.MAX_MESSAGES) {
        ctx.conversation = ctx.conversation.slice(-this.MAX_MESSAGES);
      }
    }
    await this.repo.save(ctx);
  }

  async getConversation(userId: string): Promise<ChatMessage[]> {
    const ctx = await this.repo.findOne({ where: { userId } });
    return ctx?.conversation || [];
  }

  async setPendingListSelection(userId: string, selection: PendingListSelection): Promise<void> {
    let ctx = await this.repo.findOne({ where: { userId } });
    if (!ctx) {
      ctx = this.repo.create({ userId, conversation: [] });
    }
    ctx.pendingListSelection = selection;
    await this.repo.save(ctx);
  }

  async getPendingListSelection(userId: string): Promise<PendingListSelection | null> {
    const ctx = await this.repo.findOne({ where: { userId } });
    return ctx?.pendingListSelection || null;
  }

  async clearPendingListSelection(userId: string): Promise<void> {
    let ctx = await this.repo.findOne({ where: { userId } });
    if (ctx) {
      ctx.pendingListSelection = null;
      await this.repo.save(ctx);
    }
  }

  async setListWorkflow(userId: string, workflow: ListWorkflow | null): Promise<void> {
    let ctx = await this.repo.findOne({ where: { userId } });
    if (!ctx) {
      ctx = this.repo.create({ userId, conversation: [] });
    }
    ctx.listWorkflow = workflow;
    await this.repo.save(ctx);
  }

  async getListWorkflow(userId: string): Promise<ListWorkflow | null> {
    const ctx = await this.repo.findOne({ where: { userId } });
    return ctx?.listWorkflow || null;
  }

  async clearListWorkflow(userId: string): Promise<void> {
    await this.setListWorkflow(userId, null);
  }

  async clear(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
