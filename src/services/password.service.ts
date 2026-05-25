import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Password } from '../entities/password.entity';
import { EncryptionService } from './encryption.service';

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    @InjectRepository(Password)
    private readonly passwordRepository: Repository<Password>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async savePassword(
    userId: string,
    service: string,
    username: string,
    password: string,
    url?: string,
    notes?: string,
  ): Promise<Password> {
    if (!service || !password) {
      throw new BadRequestException('Service and password are required');
    }

    const encryptedPassword = this.encryptionService.encrypt(password);

    const newPassword = this.passwordRepository.create({
      userId,
      service: service.toLowerCase(),
      username: username || '',
      encryptedPassword,
      url,
      notes,
      isFavorite: false,
      lastModified: new Date(),
    });

    const savedPassword = await this.passwordRepository.save(newPassword);
    this.logger.log(`Password saved for service: ${service} (user: ${userId})`);
    return this.maskPassword(savedPassword);
  }

  async getPassword(passwordId: string, userId: string): Promise<Password> {
    const password = await this.passwordRepository.findOne({
      where: { id: passwordId, userId },
    });

    if (!password) {
      throw new NotFoundException('Password not found');
    }

    password.encryptedPassword = this.encryptionService.decrypt(password.encryptedPassword);
    return password;
  }

  async getPasswordsByService(userId: string, service: string): Promise<Password[]> {
    const passwords = await this.passwordRepository.find({
      where: { userId, service: service.toLowerCase() },
      order: { createdAt: 'DESC' },
    });

    return passwords.map(p => {
      p.encryptedPassword = this.encryptionService.decrypt(p.encryptedPassword);
      return p;
    });
  }

  async getAllPasswords(userId: string): Promise<Password[]> {
    const passwords = await this.passwordRepository.find({
      where: { userId },
      order: { isFavorite: 'DESC', createdAt: 'DESC' },
    });

    return passwords.map(p => this.maskPassword(p));
  }

  async getFavoritePasswords(userId: string): Promise<Password[]> {
    const passwords = await this.passwordRepository.find({
      where: { userId, isFavorite: true },
      order: { createdAt: 'DESC' },
    });

    return passwords.map(p => this.maskPassword(p));
  }

  async searchPasswords(userId: string, query: string): Promise<Password[]> {
    const passwords = await this.passwordRepository
      .createQueryBuilder('password')
      .where('password.userId = :userId', { userId })
      .andWhere(
        '(password.service LIKE :query OR password.username LIKE :query OR password.notes LIKE :query)',
        { query: `%${query}%` },
      )
      .orderBy('password.isFavorite', 'DESC')
      .addOrderBy('password.createdAt', 'DESC')
      .getMany();

    return passwords.map(p => this.maskPassword(p));
  }

  async updatePassword(
    passwordId: string,
    userId: string,
    newPassword?: string,
    username?: string,
    url?: string,
    notes?: string,
  ): Promise<Password> {
    const password = await this.passwordRepository.findOne({
      where: { id: passwordId, userId },
    });

    if (!password) {
      throw new NotFoundException('Password not found');
    }

    if (newPassword) {
      password.encryptedPassword = this.encryptionService.encrypt(newPassword);
      password.lastModified = new Date();
    }
    if (username) password.username = username;
    if (url) password.url = url;
    if (notes) password.notes = notes;

    const updatedPassword = await this.passwordRepository.save(password);
    this.logger.log(`Password updated: ${passwordId}`);
    return this.maskPassword(updatedPassword);
  }

  async toggleFavorite(passwordId: string, userId: string): Promise<Password> {
    const password = await this.passwordRepository.findOne({
      where: { id: passwordId, userId },
    });

    if (!password) {
      throw new NotFoundException('Password not found');
    }

    password.isFavorite = !password.isFavorite;
    const updatedPassword = await this.passwordRepository.save(password);
    this.logger.log(`Password favorite status toggled: ${passwordId}`);
    return this.maskPassword(updatedPassword);
  }

  async deletePassword(passwordId: string, userId: string): Promise<void> {
    const password = await this.passwordRepository.findOne({
      where: { id: passwordId, userId },
    });

    if (!password) {
      throw new NotFoundException('Password not found');
    }

    await this.passwordRepository.remove(password);
    this.logger.log(`Password deleted: ${passwordId}`);
  }

  async deleteAllPasswords(userId: string): Promise<void> {
    await this.passwordRepository.delete({ userId });
    this.logger.log(`All passwords deleted for user: ${userId}`);
  }

  async deletePasswordByService(userId: string, service: string): Promise<void> {
    const result = await this.passwordRepository.delete({
      userId,
      service: service.toLowerCase(),
    });

    if (result.affected === 0) {
      throw new NotFoundException(`Password for service '${service}' not found`);
    }

    this.logger.log(`Password for service '${service}' deleted`);
  }

  private maskPassword(password: Password): Password {
    const masked = { ...password };
    masked.encryptedPassword = '••••••••';
    return masked;
  }
}
