export type ActionType = 'create_reminder' | 'complete_reminder' | 'save_note' | 'get_note' | 'save_password' | 'get_password' | 'create_todo' | 'add_todo_item' | 'get_todo' | 'complete_todo_item' | 'edit_todo_item' | 'edit_todo_list' | 'delete_list' | 'system_query' | 'update_settings' | 'check_stock' | 'check_cricket' | 'check_ipo' | 'stock_alert' | 'match_alert' | 'ipo_alert' | 'connect_calendar' | 'create_event' | 'list_events' | 'calorie_setup' | 'log_food' | 'calorie_status' | 'diet_advice' | 'make_payment' | 'unknown';

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
  /** Delay until first fire ("in 10 minutes") OR repeat interval ("every 10 minutes"). */
  intervalMinutes?: number;
  /** True only when user explicitly asked for repeats ("every X minutes/hours"). */
  isRecurring?: boolean;
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
  todoListTitles?: string[];
  deletePattern?: string;
  todoItemContent?: string;
  todoItemContents?: string[];
  dailyPromptTime?: string;
  /** Raw local wall-clock time verbatim from user (e.g. "5:05 PM", "9am") — no UTC conversion. */
  localTime?: string;
  /** Day of week from user (e.g. "thursday", "every monday", "tuesday") */
  dayOfWeek?: string;
  /** Attendee email addresses for calendar events */
  attendees?: string[];
  // Stocks
  stockSymbol?: string;
  targetPrice?: number;
  priceDirection?: 'above' | 'below';
  // Cricket
  matchQuery?: string;
  // Calorie tracker
  foodDescription?: string;
  mealType?: string;
  calories?: number;
  weight?: number;
  height?: number;
  age?: number;
  gender?: string;
  activityLevel?: string;
  goal?: string;
  targetWeight?: number;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}
