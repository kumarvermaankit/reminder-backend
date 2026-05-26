import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Reminder } from './reminder.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true, nullable: true })
  phone: string;

  @Column()
  name: string;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ 
    type: 'varchar',
    length: 20,
    default: 'email',
  })
  preferredContactMethod: 'email' | 'whatsapp' | 'sms';

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  quietHoursStart: string; // HH:mm format

  @Column({ nullable: true })
  quietHoursEnd: string; // HH:mm format

  @Column({ default: 10 })
  maxDailyReminders: number;

  @Column('simple-json', { nullable: true })
  lastReminderIds: string[];

  @Column({ name: 'daily_prompt_time', length: 5, default: '07:00' })
  dailyPromptTime: string; // HH:mm format in user's timezone

  @Column({ name: 'last_daily_prompt_date', type: 'date', nullable: true })
  lastDailyPromptDate: string; // YYYY-MM-DD in user's local date

  @OneToMany(() => Reminder, reminder => reminder.user)
  reminders: Reminder[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
