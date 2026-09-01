import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller';
import { ReminderController } from './controllers/reminder.controller';
import { AiController } from './controllers/ai.controller';
import { WhatsappController } from './controllers/whatsapp.controller';
import { AuthController } from './controllers/auth.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { AppService } from './app.service';
import { ReminderService } from './services/reminder.service';
import { SchedulerService } from './services/scheduler.service';
import { NotificationService } from './services/notification.service';
import { WhatsappService } from './services/whatsapp.service';
import { UserService } from './services/user.service';
import { AiService } from './services/ai.service';
import { SimpleAiService } from './services/simple-ai.service';
import { McpAgentService } from './mcp/agent/mcp-agent.service';
import { NoteService } from './services/note.service';
import { PasswordService } from './services/password.service';
import { EncryptionService } from './services/encryption.service';
import { UserContextService } from './services/user-context.service';
import { TodoListService } from './services/todo-list.service';
import { ListWorkflowService } from './services/list-workflow.service';
import { StockService } from './services/stock.service';
import { CricketService } from './services/cricket.service';
import { IpoService } from './services/ipo.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { CalorieService } from './services/calorie.service';
import { CalorieHandlerService } from './services/calorie-handler.service';
import { RazorpayPaymentService } from './services/razorpay-payment.service';
import { PlanGuardService } from './services/plan-guard.service';
import { InactivityService } from './services/inactivity.service';
import { GoogleCalendarController } from './controllers/google-calendar.controller';
import { RazorpayController } from './controllers/razorpay.controller';
import { GoogleToken } from './entities/google-token.entity';
import { Reminder } from './entities/reminder.entity';
import { ReminderSchedule } from './entities/reminder-schedule.entity';
import { User } from './entities/user.entity';
import { Note } from './entities/note.entity';
import { Password } from './entities/password.entity';
import { UserContextEntity } from './entities/user-context.entity';
import { TodoList } from './entities/todo-list.entity';
import { TodoItem } from './entities/todo-item.entity';
import { CalorieProfile } from './entities/calorie-profile.entity';
import { FoodLog } from './entities/food-log.entity';
import { Payment } from './entities/payment.entity';
import { Coupon } from './entities/coupon.entity';
import { CouponService } from './services/coupon.service';
import { AuthService } from './services/auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'ping-dev-secret-change-me',
        signOptions: { expiresIn: '30d' },
      }),
    }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'reminder_app',
      // Store/read DATETIME as UTC so IST hosts don't shift reminder_at by +5:30
      timezone: 'Z',
      entities: [Reminder, ReminderSchedule, User, Note, Password, UserContextEntity, TodoList, TodoItem, GoogleToken, CalorieProfile, FoodLog, Payment, Coupon],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Reminder, ReminderSchedule, User, Note, Password, UserContextEntity, TodoList, TodoItem, GoogleToken, CalorieProfile, FoodLog, Payment, Coupon])  ],
  controllers: [AppController, ReminderController, AiController, WhatsappController, GoogleCalendarController, RazorpayController, AuthController, DashboardController],
  providers: [AppService, ReminderService, UserService, WhatsappService, AiService, SimpleAiService, McpAgentService, SchedulerService, NotificationService, NoteService, PasswordService, EncryptionService, UserContextService, TodoListService, ListWorkflowService, StockService, CricketService, IpoService, GoogleCalendarService, CalorieService, CalorieHandlerService, RazorpayPaymentService, PlanGuardService, CouponService, AuthService, JwtAuthGuard, InactivityService],
})
export class AppModule {}
