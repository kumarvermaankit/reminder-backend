import { ForbiddenException } from '@nestjs/common';
import { FREE_MONTHLY_REMINDER_LIMIT, ReminderService } from './reminder.service';
import { User } from '../entities/user.entity';

describe('ReminderService', () => {
  const currentMonth = new Date().toISOString().slice(0, 7);

  const createService = (user: Partial<User>) => {
    const reminderRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'reminder-1', ...data })),
    } as any;
    const scheduleRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    } as any;
    const userRepository = {
      findOne: jest.fn(async () => user),
      update: jest.fn(async () => undefined),
    } as any;

    return {
      service: new ReminderService(reminderRepository, scheduleRepository, userRepository),
      reminderRepository,
      scheduleRepository,
      userRepository,
    };
  };

  it('consumes the twentieth free reminder in the current month', async () => {
    const { service, userRepository } = createService({
      id: 'user-1',
      plan: 'free',
      reminderQuotaMonth: currentMonth,
      reminderQuotaCount: FREE_MONTHLY_REMINDER_LIMIT - 1,
    });

    await service.createReminder({ userId: 'user-1', title: 'Call mom', reminderDate: new Date() });

    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      reminderQuotaMonth: currentMonth,
      reminderQuotaCount: FREE_MONTHLY_REMINDER_LIMIT,
    });
  });

  it('rejects reminders after the free monthly allowance is used', async () => {
    const { service, reminderRepository, userRepository } = createService({
      id: 'user-1',
      plan: 'free',
      reminderQuotaMonth: currentMonth,
      reminderQuotaCount: FREE_MONTHLY_REMINDER_LIMIT,
    });

    await expect(service.createReminder({ userId: 'user-1', title: 'Call mom' }))
      .rejects.toThrow(ForbiddenException);
    expect(reminderRepository.save).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('resets the free allowance when a new month starts', async () => {
    const { service, userRepository } = createService({
      id: 'user-1',
      plan: 'free',
      reminderQuotaMonth: '2000-01',
      reminderQuotaCount: FREE_MONTHLY_REMINDER_LIMIT,
    });

    await service.createReminder({ userId: 'user-1', title: 'Call mom' });

    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      reminderQuotaMonth: currentMonth,
      reminderQuotaCount: 1,
    });
  });

  it('does not apply the free quota to paid plans', async () => {
    const { service, userRepository } = createService({ id: 'user-1', plan: 'helper' });

    await service.createReminder({ userId: 'user-1', title: 'Call mom' });

    expect(userRepository.update).not.toHaveBeenCalled();
  });

  describe('getPausedRecurringReminders', () => {
    it('returns paused persistent reminders for a user', async () => {
      const pausedReminders = [
        { id: 'rem-1', isPersistent: true, isCompleted: true },
        { id: 'rem-2', isPersistent: true, isCompleted: true },
      ];

      const reminderRepository = {
        find: jest.fn(async () => pausedReminders),
      } as any;
      const scheduleRepository = {} as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      const result = await service.getPausedRecurringReminders('user-1');

      expect(result).toEqual(pausedReminders);
      expect(reminderRepository.find).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isPersistent: true,
          isCompleted: true,
        },
        order: { lastRemindedAt: 'DESC' },
      });
    });

    it('returns empty array when no paused reminders', async () => {
      const reminderRepository = {
        find: jest.fn(async () => []),
      } as any;
      const scheduleRepository = {} as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      const result = await service.getPausedRecurringReminders('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('resumeReminder', () => {
    it('resets reminder and creates new schedule', async () => {
      const reminder = {
        id: 'rem-1',
        isCompleted: true,
        reminderInterval: 60,
        inactiveReminderCount: 2,
        reminderCount: 5,
      };

      const reminderRepository = {
        findOne: jest.fn(async () => reminder),
        update: jest.fn(async () => undefined),
      } as any;
      const scheduleRepository = {
        create: jest.fn((data) => data),
        save: jest.fn(async (data) => data),
      } as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.resumeReminder('rem-1');

      // Should reset the reminder
      expect(reminderRepository.update).toHaveBeenCalledWith('rem-1', {
        isCompleted: false,
        reminderCount: 0,
        inactiveReminderCount: 0,
      });

      // Should create a new schedule
      expect(scheduleRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reminderId: 'rem-1',
          scheduledTime: expect.any(Date),
        })
      );
      expect(scheduleRepository.save).toHaveBeenCalled();
    });

    it('does nothing if reminder not found', async () => {
      const reminderRepository = {
        findOne: jest.fn(async () => null),
        update: jest.fn(),
      } as any;
      const scheduleRepository = {
        create: jest.fn(),
        save: jest.fn(),
      } as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.resumeReminder('nonexistent');

      expect(reminderRepository.update).not.toHaveBeenCalled();
      expect(scheduleRepository.create).not.toHaveBeenCalled();
    });

    it('uses default interval of 60 min if reminderInterval is 0', async () => {
      const reminder = {
        id: 'rem-2',
        isCompleted: true,
        reminderInterval: 0,
        inactiveReminderCount: 1,
        reminderCount: 3,
      };

      const beforeTime = Date.now();

      const reminderRepository = {
        findOne: jest.fn(async () => reminder),
        update: jest.fn(async () => undefined),
      } as any;
      const scheduleRepository = {
        create: jest.fn((data) => data),
        save: jest.fn(async (data) => data),
      } as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.resumeReminder('rem-2');

      // Should create schedule with 60 min default
      const createCall = scheduleRepository.create.mock.calls[0][0];
      const scheduledTime = createCall.scheduledTime.getTime();
      expect(scheduledTime).toBeGreaterThanOrEqual(beforeTime + 60 * 60 * 1000);
      expect(scheduledTime).toBeLessThanOrEqual(beforeTime + 61 * 60 * 1000);
    });

    it('uses custom interval when reminderInterval is set', async () => {
      const reminder = {
        id: 'rem-3',
        isCompleted: true,
        reminderInterval: 120, // 2 hours
        inactiveReminderCount: 0,
        reminderCount: 10,
      };

      const beforeTime = Date.now();

      const reminderRepository = {
        findOne: jest.fn(async () => reminder),
        update: jest.fn(async () => undefined),
      } as any;
      const scheduleRepository = {
        create: jest.fn((data) => data),
        save: jest.fn(async (data) => data),
      } as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.resumeReminder('rem-3');

      // Should create schedule with 120 min (2 hours)
      const createCall = scheduleRepository.create.mock.calls[0][0];
      const scheduledTime = createCall.scheduledTime.getTime();
      expect(scheduledTime).toBeGreaterThanOrEqual(beforeTime + 120 * 60 * 1000);
      expect(scheduledTime).toBeLessThanOrEqual(beforeTime + 121 * 60 * 1000);
    });

    it('resets all state fields correctly', async () => {
      const reminder = {
        id: 'rem-4',
        isCompleted: true,
        reminderInterval: 30,
        inactiveReminderCount: 5,
        reminderCount: 20,
      };

      const reminderRepository = {
        findOne: jest.fn(async () => reminder),
        update: jest.fn(async () => undefined),
      } as any;
      const scheduleRepository = {
        create: jest.fn((data) => data),
        save: jest.fn(async (data) => data),
      } as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.resumeReminder('rem-4');

      expect(reminderRepository.update).toHaveBeenCalledWith('rem-4', {
        isCompleted: false,
        reminderCount: 0,
        inactiveReminderCount: 0,
      });
    });
  });

  describe('getPausedRecurringReminders edge cases', () => {
    it('excludes non-persistent reminders', async () => {
      const reminderRepository = {
        find: jest.fn(async () => []),
      } as any;
      const scheduleRepository = {} as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.getPausedRecurringReminders('user-1');

      expect(reminderRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPersistent: true,
          }),
        })
      );
    });

    it('excludes active (non-completed) reminders', async () => {
      const reminderRepository = {
        find: jest.fn(async () => []),
      } as any;
      const scheduleRepository = {} as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.getPausedRecurringReminders('user-1');

      expect(reminderRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isCompleted: true,
          }),
        })
      );
    });

    it('orders by lastRemindedAt descending', async () => {
      const reminderRepository = {
        find: jest.fn(async () => []),
      } as any;
      const scheduleRepository = {} as any;
      const userRepository = {} as any;

      const service = new ReminderService(reminderRepository, scheduleRepository, userRepository);
      await service.getPausedRecurringReminders('user-1');

      expect(reminderRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { lastRemindedAt: 'DESC' },
        })
      );
    });
  });
});
