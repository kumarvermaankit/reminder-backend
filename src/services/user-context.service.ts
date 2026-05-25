import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserContextEntity, ContextEntry } from '../entities/user-context.entity';

@Injectable()
export class UserContextService {
  private readonly logger = new Logger(UserContextService.name);
  private readonly MAX_ITEMS = 5;

  constructor(
    @InjectRepository(UserContextEntity)
    private readonly repo: Repository<UserContextEntity>,
  ) {}

  async push(userId: string, entry: ContextEntry): Promise<void> {
    let ctx = await this.repo.findOne({ where: { userId } });
    if (!ctx) {
      ctx = this.repo.create({ userId, recentItems: [entry] });
    } else {
      ctx.recentItems = [entry, ...ctx.recentItems].slice(0, this.MAX_ITEMS);
    }
    await this.repo.save(ctx);
  }

  async getLatest(userId: string, actionType?: string): Promise<ContextEntry | null> {
    const ctx = await this.repo.findOne({ where: { userId } });
    if (!ctx || ctx.recentItems.length === 0) return null;
    if (actionType) {
      return ctx.recentItems.find(e => e.actionType === actionType) || null;
    }
    return ctx.recentItems[0];
  }

  async findByMessageId(userId: string, messageId: string): Promise<ContextEntry | null> {
    const ctx = await this.repo.findOne({ where: { userId } });
    if (!ctx) return null;
    return ctx.recentItems.find(e => e.messageId === messageId) || null;
  }

  async getAll(userId: string): Promise<ContextEntry[]> {
    const ctx = await this.repo.findOne({ where: { userId } });
    return ctx?.recentItems || [];
  }
}
