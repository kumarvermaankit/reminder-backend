import { Controller, Post, Get, Headers, Req, Logger, Body, Query } from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RazorpayPaymentService } from '../services/razorpay-payment.service';
import { PlanGuardService } from '../services/plan-guard.service';
import { CouponService } from '../services/coupon.service';
import { UserService } from '../services/user.service';
import { User } from '../entities/user.entity';
import { Payment } from '../entities/payment.entity';

@Controller('razorpay')
export class RazorpayController {
  private readonly logger = new Logger(RazorpayController.name);

  constructor(
    private readonly razorpayPaymentService: RazorpayPaymentService,
    private readonly planGuardService: PlanGuardService,
    private readonly couponService: CouponService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Get('plans')
  getPlans(@Query('country') country: string) {
    return this.razorpayPaymentService.getPlans(country || 'IN');
  }

  @Post('create-order')
  async createOrder(@Body() body: { planId: string; country?: string; userId?: string; interval?: 'monthly' | 'yearly' }) {
    const order = await this.razorpayPaymentService.createOrder(
      body.planId,
      body.country || 'IN',
      body.interval || 'monthly',
    );
    if (!order) {
      return { success: false, error: 'Failed to create order' };
    }
    return {
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: this.configService.get<string>('RAZORPAY_KEY_ID'),
      planId: body.planId,
      interval: body.interval || 'monthly',
    };
  }

  @Post('verify')
  async verifyPayment(@Body() body: {
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
    planId: string;
    interval?: 'monthly' | 'yearly';
    userId?: string;
  }) {
    const isValid = await this.razorpayPaymentService.verifyPayment(
      body.razorpayPaymentId,
      body.razorpayOrderId,
      body.razorpaySignature,
    );
    if (!isValid) {
      return { success: false, error: 'Payment verification failed' };
    }

    const plan = this.razorpayPaymentService.getPlanConfig(body.planId);
    if (!plan) {
      return { success: false, error: 'Invalid plan' };
    }

    if (body.userId) {
      const interval = body.interval || 'monthly';
      const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      await this.userService.updateUser(body.userId, {
        isPremium: true,
        plan: body.planId as any,
        planExpiresAt: expiresAt,
      });

      await this.paymentRepository.save({
        userId: body.userId,
        razorpayOrderId: body.razorpayOrderId,
        razorpayPaymentId: body.razorpayPaymentId,
        razorpaySignature: body.razorpaySignature,
        planId: body.planId,
        amount: 0,
        currency: 'INR',
        interval,
        status: 'captured',
      });
    }

    return { success: true };
  }

  @Post('payment-callback')
  async paymentCallback(@Body() body: {
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
    planId: string;
    userId?: string;
    interval?: 'monthly' | 'yearly';
    amount?: number;
    currency?: string;
  }) {
    const isValid = await this.razorpayPaymentService.verifyPayment(
      body.razorpayPaymentId,
      body.razorpayOrderId,
      body.razorpaySignature,
    );
    if (!isValid) {
      return { success: false, error: 'Payment verification failed' };
    }

    const plan = this.razorpayPaymentService.getPlanConfig(body.planId);
    if (!plan) {
      return { success: false, error: 'Invalid plan' };
    }

    if (body.userId) {
      const user = await this.userRepository.findOne({ where: { id: body.userId } });
      if (user) {
        const interval = body.interval || 'monthly';
        const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        await this.userRepository.update(body.userId, {
          isPremium: true,
          plan: body.planId as any,
          planExpiresAt: expiresAt,
        });

        await this.paymentRepository.save({
          userId: body.userId,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
          planId: body.planId,
          amount: body.amount || 0,
          currency: body.currency || 'INR',
          interval,
          status: 'captured',
        });

        this.logger.log(`Payment callback: user=${body.userId} plan=${body.planId} payment=${body.razorpayPaymentId}`);
      }
    }

    return { success: true };
  }

  // ── Customer endpoint ──

  @Post('create-customer')
  async createCustomer(@Body() body: { userId: string; name?: string; email?: string; contact?: string; country?: string }) {
    if (!body.userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (user.razorpayCustomerId) {
      return {
        success: true,
        customerId: user.razorpayCustomerId,
        existing: true,
      };
    }

    try {
      const name = body.name || user.name || 'User';
      const email = body.email || user.email || `user_${user.id.slice(0, 8)}@heyping.in`;
      const country = (body.country || user.country || 'IN').toUpperCase().slice(0, 2);
      const contact = this.normalizePhone(body.contact || user.phone || '', country);

      if (!contact || contact.length < 10) {
        return { success: false, error: 'Valid phone number with country code is required' };
      }

      const customer = await this.razorpayPaymentService.findOrCreateCustomer(name, contact, email, user.id);

      await this.userRepository.update(user.id, {
        razorpayCustomerId: customer.id,
        name,
        phone: contact,
        ...(body.email && { email: body.email }),
      } as any);

      this.logger.log(`Razorpay customer created: user=${user.id} customer=${customer.id}`);

      return {
        success: true,
        customerId: customer.id,
        name: customer.name,
        email: customer.email,
        contact: customer.contact || contact,
        existing: false,
      };
    } catch (error) {
      const detail = error?.error?.description || error?.message || error;
      this.logger.error(`Failed to create Razorpay customer: ${detail}`);
      return { success: false, error: `Failed to create customer: ${detail}` };
    }
  }

  // ── Subscription (autopay) endpoints ──

  /** Normalize to WhatsApp-style digits only (e.g. 918076569811). */
  private normalizePhone(phone: string, countryCode: string = 'IN'): string {
    let digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';

    // Strip leading 00 international prefix
    if (digits.startsWith('00')) digits = digits.slice(2);

    const dialCodes: Record<string, string> = {
      IN: '91', US: '1', GB: '44', UK: '44', AU: '61', CA: '1',
      DE: '49', FR: '33', SG: '65', AE: '971',
    };
    const dial = dialCodes[countryCode.toUpperCase()] || '91';

    // Local Indian mobile: 10 digits starting 6-9
    if (countryCode.toUpperCase() === 'IN' && /^[6-9]\d{9}$/.test(digits)) {
      return `${dial}${digits}`;
    }

    // Already has country code
    if (digits.startsWith(dial) && digits.length >= dial.length + 8) {
      return digits;
    }

    // US/CA 10-digit local
    if ((countryCode === 'US' || countryCode === 'CA') && digits.length === 10) {
      return `${dial}${digits}`;
    }

    // Fallback: if looks like local (too short for E.164), prepend dial
    if (digits.length <= 11 && !digits.startsWith(dial)) {
      return `${dial}${digits}`;
    }

    return digits;
  }

  private async findUserByPhoneVariants(phone: string): Promise<User | null> {
    if (!phone) return null;
    const variants = Array.from(new Set([
      phone,
      `+${phone}`,
      phone.startsWith('91') && phone.length === 12 ? phone.slice(2) : null,
    ].filter(Boolean))) as string[];

    for (const variant of variants) {
      const user = await this.userService.getUserByPhone(variant);
      if (user) return user;
    }
    return null;
  }

  private buildUserStatus(user: User, isNewUser = false) {
    const isOnTrial = this.planGuardService.isOnTrial(user);
    const hasUsedTrial = !!user.trialEndsAt;
    const trialEligible = !hasUsedTrial;
    const hasActiveAccess = this.planGuardService.hasActiveAccess(user);
    const hasAutopay = !!user.razorpaySubscriptionId;
    const daysRemaining = this.planGuardService.getDaysRemaining(user);

    let nextAction: 'start_trial' | 'setup_autopay' | 'talk_to_ping' | 'manage';
    if (hasActiveAccess && hasAutopay) {
      nextAction = 'talk_to_ping';
    } else if (hasActiveAccess && isOnTrial && !hasAutopay) {
      nextAction = 'setup_autopay';
    } else if (trialEligible) {
      nextAction = 'start_trial';
    } else {
      nextAction = 'setup_autopay';
    }

    return {
      success: true,
      userId: user.id,
      isNewUser,
      isActive: user.isActive,
      name: user.name,
      phone: user.phone,
      country: user.country,
      plan: user.plan,
      isPremium: user.isPremium,
      isOnTrial,
      hasUsedTrial,
      trialEligible,
      trialEndsAt: user.trialEndsAt?.toISOString() || null,
      hasActiveAccess,
      hasAutopay,
      daysRemaining,
      nextAction,
      trialDays: 5,
      whatsappUrl: `https://wa.me/918076569811?text=${encodeURIComponent('Hi Ping')}`,
    };
  }

  @Post('find-or-create-user')
  async findOrCreateUser(
    @Body()
    body: {
      phone?: string;
      email?: string;
      name?: string;
      country?: string;
      location?: string;
    },
  ) {
    if (!body.phone && !body.email) {
      return { success: false, error: 'Phone or email required' };
    }

    const country = (body.country || body.location || 'IN').toUpperCase().slice(0, 2);
    const phone = body.phone ? this.normalizePhone(body.phone, country) : undefined;

    if (body.phone && (!phone || phone.length < 10)) {
      return { success: false, error: 'Enter a valid WhatsApp number with country code' };
    }

    try {
      let user: User | null = null;
      if (phone) {
        user = await this.findUserByPhoneVariants(phone);
      }
      if (!user && body.email) {
        user = await this.userService.getUserByEmail(body.email);
      }

      // Recover from earlier format mismatches via generated email
      const safeEmail =
        body.email ||
        (phone ? `user_${phone}@heyping.in` : `user_${Date.now()}@heyping.in`);
      if (!user && phone) {
        user = await this.userService.getUserByEmail(safeEmail);
      }

      let isNewUser = false;
      if (!user) {
        isNewUser = true;
        try {
          user = await this.userService.createUser({
            phone,
            email: safeEmail,
            name: body.name?.trim() || 'Ping User',
            country,
            preferredContactMethod: phone ? 'whatsapp' : 'email',
            isPremium: false,
            plan: 'free',
            isActive: true,
          } as any);
        } catch (createErr: any) {
          // Race / duplicate email — fetch existing
          this.logger.warn(`createUser failed, trying lookup: ${createErr?.message || createErr}`);
          user = (await this.userService.getUserByEmail(safeEmail))
            || (phone ? await this.findUserByPhoneVariants(phone) : null);
          if (!user) throw createErr;
          isNewUser = false;
        }
      } else {
        const updates: Partial<User> = {};
        if (body.name?.trim() && body.name.trim() !== user.name) updates.name = body.name.trim();
        // Canonicalize stored phone to digits-only WhatsApp format
        if (phone && user.phone !== phone) updates.phone = phone;
        if (country && country !== user.country) updates.country = country;
        if (Object.keys(updates).length > 0) {
          await this.userRepository.update(user.id, updates as any);
          user = { ...user, ...updates };
        }
      }

      user = await this.planGuardService.getUserWithPlan(user.id);
      return this.buildUserStatus(user, isNewUser);
    } catch (error: any) {
      this.logger.error(`find-or-create-user failed: ${error?.message || error}`);
      return { success: false, error: error?.message || 'Failed to identify user' };
    }
  }

  @Post('create-subscription-link')
  async createSubscriptionLink(@Body() body: { planId: string; userId: string; interval?: 'monthly' | 'yearly'; country?: string; customerId?: string; trialDays?: number; contact?: string; email?: string }) {
    if (!body.planId || !body.userId) {
      return { success: false, error: 'planId and userId are required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const country = (body.country || user.country || 'IN').toUpperCase().slice(0, 2);
    let contact = this.normalizePhone(body.contact || user.phone || '', country);
    const email = body.email || user.email || `user_${contact || body.userId}@heyping.in`;

    if (!contact || contact.length < 10) {
      return { success: false, error: 'Valid phone number with country code is required for autopay' };
    }

    const result = await this.razorpayPaymentService.createSubscriptionLink(
      body.planId,
      body.interval || 'monthly',
      body.userId,
      country,
      body.customerId || user.razorpayCustomerId,
      body.trialDays,
      contact,
      email,
    );

    if (!result) {
      return { success: false, error: 'Failed to create subscription link. Please try again.' };
    }

    const userUpdates: any = {
      phone: contact,
      razorpaySubscriptionId: result.subscriptionId,
      razorpayPlanId: result.razorpayPlanId,
      subscriptionInterval: body.interval || 'monthly',
    };
    if (result.customerId && !user.razorpayCustomerId) {
      userUpdates.razorpayCustomerId = result.customerId;
    }

    // Trial + autopay: grant soft trial access now; first Razorpay charge is deferred.
    if (body.trialDays && body.trialDays > 0 && !user.trialEndsAt) {
      const trialEndsAt = new Date(Date.now() + body.trialDays * 24 * 60 * 60 * 1000);
      userUpdates.plan = body.planId;
      userUpdates.isPremium = true;
      userUpdates.trialEndsAt = trialEndsAt;
      userUpdates.planExpiresAt = trialEndsAt;
      userUpdates.isActive = true;
    }

    await this.userRepository.update(body.userId, userUpdates);

    await this.paymentRepository.save({
      userId: body.userId,
      razorpaySubscriptionId: result.subscriptionId,
      razorpayPlanId: result.razorpayPlanId,
      razorpayOrderId: '',
      planId: body.planId,
      amount: Math.round((result.amount || 0) / 100),
      currency: result.currency || 'INR',
      interval: body.interval || 'monthly',
      status: 'created',
      metadata: { subscriptionUrl: result.shortUrl },
    });

    this.logger.log(`Subscription link created: user=${body.userId} plan=${body.planId} sub=${result.subscriptionId}`);

    return {
      success: true,
      subscriptionId: result.subscriptionId,
      shortUrl: result.shortUrl,
      planId: result.planId,
      interval: result.interval,
      amount: result.amount,
      currency: result.currency,
      trialDays: body.trialDays || 0,
      whatsappUrl: `https://wa.me/918076569811?text=${encodeURIComponent('Hi Ping')}`,
    };
  }

  @Post('cancel-subscription')
  async cancelSubscription(@Body() body: { userId: string }) {
    if (!body.userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user || !user.razorpaySubscriptionId) {
      return { success: false, error: 'No active subscription found' };
    }

    const cancelled = await this.razorpayPaymentService.cancelSubscription(user.razorpaySubscriptionId);
    if (!cancelled) {
      return { success: false, error: 'Failed to cancel subscription' };
    }

    await this.userRepository.update(body.userId, {
      isPremium: false,
      plan: 'free',
      razorpaySubscriptionId: null,
      razorpayPlanId: null,
      subscriptionInterval: null,
      planExpiresAt: null,
    });

    await this.paymentRepository.save({
      userId: body.userId,
      razorpaySubscriptionId: user.razorpaySubscriptionId,
      razorpayOrderId: '',
      planId: user.plan,
      amount: 0,
      currency: 'INR',
      interval: user.subscriptionInterval || 'monthly',
      status: 'subscription_cancelled',
    });

    this.logger.log(`Subscription cancelled: user=${body.userId}`);
    return { success: true };
  }

  @Get('subscription-status')
  async getSubscriptionStatus(@Query('userId') userId: string) {
    if (!userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const status: any = {
      plan: user.plan,
      isPremium: user.isPremium,
      planExpiresAt: user.planExpiresAt?.toISOString() || null,
      hasSubscription: !!user.razorpaySubscriptionId,
      subscriptionInterval: user.subscriptionInterval,
    };

    if (user.razorpaySubscriptionId) {
      const sub = await this.razorpayPaymentService.getSubscription(user.razorpaySubscriptionId);
      if (sub) {
        status.razorpayStatus = sub.status;
        status.currentStart = sub.current_start ? new Date(sub.current_start * 1000).toISOString() : null;
        status.currentEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null;
        status.paymentMethod = sub.payment_method;
        status.remainingCount = sub.remaining_count;
        status.totalCount = sub.total_count;
      }
    }

    return { success: true, subscription: status };
  }

  // ── Trial endpoints ──

  @Post('start-trial')
  async startTrial(@Body() body: { userId: string; planId?: string; trialDays?: number }) {
    if (!body.userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (user.trialEndsAt) {
      const stillActive = user.trialEndsAt > new Date();
      return {
        success: false,
        error: stillActive
          ? 'Trial already active'
          : 'Free trial already used. Please set up autopay to continue.',
        trialEligible: false,
        isOnTrial: stillActive,
        trialEndsAt: user.trialEndsAt.toISOString(),
      };
    }

    const planId = (body.planId || 'helper') as any;
    const trialDays = body.trialDays || 5;
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    await this.userRepository.update(body.userId, {
      plan: planId,
      isPremium: true,
      trialEndsAt,
      planExpiresAt: trialEndsAt,
      isActive: true,
    });

    this.logger.log(`Trial started: user=${body.userId} plan=${planId} days=${trialDays} until=${trialEndsAt.toISOString()}`);

    return {
      success: true,
      planId,
      trialDays,
      trialEndsAt: trialEndsAt.toISOString(),
      whatsappUrl: 'https://wa.me/918076569811',
    };
  }

  @Post('extend-trial')
  async extendTrial(@Body() body: { userId: string; additionalDays: number }) {
    if (!body.userId || !body.additionalDays) {
      return { success: false, error: 'userId and additionalDays are required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const now = new Date();
    const currentEnd = user.trialEndsAt && user.trialEndsAt > now ? user.trialEndsAt : now;
    const newEnd = new Date(currentEnd.getTime() + body.additionalDays * 24 * 60 * 60 * 1000);

    const updates: any = {
      trialEndsAt: newEnd,
      planExpiresAt: newEnd,
    };
    if (!user.isPremium) {
      updates.isPremium = true;
      updates.plan = user.plan === 'free' ? 'helper' : user.plan;
    }

    await this.userRepository.update(body.userId, updates);

    this.logger.log(`Trial extended: user=${body.userId} +${body.additionalDays}d newEnd=${newEnd.toISOString()}`);

    return {
      success: true,
      trialEndsAt: newEnd.toISOString(),
      additionalDays: body.additionalDays,
    };
  }

  // ── Coupon endpoints ──

  @Post('create-coupon')
  async createCoupon(@Body() body: { code: string; planId: string; durationDays: number; maxUses?: number; expiresAt?: string; description?: string }) {
    if (!body.code || !body.planId || !body.durationDays) {
      return { success: false, error: 'code, planId, and durationDays are required' };
    }

    try {
      const coupon = await this.couponService.createCoupon({
        code: body.code,
        planId: body.planId as any,
        durationDays: body.durationDays,
        maxUses: body.maxUses,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        description: body.description,
      });

      return {
        success: true,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          planId: coupon.planId,
          durationDays: coupon.durationDays,
          maxUses: coupon.maxUses,
          expiresAt: coupon.expiresAt?.toISOString() || null,
          active: coupon.active,
          usedCount: coupon.usedCount,
          description: coupon.description,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to create coupon' };
    }
  }

  @Post('validate-coupon')
  async validateCoupon(@Body() body: { code: string }) {
    if (!body.code) {
      return { success: false, error: 'code is required' };
    }

    const result = await this.couponService.validateCoupon(body.code);
    if (!result.valid) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      coupon: {
        code: result.coupon.code,
        planId: result.coupon.planId,
        durationDays: result.coupon.durationDays,
        description: result.coupon.description,
        expiresAt: result.coupon.expiresAt?.toISOString() || null,
      },
    };
  }

  @Post('apply-coupon')
  async applyCoupon(@Body() body: { code: string; userId: string }) {
    if (!body.code || !body.userId) {
      return { success: false, error: 'code and userId are required' };
    }

    const result = await this.couponService.applyCoupon(body.code, body.userId);
    return result;
  }

  @Get('coupons')
  async listCoupons() {
    const coupons = await this.couponService.listCoupons();
    return {
      success: true,
      coupons: coupons.map((c) => ({
        id: c.id,
        code: c.code,
        planId: c.planId,
        durationDays: c.durationDays,
        maxUses: c.maxUses,
        usedCount: c.usedCount,
        expiresAt: c.expiresAt?.toISOString() || null,
        active: c.active,
        description: c.description,
      })),
    };
  }

  @Post('deactivate-coupon')
  async deactivateCoupon(@Body() body: { id: string }) {
    if (!body.id) {
      return { success: false, error: 'id is required' };
    }

    try {
      await this.couponService.deactivateCoupon(body.id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to deactivate coupon' };
    }
  }

  // ── Plan status / authorization endpoint ──

  @Get('plan-status')
  async getPlanStatus(@Query('userId') userId: string) {
    if (!userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.planGuardService.getUserWithPlan(userId);
    const daysRemaining = this.planGuardService.getDaysRemaining(user);

    return {
      success: true,
      plan: user.plan,
      isPremium: user.isPremium,
      isOnTrial: this.planGuardService.isOnTrial(user),
      isCouponActive: this.planGuardService.isCouponActive(user),
      hasActiveAccess: this.planGuardService.hasActiveAccess(user),
      daysRemaining,
      trialEndsAt: user.trialEndsAt?.toISOString() || null,
      planExpiresAt: user.planExpiresAt?.toISOString() || null,
      couponExpiresAt: user.couponExpiresAt?.toISOString() || null,
      features: {
        reminders: this.planGuardService.hasFeature(user, 'reminders'),
        passwords: this.planGuardService.hasFeature(user, 'passwords'),
        todoLists: this.planGuardService.hasFeature(user, 'todo_lists'),
        calorieTracker: this.planGuardService.hasFeature(user, 'calorie_tracker'),
        googleCalendar: this.planGuardService.hasFeature(user, 'google_calendar'),
        googleDocs: this.planGuardService.hasFeature(user, 'google_docs'),
        googleSheets: this.planGuardService.hasFeature(user, 'google_sheets'),
        stockQueries: this.planGuardService.hasFeature(user, 'stock_queries'),
        cricketQueries: this.planGuardService.hasFeature(user, 'cricket_queries'),
        prioritySupport: this.planGuardService.hasFeature(user, 'priority_support'),
      },
    };
  }

  // ── Webhook ──

  @Post('webhook')
  async handleWebhook(@Req() req: Request, @Headers('x-razorpay-signature') signature: string) {
    if (!signature) return { received: true };

    const secret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) return { received: true };

    const rawBody = req.body instanceof Buffer ? req.body.toString() : JSON.stringify(req.body);
    const isValid = this.razorpayPaymentService.verifyWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      this.logger.warn('Razorpay webhook signature mismatch');
      return { received: true };
    }

    try {
      const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const eventType = event.event;

      // ── Subscription events ──

      if (eventType === 'subscription.activated') {
        const sub = event.payload.subscription.entity;
        const notes = sub.notes || {};
        const userId = notes.userId;
        const planId = sub.plan_id?.notes?.planId || notes.planId || 'helper';
        const interval = sub.plan_id?.notes?.interval || notes.interval || 'monthly';
        const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        if (userId) {
          await this.userRepository.update(userId, {
            isPremium: true,
            plan: planId,
            razorpaySubscriptionId: sub.id,
            planExpiresAt: expiresAt,
          });

          await this.paymentRepository.save({
            userId,
            razorpaySubscriptionId: sub.id,
            razorpayOrderId: '',
            planId,
            amount: Math.round((sub.amount || 0) / 100),
            currency: sub.currency || 'INR',
            interval,
            status: 'subscription_active',
          });

          this.logger.log(`Subscription activated: user=${userId} plan=${planId} sub=${sub.id}`);
        }
      }

      if (eventType === 'subscription.charged') {
        const sub = event.payload.subscription.entity;
        const notes = sub.notes || {};
        const userId = notes.userId;
        const planId = sub.plan_id?.notes?.planId || notes.planId || 'helper';
        const interval = sub.plan_id?.notes?.interval || notes.interval || 'monthly';
        const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const payment = event.payload.payment?.entity;

        if (userId) {
          await this.userRepository.update(userId, {
            isPremium: true,
            planExpiresAt: expiresAt,
          });

          await this.paymentRepository.save({
            userId,
            razorpaySubscriptionId: sub.id,
            razorpayPaymentId: payment?.id || '',
            razorpayOrderId: payment?.order_id || '',
            planId,
            amount: Math.round((payment?.amount || 0) / 100),
            currency: payment?.currency || 'INR',
            interval,
            status: 'captured',
          });

          this.logger.log(`Subscription charged: user=${userId} sub=${sub.id} payment=${payment?.id}`);
        }
      }

      if (eventType === 'subscription.completed') {
        const sub = event.payload.subscription.entity;
        const notes = sub.notes || {};
        const userId = notes.userId;
        const planId = sub.plan_id?.notes?.planId || notes.planId || 'helper';

        if (userId) {
          const days = this.razorpayPaymentService.getDefaultPlanDuration('monthly');
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

          await this.userRepository.update(userId, {
            isPremium: true,
            plan: planId,
            planExpiresAt: expiresAt,
          });

          this.logger.log(`Subscription completed: user=${userId} sub=${sub.id} — plan extended as courtesy`);
        }
      }

      if (eventType === 'subscription.cancelled') {
        const sub = event.payload.subscription.entity;
        const userId = sub.notes?.userId;

        if (userId) {
          await this.userRepository.update(userId, {
            isPremium: false,
            plan: 'free',
            razorpaySubscriptionId: null,
            razorpayPlanId: null,
            subscriptionInterval: null,
          });

          this.logger.log(`Subscription cancelled via webhook: user=${userId} sub=${sub.id}`);
        }
      }

      if (eventType === 'subscription.halted') {
        const sub = event.payload.subscription.entity;
        const userId = sub.notes?.userId;

        if (userId) {
          this.logger.warn(`Subscription halted: user=${userId} sub=${sub.id} — payment likely failed`);
        }
      }

      // ── Payment link / one-time payment events ──

      if (eventType === 'payment_link.paid') {
        const userId = event.payload.payment_link.notes?.userId;
        const planId = event.payload.payment_link.notes?.planId || 'helper';
        const interval = event.payload.payment_link.notes?.interval || 'monthly';
        const amount = event.payload.payment_link?.amount_paid || 0;

        if (userId) {
          const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

          await this.userRepository.update(userId, {
            isPremium: true,
            plan: planId,
            planExpiresAt: expiresAt,
          });

          await this.paymentRepository.save({
            userId,
            razorpayOrderId: event.payload.payment_link?.order_id || '',
            razorpayPaymentId: event.payload.payment_link?.payment_id || '',
            planId,
            amount: Math.round(amount / 100),
            currency: event.payload.payment_link?.currency || 'INR',
            interval,
            status: 'captured',
          });

          this.logger.log(`Webhook payment_link.paid: user=${userId} plan=${planId}`);
        }
      }

      if (eventType === 'payment.captured') {
        const notes = event.payload.payment.entity.notes || {};
        const userId = notes.userId;
        const planId = notes.planId || 'helper';
        const interval = notes.interval || 'monthly';
        const amount = event.payload.payment.entity.amount || 0;

        if (userId) {
          const days = this.razorpayPaymentService.getDefaultPlanDuration(interval);
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

          await this.userRepository.update(userId, {
            isPremium: true,
            plan: planId,
            planExpiresAt: expiresAt,
          });

          await this.paymentRepository.save({
            userId,
            razorpayOrderId: event.payload.payment.entity.order_id || '',
            razorpayPaymentId: event.payload.payment.entity.id || '',
            planId,
            amount: Math.round(amount / 100),
            currency: event.payload.payment.entity.currency || 'INR',
            interval,
            status: 'captured',
          });

          this.logger.log(`Webhook payment.captured: user=${userId} plan=${planId}`);
        }
      }
    } catch (error) {
      this.logger.error('Razorpay webhook handler error:', error);
    }

    return { received: true };
  }
}
