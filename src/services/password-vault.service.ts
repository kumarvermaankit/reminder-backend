import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { PasswordVault } from '../entities/password-vault.entity';
import { encrypt, decrypt } from '../utils/encryption.util';

@Injectable()
export class PasswordVaultService {
  private readonly logger = new Logger(PasswordVaultService.name);

  constructor(
    @InjectRepository(PasswordVault)
    private readonly vaultRepository: Repository<PasswordVault>,
  ) {}

  async savePassword(userId: string, serviceName: string, password: string): Promise<PasswordVault> {
    const { encrypted, iv, authTag } = encrypt(password);
    return this.vaultRepository.save(
      this.vaultRepository.create({
        userId,
        serviceName: serviceName.toLowerCase(),
        encryptedPassword: encrypted,
        iv,
        authTag,
      }),
    );
  }

  async getPasswords(userId: string, serviceName: string): Promise<{ serviceName: string; password: string; createdAt: Date }[]> {
    const entries = await this.vaultRepository.find({
      where: { userId, serviceName: serviceName.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
    return entries.map(e => ({
      serviceName: e.serviceName,
      password: decrypt(e.encryptedPassword, e.iv, e.authTag),
      createdAt: e.createdAt,
    }));
  }

  async searchServices(userId: string, query: string): Promise<PasswordVault[]> {
    return this.vaultRepository.find({
      where: { userId, serviceName: Like(`%${query.toLowerCase()}%`) },
      order: { createdAt: 'DESC' },
    });
  }

  async deletePassword(userId: string, id: string): Promise<boolean> {
    const result = await this.vaultRepository.delete({ id, userId });
    return (result.affected ?? 0) > 0;
  }
}
