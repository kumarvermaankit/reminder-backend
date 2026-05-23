export interface ParsedReminder {
  title: string;
  description: string;
  reminderDate: Date;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  recurring?: {
    type: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval?: number;
  };
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
}
