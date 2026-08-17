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
});
