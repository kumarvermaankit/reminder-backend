import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RazorpayPaymentService {
  private readonly logger = new Logger(RazorpayPaymentService.name);
  private razorpay: any;

  constructor(private readonly configService: ConfigService) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    if (keyId && keySecret) {
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
  }

  get isConfigured(): boolean {
    return !!this.razorpay;
  }

  async createPaymentLink(amount: number, userId: string, description: string): Promise<string | null> {
    if (!this.razorpay) return null;
    try {
      const link = await this.razorpay.paymentLink.create({
        amount: Math.round(amount * 100),
        currency: 'INR',
        description,
        customer: { contact: '', email: '' },
        notify: { sms: false, email: false },
        notes: { userId },
        callback_url: 'https://wa.me/',
        callback_method: 'get',
      });
      return link.short_url;
    } catch (error) {
      this.logger.error('Failed to create payment link:', error);
      return null;
    }
  }

  async verifyWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
    try {
      const crypto = require('crypto');
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      return expected === signature;
    } catch {
      return false;
    }
  }
}
