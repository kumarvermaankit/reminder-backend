import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, LessThan, Not } from 'typeorm';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { Reminder } from '../entities/reminder.entity';
import { NotificationService } from './notification.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly MAX_RETRIES = 3;
  private readonly BATCH_SIZE = 1000;

  constructor(
    @InjectRepository(ReminderSchedule)
    private readonly scheduleRepository: Repository<ReminderSchedule>,
    @InjectRepository(Reminder)
    private readonly reminderRepository: Repository<Reminder>,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('0 * * * * *') // Run every minute
  async processDueReminders() {
    const startTime = Date.now();
    this.logger.log('Processing due reminders...');

    try {
      // Use the optimized index for efficient querying
      const dueSchedules = await this.scheduleRepository.find({
        where: {
          scheduledTime: LessThanOrEqual(new Date()),
          isCompleted: false,
          retryCount: LessThan(this.MAX_RETRIES),
        },
        relations: ['reminder', 'reminder.user'], // Include user for notification preferences
        take: this.BATCH_SIZE, // Limit batch size for performance
        order: {
          scheduledTime: 'ASC', // Process oldest first
        },
      });

      if (dueSchedules.length === 0) {
        this.logger.log('No due reminders found');
        return;
      }

      this.logger.log(`Found ${dueSchedules.length} due reminders`);

      let successCount = 0;
      let failureCount = 0;

      for (const schedule of dueSchedules) {
        try {
          await this.notificationService.sendReminder(schedule);
          await this.markScheduleCompleted(schedule.id);
          successCount++;
        } catch (error) {
          this.logger.error(`Failed to send reminder ${schedule.id}:`, error);
          await this.handleFailedSchedule(schedule, error);
          failureCount++;
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Processed ${dueSchedules.length} reminders in ${duration}ms. Success: ${successCount}, Failures: ${failureCount}`
      );
    } catch (error) {
      this.logger.error('Error processing due reminders:', error);
    }
  }

  private async markScheduleCompleted(scheduleId: string) {
    await this.scheduleRepository.update(scheduleId, {
      isCompleted: true,
      sentAt: new Date(),
      sentVia: 'whatsapp', // Default for now
    });
  }

  private async handlePersistentReminder(reminder: any): Promise<void> {
    // Increment reminder count
    await this.reminderRepository.update(reminder.id, {
      reminderCount: reminder.reminderCount + 1,
      lastRemindedAt: new Date()
    });

    // Schedule next reminder if persistent
    if (reminder.isPersistent && !reminder.isCompleted) {
      const nextReminderTime = new Date(Date.now() + reminder.reminderInterval * 60 * 1000);
      
      const nextSchedule = this.scheduleRepository.create({
        reminderId: reminder.id,
        scheduledTime: nextReminderTime,
        isCompleted: false,
        retryCount: 0
      });
      
      await this.scheduleRepository.save(nextSchedule);
      
      this.logger.log(`Scheduled next persistent reminder for ${reminder.id} at ${nextReminderTime}`);
    }
  }

  private async handleFailedSchedule(schedule: ReminderSchedule, error: Error) {
    const newRetryCount = schedule.retryCount + 1;
    
    if (newRetryCount >= this.MAX_RETRIES) {
      // Mark as failed after max retries
      await this.scheduleRepository.update(schedule.id, {
        retryCount: newRetryCount,
        errorMessage: error.message,
        lastRetryAt: new Date(),
      });
      
      this.logger.error(`Reminder ${schedule.id} failed after ${this.MAX_RETRIES} retries`);
    } else {
      // Update retry count and schedule next retry
      await this.scheduleRepository.update(schedule.id, {
        retryCount: newRetryCount,
        lastRetryAt: new Date(),
        errorMessage: error.message,
      });
      
      this.logger.log(`Scheduled retry ${newRetryCount}/${this.MAX_RETRIES} for reminder ${schedule.id}`);
    }
  }

  async getSchedulerStats() {
    const total = await this.scheduleRepository.count();
    const completed = await this.scheduleRepository.count({ where: { isCompleted: true } });
    const pending = await this.scheduleRepository.count({ where: { isCompleted: false } });
    const failed = await this.scheduleRepository.count({ 
      where: { 
        isCompleted: false, 
        retryCount: Not(LessThanOrEqual(2)) // retryCount >= 3
      } 
    });

    return {
      total,
      completed,
      pending,
      failed,
    };
  }
}
