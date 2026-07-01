import { Injectable, Logger } from '@nestjs/common';
import { Groq } from 'groq-sdk';
import { Together } from 'together-ai';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedReminder } from '../types/parsed-reminder.interface';
import {
  SYSTEM_MESSAGE_PARSE_REMINDER,
  SYSTEM_MESSAGE_FRIENDLY_AI,
  SYSTEM_MESSAGE_DETECT_COMPLETION_UNIFIED,
  MULTI_PROVIDER_PARSE_PROMPT,
  MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT,
} from '../constants/ai-prompts';

interface AIProvider {
  name: string;
  client: any;
  freeQuota: {
    daily: number;
    monthly: number;
  };
  currentUsage: {
    daily: number;
    monthly: number;
    lastReset: {
      daily: Date;
      monthly: Date;
    };
  };
  priority: number; // Lower = higher priority
  costPerRequest: number;
  speed: number; // Lower = faster
  models: {
    parsing: string;
    response: string;
    completion: string;
  };
}

@Injectable()
export class MultiProviderAiService {
  private readonly logger = new Logger(MultiProviderAiService.name);
  private providers: AIProvider[] = [];
  private usageCache = new Map<string, any>();

  constructor() {
    this.initializeProviders();
    this.loadUsageFromCache();
  }

  private initializeProviders() {
    // Groq - Highest priority (free, fast)
    if (process.env.GROQ_API_KEY) {
      this.providers.push({
        name: 'groq',
        client: new Groq({ apiKey: process.env.GROQ_API_KEY }),
        freeQuota: { daily: 14000, monthly: 420000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 1,
        costPerRequest: 0.000,
        speed: 200,
        models: {
          parsing: 'llama-3.3-70b-versatile',
          response: 'llama-3.3-70b-versatile',
          completion: 'llama-3.3-70b-versatile'
        }
      });
    }

    // Together AI - Second priority (free tier)
    if (process.env.TOGETHER_API_KEY) {
      this.providers.push({
        name: 'together',
        client: new Together({ apiKey: process.env.TOGETHER_API_KEY }),
        freeQuota: { daily: 1000, monthly: 30000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 2,
        costPerRequest: 0.0008,
        speed: 400,
        models: {
          parsing: 'meta-llama/Llama-3-8b-chat-hf',
          response: 'meta-llama/Llama-3-8b-chat-hf',
          completion: 'meta-llama/Llama-3-8b-chat-hf'
        }
      });
    }

    // Replicate - Third priority (free credits)
    if (process.env.REPLICATE_API_TOKEN) {
      this.providers.push({
        name: 'replicate',
        client: new Replicate({ auth: process.env.REPLICATE_API_TOKEN }),
        freeQuota: { daily: 500, monthly: 15000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 3,
        costPerRequest: 0.001,
        speed: 600,
        models: {
          parsing: 'meta/meta-llama-3-8b-instruct',
          response: 'meta/meta-llama-3-8b-instruct',
          completion: 'meta/meta-llama-3-8b-instruct'
        }
      });
    }

    // Google Gemini - Final fallback (paid)
    if (process.env.GEMINI_API_KEY) {
      this.providers.push({
        name: 'gemini',
        client: new GoogleGenerativeAI(process.env.GEMINI_API_KEY),
        freeQuota: { daily: 60, monthly: 1800 }, // Gemini has free tier limits
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 99,
        costPerRequest: 0.001,
        speed: 500,
        models: {
          parsing: 'gemini-1.5-flash',
          response: 'gemini-1.5-flash',
          completion: 'gemini-1.5-flash'
        }
      });
    }

    // Sort by priority
    this.providers.sort((a, b) => a.priority - b.priority);
    this.logger.log(`Initialized ${this.providers.length} AI providers`);
  }

  private async getAvailableProvider(): Promise<AIProvider | null> {
    const now = new Date();
    
    for (const provider of this.providers) {
      this.resetCountersIfNeeded(provider, now);
      
      // Check if provider has free quota available
      if (provider.freeQuota.daily > 0 && provider.currentUsage.daily < provider.freeQuota.daily) {
        return provider;
      }
      
      // Check monthly quota
      if (provider.freeQuota.monthly > 0 && provider.currentUsage.monthly < provider.freeQuota.monthly) {
        return provider;
      }
      
      // If no free quota, only use if it's a paid provider and we're willing to pay
      if (provider.freeQuota.daily === 0 && provider.freeQuota.monthly === 0) {
        return provider; // Paid provider
      }
    }
    
    return null; // No providers available
  }

  private resetCountersIfNeeded(provider: AIProvider, now: Date) {
    // Reset daily counter
    if (now.toDateString() !== provider.currentUsage.lastReset.daily.toDateString()) {
      provider.currentUsage.daily = 0;
      provider.currentUsage.lastReset.daily = now;
      this.logger.log(`Reset daily usage for ${provider.name}`);
    }
    
    // Reset monthly counter
    if (now.getMonth() !== provider.currentUsage.lastReset.monthly.getMonth() || 
        now.getFullYear() !== provider.currentUsage.lastReset.monthly.getFullYear()) {
      provider.currentUsage.monthly = 0;
      provider.currentUsage.lastReset.monthly = new Date(now.getFullYear(), now.getMonth(), 1);
      this.logger.log(`Reset monthly usage for ${provider.name}`);
    }
  }

  private async trackUsage(provider: AIProvider) {
    provider.currentUsage.daily++;
    provider.currentUsage.monthly++;
    
    // Save to cache
    this.saveUsageToCache();
    
    // Log usage
    this.logger.log(`Provider ${provider.name} usage: ${provider.currentUsage.daily}/${provider.freeQuota.daily} (daily), ${provider.currentUsage.monthly}/${provider.freeQuota.monthly} (monthly)`);
    
    // Check if approaching limits
    if (provider.freeQuota.daily > 0) {
      const dailyPercent = (provider.currentUsage.daily / provider.freeQuota.daily) * 100;
      if (dailyPercent > 80) {
        this.logger.warn(`Provider ${provider.name} approaching daily limit: ${dailyPercent.toFixed(1)}%`);
      }
    }
  }

  private saveUsageToCache() {
    const usageData = this.providers.map(p => ({
      name: p.name,
      currentUsage: p.currentUsage
    }));
    // In production, save to Redis or database
    this.usageCache.set('provider_usage', usageData);
  }

  private loadUsageFromCache() {
    const cached = this.usageCache.get('provider_usage');
    if (cached) {
      cached.forEach((cached: any) => {
        const provider = this.providers.find(p => p.name === cached.name);
        if (provider) {
          provider.currentUsage = cached.currentUsage;
        }
      });
      this.logger.log('Loaded usage data from cache');
    }
  }

  async parseReminderInput(userInput: string, userId?: string): Promise<ParsedReminder> {
    const provider = await this.getAvailableProvider();
    if (!provider) {
      throw new Error('No AI providers available - all quotas exceeded');
    }

    try {
      let result;
      
      switch (provider.name) {
        case 'groq':
          result = await this.parseWithGroq(provider, userInput);
          break;
        case 'together':
          result = await this.parseWithTogether(provider, userInput);
          break;
        case 'replicate':
          result = await this.parseWithReplicate(provider, userInput);
          break;
        case 'gemini':
          result = await this.parseWithGemini(provider, userInput);
          break;
        default:
          throw new Error(`Unknown provider: ${provider.name}`);
      }

      await this.trackUsage(provider);
      this.logger.log(`Parsed reminder using ${provider.name}: ${result.title}`);
      return result;
      
    } catch (error) {
      this.logger.error(`Failed to parse with ${provider.name}:`, error);
      
      // Try next provider
      const nextProvider = await this.getAvailableProvider();
      if (nextProvider && nextProvider.name !== provider.name) {
        this.logger.log(`Retrying with next provider: ${nextProvider.name}`);
        return this.parseReminderInput(userInput, userId);
      }
      
      // Final fallback
      return this.getFallbackResponse(userInput);
    }
  }

  private async parseWithGroq(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const prompt = MULTI_PROVIDER_PARSE_PROMPT(userInput);

    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_PARSE_REMINDER },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const prompt = MULTI_PROVIDER_PARSE_PROMPT(userInput);

    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_PARSE_REMINDER },
        { role: 'user', content: prompt }
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

  private async parseWithReplicate(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const prompt = MULTI_PROVIDER_PARSE_PROMPT(userInput);

    const response = await provider.client.run(
      provider.models.parsing,
      {
        input: {
          prompt: SYSTEM_MESSAGE_PARSE_REMINDER + '\n\n' + prompt,
          max_tokens: 300,
          temperature: 0.3
        }
      }
    );

    const content = response.join('');
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  private async parseWithGemini(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const model = provider.client.getGenerativeModel({ model: provider.models.parsing });
    
    const prompt = MULTI_PROVIDER_PARSE_PROMPT(userInput);

    const response = await model.generateContent(prompt);
    const content = response.response.text();
    const parsed = JSON.parse(content);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = new Date(parsed.reminderDate);
    }
    
    return parsed;
  }

  async generateBasicResponse(userInput: string, reminder?: ParsedReminder): Promise<string> {
    const provider = await this.getAvailableProvider();
    if (!provider) {
      return this.getStaticResponse(userInput, reminder);
    }

    try {
      let response;
      
      switch (provider.name) {
        case 'groq':
          response = await this.generateWithGroq(provider, userInput, reminder);
          break;
        case 'together':
          response = await this.generateWithTogether(provider, userInput, reminder);
          break;
        case 'replicate':
          response = await this.generateWithReplicate(provider, userInput, reminder);
          break;
        case 'gemini':
          response = await this.generateWithGemini(provider, userInput, reminder);
          break;
        default:
          response = this.getStaticResponse(userInput, reminder);
      }

      await this.trackUsage(provider);
      return response;
      
    } catch (error) {
      this.logger.error(`Failed to generate response with ${provider.name}:`, error);
      return this.getStaticResponse(userInput, reminder);
    }
  }

  private async generateWithGroq(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT(userInput, reminder?.title, reminder?.reminderDate);

    const response = await provider.client.chat.completions.create({
      model: provider.models.response,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_FRIENDLY_AI },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithTogether(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT(userInput, reminder?.title, reminder?.reminderDate);

    const response = await provider.client.chat.completions.create({
      model: provider.models.response,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_FRIENDLY_AI },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 100
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithReplicate(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT(userInput, reminder?.title, reminder?.reminderDate);

    const response = await provider.client.run(
      provider.models.response,
      {
        input: {
          prompt: SYSTEM_MESSAGE_FRIENDLY_AI + '\n\n' + prompt,
          max_tokens: 100,
          temperature: 0.8
        }
      }
    );

    return response.join('') || "I got you! I'll help set that reminder.";
  }

  private async generateWithGemini(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const model = provider.client.getGenerativeModel({ model: provider.models.response });
    
    const prompt = MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT(userInput, reminder?.title, reminder?.reminderDate);

    const response = await model.generateContent(prompt);
    return response.response.text() || "I got you! I'll help set that reminder.";
  }

  async detectTaskCompletion(userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const provider = await this.getAvailableProvider();
    if (!provider) {
      return { completed: false, response: "Got it!" };
    }

    try {
      let result;
      
      switch (provider.name) {
        case 'groq':
          result = await this.detectCompletionWithGroq(provider, userInput, userReminders);
          break;
        case 'together':
          result = await this.detectCompletionWithTogether(provider, userInput, userReminders);
          break;
        case 'replicate':
          result = await this.detectCompletionWithReplicate(provider, userInput, userReminders);
          break;
        case 'gemini':
          result = await this.detectCompletionWithGemini(provider, userInput, userReminders);
          break;
        default:
          result = { completed: false, response: "Got it!" };
      }

      await this.trackUsage(provider);
      return result;
      
    } catch (error) {
      this.logger.error(`Failed to detect completion with ${provider.name}:`, error);
      return { completed: false, response: "Got it!" };
    }
  }

  private async detectCompletionWithGroq(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}`).join('\n');
    
    const response = await provider.client.chat.completions.create({
      model: provider.models.completion,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_DETECT_COMPLETION_UNIFIED(remindersText) },
        { role: 'user', content: userInput }
      ],
      temperature: 0.3,
      max_tokens: 150,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithTogether(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}`).join('\n');
    
    const response = await provider.client.chat.completions.create({
      model: provider.models.completion,
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE_DETECT_COMPLETION_UNIFIED(remindersText) },
        { role: 'user', content: userInput }
      ],
      temperature: 0.3,
      max_tokens: 150
    });

    const content = response.choices[0]?.message?.content;
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithReplicate(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}`).join('\n');
    
    const prompt = `Detect task completion. User reminders:\n${remindersText}\n\nUser: ${userInput}\n\nReturn JSON: {"completed": true/false, "reminderId": "id", "response": "confirmation"}`;
    
    const response = await provider.client.run(
      provider.models.completion,
      {
        input: {
          prompt,
          max_tokens: 150,
          temperature: 0.3
        }
      }
    );

    const content = response.join('');
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  private async detectCompletionWithGemini(provider: AIProvider, userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const model = provider.client.getGenerativeModel({ model: provider.models.completion });
    const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}`).join('\n');
    
    const prompt = `Detect task completion. User reminders:\n${remindersText}\n\nUser: ${userInput}\n\nReturn JSON: {"completed": true/false, "reminderId": "id", "response": "confirmation"}`;

    const response = await model.generateContent(prompt);
    const content = response.response.text();
    return content ? JSON.parse(content) : { completed: false, response: "Got it!" };
  }

  async suggestReminders(userId: string): Promise<string[]> {
    // Use static suggestions (free!)
    const suggestions = [
      "Take medication",
      "Drink water",
      "Exercise for 30 minutes", 
      "Call family",
      "Pay monthly bills",
      "Morning meditation",
      "Evening walk",
      "Weekly grocery shopping",
      "Take vitamins",
      "Clean workspace"
    ];
    
    const shuffled = suggestions.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }

  private getFallbackResponse(userInput: string): ParsedReminder {
    return {
      title: userInput.substring(0, 50),
      description: userInput,
      reminderDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      confidence: 0.3,
      needsClarification: true,
      clarificationQuestion: "When would you like me to remind you about this?"
    };
  }

  private getStaticResponse(userInput: string, reminder?: ParsedReminder): string {
    if (reminder) {
      const responses = [
        `Got it! I'll remind you to ${reminder.title} ${this.formatTime(reminder.reminderDate)} ${this.getRandomEmoji()}`,
        `Sure thing! ${reminder.title} reminder set for ${this.formatTime(reminder.reminderDate)} ${this.getRandomEmoji()}`,
        `You got it! I'll remind you about ${reminder.title} ${this.formatTime(reminder.reminderDate)} ${this.getRandomEmoji()}`
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    } else {
      return "When would you like me to remind you about that?";
    }
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === now.toDateString()) {
      return `today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return `tomorrow at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    } else {
      return date.toLocaleString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
    }
  }

  private getRandomEmoji(): string {
    const emojis = ['', '', '', ''];
    return emojis[Math.floor(Math.random() * emojis.length)];
  }

  // Admin methods to monitor usage
  getProviderStatus() {
    return this.providers.map(p => ({
      name: p.name,
      priority: p.priority,
      costPerRequest: p.costPerRequest,
      speed: p.speed,
      dailyUsage: `${p.currentUsage.daily}/${p.freeQuota.daily}`,
      monthlyUsage: `${p.currentUsage.monthly}/${p.freeQuota.monthly}`,
      dailyPercent: p.freeQuota.daily > 0 ? (p.currentUsage.daily / p.freeQuota.daily * 100).toFixed(1) + '%' : 'N/A',
      monthlyPercent: p.freeQuota.monthly > 0 ? (p.currentUsage.monthly / p.freeQuota.monthly * 100).toFixed(1) + '%' : 'N/A'
    }));
  }
}
