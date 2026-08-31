import { Test, TestingModule } from '@nestjs/testing';
import { PlanGuardService } from './plan-guard.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, PlanType } from '../entities/user.entity';
import { ForbiddenException } from '@nestjs/common';

describe('PlanGuardService', () => {
  let service: PlanGuardService;
  let userRepo: any;

  const mockUserRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanGuardService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<PlanGuardService>(PlanGuardService);
    userRepo = module.get(getRepositoryToken(User));
  });

  describe('hasFeature', () => {
    it('free plan has reminders but not notes', () => {
      const user = { plan: 'free' } as User;
      expect(service.hasFeature(user, 'reminders')).toBe(true);
      expect(service.hasFeature(user, 'notes')).toBe(false);
    });

    it('free plan does not have passwords', () => {
      const user = { plan: 'free' } as User;
      expect(service.hasFeature(user, 'passwords')).toBe(false);
    });

    it('helper plan has passwords', () => {
      const user = { plan: 'helper' } as User;
      expect(service.hasFeature(user, 'passwords')).toBe(true);
    });

    it('assistant plan has todo_lists and calorie_tracker', () => {
      const user = { plan: 'assistant' } as User;
      expect(service.hasFeature(user, 'todo_lists')).toBe(true);
      expect(service.hasFeature(user, 'calorie_tracker')).toBe(true);
    });

    it('manager plan has google_calendar and priority_support', () => {
      const user = { plan: 'manager' } as User;
      expect(service.hasFeature(user, 'google_calendar')).toBe(true);
      expect(service.hasFeature(user, 'priority_support')).toBe(true);
    });

    it('free plan does not have google_calendar', () => {
      const user = { plan: 'free' } as User;
      expect(service.hasFeature(user, 'google_calendar')).toBe(false);
    });
  });

  describe('requireFeature', () => {
    it('throws ForbiddenException when feature not available', () => {
      const user = { plan: 'free' } as User;
      expect(() => service.requireFeature(user, 'google_calendar')).toThrow(ForbiddenException);
    });

    it('does not throw when feature is available', () => {
      const user = { plan: 'manager' } as User;
      expect(() => service.requireFeature(user, 'google_calendar')).not.toThrow();
    });
  });

  describe('minPlanForFeature', () => {
    it('reminders require free plan', () => {
      expect(service.minPlanForFeature('reminders')).toBe('free');
    });

    it('passwords require helper plan', () => {
      expect(service.minPlanForFeature('passwords')).toBe('helper');
    });

    it('calorie_tracker requires assistant plan', () => {
      expect(service.minPlanForFeature('calorie_tracker')).toBe('assistant');
    });

    it('google_calendar requires manager plan', () => {
      expect(service.minPlanForFeature('google_calendar')).toBe('manager');
    });
  });

  describe('hasPlan', () => {
    it('manager has manager or higher', () => {
      const user = { plan: 'manager' } as User;
      expect(service.hasPlan(user, 'free')).toBe(true);
      expect(service.hasPlan(user, 'manager')).toBe(true);
    });

    it('free does not have assistant', () => {
      const user = { plan: 'free' } as User;
      expect(service.hasPlan(user, 'assistant')).toBe(false);
    });

    it('assistant has helper or higher but not manager', () => {
      const user = { plan: 'assistant' } as User;
      expect(service.hasPlan(user, 'helper')).toBe(true);
      expect(service.hasPlan(user, 'assistant')).toBe(true);
      expect(service.hasPlan(user, 'manager')).toBe(false);
    });
  });

  describe('requirePlan', () => {
    it('throws when plan is below minimum', () => {
      const user = { plan: 'free' } as User;
      expect(() => service.requirePlan(user, 'helper')).toThrow(ForbiddenException);
    });

    it('does not throw when plan meets minimum', () => {
      const user = { plan: 'assistant' } as User;
      expect(() => service.requirePlan(user, 'helper')).not.toThrow();
    });
  });

  describe('getUserWithPlan', () => {
    it('returns user with active plan', async () => {
      const future = new Date(Date.now() + 86400000);
      const user = { id: '1', plan: 'assistant', isPremium: true, planExpiresAt: future, trialEndsAt: null, couponExpiresAt: null } as User;
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserWithPlan('1');
      expect(result.plan).toBe('assistant');
      expect(result.isPremium).toBe(true);
    });

    it('resets to free when plan expired and no trial/coupon', async () => {
      const past = new Date(Date.now() - 86400000);
      const user = { id: '1', plan: 'assistant', isPremium: true, planExpiresAt: past, trialEndsAt: null, couponExpiresAt: null } as User;
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.update.mockResolvedValue({});

      const result = await service.getUserWithPlan('1');
      expect(result.plan).toBe('free');
      expect(result.isPremium).toBe(false);
      expect(mockUserRepo.update).toHaveBeenCalledWith('1', { plan: 'free', isPremium: false });
    });

    it('keeps plan if trial is active even if plan expired', async () => {
      const future = new Date(Date.now() + 86400000);
      const past = new Date(Date.now() - 86400000);
      const user = { id: '1', plan: 'assistant', isPremium: true, planExpiresAt: past, trialEndsAt: future, couponExpiresAt: null } as User;
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserWithPlan('1');
      expect(result.plan).toBe('assistant');
      expect(result.isPremium).toBe(true);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('keeps plan if coupon is active even if plan expired', async () => {
      const future = new Date(Date.now() + 86400000);
      const past = new Date(Date.now() - 86400000);
      const user = { id: '1', plan: 'assistant', isPremium: true, planExpiresAt: past, trialEndsAt: null, couponExpiresAt: future } as User;
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserWithPlan('1');
      expect(result.plan).toBe('assistant');
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('throws when user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      await expect(service.getUserWithPlan('999')).rejects.toThrow(ForbiddenException);
    });

    it('keeps plan when planExpiresAt is null (manual admin override)', async () => {
      const user = { id: '1', plan: 'manager', isPremium: true, planExpiresAt: null, trialEndsAt: null, couponExpiresAt: null } as User;
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserWithPlan('1');
      expect(result.plan).toBe('manager');
      expect(result.isPremium).toBe(true);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('isOnTrial', () => {
    it('returns true when trialEndsAt is in the future', () => {
      const user = { trialEndsAt: new Date(Date.now() + 86400000) } as User;
      expect(service.isOnTrial(user)).toBe(true);
    });

    it('returns false when trialEndsAt is in the past', () => {
      const user = { trialEndsAt: new Date(Date.now() - 86400000) } as User;
      expect(service.isOnTrial(user)).toBe(false);
    });

    it('returns false when trialEndsAt is null', () => {
      const user = { trialEndsAt: null } as User;
      expect(service.isOnTrial(user)).toBe(false);
    });
  });

  describe('isCouponActive', () => {
    it('returns true when couponExpiresAt is in the future', () => {
      const user = { couponExpiresAt: new Date(Date.now() + 86400000) } as User;
      expect(service.isCouponActive(user)).toBe(true);
    });

    it('returns false when couponExpiresAt is null', () => {
      const user = { couponExpiresAt: null } as User;
      expect(service.isCouponActive(user)).toBe(false);
    });
  });

  describe('hasActiveAccess', () => {
    it('returns true when plan is active', () => {
      const user = { planExpiresAt: new Date(Date.now() + 86400000), trialEndsAt: null, couponExpiresAt: null } as User;
      expect(service.hasActiveAccess(user)).toBe(true);
    });

    it('returns true when trial is active', () => {
      const user = { planExpiresAt: null, trialEndsAt: new Date(Date.now() + 86400000), couponExpiresAt: null } as User;
      expect(service.hasActiveAccess(user)).toBe(true);
    });

    it('returns true when coupon is active', () => {
      const user = { planExpiresAt: null, trialEndsAt: null, couponExpiresAt: new Date(Date.now() + 86400000) } as User;
      expect(service.hasActiveAccess(user)).toBe(true);
    });

    it('returns true when plan is premium and planExpiresAt is null (manual admin override)', () => {
      const user = { plan: 'manager', planExpiresAt: null, trialEndsAt: null, couponExpiresAt: null } as User;
      expect(service.hasActiveAccess(user)).toBe(true);
    });

    it('returns false when nothing is active', () => {
      const user = { plan: 'free', planExpiresAt: null, trialEndsAt: null, couponExpiresAt: null } as User;
      expect(service.hasActiveAccess(user)).toBe(false);
    });
  });

  describe('getDaysRemaining', () => {
    it('returns days for trial', () => {
      const future = new Date(Date.now() + 2 * 86400000);
      const user = { trialEndsAt: future, planExpiresAt: null, couponExpiresAt: null } as User;
      const result = service.getDaysRemaining(user);
      expect(result.trial).toBe(2);
    });

    it('returns days for plan', () => {
      const future = new Date(Date.now() + 5 * 86400000);
      const user = { trialEndsAt: null, planExpiresAt: future, couponExpiresAt: null } as User;
      const result = service.getDaysRemaining(user);
      expect(result.plan).toBe(5);
    });

    it('returns days for all active periods', () => {
      const future = new Date(Date.now() + 3 * 86400000);
      const user = { trialEndsAt: future, planExpiresAt: future, couponExpiresAt: future } as User;
      const result = service.getDaysRemaining(user);
      expect(result.trial).toBe(3);
      expect(result.plan).toBe(3);
      expect(result.coupon).toBe(3);
    });
  });

  describe('getMaxInactiveWarnings', () => {
    it('free plan gets 1 warning before stop', () => {
      expect(service.getMaxInactiveWarnings('free')).toBe(1);
    });

    it('helper plan gets 1 warning before stop', () => {
      expect(service.getMaxInactiveWarnings('helper')).toBe(1);
    });

    it('assistant plan gets 2 warnings before stop', () => {
      expect(service.getMaxInactiveWarnings('assistant')).toBe(2);
    });

    it('manager plan gets 3 warnings before stop', () => {
      expect(service.getMaxInactiveWarnings('manager')).toBe(3);
    });

    it('defaults to 1 for unknown plan', () => {
      expect(service.getMaxInactiveWarnings('unknown' as any)).toBe(1);
    });
  });
});
