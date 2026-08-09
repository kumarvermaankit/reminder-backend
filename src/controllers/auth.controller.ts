import { Controller, Post, Get, Body, UseGuards, HttpCode, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../services/auth.service';
import { GoogleCalendarService } from '../services/google-calendar.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthUser } from '../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() body: { email: string; password: string; name: string; phone?: string },
  ) {
    try {
      const result = await this.authService.register(body);
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Registration failed',
        statusCode: error.status || 400,
      };
    }
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email: string; password: string }) {
    try {
      const result = await this.authService.login(body.email, body.password);
      return { success: true, ...result };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Login failed',
        statusCode: error.status || 401,
      };
    }
  }

  @Post('claim-phone')
  @UseGuards(JwtAuthGuard)
  async claimPhone(@CurrentUser() authUser: AuthUser, @Body() body: { phone: string; password: string }) {
    try {
      const user = await this.authService.claimUserByPhone(authUser.id, body.phone, body.password);
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to link WhatsApp number',
        statusCode: error.status || 400,
      };
    }
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser() authUser: AuthUser,
    @Body() body: { name?: string; phone?: string; country?: string; force?: boolean },
  ) {
    try {
      const user = await this.authService.updateProfile(authUser.id, body, !!body.force);
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to update profile',
        statusCode: error.status || 400,
        ...(error.phoneConflict ? { phoneConflict: true } : {}),
      };
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.authService.getProfile(authUser.id);
    return { success: true, user };
  }

  @Get('google')
  async googleLogin(@Res() res: Response) {
    const url = this.googleCalendarService.getLoginAuthUrl();
    return res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://heyping.in';
    try {
      if (!code || state !== 'ping-login') {
        return res.redirect(`${frontendUrl}/auth/callback?error=google_failed`);
      }
      const { email, name } = await this.googleCalendarService.getLoginUserInfo(code);
      const result = await this.authService.loginWithGoogle(email, name);
      this.logger.log(`Google login: ${result.user.id} email=${email}`);
      const url = new URL(`${frontendUrl}/auth/callback`);
      url.searchParams.set('token', result.token);
      return res.redirect(url.toString());
    } catch (error) {
      this.logger.error('Google login callback error:', error.message);
      return res.redirect(`${frontendUrl}/auth/callback?error=google_failed`);
    }
  }
}
