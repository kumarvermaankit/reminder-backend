import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthUser } from '../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.authService.getProfile(authUser.id);
    return { success: true, user };
  }
}
