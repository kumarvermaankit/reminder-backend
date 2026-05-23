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

    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:mm format
    
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
    return new Date(now.toLocaleString("en-US", { timeZone: user.timezone }));
  }
}
