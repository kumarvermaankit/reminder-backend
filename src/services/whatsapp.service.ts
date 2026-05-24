import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private phoneNumberId: string;
  private accessToken: string;
  private baseUrl: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.baseUrl = process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com/v18.0';
    
    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn('WhatsApp credentials not configured. Messages will not be sent.');
    }
  }

  async sendMessage(to: string, message: string): Promise<boolean> {
    try {
      if (!message || message.trim().length === 0) {
        this.logger.error(`Attempted to send empty message to ${to}. Stack: ${new Error().stack}`);
        return false;
      }

      // Format phone number (remove + if present)
      const formattedPhone = to.replace(/^\+/, '');
      
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: message
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
       
      this.logger.log(`WhatsApp message sent to ${to}: ${response.data.messages?.[0]?.id}`);
      return true;
       
    } catch (error) {
      this.logger.error('Error sending WhatsApp message:', error.response?.data || error.message);
      return false;
    }
  }

  async sendTemplateMessage(to: string, templateName: string, languageCode: string = 'en', components?: any[]): Promise<boolean> {
    try {
      const formattedPhone = to.replace(/^\+/, '');
      
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode
          }
        }
      };

      if (components) {
        payload.template.components = components;
      }

      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
       
      this.logger.log(`WhatsApp template message sent to ${to}: ${response.data.messages?.[0]?.id}`);
      return true;
       
    } catch (error) {
      this.logger.error('Error sending WhatsApp template message:', error.response?.data || error.message);
      return false;
    }
  }
}
