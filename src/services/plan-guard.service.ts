import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, PlanType } from '../entities/user.entity';

export type Feature =
  | 'reminders'
  | 'notes'
  | 'passwords'
  | 'daily_prompt'
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
  free: ['reminders', 'notes', 'daily_prompt'],
  helper: ['reminders', 'notes', 'passwords', 'daily_prompt'],
  assistant: [
    'reminders', 'notes', 'passwords', 'daily_prompt',
    'todo_lists', 'todo_item_reminders', 'calorie_tracker',
    'stock_queries', 'cricket_queries',
  ],
  manager: [
    'reminders', 'notes', 'passwords', 'daily_prompt',
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
    if (user.planExpiresAt && user.planExpiresAt < new Date()) {
      user.plan = 'free';
      user.isPremium = false;
      await this.userRepository.update(userId, { plan: 'free', isPremium: false });
    }
    return user;
  }
}
