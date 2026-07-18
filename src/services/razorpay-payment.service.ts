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
      pricing_monthly: { USD: 499, INR: 4999, GBP: 399, EUR: 499 },
      pricing_yearly: { USD: 4999, INR: 49900, GBP: 3999, EUR: 4999 },
    },
    {
      id: 'assistant',
      name: 'Assistant',
      description: 'Everything in Helper + to-do lists & calorie tracker',
      features: [
        'Everything in Helper',
        'Unlimited to-do lists',
        'Per-item reminders on todos',
        'Calorie tracker',
        'Diet advice & meal logging',
        'Live stock & cricket queries',
      ],
      pricing_monthly: { USD: 999, INR: 9999, GBP: 799, EUR: 999 },
      pricing_yearly: { USD: 9999, INR: 99900, GBP: 7999, EUR: 9999 },
    },
    {
      id: 'manager',
      name: 'Manager',
      description: 'Everything in Assistant + Google integration & premium support',
      features: [
        'Everything in Assistant',
        'Google Calendar integration',
        'Google Meet creation',
        'Google Docs creation',
        'Google Sheets creation',
        'Priority 24/7 support',
      ],
      pricing_monthly: { USD: 1999, INR: 19999, GBP: 1599, EUR: 1999 },
      pricing_yearly: { USD: 19999, INR: 199900, GBP: 15999, EUR: 19999 },
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
