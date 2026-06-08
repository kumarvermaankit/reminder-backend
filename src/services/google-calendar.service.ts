import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { calendar_v3 } from 'googleapis';
import { GoogleToken } from '../entities/google-token.entity';

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  meetLink?: string;
  location?: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    @InjectRepository(GoogleToken)
    private readonly tokenRepository: Repository<GoogleToken>,
    private readonly configService: ConfigService,
  ) {}

  private getOAuth2Client(): any {
    const { google } = require('googleapis');
    return new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_CALLBACK_URL'),
    );
  }

  getAuthUrl(userId: string, userPhone: string): string {
    const oauth2Client = this.getOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state: JSON.stringify({ userId, phone: userPhone }),
      prompt: 'consent',
    });
  }

  async handleCallback(code: string, state: string): Promise<{ email: string; phone: string }> {
    const { google } = require('googleapis');
    const oauth2Client = this.getOAuth2Client();
    const { userId, phone } = JSON.parse(state);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const existing = await this.tokenRepository.findOne({ where: { userId } });
    const data = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scope: tokens.scope,
      expiryDate: tokens.expiry_date,
      googleEmail: userInfo.email,
    };

    if (existing) {
      await this.tokenRepository.update(existing.id, data);
    } else {
      await this.tokenRepository.save(this.tokenRepository.create(data));
    }

    return { email: userInfo.email, phone };
  }

  async isConnected(userId: string): Promise<boolean> {
    const token = await this.tokenRepository.findOne({ where: { userId } });
    return !!token;
  }

  async getCalendarClient(userId: string): Promise<calendar_v3.Calendar | null> {
    const { google } = require('googleapis');
    const token = await this.tokenRepository.findOne({ where: { userId } });
    if (!token) return null;

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiryDate,
    });

    oauth2Client.on('tokens', async (newTokens) => {
      const update: Partial<GoogleToken> = {};
      if (newTokens.access_token) update.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) update.refreshToken = newTokens.refresh_token;
      if (newTokens.expiry_date) update.expiryDate = newTokens.expiry_date;
      if (Object.keys(update).length > 0) {
        await this.tokenRepository.update(token.id, update);
      }
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  async listEvents(userId: string, maxResults = 10): Promise<CalendarEvent[]> {
    const calendar = await this.getCalendarClient(userId);
    if (!calendar) return [];

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (data.items || []).map(e => ({
      id: e.id,
      summary: e.summary || '(no title)',
      description: e.description,
      start: new Date(e.start?.dateTime || e.start?.date),
      end: new Date(e.end?.dateTime || e.end?.date),
      meetLink: e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri,
      location: e.location,
    }));
  }

  async createEvent(
    userId: string,
    params: {
      summary: string;
      description?: string;
      start: Date;
      end: Date;
      attendees?: string[];
      addMeet?: boolean;
    },
  ): Promise<CalendarEvent | null> {
    const calendar = await this.getCalendarClient(userId);
    if (!calendar) return null;

    const event: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: params.end.toISOString(), timeZone: 'UTC' },
      attendees: params.attendees?.map(email => ({ email })),
    };

    if (params.addMeet) {
      event.conferenceData = {
        createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }

    const { data } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: params.addMeet ? 1 : 0,
    });

    return {
      id: data.id,
      summary: data.summary,
      description: data.description,
      start: new Date(data.start?.dateTime || data.start?.date),
      end: new Date(data.end?.dateTime || data.end?.date),
      meetLink: data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri,
      location: data.location,
    };
  }

  async getConnectedEmail(userId: string): Promise<string | null> {
    const token = await this.tokenRepository.findOne({ where: { userId } });
    return token?.googleEmail || null;
  }
}
