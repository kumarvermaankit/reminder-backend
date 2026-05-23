import { Injectable, Logger } from '@nestjs/common';
import { SimpleAiService } from '../../services/simple-ai.service';

@Injectable()
export class McpAgentService {
  private readonly logger = new Logger(McpAgentService.name);

  constructor(private readonly aiService: SimpleAiService) {}

  // Simplified service that just delegates to AI service
  async processReminder(input: { userInput: string; userId?: string }) {
    this.logger.log(`Processing reminder: "${input.userInput}"`);
    
    try {
      const parsedReminder = await this.aiService.parseReminderInput(input.userInput, input.userId);
      const response = await this.aiService.generateBasicResponse(input.userInput, parsedReminder);
      
      return {
        success: true,
        parsedReminder,
        response
      };
    } catch (error) {
      this.logger.error('Processing failed:', error);
      return {
        success: false,
        response: "I had trouble understanding that. Could you try rephrasing?",
        error: error.message
      };
    }
  }
}
