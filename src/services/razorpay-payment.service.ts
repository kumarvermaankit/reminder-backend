import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanType } from '../entities/user.entity';

export interface PlanPricing {
  [currency: string]: number;
}

export interface PlanConfig {
  id: PlanType;
  name: string;
  description: string;
  features: string[];
  pricing_monthly: PlanPricing;
  pricing_yearly: PlanPricing;
}

@Injectable()
export class RazorpayPaymentService {
  private readonly logger = new Logger(RazorpayPaymentService.name);
  private razorpay: any;
  private razorpayKeyId: string;
  private razorpayKeySecret: string;

  readonly plans: PlanConfig[] = [
    {
      id: 'helper',
      name: 'Helper',
      description: 'Essential reminders & password vault',
      features: [
        'Unlimited reminders',
        'Recurring reminders',
        'Personal notes vault',
        'Password manager',
        'Daily morning prompt',
      ],
      pricing_monthly: { USD: 99, INR: 6900, GBP: 79, EUR: 89 },
      pricing_yearly: { USD: 999, INR: 69900, GBP: 799, EUR: 899 },
    },
    {
      id: 'assistant',
      name: 'Assistant',
      description: 'To-do lists, calorie tracker & more',
      features: [
        'Everything in Helper',
        'Unlimited to-do lists',
        'Per-item reminders on todos',
        'Calorie & diet tracker',
        'Live stock & cricket queries',
      ],
      pricing_monthly: { USD: 129, INR: 8900, GBP: 99, EUR: 119 },
      pricing_yearly: { USD: 1299, INR: 89900, GBP: 999, EUR: 1199 },
    },
    {
      id: 'manager',
      name: 'Manager',
      description: 'Google integration & premium support',
      features: [
        'Everything in Assistant',
        'Google Calendar integration',
        'Google Meet & Docs creation',
        'Google Sheets integration',
        'Priority 24/7 support',
      ],
      pricing_monthly: { USD: 199, INR: 10900, GBP: 149, EUR: 179 },
      pricing_yearly: { USD: 1999, INR: 109900, GBP: 1499, EUR: 1799 },
    },
  ];

  constructor(private readonly configService: ConfigService) {
    this.razorpayKeyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    this.razorpayKeySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    if (this.razorpayKeyId && this.razorpayKeySecret) {
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({ key_id: this.razorpayKeyId, key_secret: this.razorpayKeySecret });
    }
  }

  get isConfigured(): boolean {
    return !!this.razorpay;
  }

  getPlans(countryCode: string = 'IN') {
    const currency = this.getCurrencyForCountry(countryCode);
    return this.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      features: plan.features,
      price_monthly: plan.pricing_monthly[currency] || plan.pricing_monthly['USD'],
      price_yearly: plan.pricing_yearly[currency] || plan.pricing_yearly['USD'],
      currency,
    }));
  }

  getPlanConfig(planId: string): PlanConfig | undefined {
    return this.plans.find((p) => p.id === planId);
  }

  getCurrencyForCountry(countryCode: string): string {
    const currencyMap: Record<string, string> = {
      US: 'USD', IN: 'INR', GB: 'GBP', UK: 'GBP',
      DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
      AU: 'AUD', CA: 'CAD', BR: 'USD', JP: 'USD', CN: 'USD',
    };
    return currencyMap[countryCode.toUpperCase()] || 'USD';
  }

  async createOrder(planId: string, countryCode: string, interval: 'monthly' | 'yearly' = 'monthly'): Promise<any> {
    if (!this.razorpay) return null;
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return null;

    const currency = this.getCurrencyForCountry(countryCode);
    const amount = interval === 'yearly'
      ? (plan.pricing_yearly[currency] || plan.pricing_yearly['USD'])
      : (plan.pricing_monthly[currency] || plan.pricing_monthly['USD']);

    try {
      const order = await this.razorpay.orders.create({
        amount,
        currency,
        receipt: `plan_${planId}_${interval}_${Date.now()}`,
        notes: { planId, interval, country: countryCode },
      });
      return order;
    } catch (error) {
      this.logger.error('Failed to create Razorpay order:', error);
      return null;
    }
  }

  async createPaymentLink(
    amount: number,
    userId: string,
    description: string,
    planId: PlanType = 'helper',
    interval: 'monthly' | 'yearly' = 'monthly',
  ): Promise<string | null> {
    if (!this.razorpay) return null;
    try {
      const link = await this.razorpay.paymentLink.create({
        amount: Math.round(amount * 100),
        currency: 'INR',
        description,
        customer: { contact: '', email: '' },
        notify: { sms: false, email: false },
        notes: { userId, planId, interval },
        callback_url: 'https://wa.me/',
        callback_method: 'get',
      });
      return link.short_url;
    } catch (error) {
      this.logger.error('Failed to create payment link:', error);
      return null;
    }
  }

  async verifyPayment(paymentId: string, orderId: string, signature: string): Promise<boolean> {
    try {
      const crypto = require('crypto');
      const expected = crypto.createHmac('sha256', this.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');
      return expected === signature;
    } catch {
      return false;
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

  getDefaultPlanDuration(interval: 'monthly' | 'yearly'): number {
    return interval === 'yearly' ? 365 : 30;
  }
}
