import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TodoList } from './todo-list.entity';

@Entity('todo_items')
export class TodoItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'list_id' })
  listId: string;

  @ManyToOne(() => TodoList, list => list.items)
  @JoinColumn({ name: 'list_id' })
  list: TodoList;

  @Column({ length: 500 })
  content: string;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ default: 0 })
  position: number;

  @Column({ name: 'item_number', default: 0 })
  itemNumber: number;

  @Column({ name: 'reminder_at', type: 'datetime', nullable: true })
  reminderAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;
}
