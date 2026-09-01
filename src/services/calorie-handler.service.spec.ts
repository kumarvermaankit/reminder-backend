import { Test, TestingModule } from '@nestjs/testing';
import { CalorieHandlerService } from './calorie-handler.service';
import { CalorieService } from './calorie.service';
import { UserContextService } from './user-context.service';
import { estimateCalories } from '../utils/calorie-estimator';

jest.mock('../utils/calorie-estimator');

describe('CalorieHandlerService', () => {
  let service: CalorieHandlerService;
  let calorieService: any;
  let userContextService: any;

  const mockCalorieService = {
    getProfile: jest.fn(),
    saveProfile: jest.fn(),
    calculateBMR: jest.fn(),
    calculateTDEE: jest.fn(),
    calculateDailyTarget: jest.fn(),
    logFood: jest.fn(),
    getStatus: jest.fn(),
    getDietAdvice: jest.fn(),
  };

  const mockUserContextService = {
    setCalorieWorkflow: jest.fn(),
    clearCalorieWorkflow: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (estimateCalories as jest.Mock).mockReturnValue(250);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalorieHandlerService,
        { provide: CalorieService, useValue: mockCalorieService },
        { provide: UserContextService, useValue: mockUserContextService },
      ],
    }).compile();

    service = module.get<CalorieHandlerService>(CalorieHandlerService);
    calorieService = module.get(CalorieService);
    userContextService = module.get(UserContextService);
  });

  describe('handleSetup', () => {
    it('should start setup for new user', async () => {
      mockCalorieService.getProfile.mockResolvedValue(null);
      const result = await service.handleSetup({}, { id: 'user-1' });
      expect(result).toContain('calorie tracker');
      expect(userContextService.setCalorieWorkflow).toHaveBeenCalledWith('user-1', {
        state: 'awaiting_weight',
        collected: {},
      });
    });

    it('should warn existing user before overwriting', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1', userId: 'user-1' });
      const result = await service.handleSetup({}, { id: 'user-1' });
      expect(result).toContain('already have a calorie profile');
      expect(result).toContain('overwrite');
    });
  });

  describe('handleWorkflowStep - awaiting_weight', () => {
    it('should accept valid weight', async () => {
      const wf = { state: 'awaiting_weight', collected: {} };
      const result = await service.handleWorkflowStep('phone', 'user-1', '70', wf);
      expect(result).toContain('height');
      expect(userContextService.setCalorieWorkflow).toHaveBeenCalledWith('user-1', {
        state: 'awaiting_height',
        collected: { weight: 70 },
      });
    });

    it('should reject weight below 20', async () => {
      const wf = { state: 'awaiting_weight', collected: {} };
      const result = await service.handleWorkflowStep('phone', 'user-1', '15', wf);
      expect(result).toContain('valid weight');
    });

    it('should reject weight above 400', async () => {
      const wf = { state: 'awaiting_weight', collected: {} };
      const result = await service.handleWorkflowStep('phone', 'user-1', '500', wf);
      expect(result).toContain('valid weight');
    });

    it('should reject non-numeric weight', async () => {
      const wf = { state: 'awaiting_weight', collected: {} };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'abc', wf);
      expect(result).toContain('valid weight');
    });
  });

  describe('handleWorkflowStep - awaiting_height', () => {
    it('should accept valid height', async () => {
      const wf = { state: 'awaiting_height', collected: { weight: 70 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', '175', wf);
      expect(result).toContain('age');
      expect(userContextService.setCalorieWorkflow).toHaveBeenCalledWith('user-1', {
        state: 'awaiting_age',
        collected: { weight: 70, height: 175 },
      });
    });

    it('should reject height below 50', async () => {
      const wf = { state: 'awaiting_height', collected: { weight: 70 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', '40', wf);
      expect(result).toContain('valid height');
    });
  });

  describe('handleWorkflowStep - awaiting_age', () => {
    it('should accept valid age', async () => {
      const wf = { state: 'awaiting_age', collected: { weight: 70, height: 175 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', '25', wf);
      expect(result).toContain('gender');
    });

    it('should reject age below 10', async () => {
      const wf = { state: 'awaiting_age', collected: { weight: 70, height: 175 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', '5', wf);
      expect(result).toContain('valid age');
    });
  });

  describe('handleWorkflowStep - awaiting_gender', () => {
    it('should accept male', async () => {
      const wf = { state: 'awaiting_gender', collected: { weight: 70, height: 175, age: 25 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'male', wf);
      expect(result).toContain('activity level');
    });

    it('should accept female', async () => {
      const wf = { state: 'awaiting_gender', collected: { weight: 70, height: 175, age: 25 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'female', wf);
      expect(result).toContain('activity level');
    });

    it('should reject other values', async () => {
      const wf = { state: 'awaiting_gender', collected: { weight: 70, height: 175, age: 25 } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'other', wf);
      expect(result).toContain('"male" or "female"');
    });
  });

  describe('handleWorkflowStep - awaiting_activity_level', () => {
    it('should accept valid levels', async () => {
      for (const level of ['sedentary', 'light', 'moderate', 'active', 'very_active']) {
        const wf = { state: 'awaiting_activity_level', collected: { weight: 70, height: 175, age: 25, gender: 'male' } };
        const result = await service.handleWorkflowStep('phone', 'user-1', level, wf);
        expect(result).toContain('goal');
      }
    });

    it('should accept space-separated level (converts to underscore)', async () => {
      const wf = { state: 'awaiting_activity_level', collected: { weight: 70, height: 175, age: 25, gender: 'male' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'very active', wf);
      expect(result).toContain('goal');
    });

    it('should reject invalid level', async () => {
      const wf = { state: 'awaiting_activity_level', collected: { weight: 70, height: 175, age: 25, gender: 'male' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'super active', wf);
      expect(result).toContain('sedentary, light, moderate, active, very_active');
    });
  });

  describe('handleWorkflowStep - awaiting_goal', () => {
    it('should accept lose goal', async () => {
      const wf = { state: 'awaiting_goal', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'lose', wf);
      expect(result).toContain('target weight');
    });

    it('should accept gain goal', async () => {
      const wf = { state: 'awaiting_goal', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'gain', wf);
      expect(result).toContain('target weight');
    });

    it('should finish setup immediately for maintain goal', async () => {
      const wf = { state: 'awaiting_goal', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate' } };
      calorieService.calculateBMR.mockReturnValue(1673);
      calorieService.calculateTDEE.mockReturnValue(2594);
      calorieService.calculateDailyTarget.mockReturnValue(2594);
      mockCalorieService.saveProfile.mockResolvedValue({});

      const result = await service.handleWorkflowStep('phone', 'user-1', 'maintain', wf);
      expect(result).toContain('Calorie Profile Complete');
      expect(calorieService.saveProfile).toHaveBeenCalled();
    });

    it('should reject invalid goal', async () => {
      const wf = { state: 'awaiting_goal', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'maintain weight', wf);
      expect(result).toContain('"lose", "gain", or "maintain"');
    });
  });

  describe('handleWorkflowStep - awaiting_target_weight', () => {
    it('should accept valid target weight and finish', async () => {
      const wf = { state: 'awaiting_target_weight', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate', goal: 'lose' } };
      calorieService.calculateBMR.mockReturnValue(1673);
      calorieService.calculateTDEE.mockReturnValue(2594);
      calorieService.calculateDailyTarget.mockReturnValue(2094);
      mockCalorieService.saveProfile.mockResolvedValue({});

      const result = await service.handleWorkflowStep('phone', 'user-1', '65', wf);
      expect(result).toContain('Calorie Profile Complete');
      expect(calorieService.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        targetWeight: 65,
      }));
    });

    it('should reject invalid target weight', async () => {
      const wf = { state: 'awaiting_target_weight', collected: { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate', goal: 'lose' } };
      const result = await service.handleWorkflowStep('phone', 'user-1', 'abc', wf);
      expect(result).toContain('valid target weight');
    });
  });

  describe('finishSetup', () => {
    it('should save profile and return summary', async () => {
      calorieService.calculateBMR.mockReturnValue(1673);
      calorieService.calculateTDEE.mockReturnValue(2594);
      calorieService.calculateDailyTarget.mockReturnValue(2094);
      mockCalorieService.saveProfile.mockResolvedValue({});

      const collected = { weight: 70, height: 175, age: 25, gender: 'male', activityLevel: 'moderate', goal: 'lose', targetWeight: 65 };
      const result = await service.finishSetup('phone', 'user-1', collected);

      expect(result).toContain('Calorie Profile Complete');
      expect(result).toContain('BMR: *1673*');
      expect(result).toContain('TDEE: *2594*');
      expect(result).toContain('Daily Target: *2094*');
      expect(result).toContain('Weight Loss');
      expect(result).toContain('→ 65 kg');
      expect(userContextService.clearCalorieWorkflow).toHaveBeenCalledWith('user-1');
    });
  });

  describe('handleLogFood', () => {
    it('should require profile setup', async () => {
      mockCalorieService.getProfile.mockResolvedValue(null);
      const result = await service.handleLogFood({}, { id: 'user-1' });
      expect(result).toContain('set up your calorie profile');
    });

    it('should require food description', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      const result = await service.handleLogFood({}, { id: 'user-1' });
      expect(result).toContain('What did you eat');
    });

    it('should use provided calories', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 500, remaining: 1500, meals: [] });

      const result = await service.handleLogFood({ foodDescription: 'chicken sandwich', calories: 400 }, { id: 'user-1' });
      expect(result).toContain('400 kcal');
      expect(estimateCalories).not.toHaveBeenCalled();
    });

    it('should estimate calories when not provided', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 250, remaining: 1750, meals: [] });
      (estimateCalories as jest.Mock).mockReturnValue(250);

      const result = await service.handleLogFood({ foodDescription: 'chicken sandwich' }, { id: 'user-1' });
      expect(result).toContain('250 kcal');
      expect(estimateCalories).toHaveBeenCalledWith('chicken sandwich');
    });

    it('should handle 0 calories from parser (explicit zero)', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 0, remaining: 2000, meals: [] });

      const result = await service.handleLogFood({ foodDescription: 'nothing', calories: 0 }, { id: 'user-1' });
      expect(result).toContain('0 kcal');
      expect(estimateCalories).not.toHaveBeenCalled();
    });

    it('should show warning when over target', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 2200, remaining: -200, meals: [] });

      const result = await service.handleLogFood({ foodDescription: 'pizza', calories: 600 }, { id: 'user-1' });
      expect(result).toContain('⚠️');
    });

    it('should show success when under target', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 500, remaining: 1500, meals: [] });

      const result = await service.handleLogFood({ foodDescription: 'tea', calories: 50 }, { id: 'user-1' });
      expect(result).toContain('✅');
    });

    it('should use title as fallback for foodDescription', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1' });
      mockCalorieService.logFood.mockResolvedValue({});
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 0, remaining: 2000, meals: [] });

      await service.handleLogFood({ title: 'chicken sandwich' }, { id: 'user-1' });
      expect(estimateCalories).toHaveBeenCalledWith('chicken sandwich');
    });
  });

  describe('handleStatus', () => {
    it('should require profile setup', async () => {
      mockCalorieService.getProfile.mockResolvedValue(null);
      const result = await service.handleStatus({ id: 'user-1' });
      expect(result).toContain('set up your calorie profile');
    });

    it('should show empty status when no meals', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1', dailyCalorieTarget: 2000 });
      mockCalorieService.getStatus.mockResolvedValue({ target: 2000, consumed: 0, remaining: 2000, meals: [] });

      const result = await service.handleStatus({ id: 'user-1' });
      expect(result).toContain("haven't logged any food");
    });

    it('should show meals list with types', async () => {
      mockCalorieService.getProfile.mockResolvedValue({ id: '1', dailyCalorieTarget: 2000 });
      mockCalorieService.getStatus.mockResolvedValue({
        target: 2000,
        consumed: 460,
        remaining: 1540,
        meals: [
          { mealType: 'breakfast', description: 'idli', calories: 160 },
          { mealType: 'lunch', description: 'rice dal', calories: 300 },
        ],
      });

      const result = await service.handleStatus({ id: 'user-1' });
      expect(result).toContain('*breakfast*');
      expect(result).toContain('*lunch*');
      expect(result).toContain('*460*');
      expect(result).toContain('*2000*');
    });
  });

  describe('handleDietAdvice', () => {
    it('should delegate to calorieService', async () => {
      mockCalorieService.getDietAdvice.mockResolvedValue('advice text');
      const result = await service.handleDietAdvice({ id: 'user-1' });
      expect(result).toBe('advice text');
      expect(mockCalorieService.getDietAdvice).toHaveBeenCalledWith('user-1');
    });
  });
});
