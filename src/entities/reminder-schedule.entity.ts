import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Reminder } from './reminder.entity';
import { User } from './user.entity';

@Entity('reminder_schedules')
@Index('idx_schedule_lookup', ['scheduledTime', 'isCompleted', 'retryCount'])
@Index('idx_unique_schedule', ['reminderId', 'scheduledTime'], { unique: true })
export class ReminderSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reminder_id' })
  reminderId: string;

  @ManyToOne(() => Reminder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reminder_id' })
  reminder: Reminder;

  // Add user relationship for efficient querying
  @ManyToOne(() => User)
  user: User;

  @Column({ name: 'scheduled_time', type: 'datetime' })
  scheduledTime: Date;

  @Column({ name: 'is_completed', default: false })
  isCompleted: boolean;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt: Date;

  @Column({ name: 'sent_via', type: 'varchar', nullable: true })
  sentVia: 'email' | 'whatsapp' | 'sms' | 'inactivity_stop' | 'inactivity_skip' | 'inactivity_limit';

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'last_retry_at', type: 'datetime', nullable: true })
  lastRetryAt: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
