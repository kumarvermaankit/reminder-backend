import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ReminderService } from '../services/reminder.service';
import { SchedulerService } from '../services/scheduler.service';

@Controller('reminders')
export class ReminderController {
  constructor(
    private readonly reminderService: ReminderService,
    private readonly schedulerService: SchedulerService,
  ) {}

  @Post()
  async createReminder(@Body() reminderData: any) {
    return await this.reminderService.createReminder(reminderData);
  }

  @Get()
  async getReminders() {
    return await this.reminderService.getReminders();
  }

  @Get(':id')
  async getReminder(@Param('id') id: string) {
    return await this.reminderService.getReminder(id);
  }

  @Get('stats/scheduler')
  async getSchedulerStats() {
    return await this.schedulerService.getSchedulerStats();
  }

  @Post('test')
  async createTestReminder() {
    // Create a reminder for 1 minute from now for testing
    const reminderData = {
      title: 'Test Reminder',
      description: 'This is a test reminder scheduled for 1 minute from now',
      reminderDate: new Date(Date.now() + 1 * 60 * 1000), // 1 minute from now
      isCompleted: false,
    };

    return await this.reminderService.createReminder(reminderData);
  }
}
