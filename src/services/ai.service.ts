import { Injectable, Logger } from '@nestjs/common';
import { SimpleAiService } from './simple-ai.service';
import { ParsedReminder } from '../types/parsed-reminder.interface';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly simpleAiService: SimpleAiService) {}

  async parseReminderInput(
    userInput: string,
    userId?: string,
    conversation?: { role: string; text: string }[],
    pendingReminders?: { id: string; title: string }[],
    msgTimestamp?: Date,
    timezone?: string,
  ): Promise<ParsedReminder> {
    return await this.simpleAiService.parseReminderInput(userInput, userId, conversation, pendingReminders, msgTimestamp, timezone);
  }

  async transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
    return await this.simpleAiService.transcribeAudio(buffer, mimeType);
  }

  async generateBasicResponse(userInput: string, reminder?: ParsedReminder): Promise<string> {
    return await this.simpleAiService.generateBasicResponse(userInput, reminder);
  }

  private buildParsingPrompt(userInput: string): string {
    const currentDate = new Date().toISOString();
    return `Parse this reminder request: "${userInput}"
    
    Current date and time: ${currentDate}
    
    Extract all relevant information and return structured JSON.`;
  }

  private buildResponsePrompt(userInput: string, reminder?: ParsedReminder): string {
    if (reminder) {
      return `User said: "${userInput}"
      
      I parsed this reminder:
      - Title: ${reminder.title}
      - Date: ${reminder.reminderDate?.toLocaleString()}
      - Priority: ${reminder.priority || 'medium'}
      ${reminder.needsClarification ? `- Needs clarification: ${reminder.clarificationQuestion}` : ''}
      
      Generate a friendly response confirming this or asking for clarification.`;
    } else {
      return `User said: "${userInput}"
      
      Generate a friendly response asking for more details to create a reminder.`;
    }
  }

  private getFallbackResponse(userInput: string): ParsedReminder {
    return {
      title: userInput.substring(0, 50),
      description: userInput,
      reminderDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      confidence: 0.3,
      needsClarification: true,
      clarificationQuestion: "When would you like me to remind you about this?"
    };
  }

  async detectTaskCompletion(userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    return await this.simpleAiService.detectTaskCompletion(userInput, userReminders);
  }

  async suggestReminders(userId: string): Promise<string[]> {
    return await this.simpleAiService.suggestReminders(userId);
  }

  getProviderStatus() {
    return this.simpleAiService.getProviderStatus();
  }
}
