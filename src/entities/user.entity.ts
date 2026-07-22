import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { Reminder } from './reminder.entity';

export type PlanType = 'free' | 'helper' | 'assistant' | 'manager';

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

  @Column({ name: 'daily_prompt_time', length: 5, default: '09:00' })
  dailyPromptTime: string; // HH:mm format in user's timezone

  @Column({ name: 'last_daily_prompt_date', type: 'date', nullable: true })
  lastDailyPromptDate: string; // YYYY-MM-DD in user's local date

  @Column({ name: 'last_message_time', type: 'datetime', nullable: true })
  lastMessageTime: Date;

  @Column({ name: 'last_ping_time', type: 'datetime', nullable: true })
  lastPingTime: Date;

  @Column({ name: 'is_premium', default: false })
  isPremium: boolean;

  @Column({ name: 'plan', type: 'varchar', length: 20, default: 'free' })
  plan: PlanType;

  @Column({ name: 'razorpay_customer_id', nullable: true })
  razorpayCustomerId: string;

  @Column({ name: 'razorpay_subscription_id', nullable: true })
  razorpaySubscriptionId: string;

  @Column({ name: 'razorpay_plan_id', nullable: true })
  razorpayPlanId: string;

  @Column({ name: 'subscription_interval', length: 10, nullable: true })
  subscriptionInterval: 'monthly' | 'yearly' | null;

  @Column({ name: 'country', default: 'IN' })
  country: string;

  @Column({ name: 'plan_expires_at', type: 'datetime', nullable: true })
  planExpiresAt: Date;

  @Column({ name: 'trial_ends_at', type: 'datetime', nullable: true })
  trialEndsAt: Date;

  @Column({ name: 'applied_coupon', nullable: true })
  appliedCoupon: string;

  @Column({ name: 'coupon_expires_at', type: 'datetime', nullable: true })
  couponExpiresAt: Date;

  @OneToMany(() => Reminder, reminder => reminder.user)
  reminders: Reminder[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
