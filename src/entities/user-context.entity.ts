import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ListWorkflow, PendingListSelection } from '../services/user-context.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

@Entity('user_contexts')
export class UserContextEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column('simple-json')
  conversation: ChatMessage[];

  @Column('simple-json', { nullable: true, name: 'pending_list_selection' })
  pendingListSelection: PendingListSelection | null;

  @Column('simple-json', { nullable: true, name: 'list_workflow' })
  listWorkflow: ListWorkflow | null;

  @Column({ nullable: true, name: 'pending_timezone_message' })
  pendingTimezoneMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
