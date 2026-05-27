import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async createUser(userData: Partial<User>): Promise<User> {
    const user = this.userRepository.create(userData);
    return await this.userRepository.save(user);
  }

  async getUserById(id: string): Promise<User> {
    return await this.userRepository.findOne({ 
      where: { id },
      relations: ['reminders']
    });
  }

  async getUserByEmail(email: string): Promise<User> {
    return await this.userRepository.findOne({ 
      where: { email },
      relations: ['reminders']
    });
  }

  async getUserByPhone(phone: string): Promise<User> {
    return await this.userRepository.findOne({ 
      where: { phone },
      relations: ['reminders']
    });
  }

  async updateUser(id: string, userData: Partial<User>): Promise<User> {
    await this.userRepository.update(id, userData);
    return await this.getUserById(id);
  }

  async getAllUsers(): Promise<User[]> {
    return await this.userRepository.find({ 
      relations: ['reminders']
    });
  }

  async getActiveUsers(): Promise<User[]> {
    return await this.userRepository.find({ 
      where: { isActive: true },
      relations: ['reminders']
    });
  }

  async deleteUser(id: string): Promise<void> {
    await this.userRepository.delete(id);
  }

  // Check if user is in quiet hours
  isInQuietHours(user: User): boolean {
    if (!user.quietHoursStart || !user.quietHoursEnd) {
      return false;
    }

    const localStr = new Date().toLocaleTimeString('en-GB', {
      timeZone: user.timezone, hour: '2-digit', minute: '2-digit',
    });
    const currentTime = localStr; // HH:mm format in user's timezone

    const startTime = user.quietHoursStart;
    const endTime = user.quietHoursEnd;
    
    // Handle case where quiet hours span midnight (e.g., 22:00 to 06:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    } else {
      return currentTime >= startTime && currentTime <= endTime;
    }
  }

  // Get user's local time
  getUserLocalTime(user: User): Date {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: user.timezone,
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const getVal = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    const h = getVal('hour'), m = getVal('minute'), s = getVal('second');
    return new Date(1970, 0, 1, h, m, s);
  }

  // Get today's local date (YYYY-MM-DD) for a user
  getUserLocalDate(user: User): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: user.timezone });
  }

  // Find active users who are due for their daily prompt
  async getUsersDueForDailyPrompt(): Promise<User[]> {
    const users = await this.userRepository.find({ where: { isActive: true } });
    return users.filter(u => {
      const localToday = this.getUserLocalDate(u);
      // Already prompted today
      if (u.lastDailyPromptDate === localToday) return false;

      // Check if prompt time has passed in user's local time
      const localNow = this.getUserLocalTime(u);
      const [pHours, pMins] = (u.dailyPromptTime || '07:00').split(':').map(Number);
      const promptMin = pHours * 60 + pMins;
      const nowMin = localNow.getHours() * 60 + localNow.getMinutes();

      return nowMin >= promptMin;
    });
  }

  // Infer timezone from message timestamp + greeting
  inferTimezone(msgTimestamp: Date, message: string): string | null {
    const lower = message.toLowerCase();
    let localHourGuess: number | null = null;

    if (/^(good\s*)?morning|g'morning|gm\b/.test(lower)) localHourGuess = 8;
    else if (/^(good\s*)?afternoon|good\s*ay/.test(lower)) localHourGuess = 14;
    else if (/^(good\s*)?evening/.test(lower)) localHourGuess = 18;
    else if (/^(good\s*)?night|gn\b/.test(lower)) localHourGuess = 22;
    else return null;

    const utcHour = msgTimestamp.getUTCHours();
    let offsetHours = localHourGuess - utcHour;
    if (offsetHours > 12) offsetHours -= 24;
    if (offsetHours < -12) offsetHours += 24;

    const offsetMap: Record<string, string> = {
      '-12': 'Etc/GMT+12', '-11': 'Pacific/Pago_Pago', '-10': 'Pacific/Honolulu',
      '-9': 'America/Anchorage', '-8': 'America/Los_Angeles', '-7': 'America/Denver',
      '-6': 'America/Chicago', '-5': 'America/New_York', '-4': 'America/Halifax',
      '-3': 'America/Argentina/Buenos_Aires', '-2': 'Etc/GMT+2', '-1': 'Atlantic/Azores',
      '0': 'UTC', '1': 'Europe/Paris', '2': 'Europe/Helsinki', '3': 'Europe/Moscow',
      '4': 'Asia/Dubai', '5': 'Asia/Karachi', '5.5': 'Asia/Kolkata',
      '6': 'Asia/Dhaka', '7': 'Asia/Bangkok', '8': 'Asia/Shanghai',
      '9': 'Asia/Tokyo', '10': 'Australia/Sydney', '11': 'Pacific/Noumea',
      '12': 'Pacific/Auckland',
    };

    // Round to nearest 0.5
    const rounded = Math.round(offsetHours * 2) / 2;
    const key = String(rounded);
    return offsetMap[key] || 'UTC';
  }

  // Format a date offset (days from today) as a daily list title
  dailyListTitle(timezone: string, daysOffset: number = 0): string {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const dateStr = date.toLocaleDateString('en-US', {
      timeZone: timezone, month: 'long', day: 'numeric',
    });
    return `${dateStr} Daily List`;
  }
}
