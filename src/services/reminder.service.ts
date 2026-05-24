import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reminder } from '../entities/reminder.entity';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';

@Injectable()
export class ReminderService {
  constructor(
    @InjectRepository(Reminder)
    private reminderRepository: Repository<Reminder>,
    @InjectRepository(ReminderSchedule)
    private scheduleRepository: Repository<ReminderSchedule>,
  ) {}

  async createReminder(reminderData: Partial<Reminder>) {
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

  async getAllSchedules() {
    return await this.scheduleRepository.find();
  }

  async deleteAllSchedulesForReminder(reminderId: string) {
    await this.scheduleRepository.delete({ reminderId });
  }
}
