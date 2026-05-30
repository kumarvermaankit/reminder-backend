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
import { NoteService } from './services/note.service';
import { PasswordService } from './services/password.service';
import { EncryptionService } from './services/encryption.service';
import { UserContextService } from './services/user-context.service';
import { TodoListService } from './services/todo-list.service';
import { ListWorkflowService } from './services/list-workflow.service';
import { Reminder } from './entities/reminder.entity';
import { ReminderSchedule } from './entities/reminder-schedule.entity';
import { User } from './entities/user.entity';
import { Note } from './entities/note.entity';
import { Password } from './entities/password.entity';
import { UserContextEntity } from './entities/user-context.entity';
import { TodoList } from './entities/todo-list.entity';
import { TodoItem } from './entities/todo-item.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'reminder_app',
      entities: [Reminder, ReminderSchedule, User, Note, Password, UserContextEntity, TodoList, TodoItem],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Reminder, ReminderSchedule, User, Note, Password, UserContextEntity, TodoList, TodoItem])  ],
  controllers: [AppController, ReminderController, AiController, WhatsappController],
  providers: [AppService, ReminderService, UserService, WhatsappService, AiService, SimpleAiService, McpAgentService, SchedulerService, NotificationService, NoteService, PasswordService, EncryptionService, UserContextService, TodoListService, ListWorkflowService],
})
export class AppModule {}
