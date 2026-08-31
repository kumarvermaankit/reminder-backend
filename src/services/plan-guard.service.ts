import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, PlanType } from '../entities/user.entity';

export type Feature =
  | 'reminders'
  | 'notes'
  | 'passwords'
  | 'todo_lists'
  | 'todo_item_reminders'
  | 'calorie_tracker'
  | 'stock_queries'
  | 'cricket_queries'
  | 'google_calendar'
  | 'google_meet'
  | 'google_docs'
  | 'google_sheets'
  | 'priority_support';

const PLAN_FEATURES: Record<PlanType, Feature[]> = {
  free: ['reminders'],
  helper: ['reminders', 'notes', 'passwords'],
  assistant: [
    'reminders', 'notes', 'passwords',
    'todo_lists', 'todo_item_reminders', 'calorie_tracker',
    'stock_queries', 'cricket_queries',
  ],
  manager: [
    'reminders', 'notes', 'passwords',
    'todo_lists', 'todo_item_reminders', 'calorie_tracker',
    'stock_queries', 'cricket_queries',
    'google_calendar', 'google_meet', 'google_docs', 'google_sheets',
    'priority_support',
  ],
};

const PLAN_ORDER: PlanType[] = ['free', 'helper', 'assistant', 'manager'];

@Injectable()
export class PlanGuardService {
  private readonly logger = new Logger(PlanGuardService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  hasFeature(user: User, feature: Feature): boolean {
    const features = PLAN_FEATURES[user.plan] || PLAN_FEATURES.free;
    return features.includes(feature);
  }

  requireFeature(user: User, feature: Feature): void {
    if (!this.hasFeature(user, feature)) {
      throw new ForbiddenException(
        `Your ${user.plan} plan does not include ${feature.replace(/_/g, ' ')}. ` +
        `Upgrade to ${this.minPlanForFeature(feature)} plan to access this feature.`,
      );
    }
  }

  minPlanForFeature(feature: Feature): PlanType {
    for (const plan of PLAN_ORDER) {
      if (PLAN_FEATURES[plan].includes(feature)) {
        return plan;
      }
    }
    return 'manager';
  }

  hasPlan(user: User, minPlan: PlanType): boolean {
    const userIdx = PLAN_ORDER.indexOf(user.plan);
    const minIdx = PLAN_ORDER.indexOf(minPlan);
    return userIdx >= minIdx;
  }

  requirePlan(user: User, minPlan: PlanType): void {
    if (!this.hasPlan(user, minPlan)) {
      throw new ForbiddenException(
        `This feature requires the ${minPlan} plan or higher. Your current plan is ${user.plan}.`,
      );
    }
  }

  async getUserWithPlan(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const now = new Date();

    const trialActive = user.trialEndsAt && user.trialEndsAt > now;
    const couponActive = user.couponExpiresAt && user.couponExpiresAt > now;
    const planExpired = user.planExpiresAt && user.planExpiresAt <= now;

    if (planExpired && !trialActive && !couponActive && user.plan !== 'free') {
      this.logger.log(`Plan expired for user ${userId}: resetting to free`);
      user.plan = 'free';
      user.isPremium = false;
      await this.userRepository.update(userId, { plan: 'free', isPremium: false });
    }

    return user;
  }

  isOnTrial(user: User): boolean {
    return !!(user.trialEndsAt && user.trialEndsAt > new Date());
  }

  getMaxInactiveWarnings(plan: PlanType): number {
    const limits: Record<PlanType, number> = {
      free: 1,
      helper: 1,
      assistant: 2,
      manager: 3,
    };
    return limits[plan] || 1;
  }

  isCouponActive(user: User): boolean {
    return !!(user.couponExpiresAt && user.couponExpiresAt > new Date());
  }

  hasActiveAccess(user: User): boolean {
    const now = new Date();
    // NULL planExpiresAt on a premium plan = manual admin override (never expires)
    const planActive = user.planExpiresAt != null
      ? user.planExpiresAt > now
      : !!(user.plan && user.plan !== 'free');
    return !!(
      planActive ||
      (user.trialEndsAt && user.trialEndsAt > now) ||
      (user.couponExpiresAt && user.couponExpiresAt > now)
    );
  }

  getDaysRemaining(user: User): { trial?: number; plan?: number; coupon?: number; total?: number } {
    const now = new Date();
    const result: any = {};
    if (user.trialEndsAt && user.trialEndsAt > now) {
      result.trial = Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
    if (user.planExpiresAt && user.planExpiresAt > now) {
      result.plan = Math.ceil((user.planExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
    if (user.couponExpiresAt && user.couponExpiresAt > now) {
      result.coupon = Math.ceil((user.couponExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
    return result;
  }
}
