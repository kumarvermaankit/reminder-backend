import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TodoList } from '../entities/todo-list.entity';
import { TodoItem } from '../entities/todo-item.entity';

@Injectable()
export class TodoListService {
  private readonly logger = new Logger(TodoListService.name);

  constructor(
    @InjectRepository(TodoList)
    private readonly listRepo: Repository<TodoList>,
    @InjectRepository(TodoItem)
    private readonly itemRepo: Repository<TodoItem>,
  ) {}

  async createList(userId: string, title: string): Promise<TodoList> {
    const list = this.listRepo.create({ userId, title });
    const saved = await this.listRepo.save(list);
    this.logger.log(`Todo list created: ${saved.id} for user ${userId}`);
    return saved;
  }

  async getLists(userId: string): Promise<TodoList[]> {
    return this.listRepo.find({
      where: { userId },
      relations: ['items'],
      order: { updatedAt: 'DESC' },
    });
  }

  async getList(listId: string, userId: string): Promise<TodoList> {
    const list = await this.listRepo.findOne({
      where: { id: listId, userId },
      relations: ['items'],
    });
    if (!list) throw new NotFoundException('Todo list not found');
    return list;
  }

  async findListsByTitle(userId: string, title: string): Promise<TodoList[]> {
    return this.listRepo
      .createQueryBuilder('list')
      .leftJoinAndSelect('list.items', 'items')
      .where('list.userId = :userId', { userId })
      .andWhere('LOWER(list.title) = LOWER(:title)', { title })
      .orderBy('list.updatedAt', 'DESC')
      .getMany();
  }

  async findListByTitle(userId: string, title: string): Promise<TodoList | null> {
    const lists = await this.findListsByTitle(userId, title);
    return lists.length > 0 ? lists[0] : null;
  }

  async addItem(listId: string, userId: string, content: string): Promise<TodoItem> {
    const list = await this.getList(listId, userId);
    const count = await this.itemRepo.count({ where: { listId } });
    const item = this.itemRepo.create({ listId, content, position: count });
    return this.itemRepo.save(item);
  }

  async getItems(listId: string, userId: string): Promise<TodoItem[]> {
    await this.getList(listId, userId);
    return this.itemRepo.find({
      where: { listId },
      order: { position: 'ASC' },
    });
  }

  async completeItem(itemId: string, userId: string): Promise<TodoItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId },
      relations: ['list'],
    });
    if (!item || item.list.userId !== userId) {
      throw new NotFoundException('Todo item not found');
    }
    item.isCompleted = true;
    item.completedAt = new Date();
    return this.itemRepo.save(item);
  }

  async updateItem(itemId: string, userId: string, newContent: string): Promise<TodoItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId },
      relations: ['list'],
    });
    if (!item || item.list.userId !== userId) {
      throw new NotFoundException('Todo item not found');
    }
    item.content = newContent;
    return this.itemRepo.save(item);
  }

  async deleteList(listId: string, userId: string): Promise<void> {
    const list = await this.getList(listId, userId);
    await this.listRepo.remove(list);
  }

  private formatItem(item: TodoItem): string {
    const status = item.isCompleted ? '✅' : '⬜';
    return `${status} ${item.content}`;
  }

  formatList(list: TodoList): string {
    const header = `📋 *${list.title}*`;
    if (!list.items || list.items.length === 0) {
      return `${header}\n_(empty)_`;
    }
    const pending = list.items.filter(i => !i.isCompleted);
    const done = list.items.filter(i => i.isCompleted);
    const lines: string[] = [header, ''];
    if (pending.length > 0) {
      lines.push('*To do:*');
      pending.forEach(i => lines.push(this.formatItem(i)));
      lines.push('');
    }
    if (done.length > 0) {
      lines.push('*Done:*');
      done.forEach(i => lines.push(this.formatItem(i)));
    }
    return lines.join('\n');
  }
}
