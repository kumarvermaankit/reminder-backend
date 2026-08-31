import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Reminder } from '../entities/reminder.entity';
import { WhatsappService } from './whatsapp.service';
import { UserService } from './user.service';
import { TodoListService } from './todo-list.service';
import { StockService } from './stock.service';
import { CricketService } from './cricket.service';
import { IpoService } from './ipo.service';
import { PlanGuardService } from './plan-guard.service';

describe('NotificationService - sendInactivityWarning', () => {
  let service: NotificationService;
  let whatsappService: any;

  const mockWhatsappService = {
    sendInteractiveMessage: jest.fn(),
    sendTemplateMessage: jest.fn(),
    sendWithMenu: jest.fn(),
    sendMessage: jest.fn(),
  };

  const mockUserService = {};
  const mockTodoListService = {};
  const mockStockService = {};
  const mockCricketService = {};
  const mockIpoService = {};
  const mockPlanGuardService = {};
  const mockUserRepo = { find: jest.fn(), findOne: jest.fn(), update: jest.fn() };
  const mockReminderRepo = { find: jest.fn(), findOne: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: WhatsappService, useValue: mockWhatsappService },
        { provide: UserService, useValue: mockUserService },
        { provide: TodoListService, useValue: mockTodoListService },
        { provide: StockService, useValue: mockStockService },
        { provide: CricketService, useValue: mockCricketService },
        { provide: IpoService, useValue: mockIpoService },
        { provide: PlanGuardService, useValue: mockPlanGuardService },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Reminder), useValue: mockReminderRepo },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    whatsappService = module.get(WhatsappService);
  });

  describe('sendInactivityWarning', () => {
    it('should send interactive message with Hello button', async () => {
      const user = {
        id: 'user-1',
        phone: '1234567890',
        name: 'Alice',
        lastMessageTime: new Date(Date.now() - 48 * 60 * 60 * 1000),
      } as User;

      const reminder = {
        id: 'rem-1',
        title: 'Drink water',
      };

      mockWhatsappService.sendInteractiveMessage.mockResolvedValue('msg-id');

      await service.sendInactivityWarning(user, reminder);

      expect(whatsappService.sendInteractiveMessage).toHaveBeenCalledWith(
        '1234567890',
        expect.stringContaining('Alice'),
        expect.arrayContaining([
          expect.objectContaining({
            id: 'hello_resume_reminders',
            title: expect.stringContaining('Hello'),
          }),
        ])
      );
    });

    it('should include reminder title in message', async () => {
      const user = {
        id: 'user-2',
        phone: '0987654321',
        name: 'Bob',
        lastMessageTime: new Date(Date.now() - 72 * 60 * 60 * 1000),
      } as User;

      const reminder = {
        id: 'rem-2',
        title: 'Take medicine',
      };

      mockWhatsappService.sendInteractiveMessage.mockResolvedValue('msg-id');

      await service.sendInactivityWarning(user, reminder);

      const messageCall = mockWhatsappService.sendInteractiveMessage.mock.calls[0][1];
      expect(messageCall).toContain('Take medicine');
    });

    it('should handle user with no name', async () => {
      const user = {
        id: 'user-3',
        phone: '1122334455',
        name: 'there',
        lastMessageTime: null,
      } as User;

      const reminder = {
        id: 'rem-3',
        title: 'Call mom',
      };

      mockWhatsappService.sendInteractiveMessage.mockResolvedValue('msg-id');

      await service.sendInactivityWarning(user, reminder);

      const messageCall = mockWhatsappService.sendInteractiveMessage.mock.calls[0][1];
      expect(messageCall).toContain('Hey!');
      expect(messageCall).not.toContain('Hey there!');
    });

    it('should handle user with custom name', async () => {
      const user = {
        id: 'user-4',
        phone: '5566778899',
        name: 'Charlie',
        lastMessageTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
      } as User;

      const reminder = {
        id: 'rem-4',
        title: 'Meeting prep',
      };

      mockWhatsappService.sendInteractiveMessage.mockResolvedValue('msg-id');

      await service.sendInactivityWarning(user, reminder);

      const messageCall = mockWhatsappService.sendInteractiveMessage.mock.calls[0][1];
      expect(messageCall).toContain('Hey Charlie!');
    });

    it('should handle reminder with no title', async () => {
      const user = {
        id: 'user-5',
        phone: '9988776655',
        name: 'Dave',
        lastMessageTime: new Date(Date.now() - 36 * 60 * 60 * 1000),
      } as User;

      const reminder = {
        id: 'rem-5',
        title: null,
      };

      mockWhatsappService.sendInteractiveMessage.mockResolvedValue('msg-id');

      await service.sendInactivityWarning(user, reminder);

      const messageCall = mockWhatsappService.sendInteractiveMessage.mock.calls[0][1];
      expect(messageCall).toContain('your reminder');
    });

    it('should not throw if send fails', async () => {
      const user = {
        id: 'user-6',
        phone: '1231231234',
        name: 'Eve',
        lastMessageTime: new Date(Date.now() - 48 * 60 * 60 * 1000),
      } as User;

      const reminder = {
        id: 'rem-6',
        title: 'Test',
      };

      mockWhatsappService.sendInteractiveMessage.mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(service.sendInactivityWarning(user, reminder)).resolves.toBeUndefined();
    });
  });
});
