import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, LessThan, Not, In } from 'typeorm';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { Reminder } from '../entities/reminder.entity';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';
import { PlanGuardService } from './plan-guard.service';
import { InactivityService } from './inactivity.service';

function partition<T>(arr: T[], pred: (t: T) => boolean): [T[], T[]] {
  const pass: T[] = [];
  const fail: T[] = [];
  for (const item of arr) (pred(item) ? pass : fail).push(item);
  return [pass, fail];
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly MAX_RETRIES = 3;
  private readonly BATCH_SIZE = 200;
  private readonly CONCURRENCY = 10;
  private processing = false;

  constructor(
    @InjectRepository(ReminderSchedule)
    private readonly scheduleRepository: Repository<ReminderSchedule>,
    @InjectRepository(Reminder)
    private readonly reminderRepository: Repository<Reminder>,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
    private readonly planGuardService: PlanGuardService,
    private readonly inactivityService: InactivityService,
  ) {}

  @Cron('0 * * * * *')
  async processDueReminders() {
    if (this.processing) {
      this.logger.warn('Previous run still in progress, skipping');
      return;
    }
    this.processing = true;

    const startTime = Date.now();
    this.logger.log('Processing due reminders...');

    try {
      const dueSchedules = await this.scheduleRepository.find({
        where: {
          scheduledTime: LessThanOrEqual(new Date()),
          isCompleted: false,
          retryCount: LessThan(this.MAX_RETRIES),
        },
        relations: ['reminder'],
        take: this.BATCH_SIZE,
        order: { scheduledTime: 'ASC' },
      });

      if (dueSchedules.length === 0) {
        this.logger.log('No due reminders found');
        return;
      }

      this.logger.log(`Found ${dueSchedules.length} due reminders`);

      // Filter out schedules whose reminder is already completed (data is in-memory via relation join)
      const [skipped, active] = partition(dueSchedules, s => s.reminder.isCompleted);

      if (skipped.length > 0) {
        await this.scheduleRepository.update(
          { id: In(skipped.map(s => s.id)) },
          { isCompleted: true, sentAt: new Date(), sentVia: 'whatsapp' },
        );
        this.logger.log(`Skipped ${skipped.length} schedules (reminder already completed)`);
      }

      // Process active reminders in parallel batches
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < active.length; i += this.CONCURRENCY) {
        const batch = active.slice(i, i + this.CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(schedule => this.processOne(schedule))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            successCount++;
          } else {
            failureCount++;
          }
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Processed ${active.length} in ${duration}ms (success: ${successCount}, fail: ${failureCount})`
      );
    } catch (error) {
      this.logger.error('Error processing due reminders:', error);
    } finally {
      this.processing = false;
    }
  }

  private async processOne(schedule: ReminderSchedule): Promise<boolean> {
    try {
      // Check if user is inactive before sending reminder
      const user = await this.userService.getUserById(schedule.reminder.userId);
      if (user && this.inactivityService.isUserInactive(user)) {
        // User is inactive - check if this is a recurring reminder
        if (schedule.reminder.isPersistent) {
          // Recurring reminders are stopped during inactivity
          this.logger.log(`Skipping recurring reminder ${schedule.id} for inactive user ${user.id}`);
          await this.scheduleRepository.update(schedule.id, {
            isCompleted: true,
            sentVia: 'inactivity_skip',
          });
          return false;
        }

        // One-time reminders: check if we can still send based on plan limits
        const canSend = await this.inactivityService.canSendOneTimeReminder(user);
        if (!canSend) {
          this.logger.log(`Skipping one-time reminder ${schedule.id}: inactive user ${user.id} reached limit`);
          await this.scheduleRepository.update(schedule.id, {
            isCompleted: true,
            sentVia: 'inactivity_limit',
          });
          return false;
        }

        // Track this one-time reminder
        await this.inactivityService.incrementOneTimeCount(user);
      }

      const sent = await this.notificationService.sendReminder(schedule);

      if (!sent) {
        // Not a crash — just couldn't send (quiet hours, daily limit, msg build failed, API reject).
        // Don't mark completed, don't consume retries — next cron tick will try again.
        this.logger.warn(`sendReminder returned false for schedule ${schedule.id}, will retry next tick`);
        return false;
      }

      // Mark completed *after* successful send (at-least-once semantics).
      // Atomic WHERE isCompleted=false prevents double-mark if "done" raced in.
      await this.scheduleRepository.update(
        { id: schedule.id, isCompleted: false },
        { isCompleted: true, sentAt: new Date(), sentVia: 'whatsapp' },
      );

      await this.handlePersistentReminder(schedule.reminder, schedule.scheduledTime);
      return true;

    } catch (error) {
      this.logger.error(`Failed to send reminder ${schedule.id}:`, error);
      await this.handleFailedSchedule(schedule, error);
      return false;
    }
  }

  private async handlePersistentReminder(reminder: any, scheduledTime: Date): Promise<void> {
    const fresh = await this.reminderRepository.findOne({
      where: { id: reminder.id },
      select: ['id', 'userId', 'isCompleted', 'reminderCount', 'isPersistent', 'reminderInterval', 'maxReminderCount', 'inactiveReminderCount'],
    });
    if (!fresh || fresh.isCompleted || !fresh.isPersistent) return;

    const newCount = fresh.reminderCount + 1;

    // Stop if maxReminderCount is set and reached
    if (fresh.maxReminderCount > 0 && newCount >= fresh.maxReminderCount) {
      await this.reminderRepository.update(reminder.id, {
        reminderCount: newCount,
        lastRemindedAt: new Date(),
        isCompleted: true,
      });
      this.logger.log(`Persistent reminder ${reminder.id} reached max count ${fresh.maxReminderCount}, marking completed`);
      return;
    }

    // Check user inactivity — track reminders sent outside 24h CSW window
    const user = await this.userService.getUserById(fresh.userId);
    const isInactive = user?.lastMessageTime
      ? (Date.now() - new Date(user.lastMessageTime).getTime()) / (1000 * 60 * 60) > 24
      : true;

    let newInactiveCount = fresh.inactiveReminderCount || 0;

    if (isInactive) {
      newInactiveCount += 1;
      const maxWarnings = this.planGuardService.getMaxInactiveWarnings(user?.plan || 'free');

      if (newInactiveCount >= maxWarnings) {
        // Hit the limit — stop and send warning
        await this.reminderRepository.update(reminder.id, {
          reminderCount: newCount,
          inactiveReminderCount: newInactiveCount,
          lastRemindedAt: new Date(),
          isCompleted: true,
        });
        this.logger.log(`Persistent reminder ${reminder.id} stopped: ${newInactiveCount} inactive reminders (limit: ${maxWarnings})`);
        await this.notificationService.sendInactivityWarning(user, reminder);
        return;
      }

      // Still under limit — send reminder with a note about upcoming pause
      this.logger.log(`Persistent reminder ${reminder.id}: inactive reminder ${newInactiveCount}/${maxWarnings}`);
    } else {
      // User interacted — reset inactive count
      if (fresh.inactiveReminderCount > 0) {
        this.logger.log(`Persistent reminder ${reminder.id}: user active again, resetting inactive count`);
        newInactiveCount = 0;
      }
    }

    await this.reminderRepository.update(reminder.id, {
      reminderCount: newCount,
      inactiveReminderCount: newInactiveCount,
      lastRemindedAt: new Date(),
    });

    // Use original scheduledTime to prevent daily drift — add interval to the due time, not Date.now()
    // Round to nearest second so parallel calls with sub-second timing differences produce the same nextTime
    const intervalMs = Math.max(fresh.reminderInterval || 1, 1) * 60 * 1000;
    let nextMs = scheduledTime.getTime() + intervalMs;
    const nowMs = Date.now();
    // If next fire is already overdue (TZ skew / missed ticks), jump forward from now
    // so we don't spam every cron minute with catch-up schedules.
    if (nextMs <= nowMs) {
      nextMs = nowMs + intervalMs;
      this.logger.warn(
        `Persistent reminder ${reminder.id} nextTime was overdue; rescheduling from now + ${fresh.reminderInterval}m`,
      );
    }
    const nextTime = new Date(Math.round(nextMs / 1000) * 1000);

    // Guard against duplicate schedule insertion
    const existing = await this.scheduleRepository.findOne({
      where: { reminderId: reminder.id, scheduledTime: nextTime },
    });
    if (existing) {
      this.logger.warn(`Schedule already exists for reminder ${reminder.id} at ${nextTime}, skipping`);
      return;
    }

    try {
      await this.scheduleRepository.save(
        this.scheduleRepository.create({
          reminderId: reminder.id,
          scheduledTime: nextTime,
          isCompleted: false,
          retryCount: 0,
        }),
      );
    } catch (err) {
      // Unique constraint violation — another parallel call already created this schedule
      this.logger.warn(`Duplicate schedule insert for reminder ${reminder.id} at ${nextTime} (race), skipping`);
    }
  }

  private async handleFailedSchedule(schedule: ReminderSchedule, error: Error) {
    const newRetryCount = schedule.retryCount + 1;
    await this.scheduleRepository.update(schedule.id, {
      retryCount: newRetryCount,
      lastRetryAt: new Date(),
      errorMessage: error.message,
    });

    if (newRetryCount >= this.MAX_RETRIES) {
      this.logger.error(`Reminder ${schedule.id} failed after ${this.MAX_RETRIES} retries`);
    } else {
      this.logger.log(`Retry ${newRetryCount}/${this.MAX_RETRIES} for reminder ${schedule.id}`);
    }
  }

  async getSchedulerStats() {
    const total = await this.scheduleRepository.count();
    const completed = await this.scheduleRepository.count({ where: { isCompleted: true } });
    const pending = await this.scheduleRepository.count({ where: { isCompleted: false } });
    const failed = await this.scheduleRepository.count({ 
      where: { isCompleted: false, retryCount: Not(LessThanOrEqual(2)) },
    });

    return { total, completed, pending, failed };
  }

  /**
   * Hourly cron job to check all users for inactivity.
   * Sends continue messages and manages grace periods.
   */
  @Cron('0 0 * * * *') // Every hour at minute 0
  async checkInactivity() {
    try {
      await this.inactivityService.checkAllUsersInactivity();
    } catch (error) {
      this.logger.error('Error checking inactivity:', error);
    }
  }
}
