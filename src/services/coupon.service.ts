import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from '../entities/coupon.entity';
import { User } from '../entities/user.entity';
import { PlanType } from '../entities/user.entity';

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async createCoupon(data: {
    code: string;
    planId: PlanType;
    durationDays: number;
    maxUses?: number;
    expiresAt?: Date;
    description?: string;
  }): Promise<Coupon> {
    const existing = await this.couponRepository.findOne({ where: { code: data.code.toUpperCase() } });
    if (existing) {
      throw new BadRequestException(`Coupon code "${data.code}" already exists`);
    }

    const coupon = this.couponRepository.create({
      code: data.code.toUpperCase(),
      planId: data.planId,
      durationDays: data.durationDays,
      maxUses: data.maxUses || 1,
      expiresAt: data.expiresAt,
      description: data.description || '',
      active: true,
      usedCount: 0,
    });

    return this.couponRepository.save(coupon);
  }

  async validateCoupon(code: string): Promise<{
    valid: boolean;
    coupon?: Coupon;
    error?: string;
  }> {
    const coupon = await this.couponRepository.findOne({ where: { code: code.toUpperCase() } });
    if (!coupon) {
      return { valid: false, error: 'Invalid coupon code' };
    }
    if (!coupon.active) {
      return { valid: false, error: 'This coupon has been deactivated' };
    }
    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return { valid: false, error: 'This coupon has expired' };
    }
    if (coupon.usedCount >= coupon.maxUses) {
      return { valid: false, error: 'This coupon has reached its usage limit' };
    }
    return { valid: true, coupon };
  }

  async applyCoupon(code: string, userId: string): Promise<{
    success: boolean;
    planId?: string;
    expiresAt?: Date;
    error?: string;
  }> {
    const validation = await this.validateCoupon(code);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const coupon = validation.coupon;

    const expiresAt = new Date(Date.now() + coupon.durationDays * 24 * 60 * 60 * 1000);

    await this.userRepository.update(userId, {
      plan: coupon.planId as PlanType,
      isPremium: true,
      planExpiresAt: expiresAt,
      appliedCoupon: coupon.code,
      couponExpiresAt: expiresAt,
    });

    await this.couponRepository.update(coupon.id, {
      usedCount: coupon.usedCount + 1,
    });

    this.logger.log(`Coupon applied: user=${userId} code=${coupon.code} plan=${coupon.planId} expires=${expiresAt.toISOString()}`);

    return {
      success: true,
      planId: coupon.planId,
      expiresAt,
    };
  }

  async listCoupons(): Promise<Coupon[]> {
    return this.couponRepository.find({ order: { createdAt: 'DESC' } });
  }

  async deactivateCoupon(id: string): Promise<Coupon> {
    const coupon = await this.couponRepository.findOne({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    coupon.active = false;
    return this.couponRepository.save(coupon);
  }
}
