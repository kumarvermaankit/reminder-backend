export const SYSTEM_MESSAGE_PARSE_REMINDER = 'You are a reminder assistant. Return valid JSON.';

export const SYSTEM_MESSAGE_PARSE_ALWAYS_JSON = 'You are a reminder assistant. Always return valid JSON.';

export const SYSTEM_MESSAGE_DETECT_INTENT =
  'You are an assistant that detects intent: create_reminder, complete_reminder, save_note, get_note, save_password, get_password, create_todo, add_todo_item, get_todo, complete_todo_item, edit_todo_item, edit_todo_list, delete_list, system_query, update_settings, check_stock, check_cricket, check_ipo, stock_alert, match_alert, ipo_alert, connect_calendar, create_event, list_events, calorie_setup, log_food, calorie_status, diet_advice, unknown. Return valid JSON.';

export const SYSTEM_MESSAGE_FRIENDLY_AI = 'You are a friendly AI assistant. Be casual and use emojis.';

export const SYSTEM_MESSAGE_FRIENDLY_AI_WITH_WORKFLOWS = (workflows: string) =>
  `You are a friendly AI assistant. Be casual and use emojis.\n\nHere are your capabilities:\n${workflows}`;

export const SYSTEM_MESSAGE_CASUAL_AI = 'You are a friendly, casual AI assistant. Use emojis and be conversational. Keep responses short and natural.';

export const SYSTEM_MESSAGE_JSON_AI = 'You are a friendly AI assistant. Return valid JSON.';

export const SYSTEM_MESSAGE_DETECT_COMPLETION = (remindersText: string) =>
  `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" without specifying which one, match the LAST/most recent reminder in the list. The reminderId MUST be one of the IDs listed below - never invent one.

User reminders:\n${remindersText}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;

export const SYSTEM_MESSAGE_DETECT_COMPLETION_SIMPLE = (remindersText: string) =>
  `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.\n\nUser reminders:\n${remindersText}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;

export const SYSTEM_MESSAGE_DETECT_COMPLETION_GEMINI = (remindersText: string, userInput: string) =>
  `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.
User reminders:
${remindersText}

User: ${userInput}

Return JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;

export const SYSTEM_MESSAGE_DETECT_COMPLETION_REPLICATE = (remindersText: string, userInput: string) =>
  `You detect if a user is marking a task as done. Understand phrases like "done", "completed", "finished", "all done", "stop reminding", "cancel". If user says "done" with a single pending reminder, mark it as done. The reminderId MUST be one of the IDs listed below - never invent one.\n\nUser reminders:\n${remindersText}\n\nUser: ${userInput}\n\nReturn JSON: {"completed": true/false, "reminderId": "one_of_ids_above_only_if_completed", "response": "confirmation"}`;

export const SYSTEM_MESSAGE_DETECT_COMPLETION_UNIFIED = (remindersText: string) =>
  `Detect task completion. User reminders:\n${remindersText}\n\nReturn JSON: {"completed": true/false, "reminderId": "id", "response": "confirmation"}`;

export const GENERATE_RESPONSE_PROMPT = (userInput: string, reminderTitle?: string, reminderDate?: Date) =>
  reminderTitle && reminderDate
    ? `User said: "${userInput}"\nI understood this as a reminder: ${reminderTitle} at ${reminderDate.toLocaleString()}\nGenerate a friendly, casual confirmation response.`
    : `User said: "${userInput}"\nThis doesn't seem like a reminder. Just respond conversationally and naturally without mentioning reminders.`;

export const GENERATE_RESPONSE_PROMPT_GEMINI = (userInput: string, reminderTitle?: string, reminderDate?: Date) =>
  reminderTitle && reminderDate
    ? `User: "${userInput}". Reminder: ${reminderTitle} at ${reminderDate.toLocaleString()}. Friendly confirmation:`
    : `User: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

export const GENERATE_RESPONSE_PROMPT_TOGETHER = (userInput: string, reminderTitle?: string, reminderDate?: Date) =>
  reminderTitle && reminderDate
    ? `User said: "${userInput}". Reminder: ${reminderTitle} at ${reminderDate.toLocaleString()}. Generate a friendly confirmation response.`
    : `User said: "${userInput}". This is not a reminder. Respond conversationally without mentioning reminders.`;

export const UNIFIED_PARSE_PROMPT = (userInput: string) =>
  `Parse this reminder request: "${userInput}"
    
Current date and time: ${new Date().toISOString()}

Return JSON with:
{
  "title": "brief title",
  "description": "full description", 
  "reminderDate": "ISO datetime",
  "priority": "low|medium|high",
  "category": "work|personal|health|finance|other",
  "confidence": 0.0-1.0,
  "needsClarification": true/false,
  "clarificationQuestion": "if needed"
}

Rules:
- morning=9am, afternoon=2pm, evening=6pm, night=8pm
- tomorrow/today=10am default
- medicine=daily morning
- Only ask if truly unclear
- Be confident when you can infer`;

export const UNIFIED_GENERATE_RESPONSE_PROMPT = (userInput: string, reminderTitle?: string, reminderDate?: Date) => {
  if (reminderTitle && reminderDate) {
    return `User said: "${userInput}"
I understood: ${reminderTitle} at ${reminderDate.toLocaleString()}
Generate a friendly, casual confirmation response.`;
  }
  return `User said: "${userInput}"
Generate a friendly response asking for more details about the reminder.`;
};

export const UNIFIED_DETECT_COMPLETION_PROMPT = (userInput: string, remindersText: string) =>
  `Detect task completion. User reminders:
${remindersText}

User: ${userInput}

Return JSON: {"completed": true/false, "reminderId": "id", "response": "casual confirmation"}

Look for phrases like:
- "done with", "finished", "completed"
- "don't need that reminder anymore"
- "already did that"
- "cancel that reminder"`;

export const MULTI_PROVIDER_PARSE_PROMPT = (userInput: string) =>
  `Parse reminder: "${userInput}"
Current time: ${new Date().toISOString()}

Return JSON:
{
  "title": "brief title",
  "description": "description",
  "reminderDate": "ISO datetime",
  "priority": "low|medium|high",
  "category": "work|personal|health|finance|other",
  "confidence": 0.0-1.0,
  "needsClarification": true/false,
  "clarificationQuestion": "if needed"
}

Rules: morning=9am, afternoon=2pm, evening=6pm, tomorrow=10am`;

export const MULTI_PROVIDER_GENERATE_RESPONSE_PROMPT = (userInput: string, reminderTitle?: string, reminderDate?: Date) =>
  reminderTitle && reminderDate
    ? `User: "${userInput}". Reminder: ${reminderTitle} at ${reminderDate.toLocaleString()}. Friendly confirmation:`
    : `User: "${userInput}". Ask for reminder details:`;

export const SYSTEM_QUERY_PROMPT = (message: string, workflows: string) =>
  `You are a helpful assistant for a reminder app. A user asked: "${message}". Answer their question politely and accurately based on these system capabilities:\n\n${workflows}\n\nKeep it concise, friendly, and use emoji. Only answer what the system can actually do — don't make things up.`;
