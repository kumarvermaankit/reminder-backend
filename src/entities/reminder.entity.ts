import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { TodoItem } from './todo-item.entity';

@Entity('reminders')
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, user => user.reminders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  title: string;

  @Column('text')
  description: string;

  @Column('datetime')
  reminderDate: Date;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ default: false })
  isPersistent: boolean; // Keep reminding until completed

  @Column({ default: 30 })
  reminderInterval: number; // Minutes between reminders

  @Column({ default: 0 })
  reminderCount: number; // How many times reminded

  @Column({ name: 'max_reminder_count', default: 0 })
  maxReminderCount: number; // 0 = unlimited, otherwise stop after this many reminders

  @Column({ name: 'last_reminded_at', type: 'datetime', nullable: true })
  lastRemindedAt: Date;

  @Column('json', { nullable: true })
  metadata: any;

  @Column({ name: 'todo_item_id', nullable: true })
  todoItemId: string;

  @ManyToOne(() => TodoItem, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'todo_item_id' })
  todoItem: TodoItem;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
