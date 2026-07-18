import { Controller, Post, Get, Headers, Req, Logger, Body, Query } from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RazorpayPaymentService } from '../services/razorpay-payment.service';
import { PlanGuardService } from '../services/plan-guard.service';
import { UserService } from '../services/user.service';
import { User } from '../entities/user.entity';
import { Payment } from '../entities/payment.entity';

@Controller('razorpay')
export class RazorpayController {
  private readonly logger = new Logger(RazorpayController.name);

  constructor(
    private readonly razorpayPaymentService: RazorpayPaymentService,
    private readonly planGuardService: PlanGuardService,
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
  async createCustomer(@Body() body: { userId: string; name?: string; email?: string; contact?: string }) {
    if (!body.userId) {
      return { success: false, error: 'userId is required' };
    }

    const user = await this.userRepository.findOne({ where: { id: body.userId } });
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    try {
      const Razorpay = require('razorpay');
      const razorpay = new Razorpay({
        key_id: this.configService.get<string>('RAZORPAY_KEY_ID'),
        key_secret: this.configService.get<string>('RAZORPAY_KEY_SECRET'),
      });

      const name = body.name || user.name || 'User';
      const email = body.email || user.email || '';
      const contact = body.contact || user.phone || '';

      const customer = await razorpay.customers.create({
        name,
        email,
        contact,
        notes: { userId: user.id },
      });

      await this.userRepository.update(user.id, {
        name,
        ...(body.email && { email: body.email }),
        ...(body.contact && { phone: body.contact }),
      } as any);

      this.logger.log(`Razorpay customer created: user=${user.id} customer=${customer.id}`);

      return {
        success: true,
        customerId: customer.id,
        name: customer.name,
        email: customer.email,
        contact: customer.contact,
      };
    } catch (error) {
      this.logger.error('Failed to create Razorpay customer:', error);
      return { success: false, error: 'Failed to create customer' };
    }
  }

  // ── Subscription (autopay) endpoints ──

  @Post('find-or-create-user')
  async findOrCreateUser(@Body() body: { phone?: string; email?: string }) {
    if (!body.phone && !body.email) {
      return { success: false, error: 'Phone or email required' };
    }
    let user: User;
    if (body.phone) {
      user = await this.userService.getUserByPhone(body.phone);
    } else {
      user = await this.userService.getUserByEmail(body.email);
    }
    if (!user) {
      user = await this.userService.createUser({
        phone: body.phone || '',
        email: body.email || '',
        isPremium: false,
        plan: 'free',
      });
    }
    return { success: true, userId: user.id };
  }

  @Post('create-subscription-link')
  async createSubscriptionLink(@Body() body: { planId: string; userId: string; interval?: 'monthly' | 'yearly'; country?: string; customerId?: string }) {
    if (!body.planId || !body.userId) {
      return { success: false, error: 'planId and userId are required' };
    }

    const result = await this.razorpayPaymentService.createSubscriptionLink(
      body.planId,
      body.interval || 'monthly',
      body.userId,
      body.country || 'IN',
      body.customerId,
    );

    if (!result) {
      return { success: false, error: 'Failed to create subscription link' };
    }

    await this.userRepository.update(body.userId, {
      razorpaySubscriptionId: result.subscriptionId,
      razorpayPlanId: result.razorpayPlanId,
      subscriptionInterval: body.interval || 'monthly',
    });

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
