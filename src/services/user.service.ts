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
}
