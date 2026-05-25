import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface ContextEntry {
  actionType: 'reminder' | 'note' | 'password' | 'todo';
  entityId: string;
  summary: string;
  messageId: string;
  timestamp: string;
}

@Entity('user_contexts')
export class UserContextEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column('simple-json')
  recentItems: ContextEntry[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
