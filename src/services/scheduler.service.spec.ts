import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from './scheduler.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { Reminder } from '../entities/reminder.entity';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';
import { PlanGuardService } from './plan-guard.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let scheduleRepo: any;
  let reminderRepo: any;
  let notificationService: any;
  let userService: any;
  let planGuardService: any;

  const mockScheduleRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockReminderRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockNotificationService = {
    sendReminder: jest.fn(),
    sendInactivityWarning: jest.fn(),
  };

  const mockUserService = {
    getUserById: jest.fn(),
  };

  const mockPlanGuardService = {
    getMaxInactiveWarnings: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: getRepositoryToken(ReminderSchedule), useValue: mockScheduleRepo },
        { provide: getRepositoryToken(Reminder), useValue: mockReminderRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: UserService, useValue: mockUserService },
        { provide: PlanGuardService, useValue: mockPlanGuardService },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    scheduleRepo = module.get(getRepositoryToken(ReminderSchedule));
    reminderRepo = module.get(getRepositoryToken(Reminder));
    notificationService = module.get(NotificationService);
    userService = module.get(UserService);
    planGuardService = module.get(PlanGuardService);
  });

  describe('handlePersistentReminder (inactivity tracking)', () => {
    it('should reset inactiveReminderCount when user is active', async () => {
      const reminder = {
        id: 'rem-1',
        userId: 'user-1',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 5,
        inactiveReminderCount: 2,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-1',
        lastMessageTime: new Date(), // Active — just messaged
        plan: 'assistant',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      // Access private method via any
      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should reset inactiveReminderCount to 0
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-1',
        expect.objectContaining({
          inactiveReminderCount: 0,
        })
      );
    });

    it('should increment inactiveReminderCount when user is inactive', async () => {
      const reminder = {
        id: 'rem-2',
        userId: 'user-2',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 3,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-2',
        lastMessageTime: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago — inactive
        plan: 'assistant',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(2);
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should increment inactiveReminderCount to 1
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-2',
        expect.objectContaining({
          inactiveReminderCount: 1,
        })
      );
    });

    it('should stop and send warning when helper hits 1 inactive reminder', async () => {
      const reminder = {
        id: 'rem-3',
        userId: 'user-3',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 2,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-3',
        lastMessageTime: new Date(Date.now() - 48 * 60 * 60 * 1000), // inactive
        plan: 'helper',
        phone: '1234567890',
        name: 'Test',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(1); // helper = 1
      mockReminderRepo.update.mockResolvedValue({});
      mockNotificationService.sendInactivityWarning.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should mark completed and send warning
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-3',
        expect.objectContaining({
          isCompleted: true,
          inactiveReminderCount: 1,
        })
      );
      expect(notificationService.sendInactivityWarning).toHaveBeenCalledWith(user, reminder);
    });

    it('should continue when assistant has 1 inactive reminder (limit is 2)', async () => {
      const reminder = {
        id: 'rem-4',
        userId: 'user-4',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 2,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-4',
        lastMessageTime: new Date(Date.now() - 48 * 60 * 60 * 1000), // inactive
        plan: 'assistant',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(2); // assistant = 2
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should NOT be completed — only 1 inactive reminder so far
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-4',
        expect.objectContaining({
          inactiveReminderCount: 1,
        })
      );
      expect(notificationService.sendInactivityWarning).not.toHaveBeenCalled();
    });

    it('should stop assistant on 2nd inactive reminder', async () => {
      const reminder = {
        id: 'rem-5',
        userId: 'user-5',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 3,
        inactiveReminderCount: 1, // Already had 1 inactive
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-5',
        lastMessageTime: new Date(Date.now() - 72 * 60 * 60 * 1000), // inactive
        plan: 'assistant',
        phone: '1234567890',
        name: 'Test',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(2); // assistant = 2
      mockReminderRepo.update.mockResolvedValue({});
      mockNotificationService.sendInactivityWarning.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should stop — 2nd inactive reminder hits limit
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-5',
        expect.objectContaining({
          isCompleted: true,
          inactiveReminderCount: 2,
        })
      );
      expect(notificationService.sendInactivityWarning).toHaveBeenCalled();
    });

    it('should allow manager 3 inactive reminders before stopping', async () => {
      const reminder = {
        id: 'rem-6',
        userId: 'user-6',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 4,
        inactiveReminderCount: 2, // Already had 2 inactive
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-6',
        lastMessageTime: new Date(Date.now() - 96 * 60 * 60 * 1000), // inactive
        plan: 'manager',
        phone: '1234567890',
        name: 'Test',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(3); // manager = 3
      mockReminderRepo.update.mockResolvedValue({});
      mockNotificationService.sendInactivityWarning.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should stop — 3rd inactive reminder hits limit
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-6',
        expect.objectContaining({
          isCompleted: true,
          inactiveReminderCount: 3,
        })
      );
      expect(notificationService.sendInactivityWarning).toHaveBeenCalled();
    });

    it('should not stop manager on 2nd inactive reminder (limit is 3)', async () => {
      const reminder = {
        id: 'rem-7',
        userId: 'user-7',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 3,
        inactiveReminderCount: 1,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-7',
        lastMessageTime: new Date(Date.now() - 72 * 60 * 60 * 1000), // inactive
        plan: 'manager',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(3); // manager = 3
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should NOT be completed — only 2 inactive reminders so far
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-7',
        expect.objectContaining({
          inactiveReminderCount: 2,
        })
      );
      expect(notificationService.sendInactivityWarning).not.toHaveBeenCalled();
    });

    it('should skip if reminder is already completed', async () => {
      const reminder = {
        id: 'rem-8',
        userId: 'user-8',
        isPersistent: true,
        isCompleted: true,
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);

      await (service as any).handlePersistentReminder(reminder, new Date());

      expect(reminderRepo.update).not.toHaveBeenCalled();
    });

    it('should skip if reminder is not persistent', async () => {
      const reminder = {
        id: 'rem-9',
        userId: 'user-9',
        isPersistent: false,
        isCompleted: false,
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);

      await (service as any).handlePersistentReminder(reminder, new Date());

      expect(reminderRepo.update).not.toHaveBeenCalled();
    });

    it('should handle user with no lastMessageTime as inactive', async () => {
      const reminder = {
        id: 'rem-10',
        userId: 'user-10',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 1,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-10',
        lastMessageTime: null, // Never messaged
        plan: 'free',
        phone: '1234567890',
        name: 'Test',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(1); // free = 1
      mockReminderRepo.update.mockResolvedValue({});
      mockNotificationService.sendInactivityWarning.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should stop — first inactive reminder hits limit for free/helper
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-10',
        expect.objectContaining({
          isCompleted: true,
          inactiveReminderCount: 1,
        })
      );
      expect(notificationService.sendInactivityWarning).toHaveBeenCalled();
    });

    it('should stop when maxReminderCount is reached', async () => {
      const reminder = {
        id: 'rem-11',
        userId: 'user-11',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 9,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 10,
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockReminderRepo.update.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should stop — reached maxReminderCount
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-11',
        expect.objectContaining({
          isCompleted: true,
          reminderCount: 10,
        })
      );
      expect(notificationService.sendInactivityWarning).not.toHaveBeenCalled();
    });

    it('should not check inactivity when maxReminderCount stops the reminder', async () => {
      const reminder = {
        id: 'rem-12',
        userId: 'user-12',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 4,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 5,
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockReminderRepo.update.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should NOT check user — maxReminderCount takes priority
      expect(userService.getUserById).not.toHaveBeenCalled();
    });

    it('should not stop when maxReminderCount is 0 (unlimited)', async () => {
      const reminder = {
        id: 'rem-13',
        userId: 'user-13',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 100,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0, // Unlimited
      };

      const user = {
        id: 'user-13',
        lastMessageTime: new Date(), // Active
        plan: 'free',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should continue — unlimited reminders
      expect(reminderRepo.update).toHaveBeenCalledWith(
        'rem-13',
        expect.objectContaining({
          inactiveReminderCount: 0,
        })
      );
    });

    it('should skip schedule creation if schedule already exists', async () => {
      const reminder = {
        id: 'rem-14',
        userId: 'user-14',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 5,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-14',
        lastMessageTime: new Date(), // Active
        plan: 'assistant',
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue({ id: 'existing-schedule' }); // Already exists

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should NOT create a new schedule
      expect(scheduleRepo.create).not.toHaveBeenCalled();
      expect(scheduleRepo.save).not.toHaveBeenCalled();
    });

    it('should handle user not found gracefully', async () => {
      const reminder = {
        id: 'rem-15',
        userId: 'user-15',
        isPersistent: true,
        reminderInterval: 60,
        reminderCount: 3,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(null); // User not found
      mockPlanGuardService.getMaxInactiveWarnings.mockReturnValue(1);
      mockReminderRepo.update.mockResolvedValue({});
      mockNotificationService.sendInactivityWarning.mockResolvedValue({});

      // Should not throw — treats user as inactive
      await (service as any).handlePersistentReminder(reminder, new Date());

      // User with null lastMessageTime is treated as inactive
      expect(reminderRepo.update).toHaveBeenCalled();
    });

    it('should handle reminder not found in repository', async () => {
      const reminder = {
        id: 'rem-16',
        userId: 'user-16',
        isPersistent: true,
      };

      mockReminderRepo.findOne.mockResolvedValue(null); // Reminder not found

      await (service as any).handlePersistentReminder(reminder, new Date());

      // Should not update anything
      expect(reminderRepo.update).not.toHaveBeenCalled();
    });

    it('should create schedule with overdue time adjusted to now + interval', async () => {
      const reminder = {
        id: 'rem-17',
        userId: 'user-17',
        isPersistent: true,
        reminderInterval: 30, // 30 min
        reminderCount: 2,
        inactiveReminderCount: 0,
        isCompleted: false,
        maxReminderCount: 0,
      };

      const user = {
        id: 'user-17',
        lastMessageTime: new Date(), // Active
        plan: 'assistant',
      };

      // Scheduled time is in the past (overdue)
      const overdueTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      mockReminderRepo.findOne.mockResolvedValue(reminder);
      mockUserService.getUserById.mockResolvedValue(user);
      mockReminderRepo.update.mockResolvedValue({});
      mockScheduleRepo.findOne.mockResolvedValue(null);
      mockScheduleRepo.create.mockReturnValue({});
      mockScheduleRepo.save.mockResolvedValue({});

      const beforeTime = Date.now();
      await (service as any).handlePersistentReminder(reminder, overdueTime);

      // Should create schedule with now + interval (not overdue + interval)
      const createCall = scheduleRepo.create.mock.calls[0][0];
      const scheduledTime = createCall.scheduledTime.getTime();
      expect(scheduledTime).toBeGreaterThanOrEqual(beforeTime + 30 * 60 * 1000);
      expect(scheduledTime).toBeLessThanOrEqual(beforeTime + 31 * 60 * 1000);
    });
  });

  describe('handleFailedSchedule', () => {
    it('should increment retry count on failure', async () => {
      const schedule = {
        id: 'sched-1',
        retryCount: 1,
      };

      mockScheduleRepo.update.mockResolvedValue({});

      await (service as any).handleFailedSchedule(schedule, new Error('Test error'));

      expect(scheduleRepo.update).toHaveBeenCalledWith('sched-1', {
        retryCount: 2,
        lastRetryAt: expect.any(Date),
        errorMessage: 'Test error',
      });
    });

    it('should log error when max retries reached', async () => {
      const schedule = {
        id: 'sched-2',
        retryCount: 2, // Already at max - 1
      };

      mockScheduleRepo.update.mockResolvedValue({});

      await (service as any).handleFailedSchedule(schedule, new Error('Final error'));

      // Should update with retryCount 3
      expect(scheduleRepo.update).toHaveBeenCalledWith('sched-2', {
        retryCount: 3,
        lastRetryAt: expect.any(Date),
        errorMessage: 'Final error',
      });
    });

    it('should not set isCompleted on failure', async () => {
      const schedule = {
        id: 'sched-3',
        retryCount: 0,
      };

      mockScheduleRepo.update.mockResolvedValue({});

      await (service as any).handleFailedSchedule(schedule, new Error('Error'));

      // Should NOT set isCompleted - the schedule will be skipped by the query filter
      const updateCall = scheduleRepo.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('isCompleted');
    });
  });
});
