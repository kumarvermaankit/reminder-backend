import { Injectable, Logger } from '@nestjs/common';
import { Groq } from 'groq-sdk';
import { Together } from 'together-ai';
import Replicate from 'replicate';
import { ParsedReminder } from '../types/parsed-reminder.interface';
import {
  SYSTEM_MESSAGE_PARSE_ALWAYS_JSON,
  SYSTEM_MESSAGE_CASUAL_AI,
  SYSTEM_MESSAGE_JSON_AI,
  UNIFIED_PARSE_PROMPT,
  UNIFIED_GENERATE_RESPONSE_PROMPT,
  UNIFIED_DETECT_COMPLETION_PROMPT,
} from '../constants/ai-prompts';

interface AIProvider {
  name: string;
  client: any;
  freeQuota: { daily: number; monthly: number };
  currentUsage: { daily: number; monthly: number; lastReset: { daily: Date; monthly: Date; } };
  priority: number;
  costPerRequest: number;
  model: string;
}

@Injectable()
export class UnifiedAiService {
  private readonly logger = new Logger(UnifiedAiService.name);
  private providers: AIProvider[] = [];
  private usageCache = new Map<string, any>();

  constructor() {
    this.initializeProviders();
    this.loadUsageFromCache();
  }

  private initializeProviders() {
    // Groq - Priority 1 (free, fast)
    if (process.env.GROQ_API_KEY) {
      this.providers.push({
        name: 'groq',
        client: new Groq({ apiKey: process.env.GROQ_API_KEY }),
        freeQuota: { daily: 14000, monthly: 420000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 1,
        costPerRequest: 0.000,
        model: 'groq/compound-mini'
      });
    }

    // Together AI - Priority 2 (free tier)
    if (process.env.TOGETHER_API_KEY) {
      this.providers.push({
        name: 'together',
        client: new Together({ apiKey: process.env.TOGETHER_API_KEY }),
        freeQuota: { daily: 1000, monthly: 30000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 2,
        costPerRequest: 0.0008,
        model: 'meta-llama/Llama-3-8b-chat-hf'
      });
    }

    // Replicate - Priority 3 (free credits)
    if (process.env.REPLICATE_API_TOKEN) {
      this.providers.push({
        name: 'replicate',
        client: new Replicate({ auth: process.env.REPLICATE_API_TOKEN }),
        freeQuota: { daily: 500, monthly: 15000 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 3,
        costPerRequest: 0.001,
        model: 'meta/meta-llama-3-8b-instruct'
      });
    }

    // OpenAI - Priority 99 (paid fallback)
    if (process.env.OPENAI_API_KEY) {
      const { OpenAI } = require('openai');
      this.providers.push({
        name: 'openai',
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        freeQuota: { daily: 0, monthly: 0 },
        currentUsage: { daily: 0, monthly: 0, lastReset: { daily: new Date(), monthly: new Date() } },
        priority: 99,
        costPerRequest: 0.002,
        model: 'gpt-3.5-turbo'
      });
    }

    this.providers.sort((a, b) => a.priority - b.priority);
    this.logger.log(`Initialized ${this.providers.length} AI providers`);
  }

  // AI Selector Method - This is the main method that switches between providers
  private async selectAIProvider(): Promise<AIProvider | null> {
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
      
      // If no free quota, only use if it's a paid provider
      if (provider.freeQuota.daily === 0 && provider.freeQuota.monthly === 0) {
        return provider;
      }
    }
    
    return null;
  }

  private resetCountersIfNeeded(provider: AIProvider, now: Date) {
    if (now.toDateString() !== provider.currentUsage.lastReset.daily.toDateString()) {
      provider.currentUsage.daily = 0;
      provider.currentUsage.lastReset.daily = now;
    }
    
    if (now.getMonth() !== provider.currentUsage.lastReset.monthly.getMonth() || 
        now.getFullYear() !== provider.currentUsage.lastReset.monthly.getFullYear()) {
      provider.currentUsage.monthly = 0;
      provider.currentUsage.lastReset.monthly = new Date(now.getFullYear(), now.getMonth(), 1);
    }
  }

  private async trackUsage(provider: AIProvider) {
    provider.currentUsage.daily++;
    provider.currentUsage.monthly++;
    this.saveUsageToCache();
    
    this.logger.log(`Provider ${provider.name} usage: ${provider.currentUsage.daily}/${provider.freeQuota.daily} (daily)`);
    
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
    }
  }

  // Unified Prompt Templates - Same prompts for all providers
  private readonly PROMPTS = {
    parseReminder: (userInput: string) => UNIFIED_PARSE_PROMPT(userInput),

    generateResponse: (userInput: string, reminder?: ParsedReminder) =>
      UNIFIED_GENERATE_RESPONSE_PROMPT(userInput, reminder?.title, reminder?.reminderDate),

    detectCompletion: (userInput: string, userReminders: any[]) => {
      const remindersText = userReminders.map(r => `ID: ${r.id}, Title: ${r.title}`).join('\n');
      return UNIFIED_DETECT_COMPLETION_PROMPT(userInput, remindersText);
    }
  };

  // Unified AI Call Method - Same interface for all providers
  private async callAI(provider: AIProvider, prompt: string, systemPrompt: string, useJson: boolean = false): Promise<string> {
    try {
      let response;
      
      switch (provider.name) {
        case 'groq':
          response = await this.callGroq(provider, prompt, systemPrompt, useJson);
          break;
        case 'together':
          response = await this.callTogether(provider, prompt, systemPrompt, useJson);
          break;
        case 'replicate':
          response = await this.callReplicate(provider, prompt, systemPrompt, useJson);
          break;
        case 'openai':
          response = await this.callOpenAI(provider, prompt, systemPrompt, useJson);
          break;
        default:
          throw new Error(`Unknown provider: ${provider.name}`);
      }

      await this.trackUsage(provider);
      return response;
      
    } catch (error) {
      this.logger.error(`Failed to call ${provider.name}:`, error);
      throw error;
    }
  }

  // Provider-specific implementations with same interface
  private async callGroq(provider: AIProvider, prompt: string, systemPrompt: string, useJson: boolean): Promise<string> {
    const response = await provider.client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 300,
      ...(useJson && { response_format: { type: "json_object" } })
    });
    return response.choices[0]?.message?.content || '';
  }

  private async callTogether(provider: AIProvider, prompt: string, systemPrompt: string, useJson: boolean): Promise<string> {
    const response = await provider.client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 300
    });
    return response.choices[0]?.message?.content || '';
  }

  private async callReplicate(provider: AIProvider, prompt: string, systemPrompt: string, useJson: boolean): Promise<string> {
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;
    const response = await provider.client.run(provider.model, {
      input: {
        prompt: fullPrompt,
        max_tokens: 300,
        temperature: 0.3
      }
    });
    return response.join('') || '';
  }

  private async callOpenAI(provider: AIProvider, prompt: string, systemPrompt: string, useJson: boolean): Promise<string> {
    const response = await provider.client.chat.completions.create({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 300
    });
    return response.choices[0]?.message?.content || '';
  }

  // Public API Methods - All use the same prompts and interface
  async parseReminderInput(userInput: string, userId?: string): Promise<ParsedReminder> {
    const provider = await this.selectAIProvider();
    if (!provider) {
      throw new Error('No AI providers available - all quotas exceeded');
    }

    try {
      const prompt = this.PROMPTS.parseReminder(userInput);
      const systemPrompt = SYSTEM_MESSAGE_PARSE_ALWAYS_JSON;
      
      const response = await this.callAI(provider, prompt, systemPrompt, true);
      const parsed = JSON.parse(response);
      
      if (parsed.reminderDate) {
        parsed.reminderDate = new Date(parsed.reminderDate);
      }
      
      this.logger.log(`Parsed reminder using ${provider.name}: ${parsed.title}`);
      return parsed;
      
    } catch (error) {
      this.logger.error(`Failed to parse with ${provider.name}:`, error);
      
      // Try next provider
      const nextProvider = await this.selectAIProvider();
      if (nextProvider && nextProvider.name !== provider.name) {
        this.logger.log(`Retrying with next provider: ${nextProvider.name}`);
        return this.parseReminderInput(userInput, userId);
      }
      
      return this.getFallbackResponse(userInput);
    }
  }

  async generateBasicResponse(userInput: string, reminder?: ParsedReminder): Promise<string> {
    const provider = await this.selectAIProvider();
    if (!provider) {
      return this.getStaticResponse(userInput, reminder);
    }

    try {
      const prompt = this.PROMPTS.generateResponse(userInput, reminder);
      const systemPrompt = SYSTEM_MESSAGE_CASUAL_AI;
      
      const response = await this.callAI(provider, prompt, systemPrompt, false);
      return response || "I got you! I'll help set that reminder.";
      
    } catch (error) {
      this.logger.error(`Failed to generate response with ${provider.name}:`, error);
      return this.getStaticResponse(userInput, reminder);
    }
  }

  async detectTaskCompletion(userInput: string, userReminders: any[]): Promise<{completed: boolean, reminderId?: string, response: string}> {
    const provider = await this.selectAIProvider();
    if (!provider) {
      return { completed: false, response: "Got it!" };
    }

    try {
      const prompt = this.PROMPTS.detectCompletion(userInput, userReminders);
      const systemPrompt = SYSTEM_MESSAGE_JSON_AI;
      
      const response = await this.callAI(provider, prompt, systemPrompt, true);
      return response ? JSON.parse(response) : { completed: false, response: "Got it!" };
      
    } catch (error) {
      this.logger.error(`Failed to detect completion with ${provider.name}:`, error);
      return { completed: false, response: "Got it!" };
    }
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

  // Helper methods
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

  // Admin methods
  getProviderStatus() {
    return this.providers.map(p => ({
      name: p.name,
      priority: p.priority,
      costPerRequest: p.costPerRequest,
      model: p.model,
      dailyUsage: `${p.currentUsage.daily}/${p.freeQuota.daily}`,
      monthlyUsage: `${p.currentUsage.monthly}/${p.freeQuota.monthly}`,
      dailyPercent: p.freeQuota.daily > 0 ? (p.currentUsage.daily / p.freeQuota.daily * 100).toFixed(1) + '%' : 'N/A',
      monthlyPercent: p.freeQuota.monthly > 0 ? (p.currentUsage.monthly / p.freeQuota.monthly * 100).toFixed(1) + '%' : 'N/A'
    }));
  }
}
