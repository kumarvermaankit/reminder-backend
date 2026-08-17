import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reminder } from '../entities/reminder.entity';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { User } from '../entities/user.entity';

export const FREE_MONTHLY_REMINDER_LIMIT = 20;

@Injectable()
export class ReminderService {
  constructor(
    @InjectRepository(Reminder)
    private reminderRepository: Repository<Reminder>,
    @InjectRepository(ReminderSchedule)
    private scheduleRepository: Repository<ReminderSchedule>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async createReminder(reminderData: Partial<Reminder>) {
    await this.consumeFreeReminderQuota(reminderData.userId);
    const reminder = this.reminderRepository.create(reminderData);
    const savedReminder = await this.reminderRepository.save(reminder);
    
    // Create a schedule for the reminder
    if (savedReminder.reminderDate) {
      const schedule = this.scheduleRepository.create({
        reminderId: savedReminder.id,
        scheduledTime: savedReminder.reminderDate,
      });
      await this.scheduleRepository.save(schedule);
    }
    
    return savedReminder;
  }

  private async consumeFreeReminderQuota(userId?: string): Promise<void> {
    if (!userId) return;

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.plan !== 'free') return;

    const quotaMonth = new Date().toISOString().slice(0, 7);
    const currentCount = user.reminderQuotaMonth === quotaMonth
      ? user.reminderQuotaCount
      : 0;

    if (currentCount >= FREE_MONTHLY_REMINDER_LIMIT) {
      throw new ForbiddenException(
        `You've reached the Free plan limit of ${FREE_MONTHLY_REMINDER_LIMIT} reminders this month. Upgrade to Helper for unlimited reminders.`,
      );
    }

    await this.userRepository.update(userId, {
      reminderQuotaMonth: quotaMonth,
      reminderQuotaCount: currentCount + 1,
    });
  }

  async getReminders() {
    return await this.reminderRepository.find();
  }

  async getReminder(id: string) {
    return await this.reminderRepository.findOne({ where: { id } });
  }

  async updateReminder(id: string, reminderData: Partial<Reminder>) {
    await this.reminderRepository.update(id, reminderData);
    return await this.getReminder(id);
  }

  async deleteReminder(id: string) {
    const reminder = await this.getReminder(id);
    if (reminder) {
      await this.reminderRepository.delete(id);
      return reminder;
    }
    return null;
  }

  async getPendingReminders() {
    return await this.reminderRepository.find({
      where: { isCompleted: false },
      order: { reminderDate: 'ASC' },
    });
  }

  async markAsCompleted(id: string) {
    return await this.updateReminder(id, { isCompleted: true });
  }

  async getPendingRemindersForUser(userId: string) {
    return await this.reminderRepository.find({
      where: { 
        userId, 
        isCompleted: false 
      },
      order: { reminderDate: 'ASC' }
    });
  }

  async getCompletedRemindersForUser(userId: string, limit = 50) {
    return await this.reminderRepository.find({
      where: { userId, isCompleted: true },
      order: { reminderDate: 'DESC' },
      take: limit,
    });
  }

  async getAllSchedules() {
    return await this.scheduleRepository.find();
  }

  async deleteAllSchedulesForReminder(reminderId: string) {
    await this.scheduleRepository.delete({ reminderId });
  }

  async getScheduleById(scheduleId: string): Promise<ReminderSchedule | null> {
    return this.scheduleRepository.findOne({
      where: { id: scheduleId },
      relations: ['reminder'],
    });
  }

  async createSchedule(reminderId: string, scheduledTime: Date): Promise<ReminderSchedule> {
    const schedule = this.scheduleRepository.create({ reminderId, scheduledTime });
    return this.scheduleRepository.save(schedule);
  }
}
