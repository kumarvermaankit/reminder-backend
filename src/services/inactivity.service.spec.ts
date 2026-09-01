import { Test, TestingModule } from '@nestjs/testing';
import { InactivityService, getGracePeriodReminderLimit, getPostInactiveMessageLimit, INACTIVITY_THRESHOLD_HOURS, GRACE_MESSAGE_INTERVAL_HOURS, POST_INACTIVE_INTERVAL_DAYS } from './inactivity.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Reminder } from '../entities/reminder.entity';
import { ReminderSchedule } from '../entities/reminder-schedule.entity';
import { WhatsappService } from './whatsapp.service';

describe('InactivityService', () => {
  let service: InactivityService;
  let userRepository: any;
  let reminderRepository: any;
  let scheduleRepository: any;
  let whatsappService: any;

  const mockUserRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
   createQueryBuilder: jest.fn(),
  };

  const mockReminderRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };

  const mockScheduleRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockWhatsappService = {
    sendTemplateMessage: jest.fn(),
    sendInteractiveMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InactivityService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        { provide: getRepositoryToken(Reminder), useValue: mockReminderRepository },
        { provide: getRepositoryToken(ReminderSchedule), useValue: mockScheduleRepository },
        { provide: WhatsappService, useValue: mockWhatsappService },
      ],
    }).compile();

    service = module.get<InactivityService>(InactivityService);
    userRepository = module.get(getRepositoryToken(User));
    reminderRepository = module.get(getRepositoryToken(Reminder));
    scheduleRepository = module.get(getRepositoryToken(ReminderSchedule));
    whatsappService = module.get(WhatsappService);
  });

  describe('getGracePeriodReminderLimit', () => {
    it('should return 6 for free/helper', () => {
      expect(getGracePeriodReminderLimit('free')).toBe(6);
      expect(getGracePeriodReminderLimit('helper')).toBe(6);
    });

    it('should return 9 for assistant', () => {
      expect(getGracePeriodReminderLimit('assistant')).toBe(9);
    });

    it('should return 12 for manager', () => {
      expect(getGracePeriodReminderLimit('manager')).toBe(12);
    });
  });

  describe('isUserInactive', () => {
    it('should return true if lastMessageTime is null', () => {
      const user = { lastMessageTime: null } as User;
      expect(service.isUserInactive(user)).toBe(true);
    });

    it('should return true if lastMessageTime is > 24h ago', () => {
      const user = { lastMessageTime: new Date(Date.now() - 25 * 60 * 60 * 1000) } as User;
      expect(service.isUserInactive(user)).toBe(true);
    });

    it('should return false if lastMessageTime is < 24h ago', () => {
      const user = { lastMessageTime: new Date(Date.now() - 23 * 60 * 60 * 1000) } as User;
      expect(service.isUserInactive(user)).toBe(false);
    });
  });

  describe('getHoursSinceLastMessage', () => {
    it('should return Infinity if lastMessageTime is null', () => {
      const user = { lastMessageTime: null } as User;
      expect(service.getHoursSinceLastMessage(user)).toBe(Infinity);
    });

    it('should return hours since last message', () => {
      const user = { lastMessageTime: new Date(Date.now() - 10 * 60 * 60 * 1000) } as User;
      expect(service.getHoursSinceLastMessage(user)).toBeCloseTo(10, 0);
    });
  });

  describe('userHasReminders', () => {
    it('should return true if user has active reminders', async () => {
      mockReminderRepository.count.mockResolvedValue(2);
      expect(await service.userHasReminders('user-1')).toBe(true);
      expect(mockReminderRepository.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', isCompleted: false },
      });
    });

    it('should return false if user has no active reminders', async () => {
      mockReminderRepository.count.mockResolvedValue(0);
      expect(await service.userHasReminders('user-1')).toBe(false);
    });
  });

  describe('handleInactivityDetected', () => {
    it('should set inactivity fields and stop pending schedules', async () => {
      const user = { id: 'user-1', plan: 'helper' } as User;
      mockUserRepository.update.mockResolvedValue({});
      mockScheduleRepository.find.mockResolvedValue([
        { id: 'sched-1', reminder: { userId: 'user-1' } },
        { id: 'sched-2', reminder: { userId: 'user-1' } },
      ]);
      mockScheduleRepository.update.mockResolvedValue({});

      await service.handleInactivityDetected(user);

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        inactivityDetectedAt: expect.any(Date),
        inactivityMessageCount: 0,
        postInactiveMessageCount: 0,
        oneTimeSentDuringInactivity: 0,
      });

      expect(scheduleRepository.update).toHaveBeenCalledTimes(2);
      expect(scheduleRepository.update).toHaveBeenCalledWith('sched-1', {
        isCompleted: true,
        sentVia: 'inactivity_stop',
      });
    });
  });

  describe('sendContinueMessage', () => {
    it('should return false if user has no phone', async () => {
      const user = { id: 'user-1', phone: null } as User;
      expect(await service.sendContinueMessage(user)).toBe(false);
    });

    it('should send template message and increment counter', async () => {
      const user = { id: 'user-1', phone: '1234567890', name: 'Test', inactivityMessageCount: 0 } as any;
      mockWhatsappService.sendTemplateMessage.mockResolvedValue(true);
      mockUserRepository.update.mockResolvedValue({});

      const result = await service.sendContinueMessage(user, false);

      expect(result).toBe(true);
      expect(whatsappService.sendTemplateMessage).toHaveBeenCalledWith(
        '1234567890',
        'notifications',
        'en',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'body',
            parameters: expect.arrayContaining([
              expect.objectContaining({ type: 'text' }),
            ]),
          }),
        ]),
        [{ id: 'continue_reminders', title: 'Done' }],
      );
      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        inactivityMessageCount: 1,
      });
    });

    it('should increment post-inactive counter when isPostInactive is true', async () => {
      const user = { id: 'user-1', phone: '1234567890', name: 'Test', postInactiveMessageCount: 0 } as any;
      mockWhatsappService.sendTemplateMessage.mockResolvedValue(true);
      mockUserRepository.update.mockResolvedValue({});

      await service.sendContinueMessage(user, true);

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        postInactiveMessageCount: 1,
      });
    });
  });

  describe('handleDoneButton', () => {
    it('should reset inactivity fields and resume reminders', async () => {
      const user = { id: 'user-1', name: 'Test' } as any;
      mockUserRepository.update.mockResolvedValue({});
      mockReminderRepository.find.mockResolvedValue([
        { id: 'rem-1', reminderInterval: 60 },
        { id: 'rem-2', reminderInterval: 120 },
      ]);
      mockScheduleRepository.findOne.mockResolvedValue(null);
      mockScheduleRepository.save.mockResolvedValue({});

      const result = await service.handleDoneButton(user);

      expect(result.resumed).toBe(2);
      expect(result.message).toContain('Welcome back');
      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        lastMessageTime: expect.any(Date),
        inactivityDetectedAt: null,
        inactivityMessageCount: 0,
        postInactiveMessageCount: 0,
        oneTimeSentDuringInactivity: 0,
      });
    });

    it('should not create schedule if one already exists', async () => {
      const user = { id: 'user-1', name: 'Test' } as any;
      mockUserRepository.update.mockResolvedValue({});
      mockReminderRepository.find.mockResolvedValue([
        { id: 'rem-1', reminderInterval: 60 },
      ]);
      mockScheduleRepository.findOne.mockResolvedValue({ id: 'existing' });

      const result = await service.handleDoneButton(user);

      expect(result.resumed).toBe(0);
      expect(scheduleRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('canSendOneTimeReminder', () => {
    it('should return true if under limit', async () => {
      const user = { id: 'user-1', plan: 'helper', oneTimeSentDuringInactivity: 3 } as any;
      expect(await service.canSendOneTimeReminder(user)).toBe(true);
    });

    it('should return false if at limit', async () => {
      const user = { id: 'user-1', plan: 'helper', oneTimeSentDuringInactivity: 6 } as any;
      expect(await service.canSendOneTimeReminder(user)).toBe(false);
    });

    it('should respect plan limits', async () => {
      const helperUser = { id: 'user-1', plan: 'helper', oneTimeSentDuringInactivity: 5 } as any;
      const assistantUser = { id: 'user-2', plan: 'assistant', oneTimeSentDuringInactivity: 5 } as any;
      const managerUser = { id: 'user-3', plan: 'manager', oneTimeSentDuringInactivity: 5 } as any;

      expect(await service.canSendOneTimeReminder(helperUser)).toBe(true);
      expect(await service.canSendOneTimeReminder(assistantUser)).toBe(true);
      expect(await service.canSendOneTimeReminder(managerUser)).toBe(true);

      const helperUserAtLimit = { id: 'user-4', plan: 'helper', oneTimeSentDuringInactivity: 6 } as any;
      const assistantUserAtLimit = { id: 'user-5', plan: 'assistant', oneTimeSentDuringInactivity: 9 } as any;
      const managerUserAtLimit = { id: 'user-6', plan: 'manager', oneTimeSentDuringInactivity: 12 } as any;

      expect(await service.canSendOneTimeReminder(helperUserAtLimit)).toBe(false);
      expect(await service.canSendOneTimeReminder(assistantUserAtLimit)).toBe(false);
      expect(await service.canSendOneTimeReminder(managerUserAtLimit)).toBe(false);
    });
  });

  describe('checkAllUsersInactivity', () => {
    it('should detect inactive users and send continue messages', async () => {
      const inactiveUser = {
        id: 'user-1',
        lastMessageTime: new Date(Date.now() - 25 * 60 * 60 * 1000),
        inactivityDetectedAt: null,
        plan: 'helper',
      };

      mockUserRepository.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([inactiveUser]),
      });

      mockUserRepository.update.mockResolvedValue({});
      mockScheduleRepository.find.mockResolvedValue([]);
      mockWhatsappService.sendTemplateMessage.mockResolvedValue(true);

      await service.checkAllUsersInactivity();

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        inactivityDetectedAt: expect.any(Date),
        inactivityMessageCount: 0,
        postInactiveMessageCount: 0,
        oneTimeSentDuringInactivity: 0,
      });
    });
  });

  describe('getPostInactiveMessageLimit', () => {
    it('should return 3 for free/helper', () => {
      expect(getPostInactiveMessageLimit('free')).toBe(3);
      expect(getPostInactiveMessageLimit('helper')).toBe(3);
    });

    it('should return 6 for assistant', () => {
      expect(getPostInactiveMessageLimit('assistant')).toBe(6);
    });

    it('should return 9 for manager', () => {
      expect(getPostInactiveMessageLimit('manager')).toBe(9);
    });
  });

  describe('constants', () => {
    it('should have correct threshold values', () => {
      expect(INACTIVITY_THRESHOLD_HOURS).toBe(24);
      expect(GRACE_MESSAGE_INTERVAL_HOURS).toBe(12);
      expect(POST_INACTIVE_INTERVAL_DAYS).toBe(3);
    });
  });
});
