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

      if (event.event === 'payment_link.paid') {
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

          this.logger.log(`Webhook: user ${userId} upgraded to ${planId}`);
        }
      }

      if (event.event === 'payment.captured') {
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

          this.logger.log(`Webhook payment.captured: user ${userId} upgraded to ${planId}`);
        }
      }
    } catch (error) {
      this.logger.error('Razorpay webhook handler error:', error);
    }

    return { received: true };
  }
}
