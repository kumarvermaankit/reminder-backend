import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Groq } from 'groq-sdk';
import { Together } from 'together-ai';
import Replicate from 'replicate';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedReminder } from '../types/parsed-reminder.interface';
import { WORKFLOWS } from '../constants/workflows';

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

    // DeepSeek - Fourth priority (free trial credits, OpenAI-compatible)
    const deepseekApiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (deepseekApiKey) {
      this.providers.push({
        name: 'deepseek',
        client: new OpenAI({ apiKey: deepseekApiKey, baseURL: 'https://api.deepseek.com/v1' }),
        models: {
          parsing: 'deepseek-chat',
          response: 'deepseek-chat',
          completion: 'deepseek-chat'
        },
        priority: 0.5,
        costPerRequest: 0.000
      });
    }

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
        priority: 0.1,
        costPerRequest: 0.001
      });
    }

    // Add debug logging
    this.logger.log('Checking API keys:');
    this.logger.log('GROQ_API_KEY:', groqApiKey ? 'FOUND' : 'NOT FOUND');
    this.logger.log('TOGETHER_API_KEY:', togetherApiKey ? 'FOUND' : 'NOT FOUND');
    this.logger.log('REPLICATE_API_TOKEN:', replicateApiToken ? 'FOUND' : 'NOT FOUND');
    this.logger.log('DEEPSEEK_API_KEY:', deepseekApiKey ? 'FOUND' : 'NOT FOUND');
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

  async parseReminderInput(
    userInput: string,
    userId?: string,
    timezone?: string,
    conversation?: { role: string; text: string }[],
    pendingReminders?: { id: string; title: string }[],
    msgTimestamp?: Date,
  ): Promise<ParsedReminder> {
    const provider = await this.selectProvider();
    if (!provider) {
      throw new Error('No AI providers available');
    }

    const now = msgTimestamp || new Date();
    const nowISO = now.toISOString();

    const historyText = conversation && conversation.length > 0
      ? `\nRecent conversation:\n${conversation.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: "${m.text}"`).join('\n')}\n---`
      : '';

    const remindersText = pendingReminders && pendingReminders.length > 0
      ? `\nUser's pending reminders:\n${pendingReminders.map(r => `ID: ${r.id}, Title: "${r.title}"`).join('\n')}\n---`
      : '';

    const workflowsText = `\nSystem capabilities (refer to this when user asks how things work):\n${WORKFLOWS}\n---`;

    const fullPrompt = `${userInput}${historyText}${remindersText}${workflowsText}`;

    try {
      switch (provider.name) {
        case 'groq':
          return await this.parseWithGroq(provider, fullPrompt, timezone, nowISO);
        case 'together':
        case 'deepseek':
          return await this.parseWithTogether(provider, fullPrompt, timezone, nowISO);
        case 'replicate':
          return await this.parseWithReplicate(provider, fullPrompt, timezone, nowISO);
        case 'gemini':
          return await this.parseWithGemini(provider, fullPrompt, timezone, nowISO);
        default:
          throw new Error(`Unknown provider: ${provider.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse with ${provider.name}:`, error);
      if (this.providers.length > 1) {
        this.providers.shift();
        return this.parseReminderInput(userInput, userId, timezone, conversation, pendingReminders, msgTimestamp);
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
        case 'deepseek':
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
        case 'deepseek':
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
  private adjustDateForTimezone(dateStr: string, timezone?: string): Date | null {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      this.logger.warn(`AI returned unparseable reminderDate: "${dateStr}"`);
      return null;
    }
    if (!timezone) return date;

    // If the AI output includes a non-UTC offset (e.g. +05:30 matching user's timezone),
    // it correctly handled timezone — return as-is.
    const hasNonUtcOffset = /[+-](?!00:?00)\d{2}:?\d{2}/.test(dateStr);
    if (hasNonUtcOffset) return date;

    // Otherwise the AI either returned a naive date (no tz info) or used Z/+0000.
    // AI thinks the time value (e.g. 22:20 for "10:20 PM") is UTC, but the user
    // meant local time. Convert: treat the value as local time → UTC.
    const localStr = date.toLocaleString('en-CA', { timeZone: timezone });
    const localDate = new Date(localStr + 'Z');
    const offsetMs = localDate.getTime() - date.getTime();
    return new Date(date.getTime() - offsetMs);
  }

  private formatLocalTime(nowISO: string, timezone?: string): string {
    if (!timezone) return nowISO;
    const now = new Date(nowISO);
    return now.toLocaleString('en-US', {
      timeZone: timezone, weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    }) + ` (${timezone})`;
  }

  private async parseWithGroq(provider: AIProvider, userInput: string, timezone?: string, nowISO?: string): Promise<ParsedReminder> {
    const nowStr = nowISO || new Date().toISOString();
    const localTime = this.formatLocalTime(nowStr, timezone);

    const prompt = `Parse this user message: "${userInput}"

Current local time: ${localTime}

First, determine the actionType:
- "create_reminder" = user wants a new reminder for something
- "complete_reminder" = user wants to mark a reminder as done/finished/completed (check conversation history and pending reminders list to find which one)
- "save_note" = user wants to save information/reference data ("remember my email is xyz", "save that my address is 123 street")
- "get_note" = user wants to retrieve saved info
- "save_password" = user wants to save a password
- "get_password" = user wants a saved password
- "create_todo" = user wants to create a new todo/list ("start a shopping list", "create a grocery list", "make a todo list for work"). If the user provides items (numbered, bulleted, or comma-separated), set them in todoItemContents.
- "add_todo_item" = user wants to add items to a list ("add milk to shopping list", "add buy eggs to groceries"). If multiple items are given (comma-separated, "and" separated, or sequential), put them all in todoItemContents.
- "get_todo" = user wants to see a list ("show my shopping list", "what's on my todo list")
- "complete_todo_item" = user wants to mark a todo item as done ("done with milk", "check off eggs from shopping list", "mark first item as done", "mark last item as done", "mark second item as done")
- "edit_todo_item" = user wants to change the text of a todo item ("edit first list item as ...", "change milk to almond milk in shopping list", "update the eggs item to organic eggs")
- "delete_list" = user wants to delete/remove a todo list entirely ("delete my shopping list", "remove the grocery list", "trash the todo list")
- "system_query" = user is asking about the system's capabilities ("what can you do?", "how to set a reminder", "how to save a password", "can you save passwords", "is my password protected", "how do todo lists work") or simple greetings ("hi", "hello", "hey", "good morning")
- "update_settings" = user wants to change their preferences like daily prompt time ("set my daily prompt to 8am", "change daily reminder time to 10am", "make daily list at 9am"). Set dailyPromptTime to the requested time in HH:mm format.
- "unknown" = casual chat not related to any action and not a system query

Use the conversation history and pending reminders above to understand context. For "complete_reminder", the reminder ID MUST be a real ID from the pending reminders list — never invent one.

CRITICAL for title: Use the EXACT words from the user for the title. Do NOT transform, capitalize, or rephrase. Examples:
- "drink water" → title: "drink water" (NOT "Drinking Water" or "Drink Water")
- "call mom" → title: "call mom" (NOT "Call Mom")

CRITICAL for noteKey: Use the EXACT words from the user's message. Do NOT transform, normalize, or change the words. Examples:
- User says "square root decomposition" → noteKey = "square root decomposition" (NOT "square_root_decomposition")
- User says "my email" → noteKey = "my email"
- User says "sqrt decomposition" → noteKey = "sqrt decomposition"

Return JSON with:
{
  "actionType": "create_reminder|complete_reminder|save_note|get_note|save_password|get_password|create_todo|add_todo_item|get_todo|complete_todo_item|edit_todo_item|delete_list|system_query|update_settings|unknown",
  "reminderId": "REAL ID from pending reminders list (complete_reminder only, NEVER invent)",
  "title": "EXACT user words — no transformations (for create_reminder)",
  "description": "full description (for create_reminder)",
  "reminderDate": "ISO datetime in user's local time WITHOUT timezone suffix (for create_reminder, and optionally for add_todo_item/create_todo). Example: if user says '10:15 PM' and local time shows ~10:12 PM, return '2026-05-27T22:15:00' — NOT '2026-05-27T22:15:00Z'. If interval is given but no start time, set to now + intervalMinutes.",
  "priority": "low|medium|high",
  "category": "work|personal|health|finance|other",
  "intervalMinutes": "CRITICAL: extract repeat interval in minutes ONLY if user mentions 'every X minutes/hours' or 'every X min'",
  "maxReminderCount": "if user says 'for next X hours/minutes/times', calculate how many reminders that would be (intervalMinutes * count = duration). Example: every 5 min for 1 hour → maxReminderCount = 12. Leave 0 for unlimited.",
  "confidence": 0.0-1.0,
  "needsClarification": true/false,
  "clarificationQuestion": "if needed",
  "noteKey": "title/keyword for the note (save_note/get_note only). For get_note: use exact words from user message.",
  "noteContent": "the content to save (save_note only) OR the new text for a todo item (edit_todo_item only)",
  "serviceName": "service name (save_password/get_password only, e.g. 'facebook', 'gmail')",
  "password": "the password to save (save_password only, NEVER include this for get_password)",
  "todoListTitle": "title of the todo list (create_todo/get_todo/add_todo_item/complete_todo_item only). If the user doesn't specify a list name, use 'general'.",
  "todoItemContent": "a single item to add (add_todo_item only, use this when there's ONE item)",
  "todoItemContents": "an array of items when the user gives MULTIPLE items (add_todo_item/create_todo only, e.g. ['walk', 'need to work on merger task', 'need to review PR'])",
  "dailyPromptTime": "HH:mm format (update_settings only, e.g. '09:00'). Set when user requests to change their daily prompt time."
}

Rules:
- Do NOT ask for clarification about start time if intervalMinutes is set. The first reminder fires after one interval.
- morning=9am, afternoon=2pm, evening=6pm, night=8pm;
- Use EXACT user words for title — no transformations
- CRITICAL: reminderDate must NOT have a timezone suffix (no Z, no +05:30). Use local time only.`;

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

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger.error(`parseWithGroq: failed to parse AI response: "${content}"`);
      throw new Error('Invalid JSON from AI');
    }
    
    this.logger.log(`parseWithGroq raw reminderDate="${parsed.reminderDate}"`);

    // Convert string date to Date object
    if (parsed.reminderDate) {
      parsed.reminderDate = this.adjustDateForTimezone(parsed.reminderDate, timezone);
      if (!parsed.reminderDate) delete parsed.reminderDate;
    }

    return parsed;
  }

  private async parseWithGemini(provider: AIProvider, userInput: string, timezone?: string, nowISO?: string): Promise<ParsedReminder> {
    const model = provider.client.getGenerativeModel({ model: provider.models.parsing });
    const nowStr = nowISO || new Date().toISOString();
    const localTime = this.formatLocalTime(nowStr, timezone);

    const prompt = `Parse: "${userInput}"
Current local time: ${localTime}
Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, delete_list, system_query, unknown.
Return JSON with actionType, reminderId, title, description, reminderDate (local ISO without Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount
CRITICAL: reminderDate must be in user's local time WITHOUT timezone suffix (no Z, no +05:30).`;

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
      parsed.reminderDate = this.adjustDateForTimezone(parsed.reminderDate, timezone);
      if (!parsed.reminderDate) delete parsed.reminderDate;
    }
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string, timezone?: string, nowISO?: string): Promise<ParsedReminder> {
    const nowStr = nowISO || new Date().toISOString();
    const localTime = this.formatLocalTime(nowStr, timezone);
    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are an assistant that detects intent: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, delete_list, system_query, update_settings, unknown. Return valid JSON.' },
        { role: 'user', content: `Parse: "${userInput}". Current local time: ${localTime}. Return JSON with actionType, reminderId, title, description, reminderDate (local ISO without Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount. reminderDate must NOT have timezone suffix (no Z, no +05:30).` }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Together');
    const parsed = JSON.parse(content);
    if (parsed.reminderDate) {
      parsed.reminderDate = this.adjustDateForTimezone(parsed.reminderDate, timezone);
      if (!parsed.reminderDate) delete parsed.reminderDate;
    }
    return parsed;
  }

  private async parseWithReplicate(provider: AIProvider, userInput: string, timezone?: string, nowISO?: string): Promise<ParsedReminder> {
    const nowStr = nowISO || new Date().toISOString();
    const localTime = this.formatLocalTime(nowStr, timezone);
    const prompt = `Parse this message and return ONLY valid JSON with no other text: "${userInput}"
Current local time: ${localTime}

Return JSON with actionType (create_reminder|complete_reminder|save_note|get_note|save_password|get_password|create_todo|add_todo_item|get_todo|complete_todo_item|edit_todo_item|delete_list|system_query|update_settings|unknown), title, description, reminderDate (local ISO without Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount

Rules: morning=9am, afternoon=2pm, evening=6pm, night=8pm. Use EXACT user words for title. reminderDate MUST NOT have timezone suffix (no Z, no +05:30).`;

    const response = await provider.client.run(provider.models.parsing, {
      input: {
        prompt: prompt,
        max_tokens: 400,
        temperature: 0.3
      }
    });

    const content = Array.isArray(response) ? response.join('') : String(response);
    // Extract JSON from the response (handle markdown code blocks)
    const jsonStr = content.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.reminderDate) parsed.reminderDate = this.adjustDateForTimezone(parsed.reminderDate, timezone);
    return parsed;
  }

  private async generateWithGroq(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = reminder
      ? `User said: "${userInput}"\nI understood this as a reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}\nGenerate a friendly, casual confirmation response.`
      : `User said: "${userInput}"\nThis doesn't seem like a reminder. Just respond conversationally and naturally without mentioning reminders.`;

    const response = await provider.client.chat.completions.create({
      model: provider.models.response,
      messages: [
        { role: 'system', content: `You are a friendly AI assistant. Be casual and use emojis.\n\nHere are your capabilities:\n${WORKFLOWS}` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 200
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithGemini(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const model = provider.client.getGenerativeModel({ model: provider.models.response });
    
    const prompt = reminder 
      ? `User: "${userInput}". Reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}. Friendly confirmation:`
      : `User: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

    const fullPrompt = `System capabilities:\n${WORKFLOWS}\n\n${prompt}`;
    const response = await model.generateContent(fullPrompt);
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
        { role: 'system', content: `You are a friendly AI assistant. Be casual and use emojis.\n\nHere are your capabilities:\n${WORKFLOWS}` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 200
    });

    return response.choices[0]?.message?.content || "I got you! I'll help set that reminder.";
  }

  private async generateWithReplicate(provider: AIProvider, userInput: string, reminder?: ParsedReminder): Promise<string> {
    const prompt = reminder 
      ? `User said: "${userInput}". Reminder: ${reminder.title} at ${reminder.reminderDate?.toLocaleString()}. Generate a friendly confirmation response.`
      : `User said: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

    const fullPrompt = `You are a friendly AI assistant. Be casual and use emojis.\n\nHere are your capabilities:\n${WORKFLOWS}\n\n${prompt}`;
    const response = await provider.client.run(provider.models.response, {
      input: {
        prompt: fullPrompt,
        max_tokens: 200,
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
