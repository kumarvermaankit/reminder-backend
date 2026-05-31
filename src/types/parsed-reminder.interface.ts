export type ActionType = 'create_reminder' | 'complete_reminder' | 'save_note' | 'get_note' | 'save_password' | 'get_password' | 'create_todo' | 'add_todo_item' | 'get_todo' | 'complete_todo_item' | 'edit_todo_item' | 'delete_list' | 'system_query' | 'update_settings' | 'check_stock' | 'check_cricket' | 'stock_alert' | 'match_alert' | 'unknown';

export interface ParsedReminder {
  actionType?: ActionType;
  reminderId?: string;
  title: string;
  description: string;
  reminderDate: Date;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  recurring?: {
    type: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
  };
  intervalMinutes?: number;
  maxReminderCount?: number;
  userName?: string;
  // Notes
  noteKey?: string;
  noteContent?: string;
  // Passwords
  serviceName?: string;
  password?: string;
  // Todo lists
  todoListTitle?: string;
  todoItemContent?: string;
  todoItemContents?: string[];
  dailyPromptTime?: string;
  /** Raw local wall-clock time verbatim from user (e.g. "5:05 PM", "9am") — no UTC conversion. */
  localTime?: string;
  // Stocks
  stockSymbol?: string;
  targetPrice?: number;
  priceDirection?: 'above' | 'below';
  // Cricket
  matchQuery?: string;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}
