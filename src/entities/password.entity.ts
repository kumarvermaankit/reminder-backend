import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('passwords')
export class Password {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, user => user.passwords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  service: string;

  @Column({ nullable: true })
  username: string;

  @Column('text')
  encryptedPassword: string;

  @Column({ nullable: true })
  url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes: string;

  @Column({ default: false })
  isFavorite: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastModified: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
