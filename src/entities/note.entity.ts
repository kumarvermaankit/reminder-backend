import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('notes')
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string; // e.g., "personal", "work", "ideas", "shopping", etc.

  @Column({ default: false })
  isPinned: boolean;

  @Column('json', { nullable: true })
  tags: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
