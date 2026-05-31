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
          return await this.parseWithGroq(provider, fullPrompt, msgTimestamp);
        case 'together':
        case 'deepseek':
          return await this.parseWithTogether(provider, fullPrompt, msgTimestamp);
        case 'replicate':
          return await this.parseWithReplicate(provider, fullPrompt, msgTimestamp);
        case 'gemini':
          return await this.parseWithGemini(provider, fullPrompt, msgTimestamp);
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
  /** Prompt block: anchor "now" on WhatsApp msgTimestamp vs server clock — no IANA timezone. */
  private buildReminderTimeContext(msgTimestamp?: Date): string {
    const userMsgUtc = (msgTimestamp || new Date()).toISOString();
    const serverUtc = new Date().toISOString();
    const lagMinutes = Math.round(
      (new Date(serverUtc).getTime() - new Date(userMsgUtc).getTime()) / 60000,
    );
    this.logger.log(
      `reminder time context: userMsgUtc=${userMsgUtc} serverUtc=${serverUtc} lagMin=${lagMinutes}`,
    );

    return `TIME REFERENCE (do NOT use any timezone name, IANA zone, or profile timezone):
- User message sent at (UTC): ${userMsgUtc}  ← this is the user's "now"; use for all relative times
- Server time (UTC): ${serverUtc}  (processing lag ~${lagMinutes} min — use user message time, not server time)
- Infer the user's UTC offset from when they sent the message vs the wall-clock they mention (e.g. if message is 09:44Z and they say "15:15", offset is about +05:30).
- NEVER put the user's local hour into the UTC string. WRONG: message 2026-05-30T09:44:00Z, user wants 15:15 local → "2026-05-30T15:15:00Z". RIGHT: "2026-05-30T09:45:00Z" (subtract offset from local time to get UTC).
- For wall-clock times: convert local → UTC before returning reminderDate.
- For relative times ("in 5 minutes", "in 1 hour"): add to the user message UTC timestamp, not server time.
- If only an interval is given (every X min) with no start time: reminderDate = user message UTC + intervalMinutes.
- Output reminderDate as ISO-8601 UTC with Z suffix only.`;
  }

  /** Standard UTC offsets in minutes (east positive), 15/30/45 min steps. */
  private static readonly STANDARD_UTC_OFFSET_MINUTES = [
    -720, -660, -600, -540, -480, -420, -360, -300, -270, -240, -210, -180, -150, -120, -90, -60, -30,
    0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 450, 480, 510, 540, 570, 600, 630, 660, 690, 720, 780,
  ];

  private minutesOfDayUtc(d: Date): number {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  /**
   * AI often returns local wall-clock as UTC (e.g. 15:15Z instead of 09:45Z for IST).
   * When gap ≈ standard UTC offset and intended delay is small, fix to msgTimestamp + delay.
   */
  private correctReminderDateFromMsgTimestamp(msgTimestamp: Date, reminderDate: Date): Date {
    const diffMs = reminderDate.getTime() - msgTimestamp.getTime();
    const diffMin = diffMs / 60000;
    if (diffMin <= 0 || diffMin > 24 * 60) return reminderDate;

    let offsetMin: number | null = null;
    for (const o of SimpleAiService.STANDARD_UTC_OFFSET_MINUTES) {
      if (Math.abs(diffMin - o) <= 3) {
        offsetMin = o;
        break;
      }
    }
    if (offsetMin === null || offsetMin === 0) return reminderDate;

    const intendedDelayMin = diffMin - offsetMin;
    if (intendedDelayMin <= 0 || intendedDelayMin > 12 * 60) return reminderDate;

    const localMsgMin = (this.minutesOfDayUtc(msgTimestamp) + offsetMin + 24 * 60) % (24 * 60);
    const remMin = this.minutesOfDayUtc(reminderDate);
    const clockDelta = Math.min(
      Math.abs(remMin - localMsgMin),
      24 * 60 - Math.abs(remMin - localMsgMin),
    );
    if (clockDelta > 120) return reminderDate;

    const corrected = new Date(msgTimestamp.getTime() + intendedDelayMin * 60 * 1000);
    this.logger.log(
      `corrected local-as-UTC: ${reminderDate.toISOString()} → ${corrected.toISOString()} ` +
        `(offset=${offsetMin}min, intendedDelay=${Math.round(intendedDelayMin)}min)`,
    );
    return corrected;
  }

  private applyReminderDateFromMsgTimestamp(parsed: any, msgTimestamp?: Date): void {
    if (!parsed.reminderDate || !msgTimestamp) return;
    const rem =
      parsed.reminderDate instanceof Date
        ? parsed.reminderDate
        : this.parseReminderDateUtc(String(parsed.reminderDate));
    if (!rem) {
      delete parsed.reminderDate;
      return;
    }
    parsed.reminderDate = this.correctReminderDateFromMsgTimestamp(msgTimestamp, rem);
  }

  private parseReminderDateUtc(dateStr: string): Date | null {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        this.logger.warn(`parseReminderDateUtc: unparseable: "${dateStr}"`);
        return null;
      }
      return date;
    } catch (e: any) {
      this.logger.error(`parseReminderDateUtc: error for "${dateStr}": ${e.message}`);
      return null;
    }
  }

  private async parseWithGroq(provider: AIProvider, userInput: string, msgTimestamp?: Date): Promise<ParsedReminder> {
    const timeContext = this.buildReminderTimeContext(msgTimestamp);

    const prompt = `Parse: "${userInput}"
    ${timeContext}
    Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, delete_list, system_query, unknown.
    Return JSON with actionType, reminderId, title, description, reminderDate (UTC ISO with Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount
    CRITICAL: reminderDate MUST be UTC with Z suffix. Anchor to user message UTC above; do not use profile timezone.`;

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

    if (parsed.reminderDate) {
      parsed.reminderDate = this.parseReminderDateUtc(parsed.reminderDate);
      if (!parsed.reminderDate) delete parsed.reminderDate;
      this.applyReminderDateFromMsgTimestamp(parsed, msgTimestamp);
    }

    return parsed;
  }

  private async parseWithGemini(provider: AIProvider, userInput: string, msgTimestamp?: Date): Promise<ParsedReminder> {
    const model = provider.client.getGenerativeModel({ model: provider.models.parsing });
    const timeContext = this.buildReminderTimeContext(msgTimestamp);

    const prompt = `Parse: "${userInput}"
${timeContext}
Determine actionType: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, delete_list, system_query, unknown.
Return JSON with actionType, reminderId, title, description, reminderDate (UTC ISO with Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount
CRITICAL: reminderDate MUST be UTC with Z suffix. Anchor to user message UTC above; do not use profile timezone.`;

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
    this.logger.log(`parseWithGemini raw reminderDate="${parsed.reminderDate}"`);
    
    if (parsed.reminderDate) {
      parsed.reminderDate = this.parseReminderDateUtc(parsed.reminderDate);
      if (!parsed.reminderDate) delete parsed.reminderDate;
      this.applyReminderDateFromMsgTimestamp(parsed, msgTimestamp);
    }
    
    return parsed;
  }

  private async parseWithTogether(provider: AIProvider, userInput: string, msgTimestamp?: Date): Promise<ParsedReminder> {
    const timeContext = this.buildReminderTimeContext(msgTimestamp);
    const response = await provider.client.chat.completions.create({
      model: provider.models.parsing,
      messages: [
        { role: 'system', content: 'You are an assistant that detects intent: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, delete_list, system_query, update_settings, unknown. Return valid JSON.' },
        { role: 'user', content: `Parse: "${userInput}".\n${timeContext}\nReturn JSON with actionType, reminderId, title, description, reminderDate (UTC ISO with Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount. reminderDate MUST be UTC with Z suffix; anchor to user message UTC, not profile timezone.` }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from Together');
    const parsed = JSON.parse(content);
    this.logger.log(`parseWithTogether raw reminderDate="${parsed.reminderDate}"`);
    if (parsed.reminderDate) {
      parsed.reminderDate = this.parseReminderDateUtc(parsed.reminderDate);
      if (!parsed.reminderDate) delete parsed.reminderDate;
      this.applyReminderDateFromMsgTimestamp(parsed, msgTimestamp);
    }
    return parsed;
  }

  private async parseWithReplicate(provider: AIProvider, userInput: string, msgTimestamp?: Date): Promise<ParsedReminder> {
    const timeContext = this.buildReminderTimeContext(msgTimestamp);
    const prompt = `Parse this message and return ONLY valid JSON with no other text: "${userInput}"
${timeContext}

Return JSON with actionType (create_reminder|complete_reminder|save_note|get_note|save_password|get_password|create_todo|add_todo_item|get_todo|complete_todo_item|edit_todo_item|delete_list|system_query|update_settings|unknown), title, description, reminderDate (UTC ISO with Z suffix), priority, category, confidence, needsClarification, noteKey, noteContent, serviceName, password, todoListTitle, todoItemContent, todoItemContents, dailyPromptTime, intervalMinutes, maxReminderCount

Rules: morning=9am, afternoon=2pm, evening=6pm, night=8pm relative to user message local frame. Use EXACT user words for title. reminderDate MUST be UTC with Z suffix; anchor to user message UTC, not profile timezone.`;

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
    this.logger.log(`parseWithReplicate raw reminderDate="${parsed.reminderDate}"`);
    if (parsed.reminderDate) {
      parsed.reminderDate = this.parseReminderDateUtc(parsed.reminderDate);
      if (!parsed.reminderDate) delete parsed.reminderDate;
      this.applyReminderDateFromMsgTimestamp(parsed, msgTimestamp);
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
