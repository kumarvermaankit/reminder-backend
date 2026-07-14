import { Controller, Post, Headers, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { RazorpayPaymentService } from '../services/razorpay-payment.service';
import { UserService } from '../services/user.service';

@Controller('razorpay')
export class RazorpayController {
  private readonly logger = new Logger(RazorpayController.name);

  constructor(
    private readonly razorpayPaymentService: RazorpayPaymentService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

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
        if (userId) {
          await this.userService.updateUser(userId, { isPremium: true });
          this.logger.log(`User ${userId} upgraded to premium via Razorpay`);
        }
      }
    } catch (error) {
      this.logger.error('Razorpay webhook handler error:', error);
    }

    return { received: true };
  }
}
