import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthUser } from '../guards/jwt-auth.guard';
import { UserService } from '../services/user.service';
import { ReminderService } from '../services/reminder.service';
import { NoteService } from '../services/note.service';
import { PasswordService } from '../services/password.service';
import { PlanGuardService } from '../services/plan-guard.service';
import { RazorpayPaymentService } from '../services/razorpay-payment.service';
import { User } from '../entities/user.entity';
import { Payment } from '../entities/payment.entity';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(
    private readonly userService: UserService,
    private readonly reminderService: ReminderService,
    private readonly noteService: NoteService,
    private readonly passwordService: PasswordService,
    private readonly planGuardService: PlanGuardService,
    private readonly razorpayPaymentService: RazorpayPaymentService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  // ── Profile & plan overview ──

  @Get()
  async overview(@CurrentUser() auth: AuthUser) {
    const user = await this.planGuardService.getUserWithPlan(auth.id);
    const daysRemaining = this.planGuardService.getDaysRemaining(user);

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        country: user.country,
        timezone: user.timezone,
        plan: user.plan,
        isPremium: user.isPremium,
        isOnTrial: this.planGuardService.isOnTrial(user),
        isCouponActive: this.planGuardService.isCouponActive(user),
        hasActiveAccess: this.planGuardService.hasActiveAccess(user),
        trialEndsAt: user.trialEndsAt?.toISOString() || null,
        planExpiresAt: user.planExpiresAt?.toISOString() || null,
        daysRemaining,
        hasAutopay: !!user.razorpaySubscriptionId,
      },
    };
  }

  // ── Reminders ──

  @Get('reminders')
  async getReminders(@CurrentUser() auth: AuthUser) {
    const [pending, completed] = await Promise.all([
      this.reminderService.getPendingRemindersForUser(auth.id),
      this.reminderService.getCompletedRemindersForUser(auth.id, 50),
    ]);
    return { success: true, reminders: [...pending, ...completed] };
  }

  @Post('reminders')
  async createReminder(
    @CurrentUser() auth: AuthUser,
    @Body() body: { title: string; description?: string; reminderDate?: string },
  ) {
    if (!body.title?.trim()) {
      return { success: false, error: 'Title is required' };
    }
    let reminderDate: Date | undefined;
    if (body.reminderDate) {
      reminderDate = new Date(body.reminderDate);
      if (isNaN(reminderDate.getTime())) {
        return { success: false, error: 'Invalid reminder date' };
      }
    } else {
      reminderDate = new Date(Date.now() + 60 * 60 * 1000);
    }

    const reminder = await this.reminderService.createReminder({
      userId: auth.id,
      title: body.title.trim(),
      description: body.description || '',
      reminderDate,
    });
    return { success: true, reminder };
  }

  @Delete('reminders/:id')
  async cancelReminder(@CurrentUser() auth: AuthUser, @Param('id') id: string) {
    const reminder = await this.reminderService.getReminder(id);
    if (!reminder || reminder.userId !== auth.id) {
      return { success: false, error: 'Reminder not found' };
    }
    await this.reminderService.deleteAllSchedulesForReminder(id);
    await this.reminderService.deleteReminder(id);
    this.logger.log(`Reminder cancelled from dashboard: ${id} user=${auth.id}`);
    return { success: true };
  }

  // ── Notes ──

  @Get('notes')
  async getNotes(@CurrentUser() auth: AuthUser) {
    const notes = await this.noteService.getAllNotesByUser(auth.id);
    return { success: true, notes };
  }

  @Post('notes')
  async createNote(
    @CurrentUser() auth: AuthUser,
    @Body() body: { title: string; content: string; category?: string },
  ) {
    try {
      const note = await this.noteService.createNote(
        auth.id, body.title, body.content, body.category,
      );
      return { success: true, note };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to create note' };
    }
  }

  @Delete('notes/:id')
  async deleteNote(@CurrentUser() auth: AuthUser, @Param('id') id: string) {
    try {
      await this.noteService.deleteNote(id, auth.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to delete note' };
    }
  }

  // ── Passwords ──

  @Get('passwords')
  async getPasswords(@CurrentUser() auth: AuthUser) {
    const passwords = await this.passwordService.getAllPasswords(auth.id);
    return { success: true, passwords };
  }

  @Post('passwords')
  async createPassword(
    @CurrentUser() auth: AuthUser,
    @Body() body: { service: string; username?: string; password: string; url?: string; notes?: string },
  ) {
    try {
      const saved = await this.passwordService.savePassword(
        auth.id, body.service, body.username || '', body.password, body.url, body.notes,
      );
      return { success: true, password: saved };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to save password' };
    }
  }

  @Get('passwords/:id')
  async revealPassword(@CurrentUser() auth: AuthUser, @Param('id') id: string) {
    try {
      const password = await this.passwordService.getPassword(id, auth.id);
      return { success: true, password };
    } catch (error) {
      return { success: false, error: error.message || 'Password not found' };
    }
  }

  @Delete('passwords/:id')
  async deletePassword(@CurrentUser() auth: AuthUser, @Param('id') id: string) {
    try {
      await this.passwordService.deletePassword(id, auth.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to delete password' };
    }
  }

  // ── Subscription ──

  @Get('subscription')
  async getSubscription(@CurrentUser() auth: AuthUser) {
    const user = await this.userRepository.findOne({ where: { id: auth.id } });
    if (!user) return { success: false, error: 'User not found' };

    const status: any = {
      plan: user.plan,
      isPremium: user.isPremium,
      hasAutopay: !!user.razorpaySubscriptionId,
      subscriptionInterval: user.subscriptionInterval,
      planExpiresAt: user.planExpiresAt?.toISOString() || null,
      trialEndsAt: user.trialEndsAt?.toISOString() || null,
    };

    if (user.razorpaySubscriptionId) {
      const sub = await this.razorpayPaymentService.getSubscription(user.razorpaySubscriptionId);
      if (sub) {
        status.razorpayStatus = sub.status;
        status.currentStart = sub.current_start ? new Date(sub.current_start * 1000).toISOString() : null;
        status.currentEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null;
        status.paymentMethod = sub.payment_method;
      }
    }

    const payments = await this.paymentRepository.find({
      where: { userId: auth.id },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return { success: true, subscription: status, payments };
  }

  @Post('subscription/cancel')
  async cancelSubscription(@CurrentUser() auth: AuthUser) {
    const user = await this.userRepository.findOne({ where: { id: auth.id } });
    if (!user || !user.razorpaySubscriptionId) {
      return { success: false, error: 'No active subscription found' };
    }

    const cancelled = await this.razorpayPaymentService.cancelSubscription(user.razorpaySubscriptionId);
    if (!cancelled) {
      return { success: false, error: 'Failed to cancel subscription. Please contact support.' };
    }

    await this.userRepository.update(user.id, {
      isPremium: false,
      plan: 'free',
      razorpaySubscriptionId: null,
      razorpayPlanId: null,
      subscriptionInterval: null,
      planExpiresAt: null,
    });

    await this.paymentRepository.save({
      userId: user.id,
      razorpaySubscriptionId: user.razorpaySubscriptionId,
      razorpayOrderId: '',
      planId: user.plan,
      amount: 0,
      currency: 'INR',
      interval: user.subscriptionInterval || 'monthly',
      status: 'subscription_cancelled',
    });

    this.logger.log(`Subscription cancelled from dashboard: user=${user.id}`);
    return { success: true };
  }
}
