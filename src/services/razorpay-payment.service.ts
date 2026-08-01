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

  getRazorpayPlanId(planId: string, interval: 'monthly' | 'yearly'): string {
    return `plan_${planId}_${interval}`;
  }

  async createOrGetRazorpayPlan(planId: string, interval: 'monthly' | 'yearly'): Promise<any> {
    if (!this.razorpay) return null;
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return null;

    // Reuse an existing Razorpay plan for this planId+interval instead of creating duplicates
    try {
      const existing = await this.razorpay.plans.all({ count: 100 });
      const match = existing?.items?.find(
        (p: any) => p?.notes?.planId === planId && p?.notes?.interval === interval,
      );
      if (match) {
        this.logger.log(`Reusing Razorpay plan: id=${match.id} planId=${planId} interval=${interval}`);
        return match;
      }
    } catch (lookupErr) {
      this.logger.warn(`Razorpay plan lookup failed (proceeding to create): ${lookupErr.message}`);
    }

    const currency = 'INR';
    const amount = interval === 'yearly'
      ? (plan.pricing_yearly[currency] || plan.pricing_yearly['USD'])
      : (plan.pricing_monthly[currency] || plan.pricing_monthly['USD']);

    const period = interval === 'yearly' ? 'yearly' : 'monthly';

    try {
      const newPlan = await this.razorpay.plans.create({
        period,
        interval: 1,
        item: {
          name: `${plan.name} (${interval})`,
          amount: Math.round(amount),
          currency,
          description: plan.description,
        },
        notes: { planId, interval },
      });
      this.logger.log(`Created Razorpay plan: id=${newPlan.id} planId=${planId} interval=${interval}`);
      return newPlan;
    } catch (error) {
      this.logger.error(`Failed to create Razorpay plan (planId=${planId} interval=${interval}):`, error?.error?.description || error.message || error);
      return null;
    }
  }

  async createSubscriptionLink(
    planId: string,
    interval: 'monthly' | 'yearly',
    userId: string,
    countryCode: string = 'IN',
    customerId?: string,
    trialDays?: number,
    contact?: string,
    email?: string,
  ): Promise<any> {
    if (!this.razorpay) return null;
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return null;
    const currency = this.getCurrencyForCountry(countryCode);

    const razorpayPlan = await this.createOrGetRazorpayPlan(planId, interval);
    if (!razorpayPlan) return null;

    const totalCount = interval === 'yearly' ? 12 : 24;

    try {
      if (!contact) {
        throw new Error('contact (phone number with country code) is required to create a subscription link');
      }

      const subscriptionOptions: any = {
        plan_id: razorpayPlan.id,
        total_count: totalCount,
        customer_notify: 1,
        quantity: 1,
        notes: { userId, planId, interval, ...(trialDays && trialDays > 0 ? { trialDays } : {}) },
        notify_info: {
          notify_phone: contact.startsWith('+') ? contact : `+${contact}`,
          notify_email: email || `user_${userId}@heyping.in`,
        },
      };

      // Razorpay has no trial_period_days — defer first charge with start_at.
      if (trialDays && trialDays > 0) {
        subscriptionOptions.start_at = Math.floor(Date.now() / 1000) + trialDays * 86400;
        subscriptionOptions.expire_by = Math.floor(Date.now() / 1000) + 7 * 86400;
      }

      this.logger.log(`Creating subscription: ${JSON.stringify(subscriptionOptions)}`);
      const subscription = await this.razorpay.subscriptions.create(subscriptionOptions);
      this.logger.log(`Subscription created: id=${subscription.id} status=${subscription.status} url=${subscription.short_url}`);

      if (!customerId) {
        try {
          const customer = await this.findOrCreateCustomer(
            plan.name,
            contact,
            email || `user_${userId}@heyping.in`,
            userId,
          );
          customerId = customer.id;
        } catch (customerErr) {
          this.logger.warn(`Customer create/lookup skipped: ${customerErr?.message || customerErr}`);
        }
      }

      if (!subscription.short_url) {
        throw new Error(`Subscription ${subscription.id} created but short_url is missing`);
      }

      const planTrialEnd = trialDays ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : undefined;

      return {
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url,
        planId,
        interval,
        amount: interval === 'yearly'
          ? (plan.pricing_yearly[currency] || plan.pricing_yearly['USD'])
          : (plan.pricing_monthly[currency] || plan.pricing_monthly['USD']),
        currency,
        razorpayPlanId: razorpayPlan.id,
        customerId,
        trialDays: trialDays || 0,
        trialEndsAt: planTrialEnd ? planTrialEnd.toISOString() : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create subscription link: ${JSON.stringify(error?.error || error?.message || error)}`,
      );
      return null;
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    if (!this.razorpay) return false;
    try {
      await this.razorpay.subscriptions.cancel(subscriptionId);
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel subscription ${subscriptionId}:`, error);
      return false;
    }
  }

  async findOrCreateCustomer(name: string, contact: string, email: string, userId: string): Promise<any> {
    if (!this.razorpay) {
      throw new Error('Razorpay not configured — check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
    }

    const lookupKey = contact || email;
    if (lookupKey) {
      try {
        const filter: any = { count: 5 };
        if (email) filter.email = email;
        if (contact) filter.contact = contact;
        const existing = await this.razorpay.customers.all(filter);
        if (existing?.items?.length > 0) {
          this.logger.log(`Found existing Razorpay customer: id=${existing.items[0].id} email=${email} contact=${contact}`);
          return existing.items[0];
        }
      } catch (lookupErr) {
        this.logger.warn(`Razorpay customer lookup failed (proceeding to create): ${lookupErr.message}`);
      }
    }

    try {
      const customer = await this.razorpay.customers.create({
        name,
        contact,
        email,
        notes: { userId },
      });
      this.logger.log(`Created new Razorpay customer: id=${customer.id} userId=${userId}`);
      return customer;
    } catch (error) {
      this.logger.error(`Razorpay createCustomer failed: ${error?.error?.description || error.message || error}`);
      throw error;
    }
  }

  async getSubscription(subscriptionId: string): Promise<any> {
    if (!this.razorpay) return null;
    try {
      return await this.razorpay.subscriptions.fetch(subscriptionId);
    } catch (error) {
      this.logger.error(`Failed to fetch subscription ${subscriptionId}:`, error);
      return null;
    }
  }

  async pauseSubscription(subscriptionId: string): Promise<boolean> {
    if (!this.razorpay) return false;
    try {
      await this.razorpay.subscriptions.pause(subscriptionId, { pause_at: 'now' });
      return true;
    } catch (error) {
      this.logger.error(`Failed to pause subscription ${subscriptionId}:`, error);
      return false;
    }
  }

  async resumeSubscription(subscriptionId: string): Promise<boolean> {
    if (!this.razorpay) return false;
    try {
      await this.razorpay.subscriptions.resume(subscriptionId, { resume_at: 'immediately' });
      return true;
    } catch (error) {
      this.logger.error(`Failed to resume subscription ${subscriptionId}:`, error);
      return false;
    }
  }
}
