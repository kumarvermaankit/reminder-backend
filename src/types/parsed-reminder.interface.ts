export type ActionType = 'create_reminder' | 'save_note' | 'get_note' | 'save_password' | 'get_password' | 'unknown';

export interface ParsedReminder {
  actionType?: ActionType;
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
  userName?: string;
  // Notes
  noteKey?: string;
  noteContent?: string;
  // Passwords
  serviceName?: string;
  password?: string;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}
