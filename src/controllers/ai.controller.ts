import { Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import { AiService } from '../services/ai.service';
import { ReminderService } from '../services/reminder.service';
import { UserService } from '../services/user.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly reminderService: ReminderService,
    private readonly userService: UserService,
  ) {}

  @Post('parse')
  async parseReminder(@Body() body: { input: string; userId?: string }) {
    const { input, userId } = body;
    
    try {
      // Parse the natural language input
      const parsedReminder = await this.aiService.parseReminderInput(input, userId);
      
      // Generate AI response
      const response = await this.aiService.generateBasicResponse(input, parsedReminder);
      
      // If high confidence and no clarification needed, create the reminder
      let createdReminder = null;
      if (parsedReminder.confidence > 0.7 && !parsedReminder.needsClarification && userId) {
        // Ensure user exists before creating reminder
        let user = await this.userService.getUserById(userId);
        if (!user) {
          // Create user if doesn't exist
          user = await this.userService.createUser({
            id: userId,
            phone: userId, // Using userId as phone number for simplicity
            email: `${userId}@example.com`, // Add required email field
            name: `User ${userId}`,
            isActive: true
          });
        }
        
        createdReminder = await this.reminderService.createReminder({
          userId,
          title: parsedReminder.title,
          description: parsedReminder.description,
          reminderDate: parsedReminder.reminderDate,
          isCompleted: false,
          metadata: {
            category: parsedReminder.category,
            priority: parsedReminder.priority,
            recurring: parsedReminder.recurring,
            source: 'ai'
          }
        });
      }
      
      return {
        success: true,
        response,
        parsedReminder,
        createdReminder,
        needsClarification: parsedReminder.needsClarification,
        clarificationQuestion: parsedReminder.clarificationQuestion
      };
    } catch (error) {
      console.log(error.stack);
      return {
        success: false,
        error: error.message,
        response: "I had trouble understanding that. Could you try rephrasing?"
      };
    }
  }

  @Post('chat')
  async chat(@Body() body: { message: string; userId?: string; context?: any }) {
    const { message, userId, context } = body;
    
    try {
      // For simple chat, just generate a response
      const response = await this.aiService.generateBasicResponse(message);
      
      return {
        success: true,
        response,
        suggestions: await this.aiService.suggestReminders(userId)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        response: "I'm having trouble right now. Please try again later."
      };
    }
  }

  @Get('suggestions')
  async getSuggestions(@Query('userId') userId?: string) {
    try {
      const suggestions = await this.aiService.suggestReminders(userId);
      return {
        success: true,
        suggestions
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        suggestions: []
      };
    }
  }

  @Post('clarify')
  async handleClarification(@Body() body: { 
    originalInput: string; 
    clarification: string; 
    userId?: string 
  }) {
    const { originalInput, clarification, userId } = body;
    
    try {
      // Combine original input with clarification
      const combinedInput = `${originalInput}. ${clarification}`;
      
      // Parse again with more context
      const parsedReminder = await this.aiService.parseReminderInput(combinedInput, userId);
      
      const response = await this.aiService.generateBasicResponse(combinedInput, parsedReminder);
      
      // Create reminder if we have enough info
      let createdReminder = null;
      if (parsedReminder.confidence > 0.6 && userId) {
        createdReminder = await this.reminderService.createReminder({
          userId,
          title: parsedReminder.title,
          description: parsedReminder.description,
          reminderDate: parsedReminder.reminderDate,
          isCompleted: false,
          metadata: {
            category: parsedReminder.category,
            priority: parsedReminder.priority,
            recurring: parsedReminder.recurring,
            source: 'ai',
            clarificationNeeded: true
          }
        });
      }
      
      return {
        success: true,
        response,
        parsedReminder,
        createdReminder,
        needsClarification: parsedReminder.needsClarification
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        response: "I'm still having trouble understanding. Could you provide more specific details?"
      };
    }
  }

  @Get('examples')
  async getExamples() {
    return {
      examples: [
        "Remind me to call mom tomorrow at 3pm",
        "Take medicine every morning at 8am",
        "Meeting with team at 2pm today",
        "Exercise for 30 minutes daily",
        "Pay rent on the 1st of each month"
      ]
    };
  }

  @Get('status')
  async getAiStatus() {
    try {
      const status = this.aiService.getProviderStatus();
      return {
        success: true,
        providers: status,
        totalProviders: status.length,
        message: "AI providers status retrieved successfully"
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: "Failed to get AI provider status"
      };
    }
  }

  @Post('test-connection')
  async testAiConnection(@Body() body: { provider?: string }) {
    try {
      const testInput = "Test connection - remind me to test AI";
      const result = await this.aiService.parseReminderInput(testInput, "test-user");
      
      return {
        success: true,
        message: "AI connection successful",
        parsedResult: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: "AI connection failed",
        timestamp: new Date().toISOString()
      };
    }
  }
}
