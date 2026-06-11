import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CalorieProfile } from '../entities/calorie-profile.entity';
import { FoodLog } from '../entities/food-log.entity';

export interface CalorieStatus {
  target: number;
  consumed: number;
  remaining: number;
  meals: { mealType: string; description: string; calories: number }[];
}

@Injectable()
export class CalorieService {
  private readonly logger = new Logger(CalorieService.name);

  constructor(
    @InjectRepository(CalorieProfile)
    private readonly profileRepo: Repository<CalorieProfile>,
    @InjectRepository(FoodLog)
    private readonly foodRepo: Repository<FoodLog>,
  ) {}

  // ── BMR / TDEE Calculation ──────────────────────────────────────────

  calculateBMR(weight: number, height: number, age: number, gender: string): number {
    if (gender.toLowerCase() === 'male') {
      return 10 * weight + 6.25 * height - 5 * age + 5;
    }
    return 10 * weight + 6.25 * height - 5 * age - 161;
  }

  calculateTDEE(bmr: number, activityLevel: string): number {
    const multipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };
    return Math.round(bmr * (multipliers[activityLevel] || 1.2));
  }

  calculateDailyTarget(tdee: number, goal: string, targetWeight?: number, currentWeight?: number): number {
    if (goal === 'lose') return tdee - 500;
    if (goal === 'gain') return tdee + 500;
    return tdee; // maintain
  }

  // ── Profile ─────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<CalorieProfile | null> {
    return this.profileRepo.findOne({ where: { userId } });
  }

  async saveProfile(data: Partial<CalorieProfile>): Promise<CalorieProfile> {
    const existing = await this.profileRepo.findOne({ where: { userId: data.userId } });
    if (existing) {
      await this.profileRepo.update(existing.id, data);
      return this.profileRepo.findOne({ where: { id: existing.id } });
    }
    return this.profileRepo.save(data);
  }

  recalculateTarget(profile: CalorieProfile): number {
    const bmr = this.calculateBMR(profile.weight, profile.height, profile.age, profile.gender);
    const tdee = this.calculateTDEE(bmr, profile.activityLevel);
    return this.calculateDailyTarget(tdee, profile.goal, profile.targetWeight, profile.weight);
  }

  // ── Food Logging ────────────────────────────────────────────────────

  async logFood(userId: string, foodDescription: string, calories: number, mealType?: string): Promise<FoodLog> {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.foodRepo.create({ userId, logDate: today, foodDescription, calories, mealType });
    return this.foodRepo.save(entry);
  }

  async getTodayLogs(userId: string): Promise<FoodLog[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.foodRepo.find({
      where: { userId, logDate: today },
      order: { createdAt: 'ASC' },
    });
  }

  async getStatus(userId: string): Promise<CalorieStatus | null> {
    const profile = await this.getProfile(userId);
    if (!profile) return null;
    const logs = await this.getTodayLogs(userId);
    const consumed = logs.reduce((sum, l) => sum + l.calories, 0);
    return {
      target: profile.dailyCalorieTarget,
      consumed,
      remaining: profile.dailyCalorieTarget - consumed,
      meals: logs.map(l => ({ mealType: l.mealType, description: l.foodDescription, calories: l.calories })),
    };
  }

  // ── Diet Advice ─────────────────────────────────────────────────────

  async getDietAdvice(userId: string): Promise<string> {
    const profile = await this.getProfile(userId);
    if (!profile) return "Please set up your calorie profile first! Say *\"I want to track calories\"*.";
    const status = await this.getStatus(userId);

    let advice = `📊 *Your Daily Summary*\n`;
    advice += `Target: *${status.target} kcal*\n`;
    advice += `Consumed: *${status.consumed} kcal*\n`;
    advice += `Remaining: *${status.remaining} kcal*\n\n`;

    if (profile.goal === 'lose') {
      advice += `🎯 *Weight Loss Tips:*\n`;
      advice += `• Prioritise protein (lean meat, eggs, dal) to stay full\n`;
      advice += `• Include fibre-rich veggies in every meal\n`;
      advice += `• Cut sugary drinks and processed snacks\n`;
      advice += `• Drink 2-3L water — thirst is often mistaken for hunger\n`;
      advice += `• Try 16:8 intermittent fasting if it fits your routine\n`;
    } else if (profile.goal === 'gain') {
      advice += `💪 *Weight Gain Tips:*\n`;
      advice += `• Eat calorie-dense foods: nuts, peanut butter, bananas, rice\n`;
      advice += `• Add healthy fats — ghee, olive oil, avocado\n`;
      advice += `• Have 5-6 smaller meals instead of 3 large ones\n`;
      advice += `• Include strength training to convert calories to muscle\n`;
    } else {
      advice += `⚖️ *Maintenance Tips:*\n`;
      advice += `• Keep a balanced plate: ¼ protein, ¼ carbs, ½ veggies\n`;
      advice += `• Stick to whole foods — minimise processed items\n`;
      advice += `• Stay consistent with meal timings\n`;
    }

    if (status.remaining < 0) {
      advice += `\n⚠️ You've exceeded your calorie target by ${Math.abs(status.remaining)} kcal. Consider a light walk or extra workout today.`;
    } else if (status.remaining < 200) {
      advice += `\n👍 You're on track! Stick to light meals for the rest of the day.`;
    } else {
      advice += `\n✅ You have ${status.remaining} kcal left. Plan a balanced meal to stay within target.`;
    }

    return advice;
  }
}
