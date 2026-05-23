import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { ReminderController } from './controllers/reminder.controller';
import { AiController } from './controllers/ai.controller';
import { WhatsappController } from './controllers/whatsapp.controller';
import { AppService } from './app.service';
import { ReminderService } from './services/reminder.service';
import { SchedulerService } from './services/scheduler.service';
import { NotificationService } from './services/notification.service';
import { WhatsappService } from './services/whatsapp.service';
import { UserService } from './services/user.service';
import { AiService } from './services/ai.service';
import { SimpleAiService } from './services/simple-ai.service';
import { McpAgentService } from './mcp/agent/mcp-agent.service';
import { Reminder } from './entities/reminder.entity';
import { ReminderSchedule } from './entities/reminder-schedule.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_DATABASE || './data/reminder.db',
      entities: [Reminder, ReminderSchedule, User],
      synchronize: true, // Only for development - auto creates schema
    }),
    TypeOrmModule.forFeature([Reminder, ReminderSchedule, User])  ],
  controllers: [AppController, AiController, WhatsappController],
  providers: [AppService, ReminderService, UserService, WhatsappService, AiService, SimpleAiService, McpAgentService],
})
export class AppModule {}
