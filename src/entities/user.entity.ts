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
    default: 'email',
    enum: ['email', 'whatsapp', 'sms']
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

  @OneToMany(() => Reminder, reminder => reminder.user)
  reminders: Reminder[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
