import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { User, PlanType } from '../entities/user.entity';
import { Reminder } from '../entities/reminder.entity';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { WhatsappService } from './whatsapp.service';

/** Grace period limits: max reminders that continue during inactivity */
export function getGracePeriodReminderLimit(plan: PlanType): number {
  const limits: Record<PlanType, number> = {
    free: 6,
    helper: 6,
    assistant: 9,
    manager: 12,
  };
  return limits[plan] || 6;
}

/** Max post-inactive continue messages before giving up (per plan) */
export function getPostInactiveMessageLimit(plan: PlanType): number {
  const limits: Record<PlanType, number> = {
    free: 3,
    helper: 3,
    assistant: 6,
    manager: 9,
  };
  return limits[plan] || 3;
}

/** Hours after last message before user is considered inactive */
export const INACTIVITY_THRESHOLD_HOURS = 24;

/** Hours between grace period continue messages */
export const GRACE_MESSAGE_INTERVAL_HOURS = 12;

/** Days between post-inactive continue messages */
export const POST_INACTIVE_INTERVAL_DAYS = 3;

@Injectable()
export class InactivityService {
  private readonly logger = new Logger(InactivityService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Reminder)
    private readonly reminderRepository: Repository<Reminder>,
    @InjectRepository(ReminderSchedule)
    private readonly scheduleRepository: Repository<ReminderSchedule>,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Check if a user is currently inactive (last message > 24h ago).
   */
  isUserInactive(user: User): boolean {
    if (!user.lastMessageTime) return true;
    const hoursSinceLastMsg = (Date.now() - new Date(user.lastMessageTime).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastMsg > INACTIVITY_THRESHOLD_HOURS;
  }

  /**
   * Get hours since user's last message.
   */
  getHoursSinceLastMessage(user: User): number {
    if (!user.lastMessageTime) return Infinity;
    return (Date.now() - new Date(user.lastMessageTime).getTime()) / (1000 * 60 * 60);
  }

  /**
   * Check if user has any active reminders (recurring or one-time).
   */
  async userHasReminders(userId: string): Promise<boolean> {
    const count = await this.reminderRepository.count({
      where: { userId, isCompleted: false },
    });
    return count > 0;
  }

  /**
   * Handle user becoming inactive (called when 24h threshold is crossed).
   * Sets inactivityDetectedAt and stops all reminders.
   */
  async handleInactivityDetected(user: User): Promise<void> {
    this.logger.log(`Inactivity detected for user ${user.id} (${user.plan} plan)`);

    // Mark inactivity detection time
    await this.userRepository.update(user.id, {
      inactivityDetectedAt: new Date(),
      inactivityMessageCount: 0,
      postInactiveMessageCount: 0,
      oneTimeSentDuringInactivity: 0,
    });

    // Stop all pending reminder schedules for this user
    const pendingSchedules = await this.scheduleRepository.find({
      where: {
        isCompleted: false,
        reminder: { userId: user.id, isCompleted: false },
      },
      relations: ['reminder'],
    });

    for (const schedule of pendingSchedules) {
      await this.scheduleRepository.update(schedule.id, {
        isCompleted: true,
        sentVia: 'inactivity_stop',
      });
    }

    this.logger.log(`Stopped ${pendingSchedules.length} pending schedules for inactive user ${user.id}`);
  }

  /**
   * Send a continue message to an inactive user.
   * Returns true if message was sent successfully.
   */
  async sendContinueMessage(user: User, isPostInactive: boolean = false): Promise<boolean> {
    if (!user.phone) {
      this.logger.warn(`Cannot send continue message to user ${user.id}: no phone number`);
      return false;
    }

    const name = (!user.name || user.name === 'there') ? '' : user.name;
    const message = [
      `👋 ${name ? `Hey ${name}!` : 'Hey!'}`,
      '',
      `We noticed you haven't been around for a while, so we've paused your reminders to keep things tidy.`,
      '',
      `Tap *Done* below whenever you're ready, and we'll get everything running again for you.`,
    ].join('\n');

    try {
      const msgId = await this.whatsappService.sendTemplateMessage(
        user.phone,
        'notifications',
        'en',
        [{
          type: 'body',
          parameters: [{ type: 'text', text: message }],
        }],
        [{ id: 'continue_reminders', title: 'Done' }],
      );

      if (msgId) {
        // Increment the appropriate counter
        if (isPostInactive) {
          await this.userRepository.update(user.id, {
            postInactiveMessageCount: user.postInactiveMessageCount + 1,
          });
        } else {
          await this.userRepository.update(user.id, {
            inactivityMessageCount: user.inactivityMessageCount + 1,
          });
        }
        this.logger.log(`Continue message sent to user ${user.id} (${isPostInactive ? 'post-inactive' : 'grace'})`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to send continue message to user ${user.id}:`, error);
      return false;
    }
  }

  /**
   * Handle user tapping the "Done" button.
   * Resets all inactivity counters and resumes reminders.
   */
  async handleDoneButton(user: User): Promise<{ resumed: number; message: string }> {
    // Reset inactivity fields
    await this.userRepository.update(user.id, {
      lastMessageTime: new Date(),
      inactivityDetectedAt: null,
      inactivityMessageCount: 0,
      postInactiveMessageCount: 0,
      oneTimeSentDuringInactivity: 0,
    });

    // Find and resume paused reminders
    const pausedReminders = await this.reminderRepository.find({
      where: { userId: user.id, isCompleted: false },
    });

    let resumedCount = 0;
    for (const reminder of pausedReminders) {
      // Create next schedule for each reminder
      const now = new Date();
      const intervalMs = Math.max(reminder.reminderInterval || 60, 1) * 60 * 1000;
      const nextTime = new Date(Math.round((now.getTime() + intervalMs) / 1000) * 1000);

      // Check if schedule already exists
      const existing = await this.scheduleRepository.findOne({
        where: { reminderId: reminder.id, scheduledTime: nextTime },
      });

      if (!existing) {
        await this.scheduleRepository.save(
          this.scheduleRepository.create({
            reminderId: reminder.id,
            scheduledTime: nextTime,
            isCompleted: false,
            retryCount: 0,
          }),
        );
        resumedCount++;
      }
    }

    const name = (!user.name || user.name === 'there') ? '' : user.name;
    const msg = resumedCount === 1
      ? `👋 Welcome back${name ? `, ${name}` : ''}! Your reminder has been resumed.`
      : resumedCount > 0
        ? `👋 Welcome back${name ? `, ${name}` : ''}! Your ${resumedCount} reminders have been resumed.`
        : `👋 Welcome back${name ? `, ${name}` : ''}! You're all set.`;

    return { resumed: resumedCount, message: msg };
  }

  /**
   * Check if a one-time reminder can be sent during inactivity.
   * Returns true if the user hasn't exceeded their plan's limit.
   */
  async canSendOneTimeReminder(user: User): Promise<boolean> {
    const limit = getGracePeriodReminderLimit(user.plan);
    return user.oneTimeSentDuringInactivity < limit;
  }

  /**
   * Increment the one-time reminder count during inactivity.
   */
  async incrementOneTimeCount(user: User): Promise<void> {
    await this.userRepository.update(user.id, {
      oneTimeSentDuringInactivity: user.oneTimeSentDuringInactivity + 1,
    });
  }

  /**
   * Main cron job: check all users for inactivity and send continue messages.
   */
  async checkAllUsersInactivity(): Promise<void> {
    this.logger.log('Checking all users for inactivity...');

    // Get all users with active reminders
    const usersWithReminders = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.reminders', 'reminder', 'reminder.isCompleted = false')
      .distinct(true)
      .getMany();

    let inactivityDetected = 0;
    let graceMessagesSent = 0;
    let postInactiveSent = 0;
    let usersMarkedInactive = 0;

    for (const user of usersWithReminders) {
      const hoursSinceLastMsg = this.getHoursSinceLastMessage(user);

      // Skip if user has no lastMessageTime (never interacted)
      if (hoursSinceLastMsg === Infinity) continue;

      // Case 1: User just became inactive (crossed 24h threshold)
      if (hoursSinceLastMsg >= INACTIVITY_THRESHOLD_HOURS && !user.inactivityDetectedAt) {
        await this.handleInactivityDetected(user);
        await this.sendContinueMessage(user, false);
        inactivityDetected++;
        continue;
      }

      // Case 2: User is in grace period (24h-36h, inactivity detected but not yet marked fully inactive)
      if (user.inactivityDetectedAt && user.inactivityMessageCount < 2) {
        const hoursSinceDetection = (Date.now() - new Date(user.inactivityDetectedAt).getTime()) / (1000 * 60 * 60);

        // Send second continue message at 12h after detection (36h from last message)
        if (hoursSinceDetection >= GRACE_MESSAGE_INTERVAL_HOURS && user.inactivityMessageCount < 2) {
          const sent = await this.sendContinueMessage(user, false);
          if (sent) graceMessagesSent++;
        }

        // After grace period (24h after detection = 48h from last message), stop all reminders
        if (hoursSinceDetection >= INACTIVITY_THRESHOLD_HOURS) {
          await this.stopAllRemindersForUser(user.id);
          usersMarkedInactive++;
        }
        continue;
      }

      // Case 3: User is post-inactive (grace period expired)
      if (user.inactivityDetectedAt) {
        const postInactiveLimit = getPostInactiveMessageLimit(user.plan);
        if (user.postInactiveMessageCount < postInactiveLimit) {
          const hoursSinceDetection = (Date.now() - new Date(user.inactivityDetectedAt).getTime()) / (1000 * 60 * 60);
          const hoursSinceLastContinue = user.postInactiveMessageCount > 0
            ? hoursSinceDetection - (INACTIVITY_THRESHOLD_HOURS + GRACE_MESSAGE_INTERVAL_HOURS + (user.postInactiveMessageCount * POST_INACTIVE_INTERVAL_DAYS * 24))
            : hoursSinceDetection - INACTIVITY_THRESHOLD_HOURS;

          // Send continue message every 3 days
          if (hoursSinceLastContinue >= POST_INACTIVE_INTERVAL_DAYS * 24) {
            const sent = await this.sendContinueMessage(user, true);
            if (sent) postInactiveSent++;
          }
        }
      }
    }

    this.logger.log(
      `Inactivity check complete: ${inactivityDetected} newly inactive, ` +
      `${graceMessagesSent} grace messages, ${postInactiveSent} post-inactive messages, ` +
      `${usersMarkedInactive} users marked inactive`
    );
  }

  /**
   * Stop all reminders for a user (mark all pending schedules as completed).
   */
  private async stopAllRemindersForUser(userId: string): Promise<void> {
    const pendingSchedules = await this.scheduleRepository.find({
      where: {
        isCompleted: false,
        reminder: { userId: userId, isCompleted: false },
      },
      relations: ['reminder'],
    });

    for (const schedule of pendingSchedules) {
      await this.scheduleRepository.update(schedule.id, {
        isCompleted: true,
        sentVia: 'inactivity_stop',
      });
    }

    this.logger.log(`Stopped ${pendingSchedules.length} schedules for user ${userId}`);
  }
}
