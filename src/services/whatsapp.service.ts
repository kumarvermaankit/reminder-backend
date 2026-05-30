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

  /** Show typing + mark incoming message read (Cloud API). Auto-dismisses on reply or after ~25s. */
  async sendTypingIndicator(messageId: string): Promise<boolean> {
    try {
      if (!this.phoneNumberId || !this.accessToken || !messageId) {
        return false;
      }

      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: { type: 'text' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const ok = response.data?.success === true;
      if (ok) {
        this.logger.log(`Typing indicator sent for message ${messageId}`);
      }
      return ok;
    } catch (error) {
      this.logger.warn(
        'Typing indicator failed (non-fatal):',
        error.response?.data || error.message,
      );
      return false;
    }
  }

  async sendMessage(to: string, message: string): Promise<string | null> {
    try {
      if (!message || message.trim().length === 0) {
        this.logger.error(`Attempted to send empty/null message to ${to}. Stack: ${new Error().stack}`);
        return null;
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
       
      const msgId = response.data.messages?.[0]?.id || null;
      this.logger.log(`WhatsApp message sent to ${to}: ${msgId}`);
      return msgId;
       
    } catch (error) {
      this.logger.error('Error sending WhatsApp message:', error.response?.data || error.message);
      return null;
    }
  }

  async sendInteractiveMessage(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<string | null> {
    try {
      const formattedPhone = to.replace(/^\+/, '');
      const fbButtons = buttons.slice(0, 3).map(b => ({
        type: 'reply',
        reply: { id: b.id, title: b.title.slice(0, 20) },
      }));

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText.slice(0, 1024) },
          action: { buttons: fbButtons },
        },
      };

      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const msgId = response.data.messages?.[0]?.id || null;
      this.logger.log(`WhatsApp interactive message sent to ${to}: ${msgId}`);
      return msgId;
    } catch (error) {
      this.logger.error('Error sending WhatsApp interactive message:', error.response?.data || error.message);
      return null;
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
