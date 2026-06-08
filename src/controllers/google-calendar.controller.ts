import { Controller, Get, Query, Logger } from '@nestjs/common';
import { GoogleCalendarService } from '../services/google-calendar.service';
import { UserService } from '../services/user.service';
import { WhatsappService } from '../services/whatsapp.service';

@Controller('google')
export class GoogleCalendarController {
  private readonly logger = new Logger(GoogleCalendarController.name);

  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly userService: UserService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Get('auth')
  getAuthUrl(@Query('userId') userId: string, @Query('phone') phone: string) {
    if (!userId || !phone) {
      return { error: 'Missing userId or phone query params.' };
    }
    const url = this.googleCalendarService.getAuthUrl(userId, phone);
    return { authUrl: url };
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Query('state') state: string) {
    if (!code || !state) {
      return '<html><body><h2>❌ Authentication failed — missing parameters.</h2></body></html>';
    }

    try {
      const { email, phone } = await this.googleCalendarService.handleCallback(code, state);
      const msg = `✅ *Google Calendar connected!*\n\nYour Google account *${email}* is now linked.\n\nNow you can:\n• Say *"create a meeting tomorrow at 3pm"* to create a Calendar event with Google Meet\n• Say *"my events"* to see upcoming events\n• I'll auto-send invites to attendees!`;
      await this.whatsappService.sendWithMenu(phone, msg);
      return `<html><body><h2>✅ Google Calendar connected as ${email}!</h2><p>You can close this window and go back to WhatsApp.</p></body></html>`;
    } catch (e) {
      this.logger.error('Google OAuth callback error:', e);
      return `<html><body><h2>❌ Authentication failed.</h2><p>${e.message}</p></body></html>`;
    }
  }

  @Get('status')
  async status() {
    return { message: 'Google Calendar integration is active.' };
  }
}
