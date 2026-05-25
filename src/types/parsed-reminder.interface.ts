export type ActionType = 'create_reminder' | 'complete_reminder' | 'save_note' | 'get_note' | 'save_password' | 'get_password' | 'create_todo' | 'add_todo_item' | 'get_todo' | 'complete_todo_item' | 'unknown';

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
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}
