import { Test, TestingModule } from '@nestjs/testing';
import { CouponService } from './coupon.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Coupon } from '../entities/coupon.entity';
import { User } from '../entities/user.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('CouponService', () => {
  let service: CouponService;
  let couponRepo: any;
  let userRepo: any;

  const mockCouponRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockUserRepo = {
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponService,
        { provide: getRepositoryToken(Coupon), useValue: mockCouponRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<CouponService>(CouponService);
    couponRepo = module.get(getRepositoryToken(Coupon));
    userRepo = module.get(getRepositoryToken(User));
  });

  describe('createCoupon', () => {
    it('creates a new coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue(null);
      mockCouponRepo.create.mockReturnValue({ code: 'SAVE50' });
      mockCouponRepo.save.mockResolvedValue({ code: 'SAVE50', planId: 'assistant', durationDays: 30 });

      const result = await service.createCoupon({
        code: 'save50',
        planId: 'assistant',
        durationDays: 30,
      });

      expect(result.code).toBe('SAVE50');
      expect(mockCouponRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SAVE50', planId: 'assistant' })
      );
    });

    it('throws if coupon code already exists', async () => {
      mockCouponRepo.findOne.mockResolvedValue({ id: '1', code: 'SAVE50' });

      await expect(
        service.createCoupon({ code: 'save50', planId: 'assistant', durationDays: 30 })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateCoupon', () => {
    it('returns valid for active coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue({
        active: true,
        expiresAt: new Date(Date.now() + 86400000),
        usedCount: 0,
        maxUses: 10,
      });

      const result = await service.validateCoupon('SAVE50');
      expect(result.valid).toBe(true);
    });

    it('returns invalid for non-existent code', async () => {
      mockCouponRepo.findOne.mockResolvedValue(null);
      const result = await service.validateCoupon('INVALID');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('returns invalid for deactivated coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue({ active: false });
      const result = await service.validateCoupon('SAVE50');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('deactivated');
    });

    it('returns invalid for expired coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue({
        active: true,
        expiresAt: new Date(Date.now() - 86400000),
        usedCount: 0,
        maxUses: 10,
      });

      const result = await service.validateCoupon('SAVE50');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('returns invalid when usage limit reached', async () => {
      mockCouponRepo.findOne.mockResolvedValue({
        active: true,
        expiresAt: new Date(Date.now() + 86400000),
        usedCount: 10,
        maxUses: 10,
      });

      const result = await service.validateCoupon('SAVE50');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('usage limit');
    });
  });

  describe('applyCoupon', () => {
    it('applies valid coupon to user', async () => {
      const coupon = {
        active: true,
        expiresAt: new Date(Date.now() + 86400000),
        usedCount: 0,
        maxUses: 10,
        code: 'SAVE50',
        planId: 'assistant',
        durationDays: 30,
        id: 'c1',
      };
      mockCouponRepo.findOne.mockResolvedValue(coupon);
      mockUserRepo.update.mockResolvedValue({});
      mockCouponRepo.update.mockResolvedValue({});

      const result = await service.applyCoupon('SAVE50', 'user1');
      expect(result.success).toBe(true);
      expect(result.planId).toBe('assistant');
      expect(mockUserRepo.update).toHaveBeenCalled();
      expect(mockCouponRepo.update).toHaveBeenCalledWith('c1', { usedCount: 1 });
    });

    it('returns failure for invalid coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue(null);
      const result = await service.applyCoupon('INVALID', 'user1');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listCoupons', () => {
    it('returns all coupons ordered by creation date', async () => {
      const coupons = [{ code: 'SAVE50' }, { code: 'SUMMER30' }];
      mockCouponRepo.find.mockResolvedValue(coupons);

      const result = await service.listCoupons();
      expect(result).toEqual(coupons);
      expect(mockCouponRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });
  });

  describe('deactivateCoupon', () => {
    it('deactivates an existing coupon', async () => {
      const coupon = { id: 'c1', active: true };
      mockCouponRepo.findOne.mockResolvedValue(coupon);
      mockCouponRepo.save.mockResolvedValue({ ...coupon, active: false });

      const result = await service.deactivateCoupon('c1');
      expect(result.active).toBe(false);
    });

    it('throws for non-existent coupon', async () => {
      mockCouponRepo.findOne.mockResolvedValue(null);
      await expect(service.deactivateCoupon('c1')).rejects.toThrow(NotFoundException);
    });
  });
});
