import { Injectable, Logger, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    name: string;
    phone?: string;
  }): Promise<{ user: Partial<User>; token: string }> {
    const email = data.email.trim().toLowerCase();
    if (!email || !data.password || !data.name?.trim()) {
      throw new BadRequestException('Email, password, and name are required');
    }
    if (data.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await this.userRepository.findOne({
      where: [{ email }, ...(data.phone ? [{ phone: data.phone }] : [])],
    });
    if (existing) {
      const field = existing.email === email ? 'email' : 'WhatsApp number';
      throw new ConflictException(`Account with this ${field} already exists. Please log in.`);
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await this.userRepository.save(
      this.userRepository.create({
        email,
        passwordHash,
        name: data.name.trim(),
        phone: data.phone || null,
        country: 'IN',
        preferredContactMethod: data.phone ? 'whatsapp' : 'email',
        isActive: true,
        plan: 'free',
      }),
    );

    this.logger.log(`Registered user: ${user.id} email=${email}`);
    return { user: this.sanitize(user), token: this.sign(user) };
  }

  async login(email: string, password: string): Promise<{ user: Partial<User>; token: string }> {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }
    const user = await this.userRepository.findOne({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.logger.log(`User logged in: ${user.id}`);
    return { user: this.sanitize(user), token: this.sign(user) };
  }

  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitize(user);
  }

  /** Find an existing user by Google email, or create one. Returns sanitized user + JWT. */
  async loginWithGoogle(email: string, name?: string): Promise<{ user: Partial<User>; token: string }> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new UnauthorizedException('Google account has no email');

    let user = await this.userRepository.findOne({ where: { email: normalized } });
    if (!user) {
      user = await this.userRepository.save(
        this.userRepository.create({
          email: normalized,
          name: name?.trim() || normalized.split('@')[0],
          country: 'IN',
          preferredContactMethod: 'email',
          isActive: true,
          plan: 'free',
        }),
      );
      this.logger.log(`User created via Google login: ${user.id} email=${normalized}`);
    } else if (user.name && name && !user.name.trim()) {
      await this.userRepository.update(user.id, { name: name.trim() });
    }

    return { user: this.sanitize(user), token: this.sign(user) };
  }

  /** Sign a JWT for an already-authenticated user (used by Google OAuth callback). */
  signForUser(user: User): string {
    return this.sign(user);
  }

  /** Link an existing WhatsApp-created user to this email account (claim flow). */
  async claimUserByPhone(userId: string, phone: string, password: string): Promise<Partial<User>> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const phoneOwner = await this.userRepository.findOne({ where: { phone } });
    if (phoneOwner && phoneOwner.id !== userId) {
      throw new ConflictException('This WhatsApp number is already linked to another account');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepository.update(userId, { phone, passwordHash });
    return this.sanitize({ ...user, phone, passwordHash } as User);
  }

  private sign(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwtService.sign(payload);
  }

  private sanitize(user: User): Partial<User> {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
