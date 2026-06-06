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
        priority: 5,
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
        priority: 4,
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
        priority: 2,
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
          parsing: 'gemini-1.5-flash',
          response: 'gemini-1.5-flash',
          completion: 'gemini-1.5-flash'
        },
        priority: 1,
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

    // Sort by priority (descending — higher = tried first)
    this.providers.sort((a, b) => b.priority - a.priority);
    this.logger.log(`Initialized ${this.providers.length} AI providers`);
    
    // Debug: List available Gemini models
    this.listGeminiModels();
  }

  private async listGeminiModels() {
    // Remove broken model listing call — it used wrong API key and invalid method
  }

  private async selectProvider(): Promise<AIProvider | null> {
    // Simple selection - just return the first available provider
    return this.providers.length > 0 ? this.providers[0] : null;
  }

  async parseReminderInput(
    userInput: string,
    userId?: string,
    conversation?: { role: string; text: string }[],
    pendingReminders?: { id: string; title: string }[],
    msgTimestamp?: Date,
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

    const fullPrompt = `${userInput}${historyText}${remindersText}${workflowsText}`;

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
        return this.parseReminderInput(userInput, userId, conversation, pendingReminders, msgTimestamp);
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
  /**
   * Infer the user's UTC offset (in minutes) from a raw local time string + msgTimestamp.
   * Tries each standard offset; the correct offset is the one where the resulting
   * UTC time is in the future AND the implied local "now" (msgTimestamp + offset)
   * falls within waking hours (7am – 11pm local).
   */

  /**
   * Parse a local time string like "5:05 PM", "9am", "15:15", "4:50 pm".
   * Returns { hours, minutes } in 24h format, or null on failure.
   */
  private parseLocalTime(input: string): { hours: number; minutes: number } | null {
    const s = input.trim().toLowerCase();
    // Allow trailing text after time (e.g. "7am tomorrow", "5:15 PM here")
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
    Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, unknown.
    Return JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery
    RULES:
    - Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
    - Relative time ("in 5 minutes"): set intervalMinutes. Leave reminderDate and localTime empty.
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
Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, unknown.
    Return JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery

RULES:
- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
- Relative time ("in 5 minutes", "in 1 hour"): set intervalMinutes. Leave reminderDate and localTime empty.
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
`;
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
    
    const parsed = JSON.parse(content);
    this.logger.log(`parseWithGemini raw localTime="${parsed.localTime}" intervalMinutes="${parsed.intervalMinutes}"`);
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string): Promise<ParsedReminder> {
    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are an assistant that detects intent: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, unknown. Return valid JSON.' },
        { role: 'user', content: `Parse: "${userInput}".\nReturn JSON with actionType, reminderId, title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery\n\nRULES:\n- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.\n- Relative time ("in 5 minutes"): set intervalMinutes. Leave reminderDate and localTime empty.\n- Do NOT compute any UTC timestamps.\n- "what's the price of Reliance" → check_stock, stockSymbol="reliance"\n- "alert when Reliance hits 5000" → stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"\n- "cricket score" → check_cricket, matchQuery="india"\n- "match updates every 15 min" → match_alert, matchQuery (team), intervalMinutes=15\n- "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"\n- "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"\n- "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"` }
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

Return JSON with actionType (create_reminder|complete_reminder|save_note|get_note|save_password|get_password|create_todo|add_todo_item|get_todo|complete_todo_item|edit_todo_item|edit_todo_list|delete_list|system_query|update_settings|check_stock|check_cricket|check_ipo|stock_alert|match_alert|unknown), title, description, priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount, stockSymbol, targetPrice, priceDirection, matchQuery

RULES:
- Wall-clock time ("at 5PM", "at 7am"): set localTime to EXACT text (e.g. "7am", "5:05 PM"). Leave reminderDate empty.
- Relative time ("in 5 minutes"): set intervalMinutes. Leave reminderDate and localTime empty.
- Do NOT compute UTC timestamps. morning=9am, afternoon=2pm, evening=6pm, night=8pm.
- "price of Reliance" → check_stock, stockSymbol="reliance"
- "alert when Reliance hits 5000" → stock_alert, stockSymbol="reliance", targetPrice=5000, priceDirection="above"
- "cricket score" → check_cricket, matchQuery="india"
- "match updates every 15 min" → match_alert, matchQuery="india", intervalMinutes=15
- "add milk to shopping list and remind me at 5pm" → actionType=add_todo_item, todoListTitle="shopping list", todoItemContent="milk", localTime="5pm"
- "remind me to buy milk at 5pm" → actionType=create_reminder, title="buy milk", localTime="5pm"
- "remind me about my shopping list at 5pm" → actionType=create_reminder, title="Shopping list items", todoListTitle="shopping list", localTime="5pm"
- "current IPOs" → check_ipo
- "upcoming IPOs" → check_ipo, matchQuery="upcoming"
`;

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
