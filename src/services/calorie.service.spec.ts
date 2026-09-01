import { Test, TestingModule } from '@nestjs/testing';
import { CalorieService } from './calorie.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CalorieProfile } from '../entities/calorie-profile.entity';
import { FoodLog } from '../entities/food-log.entity';

describe('CalorieService', () => {
  let service: CalorieService;
  let profileRepo: any;
  let foodRepo: any;

  const mockProfileRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const mockFoodRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalorieService,
        { provide: getRepositoryToken(CalorieProfile), useValue: mockProfileRepo },
        { provide: getRepositoryToken(FoodLog), useValue: mockFoodRepo },
      ],
    }).compile();

    service = module.get<CalorieService>(CalorieService);
    profileRepo = module.get(getRepositoryToken(CalorieProfile));
    foodRepo = module.get(getRepositoryToken(FoodLog));
  });

  describe('calculateBMR', () => {
    it('should calculate male BMR using Mifflin-St Jeor', () => {
      // 70kg, 175cm, 25yo male: 10*70 + 6.25*175 - 5*25 + 5 = 1673.75
      const bmr = service.calculateBMR(70, 175, 25, 'male');
      expect(bmr).toBe(1673.75);
    });

    it('should calculate female BMR using Mifflin-St Jeor', () => {
      // 60kg, 165cm, 30yo female: 10*60 + 6.25*165 - 5*30 - 161 = 1320.25
      const bmr = service.calculateBMR(60, 165, 30, 'female');
      expect(bmr).toBe(1320.25);
    });

    it('should handle uppercase gender', () => {
      const bmrMale = service.calculateBMR(70, 175, 25, 'MALE');
      const bmrFemale = service.calculateBMR(70, 175, 25, 'FEMALE');
      expect(bmrMale).toBe(1673.75);
      expect(bmrFemale).toBe(1507.75);
    });
  });

  describe('calculateTDEE', () => {
    it('should apply sedentary multiplier (1.2)', () => {
      const tdee = service.calculateTDEE(1673.75, 'sedentary');
      expect(tdee).toBe(2009); // 1673.75 * 1.2 = 2008.5 -> rounded
    });

    it('should apply light activity multiplier (1.375)', () => {
      const tdee = service.calculateTDEE(1673.75, 'light');
      expect(tdee).toBe(2301); // 1673.75 * 1.375 = 2301.41 -> rounded
    });

    it('should apply moderate multiplier (1.55)', () => {
      const tdee = service.calculateTDEE(1673.75, 'moderate');
      expect(tdee).toBe(2594); // 1673.75 * 1.55 = 2594.31 -> rounded
    });

    it('should apply active multiplier (1.725)', () => {
      const tdee = service.calculateTDEE(1673.75, 'active');
      expect(tdee).toBe(2887); // 1673.75 * 1.725 = 2887.22 -> rounded
    });

    it('should apply very_active multiplier (1.9)', () => {
      const tdee = service.calculateTDEE(1673.75, 'very_active');
      expect(tdee).toBe(3180); // 1673.75 * 1.9 = 3180.13 -> rounded
    });

    it('should default to sedentary for unknown level', () => {
      const tdee = service.calculateTDEE(1673.75, 'unknown');
      expect(tdee).toBe(2009); // Same as sedentary
    });
  });

  describe('calculateDailyTarget', () => {
    it('should subtract 500 for lose goal', () => {
      expect(service.calculateDailyTarget(2000, 'lose')).toBe(1500);
    });

    it('should add 500 for gain goal', () => {
      expect(service.calculateDailyTarget(2000, 'gain')).toBe(2500);
    });

    it('should return TDEE for maintain goal', () => {
      expect(service.calculateDailyTarget(2000, 'maintain')).toBe(2000);
    });
  });

  describe('getProfile', () => {
    it('should return profile if found', async () => {
      const profile = { id: '1', userId: 'user-1', weight: 70 };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      const result = await service.getProfile('user-1');
      expect(result).toEqual(profile);
      expect(mockProfileRepo.findOne).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('should return null if not found', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const result = await service.getProfile('user-999');
      expect(result).toBeNull();
    });
  });

  describe('saveProfile', () => {
    it('should create new profile if none exists', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const data = { userId: 'user-1', weight: 70, height: 175, age: 25, gender: 'male' };
      mockProfileRepo.save.mockResolvedValue({ id: '1', ...data });

      const result = await service.saveProfile(data);
      expect(mockProfileRepo.save).toHaveBeenCalledWith(data);
      expect(mockProfileRepo.update).not.toHaveBeenCalled();
    });

    it('should update existing profile', async () => {
      const existing = { id: '1', userId: 'user-1', weight: 75 };
      mockProfileRepo.findOne.mockResolvedValue(existing);
      mockProfileRepo.update.mockResolvedValue({});
      mockProfileRepo.findOne.mockResolvedValue({ ...existing, weight: 70 });

      const data = { userId: 'user-1', weight: 70 };
      await service.saveProfile(data);
      expect(mockProfileRepo.update).toHaveBeenCalledWith('1', data);
    });
  });

  describe('logFood', () => {
    it('should save food log entry', async () => {
      const entry = { id: '1', userId: 'user-1', foodDescription: 'rice', calories: 200, logDate: '2026-08-31' };
      mockFoodRepo.create.mockReturnValue(entry);
      mockFoodRepo.save.mockResolvedValue(entry);

      const result = await service.logFood('user-1', 'rice', 200, 'lunch');
      expect(mockFoodRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        foodDescription: 'rice',
        calories: 200,
        mealType: 'lunch',
      }));
      expect(result).toEqual(entry);
    });

    it('should work without mealType', async () => {
      mockFoodRepo.create.mockReturnValue({});
      mockFoodRepo.save.mockResolvedValue({});

      await service.logFood('user-1', 'tea', 50);
      expect(mockFoodRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        mealType: undefined,
      }));
    });
  });

  describe('getTodayLogs', () => {
    it('should return today logs ordered by createdAt ASC', async () => {
      const logs = [
        { id: '1', foodDescription: 'rice', calories: 200 },
        { id: '2', foodDescription: 'dal', calories: 150 },
      ];
      mockFoodRepo.find.mockResolvedValue(logs);

      const result = await service.getTodayLogs('user-1');
      expect(mockFoodRepo.find).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
        order: { createdAt: 'ASC' },
      }));
      expect(result).toEqual(logs);
    });
  });

  describe('getStatus', () => {
    it('should return null if no profile', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const result = await service.getStatus('user-999');
      expect(result).toBeNull();
    });

    it('should calculate consumed and remaining', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 2000 };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([
        { mealType: 'breakfast', foodDescription: 'idli', calories: 160 },
        { mealType: 'lunch', foodDescription: 'rice', calories: 300 },
      ]);

      const result = await service.getStatus('user-1');
      expect(result.target).toBe(2000);
      expect(result.consumed).toBe(460);
      expect(result.remaining).toBe(1540);
      expect(result.meals).toHaveLength(2);
    });

    it('should handle zero consumed', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 2000 };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([]);

      const result = await service.getStatus('user-1');
      expect(result.consumed).toBe(0);
      expect(result.remaining).toBe(2000);
      expect(result.meals).toHaveLength(0);
    });
  });

  describe('getDietAdvice', () => {
    it('should return setup message if no profile', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);
      const result = await service.getDietAdvice('user-999');
      expect(result).toContain('set up your calorie profile');
    });

    it('should return weight loss tips for lose goal', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 1500, goal: 'lose' };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([]);

      const result = await service.getDietAdvice('user-1');
      expect(result).toContain('Weight Loss Tips');
      expect(result).toContain('protein');
    });

    it('should return weight gain tips for gain goal', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 2500, goal: 'gain' };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([]);

      const result = await service.getDietAdvice('user-1');
      expect(result).toContain('Weight Gain Tips');
    });

    it('should return maintenance tips for maintain goal', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 2000, goal: 'maintain' };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([]);

      const result = await service.getDietAdvice('user-1');
      expect(result).toContain('Maintenance Tips');
    });

    it('should warn when over target', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 1500, goal: 'lose' };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([
        { mealType: 'lunch', foodDescription: 'biryani', calories: 800 },
        { mealType: 'dinner', foodDescription: 'pizza', calories: 900 },
      ]);

      const result = await service.getDietAdvice('user-1');
      expect(result).toContain('exceeded your calorie target');
    });

    it('should encourage when close to target', async () => {
      const profile = { id: '1', userId: 'user-1', dailyCalorieTarget: 2000, goal: 'maintain' };
      mockProfileRepo.findOne.mockResolvedValue(profile);
      mockFoodRepo.find.mockResolvedValue([
        { mealType: 'lunch', foodDescription: 'rice', calories: 1900 },
      ]);

      const result = await service.getDietAdvice('user-1');
      expect(result).toContain('on track');
    });
  });
});
