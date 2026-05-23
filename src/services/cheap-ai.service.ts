import { Injectable, Logger } from '@nestjs/common';
import { UnifiedAiService } from './unified-ai.service';
import { ParsedReminder } from '../types/parsed-reminder.interface';

@Injectable()
export class CheapAiService {
  private readonly logger = new Logger(CheapAiService.name);

  constructor(private readonly unifiedAi: UnifiedAiService) {}

  async parseReminderInput(userInput: string, userId?: string): Promise<ParsedReminder> {
    return await this.unifiedAi.parseReminderInput(userInput, userId);
  }

  async generateBasicResponse(userInput: string, reminder?: ParsedReminder): Promise<string> {
    return await this.unifiedAi.generateBasicResponse(userInput, reminder);
  }

  async detectTaskCompletion(userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    return await this.unifiedAi.detectTaskCompletion(userInput, userReminders);
  }

  async suggestReminders(userId: string): Promise<string[]> {
    return await this.unifiedAi.suggestReminders(userId);
  }

  // Admin method to get provider status
  getProviderStatus() {
    return this.unifiedAi.getProviderStatus();
  }
}
