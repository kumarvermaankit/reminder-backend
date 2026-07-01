import { Injectable, Logger } from '@nestjs/common';
import { CalorieService } from './calorie.service';
import { UserContextService } from './user-context.service';
import { estimateCalories } from '../utils/calorie-estimator';

type CalState = 'awaiting_weight' | 'awaiting_height' | 'awaiting_age' | 'awaiting_gender' | 'awaiting_activity_level' | 'awaiting_goal' | 'awaiting_target_weight' | 'complete';

@Injectable()
export class CalorieHandlerService {
  private readonly logger = new Logger(CalorieHandlerService.name);

  constructor(
    private readonly calorieService: CalorieService,
    private readonly userContextService: UserContextService,
  ) {}

  async handleWorkflowStep(userPhone: string, userId: string, message: string, wf: any): Promise<string | null> {
    const next = async (state: CalState, collected: any) => {
      await this.userContextService.setCalorieWorkflow(userId, { state, collected });
    };

    const collected = { ...wf.collected };
    const trimmed = message.trim();

    switch (wf.state) {
      case 'awaiting_weight': {
        const w = parseFloat(trimmed);
        if (isNaN(w) || w < 20 || w > 400) return 'Please enter a valid weight in kg (e.g. "70").';
        collected.weight = w;
        await next('awaiting_height', collected);
        return 'Great! Now what is your height in cm? (e.g. "175")';
      }
      case 'awaiting_height': {
        const h = parseFloat(trimmed);
        if (isNaN(h) || h < 50 || h > 300) return 'Please enter a valid height in cm (e.g. "175").';
        collected.height = h;
        await next('awaiting_age', collected);
        return 'Thanks! What is your age? (e.g. "25")';
      }
      case 'awaiting_age': {
        const a = parseInt(trimmed, 10);
        if (isNaN(a) || a < 10 || a > 120) return 'Please enter a valid age (e.g. "25").';
        collected.age = a;
        await next('awaiting_gender', collected);
        return 'Got it! What is your gender? (male / female)';
      }
      case 'awaiting_gender': {
        const g = trimmed.toLowerCase();
        if (!['male', 'female'].includes(g)) return 'Please enter "male" or "female".';
        collected.gender = g;
        await next('awaiting_activity_level', collected);
        return 'What is your activity level?\n\n• *sedentary* — desk job, little exercise\n• *light* — light exercise 1-3 days/week\n• *moderate* — moderate exercise 3-5 days/week\n• *active* — hard exercise 6-7 days/week\n• *very_active* — intense daily exercise / physical job';
      }
      case 'awaiting_activity_level': {
        const validLevels = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
        const al = trimmed.toLowerCase().replace(/\s/g, '_');
        if (!validLevels.includes(al)) return 'Please enter one of: sedentary, light, moderate, active, very_active.';
        collected.activityLevel = al;
        await next('awaiting_goal', collected);
        return 'What is your goal?\n\n• *lose* — lose weight\n• *gain* — gain weight\n• *maintain* — maintain current weight';
      }
      case 'awaiting_goal': {
        const validGoals = ['lose', 'gain', 'maintain'];
        const gl = trimmed.toLowerCase();
        if (!validGoals.includes(gl)) return 'Please enter "lose", "gain", or "maintain".';
        collected.goal = gl;
        if (gl === 'maintain') {
          return this.finishSetup(userPhone, userId, collected);
        }
        await next('awaiting_target_weight', collected);
        return 'What is your target weight in kg? (e.g. "65")';
      }
      case 'awaiting_target_weight': {
        const tw = parseFloat(trimmed);
        if (isNaN(tw) || tw < 20 || tw > 400) return 'Please enter a valid target weight in kg (e.g. "65").';
        collected.targetWeight = tw;
        return this.finishSetup(userPhone, userId, collected);
      }
      default:
        return null;
    }
  }

  async finishSetup(userPhone: string, userId: string, collected: any): Promise<string> {
    await this.userContextService.clearCalorieWorkflow(userId);
    const bmr = this.calorieService.calculateBMR(collected.weight, collected.height, collected.age, collected.gender);
    const tdee = this.calorieService.calculateTDEE(bmr, collected.activityLevel);
    const target = this.calorieService.calculateDailyTarget(tdee, collected.goal, collected.targetWeight);

    await this.calorieService.saveProfile({
      userId,
      weight: collected.weight,
      height: collected.height,
      age: collected.age,
      gender: collected.gender,
      activityLevel: collected.activityLevel,
      goal: collected.goal,
      targetWeight: collected.targetWeight,
      dailyCalorieTarget: target,
    });

    const goalText = collected.goal === 'lose' ? '📉 Weight Loss' : collected.goal === 'gain' ? '📈 Weight Gain' : '⚖️ Maintain Weight';
    const targetDetail = collected.targetWeight ? ` → ${collected.targetWeight} kg` : '';

    return `✅ *Calorie Profile Complete!*\n\n` +
      `${goalText}${targetDetail}\n` +
      `⚡ BMR: *${bmr}* kcal/day\n` +
      `🏃 TDEE: *${tdee}* kcal/day\n` +
      `🎯 Daily Target: *${target}* kcal\n\n` +
      `Now you can:\n` +
      `• Log food: *"I ate a chicken sandwich for lunch"*\n` +
      `• Check status: *"my calories today"*\n` +
      `• Get advice: *"diet advice"*`;
  }

  async handleSetup(parsed: any, user: any): Promise<string> {
    const existing = await this.calorieService.getProfile(user.id);
    if (existing) {
      await this.userContextService.setCalorieWorkflow(user.id, {
        state: 'awaiting_weight',
        collected: {},
      });
    } else {
      await this.userContextService.setCalorieWorkflow(user.id, {
        state: 'awaiting_weight',
        collected: {},
      });
    }
    return "Let's set up your calorie tracker! 🥗\n\nWhat is your weight in kg? (e.g. \"70\")";
  }

  async handleLogFood(parsed: any, user: any): Promise<string> {
    const profile = await this.calorieService.getProfile(user.id);
    if (!profile) {
      return "Please set up your calorie profile first! Say *\"I want to track calories\"*.";
    }
    const foodDesc = parsed.foodDescription || parsed.title || '';
    if (!foodDesc) return "What did you eat? Tell me like *\"I ate a chicken sandwich for lunch\"*.";
    const mealType = parsed.mealType || '';
    let calories = parsed.calories;
    if (!calories) {
      calories = estimateCalories(foodDesc);
    }
    await this.calorieService.logFood(user.id, foodDesc, calories, mealType);
    const status = await this.calorieService.getStatus(user.id);
    const remaining = status.remaining;
    const emoji = remaining < 0 ? '⚠️' : '✅';
    return `🍽️ Logged: *${foodDesc}* (${calories} kcal)\n${emoji} Remaining today: *${remaining}* kcal / ${status.target}`;
  }

  async handleStatus(user: any): Promise<string> {
    const profile = await this.calorieService.getProfile(user.id);
    if (!profile) {
      return "Please set up your calorie profile first! Say *\"I want to track calories\"*.";
    }
    const status = await this.calorieService.getStatus(user.id);
    if (!status || status.meals.length === 0) {
      return `📊 *Today's Calories*\n\nTarget: *${profile.dailyCalorieTarget}* kcal\nConsumed: *0* kcal\n\nYou haven't logged any food today. Tell me what you ate!`;
    }
    const meals = status.meals.map((m, i) =>
      `${i + 1}. ${m.mealType ? `*${m.mealType}* — ` : ''}${m.description} (${m.calories} kcal)`
    ).join('\n');
    const emoji = status.remaining < 0 ? '⚠️' : '✅';
    return `📊 *Today's Calories*\n\n${meals}\n\nTotal: *${status.consumed}* / *${status.target}* kcal\n${emoji} Remaining: *${status.remaining}* kcal`;
  }

  async handleDietAdvice(user: any): Promise<string> {
    return this.calorieService.getDietAdvice(user.id);
  }
}
