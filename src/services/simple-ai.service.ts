import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Groq } from 'groq-sdk';
import { Together } from 'together-ai';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedReminder } from '../types/parsed-reminder.interface';

interface AIProvider {
  name: string;
  client: any;
  models: {
    parsing: string;
    response: string;
    completion: string;
  };
  priority: number;
  costPerRequest: number;
}

@Injectable()
export class SimpleAiService {
  private readonly logger = new Logger(SimpleAiService.name);
  private providers: AIProvider[] = [];

  constructor(private readonly configService: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Groq - First priority (free tier)
    const groqApiKey = this.configService.get<string>('GROQ_API_KEY');
    if (groqApiKey) {
      this.providers.push({
        name: 'groq',
        client: new Groq({ apiKey: groqApiKey }),
        models: {
          parsing: 'llama-3.3-70b-versatile',
          response: 'llama-3.3-70b-versatile',
          completion: 'llama-3.3-70b-versatile'
        },
        priority: 1,
        costPerRequest: 0.000
      });
    }

    // Together AI - Second priority (free tier)
    const togetherApiKey = this.configService.get<string>('TOGETHER_API_KEY');
    if (togetherApiKey) {
      this.providers.push({
        name: 'together',
        client: new Together({ apiKey: togetherApiKey }),
        models: {
          parsing: 'meta-llama/Llama-3-8b-chat-hf',
          response: 'meta-llama/Llama-3-8b-chat-hf',
          completion: 'meta-llama/Llama-3-8b-chat-hf'
        },
        priority: 2,
        costPerRequest: 0.0008
      });
    }

    // Replicate - Third priority (free credits)
    const replicateApiToken = this.configService.get<string>('REPLICATE_API_TOKEN');
    if (replicateApiToken) {
      this.providers.push({
        name: 'replicate',
        client: new Replicate({ auth: replicateApiToken }),
        models: {
          parsing: 'meta/meta-llama-3-8b-instruct',
          response: 'meta/meta-llama-3-8b-instruct',
          completion: 'meta/meta-llama-3-8b-instruct'
        },
        priority: 3,
        costPerRequest: 0.001
      });
    }

    this.listGeminiModels();

    // Google Gemini - Final fallback (paid)
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (geminiApiKey) {
      this.providers.push({
        name: 'gemini',
        client: new GoogleGenerativeAI(geminiApiKey),
        models: {
          parsing: 'gemini-3-flash-preview',
          response: 'gemini-3-flash-preview',
          completion: 'gemini-3-flash-preview'
        },
        priority: 99,
        costPerRequest: 0.001
      });
    }

    // Add debug logging
    this.logger.log('Checking API keys:');
    this.logger.log('GROQ_API_KEY:', groqApiKey ? 'FOUND' : 'NOT FOUND');
    this.logger.log('TOGETHER_API_KEY:', togetherApiKey ? 'FOUND' : 'NOT FOUND');
    this.logger.log('REPLICATE_API_TOKEN:', replicateApiToken ? 'FOUND' : 'NOT FOUND');
    this.logger.log('GEMINI_API_KEY:', geminiApiKey ? 'FOUND' : 'NOT FOUND');

    // Sort by priority
    this.providers.sort((a, b) => a.priority - b.priority);
    this.logger.log(`Initialized ${this.providers.length} AI providers`);
    
    // Debug: List available Gemini models
    this.listGeminiModels();
  }

  private async listGeminiModels() {
    const geminiApiKey = this.configService.get<string>('GEMINI_API_KEY');
    const genAI = new GoogleGenerativeAI(process.env.API_KEY);
    const customerModels = await genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    console.log(customerModels);
    // if (geminiApiKey) {
    //   try {
    //     // Try to make a simple API call to see what models are available
    //     const genAI = new GoogleGenerativeAI(geminiApiKey);
    //     const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    //     this.logger.log('Testing Gemini Pro model availability...');
        
    //     // Simple test to see if the model works
    //     const result = await model.generateContent('Test');
    //     this.logger.log('Gemini Pro model is available and working');
    //   } catch (error) {
    //     this.logger.error('Gemini Pro model test failed:', error.message);
        
    //     // Try alternative models
    //     const alternativeModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro-vision'];
    //     for (const modelName of alternativeModels) {
    //       try {
    //         const genAI = new GoogleGenerativeAI(geminiApiKey);
    //         const model = genAI.getGenerativeModel({ model: modelName });
    //         await model.generateContent('Test');
    //         this.logger.log(`✅ ${modelName} is available!`);
    //         break;
    //       } catch (err) {
    //         this.logger.log(`❌ ${modelName} failed: ${err.message}`);
    //       }
    //     }
    //   }
    // }
  }

  private async selectProvider(): Promise<AIProvider | null> {
    // Simple selection - just return the first available provider
    return this.providers.length > 0 ? this.providers[0] : null;
  }

  async parseReminderInput(userInput: string, userId?: string, timezone?: string): Promise<ParsedReminder> {
    const provider = await this.selectProvider();
    if (!provider) {
      throw new Error('No AI providers available');
    }

    try {
      switch (provider.name) {
        case 'groq':
          return await this.parseWithGroq(provider, userInput, timezone);
        case 'together':
          return await this.parseWithTogether(provider, userInput, timezone);
        case 'replicate':
          return await this.parseWithReplicate(provider, userInput, timezone);
        case 'gemini':
          return await this.parseWithGemini(provider, userInput, timezone);
        default:
          throw new Error(`Unknown provider: ${provider.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse with ${provider.name}:`, error);
      // Try next provider
      if (this.providers.length > 1) {
        this.providers.shift(); // Remove failed provider
        return this.parseReminderInput(userInput, userId, timezone);
      }
      throw error;
    }
  }

  async generateBasicResponse(userInput: string, reminder?: ParsedReminder): Promise<string> {
    const provider = await this.selectProvider();
    if (!provider) {
      return "I got you! I'll help set that reminder.";
    }

    try {
      switch (provider.name) {
        case 'groq':
          return await this.generateWithGroq(provider, userInput, reminder);
        case 'together':
          return await this.generateWithTogether(provider, userInput, reminder);
        case 'replicate':
          return await this.generateWithReplicate(provider, userInput, reminder);
        case 'gemini':
          return await this.generateWithGemini(provider, userInput, reminder);
        default:
          return this.getStaticResponse(userInput, reminder);
      }
    } catch (error) {
      this.logger.error(`Failed to generate response with ${provider.name}:`, error);
      return this.getStaticResponse(userInput, reminder);
    }
  }

  async detectTaskCompletion(userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const provider = await this.selectProvider();
    if (!provider) {
      return { completed: false, response: "Got it!" };
    }

    try {
      switch (provider.name) {
        case 'groq':
          return await this.detectCompletionWithGroq(provider, userInput, userReminders);
        case 'together':
          return await this.detectCompletionWithTogether(provider, userInput, userReminders);
        case 'replicate':
          return await this.detectCompletionWithReplicate(provider, userInput, userReminders);
        case 'gemini':
          return await this.detectCompletionWithGemini(provider, userInput, userReminders);
        default:
          return { completed: false, response: "Got it!" };
      }
    } catch (error) {
      this.logger.error(`Failed to detect completion with ${provider.name}:`, error);
      return { completed: false, response: "Got it!" };
    }
  }

  async suggestReminders(userId: string): Promise<string[]> {
    // Static suggestions (free!)
    return [
      "Take medication",
      "Drink water",
      "Exercise for 30 minutes",
      "Call family",
      "Read a book",
      "Meditate",
      "Prepare healthy meal",
      "Review calendar",
      "Clean workspace",
      "Plan tomorrow"
    ];
  }

  getProviderStatus() {
    return this.providers.map(p => ({
      name: p.name,
      priority: p.priority,
      costPerRequest: p.costPerRequest,
      models: p.models
    }));
  }

  
  // Provider-specific methods
  private async parseWithGroq(provider: AIProvider, userInput: string, timezone?: string): Promise<ParsedReminder> {
    const tzInfo = timezone ? ` (${timezone})` : '';
    const prompt = `Parse this user message: "${userInput}"
    
Current date: ${new Date().toISOString()}${tzInfo}

First, determine the actionType:
- "create_reminder" = user wants a reminder for something
- "save_note" = user wants to save information ("save that my email is X", "remember my address is Y", "note this down")
- "get_note" = user wants to retrieve saved info ("what's my email?", "get my saved address")
- "save_password" = user wants to save a password for a service ("save my facebook password as abc123", "store password for gmail as mypass")
- "get_password" = user wants a saved password ("what's my facebook password?", "get gmail password")
- "unknown" = casual chat, greeting, etc.

Return JSON with:
{
  "actionType": "create_reminder|save_note|get_note|save_password|get_password|unknown",
  "title": "brief title (for reminders)",
  "description": "full description (for reminders)",
  "reminderDate": "ISO datetime (for reminders)",
  "priority": "low|medium|high",
  "category": "work|personal|health|finance|other",
  "intervalMinutes": "CRITICAL: extract repeat interval in minutes ONLY if user mentions 'every X minutes/hours' or 'every X min'",
  "confidence": 0.0-1.0,
  "needsClarification": true/false,
  "clarificationQuestion": "if needed",
  "noteKey": "descriptive key/title for the note (save_note/get_note only, e.g. 'email', 'address')",
  "noteContent": "the content to save (save_note only)",
  "serviceName": "service name (save_password/get_password only, e.g. 'facebook', 'gmail')",
  "password": "the password to save (save_password only, NEVER include this for get_password)"
}

Rules:
- morning=9am, afternoon=2pm, evening=6pm, night=8pm
- tomorrow/today=10am default
- medicine=daily morning
- Only ask if truly unclear
- Be confident when you can infer`;

    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are a reminder assistant. Return valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from Groq');
    }

    const parsed = JSON.parse(content);
    
    // Convert string date to Date object
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }

    return parsed;
  }

  private async parseWithGemini(provider: AIProvider, userInput: string, timezone?: string): Promise<ParsedReminder> {
    const model = provider.client.getGenerativeModel({ model: provider.models.parsing });
    const tzInfo = timezone ? ` User timezone: ${timezone}` : '';
    
    const prompt = `Parse: "${userInput}"
Current time: ${new Date().toISOString()}${tzInfo}
Determine actionType: create_reminder, save_note, get_note, save_password, get_password, unknown.
Return JSON with actionType, title, description, reminderDate (ISO), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password`;

    const response = await model.generateContent(prompt);
    console.log(response.response.text());
    let content = response.response.text();
    
    // Remove markdown code blocks if present
    if (content.includes('```json')) {
      content = content.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (content.includes('```')) {
      content = content.replace(/```\s*/, '').replace(/```\s*$/, '');
    }
    
    // Clean up any extra whitespace
    content = content.trim();
    
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string, timezone?: string): Promise<ParsedReminder> {
    const tzInfo = timezone ? ` User timezone: ${timezone}` : '';
    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are an assistant that detects intent: create_reminder, save_note, get_note, save_password, get_password, unknown. Return valid JSON.' },
        { role: 'user', content: `Parse: "${userInput}". Current time: ${new Date().toISOString()}${tzInfo}. Return JSON with actionType, title, description, reminderDate (ISO), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password` }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content;
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  private async parseWithReplicate(provider: AIProvider, userInput: string, timezone?: string): Promise<ParsedReminder> {
    const tzInfo = timezone ? ` User timezone: ${timezone}` : '';
    const prompt = `Parse: "${userInput}"\nCurrent time: ${new Date().toISOString()}${tzInfo}\n\nDetermine actionType: create_reminder, save_note, get_note, save_password, get_password, unknown. Return JSON with actionType, title, description, reminderDate (ISO), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password`;
    
    const response = await provider.client.run(provider.models.parsing, {
      input: {
        prompt: `You are an intent detection assistant. Return valid JSON.\n\n${prompt}`,
        max_tokens: 300,
        temperature: 0.3
      }
    });

    const content = response.join('');
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  private async generateWithGroq(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = reminder 
      ? `User said: "${userInput}"\nI understood this as a reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}\nGenerate a friendly, casual confirmation response.`
      : `User said: "${userInput}"\nThis doesn't seem like a reminder. Just respond conversationally and naturally without mentioning reminders.`;

    const response = await provider.client.chat.completions.create({
      model: provider.models.response,
      messages: [
        { role: 'system', content: 'You are a friendly AI assistant. Be casual and use emojis.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithGemini(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const model = provider.client.getGenerativeModel({ model: provider.models.response });
    
    const prompt = reminder 
      ? `User: "${userInput}". Reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}. Friendly confirmation:`
      : `User: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

    const response = await model.generateContent(prompt);
    let content = response.response.text();
    
    // Remove markdown code blocks if present
    if (content.includes('```')) {
      content = content.replace(/```\s*/, '').replace(/```\s*$/, '');
    }
    
    return content || "I got you! I'll help set that reminder.";
  }

  private async generateWithTogether(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = reminder 
      ? `User said: "${userInput}". Reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}. Generate a friendly confirmation response.`
      : `User said: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

    const response = await provider.client.chat.completions.create({
      model: provider.models.response,
      messages: [
        { role: 'system', content: 'You are a friendly AI assistant. Be casual and use emojis.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithReplicate(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = reminder 
      ? `User said: "${userInput}". Reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}. Generate a friendly confirmation response.`
      : `User said: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

    const response = await provider.client.run(provider.models.response, {
      input: {
        prompt: `You are a friendly AI assistant. Be casual and use emojis.\n\n${prompt}`,
        max_tokens: 100,
        temperature: 0.8
      }
    });

    return response.join('') || "I got you! I'll help set that reminder.";
  }

  private async detectCompletionWithGroq(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}, Created: ${r.createdAt}`).join('\n');
    
    const response = await provider.client.chat.completions.create({
      model: provider.models.completion,
      messages: [
        { 
          role: 'system', 
          content: `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" without specifying which one, match the LAST/most recent reminder in the list. The reminderId MUST be one of the IDs listed below - never invent one.

User reminders:\n${remindersText}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}` 
        },
        { role: 'user', content: userInput }
      ],
      temperature: 0.3,
      max_tokens: 150
    });

    const content = response.choices[0]?.message?.content;
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithGemini(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const model = provider.client.getGenerativeModel({ model: provider.models.completion });
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}, Created: ${r.createdAt}`).join('\n');
    
    const prompt = `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.
User reminders:
${remindersText}

User: ${userInput}

Return JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;

    const response = await model.generateContent(prompt);
    let content = response.response.text();
    
    // Remove markdown code blocks if present
    if (content.includes('```json')) {
      content = content.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (content.includes('```')) {
      content = content.replace(/```\s*/, '').replace(/```\s*$/, '');
    }
    
    // Clean up any extra whitespace
    content = content.trim();
    
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithTogether(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}, Created: ${r.createdAt}`).join('\n');
    
    const response = await provider.client.chat.completions.create({
      model: provider.models.completion,
      messages: [
        { 
          role: 'system', 
          content: `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.\n\nUser reminders:\n${remindersText}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}` 
        },
        { role: 'user', content: userInput }
      ],
      temperature: 0.3,
      max_tokens: 150
    });

    const content = response.choices[0]?.message?.content;
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithReplicate(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}, Created: ${r.createdAt}`).join('\n');
    
    const prompt = `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.\n\nUser reminders:\n${remindersText}\n\nUser: ${userInput}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;
    
    const response = await provider.client.run(provider.models.completion, {
      input: {
        prompt: prompt,
        max_tokens: 150,
        temperature: 0.3
      }
    });

    const content = response.join('');
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private getStaticResponse(userInput: string, reminder?: ParsedReminder): string {
    if (reminder) {
      const responses = [
        `Got it! ${reminder.title} reminder set for ${reminder.reminderDate?.toLocaleString()} 🎉`,
        `Sure thing! ${reminder.title} reminder scheduled for ${reminder.reminderDate?.toLocaleString()} ✅`,
        `You got it! I'll remind you about ${reminder.title} ${reminder.reminderDate?.toLocaleString()} 🔔`
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    } else {
      const casualResponses = [
        "Hey! How can I help you today?",
        "Got it! Let me know if you need anything.",
        "👋 I'm here if you need to set a reminder or just chat!"
      ];
      return casualResponses[Math.floor(Math.random() * casualResponses.length)];
    }
  }
}
