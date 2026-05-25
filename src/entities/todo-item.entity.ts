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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', nullable: true })
  completedAt: Date;
}
