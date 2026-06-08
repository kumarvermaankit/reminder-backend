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

type ProviderName = 'groq' | 'together' | 'replicate' | 'deepseek' | 'gemini';

const DEFAULT_PRIORITY: Record<ProviderName, number> = {
  groq: 5,
  together: 4,
  replicate: 3,
  deepseek: 2,
  gemini: 1,
};

const DEFAULT_MODELS: Record<ProviderName, { parsing: string; response: string; completion: string }> = {
  groq: { parsing: 'llama-3.3-70b-versatile', response: 'llama-3.3-70b-versatile', completion: 'llama-3.3-70b-versatile' },
  together: { parsing: 'meta-llama/Llama-3-8b-chat-hf', response: 'meta-llama/Llama-3-8b-chat-hf', completion: 'meta-llama/Llama-3-8b-chat-hf' },
  replicate: { parsing: 'meta/meta-llama-3-8b-instruct', response: 'meta/meta-llama-3-8b-instruct', completion: 'meta/meta-llama-3-8b-instruct' },
  deepseek: { parsing: 'deepseek-chat', response: 'deepseek-chat', completion: 'deepseek-chat' },
  gemini: { parsing: 'gemini-1.5-flash', response: 'gemini-1.5-flash', completion: 'gemini-1.5-flash' },
};

@Injectable()
export class SimpleAiService {
  private readonly logger = new Logger(SimpleAiService.name);
  private providers: AIProvider[] = [];

  constructor(private readonly configService: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    const factories: { name: ProviderName; apiKey: string | undefined; build: () => AIProvider }[] = [
      {
        name: 'groq',
        apiKey: this.configService.get<string>('GROQ_API_KEY'),
        build: () => ({
          name: 'groq',
          client: new Groq({ apiKey: factories[0].apiKey }),
          models: this.resolveModels('groq'),
          priority: 0,
          costPerRequest: 0.000,
        }),
      },
      {
        name: 'together',
        apiKey: this.configService.get<string>('TOGETHER_API_KEY'),
        build: () => ({
          name: 'together',
          client: new Together({ apiKey: factories[1].apiKey }),
          models: this.resolveModels('together'),
          priority: 0,
          costPerRequest: 0.0008,
        }),
      },
      {
        name: 'replicate',
        apiKey: this.configService.get<string>('REPLICATE_API_TOKEN'),
        build: () => ({
          name: 'replicate',
          client: new Replicate({ auth: factories[2].apiKey }),
          models: this.resolveModels('replicate'),
          priority: 0,
          costPerRequest: 0.001,
        }),
      },
      {
        name: 'deepseek',
        apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
        build: () => ({
          name: 'deepseek',
          client: new OpenAI({ apiKey: factories[3].apiKey, baseURL: 'https://api.deepseek.com/v1' }),
          models: this.resolveModels('deepseek'),
          priority: 0,
          costPerRequest: 0.000,
        }),
      },
      {
        name: 'gemini',
        apiKey: this.configService.get<string>('GEMINI_API_KEY'),
        build: () => ({
          name: 'gemini',
          client: new GoogleGenerativeAI(factories[4].apiKey!),
          models: this.resolveModels('gemini'),
          priority: 0,
          costPerRequest: 0.001,
        }),
      },
    ];

    // Build providers that have an API key
    for (const f of factories) {
      if (f.apiKey) {
        this.providers.push(f.build());
        this.logger.log(`${f.name.toUpperCase()}_API_KEY: FOUND`);
      } else {
        this.logger.log(`${f.name.toUpperCase()}_API_KEY: NOT FOUND`);
      }
    }

    // Sort by AI_PROVIDER_ORDER env var, or fall back to DEFAULT_PRIORITY
    const orderRaw = this.configService.get<string>('AI_PROVIDER_ORDER') || '';
    if (orderRaw) {
      const order = orderRaw.toLowerCase().split(',').map(s => s.trim()) as ProviderName[];
      const rank = Object.fromEntries(order.map((name, i) => [name, order.length - i]));
      for (const p of this.providers) {
        p.priority = rank[p.name] ?? 0;
      }
      this.logger.log(`AI_PROVIDER_ORDER=${orderRaw}`);
    } else {
      for (const p of this.providers) {
        p.priority = DEFAULT_PRIORITY[p.name as ProviderName] ?? 0;
      }
    }

    this.providers.sort((a, b) => b.priority - a.priority);
    this.logger.log(`Initialized ${this.providers.length} AI providers: ${this.providers.map(p => p.name).join(' → ')}`);
  }

  private resolveModels(name: ProviderName): { parsing: string; response: string; completion: string } {
    const prefix = `AI_${name.toUpperCase()}_MODEL`;
    const env = this.configService.get<string>(prefix);
    if (env) {
      this.logger.log(`${prefix}=${env}`);
      return { parsing: env, response: env, completion: env };
    }
    return DEFAULT_MODELS[name];
  }

  private async selectProvider(): Promise<AIProvider | null> {
    return this.providers.length > 0 ? this.providers[0] : null;
  }

  async parseReminderInput(
    userInput: string,
    userId?: string,
    conversation?: { role: string; text: string }[],
    pendingReminders?: { id: string; title: string }[],
    msgTimestamp?: Date,
    timezone?: string,
  ): Promise<ParsedReminder> {
    const provider = await this.selectProvider();
    if (!provider) {
      throw new Error('No AI providers available');
    }

    const historyText = conversation && conversation.length > 0
      ? `\nRecent conversation:\n${conversation.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: "${m.text}"`).join('\n')}\n---`
      : '';

    const remindersText = pendingReminders && pendingReminders.length > 0
      ? `\nUser's pending reminders:\n${pendingReminders.map(r => `ID: ${r.id}, Title: "${r.title}"`).join('\n')}\n---`
      : '';

    const workflowsText = `\nSystem capabilities (refer to this when user asks how things work):\n${WORKFLOWS}\n---`;

    const now = msgTimestamp || new Date();
    const tz = timezone || 'UTC';
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const localDateStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const localTimeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    const dateContext = `\nUser's local date and time: ${localDateStr}, ${localTimeStr} (timezone: ${tz}).\nUse this to compute relative days (e.g. "tomorrow" = ${localDateStr.split(',')[0]} + 1 day).`;

    const fullPrompt = `${userInput}${dateContext}${historyText}${remindersText}${workflowsText}`;

    try {
      switch (provider.name) {
        case 'groq':
          return await this.parseWithGroq(provider, fullPrompt);
        case 'together':
        case 'deepseek':
          return await this.parseWithTogether(provider, fullPrompt);
        case 'replicate':
          return await this.parseWithReplicate(provider, fullPrompt);
        case 'gemini':
          return await this.parseWithGemini(provider, fullPrompt);
        default:
          throw new Error(`Unknown provider: ${provider.name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse with ${provider.name}:`, error);
      if (this.providers.length > 1) {
        this.providers.shift();
        return this.parseReminderInput(userInput, userId, conversation, pendingReminders, msgTimestamp, timezone);
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

  /**
   * Parse a local time string like "5:05 PM", "9am", "15:15", "4:50 pm".
   * Returns { hours, minutes } in 24h format, or null on failure.
   */
  private parseLocalTime(input: string): { hours: number; minutes: number } | null {
    const s = input.trim().toLowerCase();
    const amPmMatch = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (amPmMatch) {
      let h = parseInt(amPmMatch[1], 10);
      const m = parseInt(amPmMatch[2] || '0', 10);
      const mer = amPmMatch[3];
      if (h < 1 || h > 12 || m > 59) return null;
      if (mer === 'pm' && h < 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
      return { hours: h, minutes: m };
    }
    const milMatch = s.match(/^(\d{1,2}):(\d{2})\b/);
    if (milMatch) {
      const h = parseInt(milMatch[1], 10);
      const m = parseInt(milMatch[2], 10);
      if (h > 23 || m > 59) return null;
      return { hours: h, minutes: m };
    }
    return null;
  }

  private async parseWithGroq(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const prompt = `Parse: "${userInput}"
    Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, ipo_alert, connect_calendar, create_event, list_events, unknown.
    Return JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery, dayOfWeek, attendees
    RULES:
    - Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
    - Relative time ("in 2 minutes", "in 1 hour"): set intervalMinutes (2, 60). Leave reminderDate and localTime empty.
    - Day of week ("every thursday", "every Monday", "tuesday"): set dayOfWeek to lowercase day name (e.g. "thursday", "monday"). If also has a time, set localTime too.
    - For calendar events: extract attendee emails into attendees array.
    - "create a meeting in 2 minutes and send invite to john@example.com" → actionType=create_event, title="Meeting", intervalMinutes=2, attendees=["john@example.com"]
    - "schedule a call with John at 5pm" → actionType=create_event, title="Call with John", localTime="5pm"
    - "create a Google Meet for tomorrow at 2pm with Priya about project review" → actionType=create_event, title="Project review", localTime="2pm", attendees=["priya@email.com"]
    - Do NOT compute any UTC timestamps — leave that to the system.
    - "what's the price of Reliance" or "check Tata Motors stock" → actionType=check_stock, stockSymbol="reliance" or "tata motors"
    - "alert me when Reliance hits 5000" → actionType=stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"
    - "alert me if Infosys falls below 1500" → actionType=stock_alert, stockSymbol="infosys", targetPrice=1500, priceDirection="below"
    - "cricket score" or "India match score" → actionType=check_cricket, matchQuery="india"
    - "send me match updates every 15 min" → actionType=match_alert, matchQuery (the team or match name), intervalMinutes=15
    - "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"
    - "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"
    - "set a reminder for milk at 5pm" → actionType=create_reminder, title="milk", localTime="5pm"
    - "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"
    - "add eggs to groceries and remind me at 6pm and add milk to groceries and remind me at 7pm" → create TWO separate add_todo_item actions. For now, return only the FIRST item: actionType=add_todo_item, todoListTitle="groceries", todoItemContent="eggs", localTime="6pm"
    - "edit my shopping list" → actionType=edit_todo_list, todoListTitle="shopping list"
    - "edit shopping list rename it to groceries" → actionType=edit_todo_list, todoListTitle="shopping list"
    - "current IPOs" or "show me IPOs" → actionType=check_ipo
    - "upcoming IPOs" → actionType=check_ipo, matchQuery="upcoming"
    - "Hexagon Nutrition IPO" → actionType=check_ipo, matchQuery="hexagon"
    - "remind me about IPO deadlines" or "notify me when IPOs are closing" → actionType=ipo_alert, title="IPO Deadline Alerts", intervalMinutes=1440
    - "connect my Google Calendar" or "link my calendar" → actionType=connect_calendar
    - "create a meeting tomorrow at 3pm" or "schedule a call with John at 5pm" → actionType=create_event, title="Meeting with John", localTime="5pm", description="meeting with John"
    - "my events" or "what's on my calendar" → actionType=list_events
    - "create a Google Meet for tomorrow at 2pm with Priya about project review" → actionType=create_event, title="Project review", description="with Priya", localTime="2pm"
    `;
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
    
    this.logger.log(`parseWithGroq raw localTime="${parsed.localTime}" intervalMinutes="${parsed.intervalMinutes}"`);

    return parsed;
  }

  private async parseWithGemini(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const model = provider.client.getGenerativeModel({ model: provider.models.parsing });

    const prompt = `Parse: "${userInput}"
Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, ipo_alert, connect_calendar, create_event, list_events, unknown.
    Return JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery, dayOfWeek, attendees

RULES:
- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
- Relative time ("in 2 minutes", "in 1 hour"): set intervalMinutes (2, 60). Leave reminderDate and localTime empty.
- Day of week ("every thursday", "every Monday", "tuesday"): set dayOfWeek to lowercase day name (e.g. "thursday", "monday"). If also has a time, set localTime too.
- For calendar events: extract attendee emails into attendees array.
- "create a meeting in 2 minutes and send invite to john@example.com" → actionType=create_event, title="Meeting", intervalMinutes=2, attendees=["john@example.com"]
- "schedule a call with John at 5pm" → actionType=create_event, title="Call with John", localTime="5pm"
- "create a Google Meet for tomorrow at 2pm with Priya about project review" → actionType=create_event, title="Project review", localTime="2pm", attendees=["priya@email.com"]
- Do NOT compute any UTC timestamps.
- "what's the price of Reliance" → actionType=check_stock, stockSymbol="reliance"
- "alert me when Reliance hits 5000" → actionType=stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"
- "cricket score" → actionType=check_cricket, matchQuery="india"
- "send me match updates every 15 min" → actionType=match_alert, matchQuery (team/match), intervalMinutes=15
- "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"
- "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"
- "set a reminder for milk at 5pm" → actionType=create_reminder, title="milk", localTime="5pm"
- "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"
- "current IPOs" or "show me IPOs" → actionType=check_ipo
- "upcoming IPOs" → actionType=check_ipo, matchQuery="upcoming"
- "remind me about IPO deadlines" → actionType=ipo_alert, title="IPO Deadline Alerts", intervalMinutes=1440
- "connect my Google Calendar" → actionType=connect_calendar
- "create a meeting tomorrow at 3pm" → actionType=create_event, title="Meeting", localTime="3pm"
- "my events" → actionType=list_events
`;
    const response = await model.generateContent(prompt);
    let content = response.response.text();
    
    if (content.includes('```json')) {
      content = content.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (content.includes('```')) {
      content = content.replace(/```\s*/, '').replace(/```\s*$/, '');
    }
    
    content = content.trim();
    
    const parsed = JSON.parse(content);
    this.logger.log(`parseWithGemini raw localTime="${parsed.localTime}" intervalMinutes="${parsed.intervalMinutes}"`);
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are an assistant that detects intent: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, ipo_alert, connect_calendar, create_event, list_events, unknown. Return valid JSON.' },
        { role: 'user', content: `Parse: "${userInput}".\nReturn JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery, dayOfWeek, attendees\n\nRULES:\n- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.\n- Relative time ("in 2 minutes", "in 1 hour"): set intervalMinutes (2, 60). Leave reminderDate and localTime empty.\n- Day of week ("every thursday", "every Monday", "tuesday"): set dayOfWeek to lowercase day name (e.g. "thursday", "monday"). If also has a time, set localTime too.\n- For calendar events: extract attendee emails into attendees array.\n- Do NOT compute any UTC timestamps.\n- "what\\'s the price of Reliance" → check_stock, stockSymbol="reliance"\n- "alert when Reliance hits 5000" → stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"\n- "cricket score" → check_cricket, matchQuery="india"\n- "match updates every 15 min" → match_alert, matchQuery (team), intervalMinutes=15\n- "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"\n- "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"\n- "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"\n- "remind me every thursday 8am" → actionType=create_reminder, title="Reminder", dayOfWeek="thursday", localTime="8am"\n- "create a meeting in 2 minutes and send invite to john@example.com" → actionType=create_event, title="Meeting", intervalMinutes=2, attendees=["john@example.com"]\n- "schedule a call with John at 5pm" → actionType=create_event, title="Call with John", localTime="5pm"\n- "current IPOs" → check_ipo\n- "upcoming IPOs" → check_ipo, matchQuery="upcoming"\n- "connect my Google Calendar" → connect_calendar\n- "my events" → list_events` }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Together');
    const parsed = JSON.parse(content);
    this.logger.log(`parseWithTogether raw localTime="${parsed.localTime}" intervalMinutes="${parsed.intervalMinutes}"`);
    return parsed;
  }

  private async parseWithReplicate(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const prompt = `Parse this message and return ONLY valid JSON with no other text: "${userInput}"

Return JSON with actionType (create_reminder|complete_reminder|save_note|get_note|save_password|get_password|create_todo|add_todo_item|get_todo|complete_todo_item|edit_todo_item|edit_todo_list|delete_list|system_query|update_settings|check_stock|check_cricket|check_ipo|stock_alert|match_alert|ipo_alert|connect_calendar|create_event|list_events|unknown), title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery, dayOfWeek, attendees

RULES:
- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
- Relative time ("in 2 minutes", "in 1 hour"): set intervalMinutes (2, 60). Leave reminderDate and localTime empty.
- Day of week ("every thursday", "every Monday", "tuesday"): set dayOfWeek to lowercase day name (e.g. "thursday", "monday"). If also has a time, set localTime too.
- For calendar events: extract attendee emails into attendees array.
- Do NOT compute UTC timestamps. morning=9am, afternoon=2pm, evening=6pm, night=8pm.
- "create a meeting in 2 minutes and send invite to john@example.com" → actionType=create_event, title="Meeting", intervalMinutes=2, attendees=["john@example.com"]
- "schedule a call with John at 5pm" → actionType=create_event, title="Call with John", localTime="5pm"
- "price of Reliance" → check_stock, stockSymbol="reliance"
- "alert when Reliance hits 5000" → stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"
- "cricket score" → check_cricket, matchQuery="india"
- "match updates every 15 min" → match_alert, matchQuery="india", intervalMinutes=15
- "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"
- "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"
- "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"
- "current IPOs" → check_ipo
- "upcoming IPOs" → check_ipo, matchQuery="upcoming"
- "connect my Google Calendar" → connect_calendar
- "create a meeting tomorrow at 3pm" → create_event, title="Meeting", localTime="3pm"
- "my events" → list_events
- "remind me about IPO deadlines" → ipo_alert, title="IPO Deadline Alerts", intervalMinutes=1440
`;

    const response = await provider.client.run(provider.models.parsing, {
      input: {
        prompt: prompt,
        max_tokens: 400,
        temperature: 0.3
      }
    });

    const content = Array.isArray(response) ? response.join('') : String(response);
    const jsonStr = content.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(jsonStr);
    this.logger.log(`parseWithReplicate raw localTime="${parsed.localTime}" intervalMinutes="${parsed.intervalMinutes}"`);
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
    
    if (content.includes('```json')) {
      content = content.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (content.includes('```')) {
      content = content.replace(/```\s*/, '').replace(/```\s*$/, '');
    }
    
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
