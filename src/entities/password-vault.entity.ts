import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('password_vault')
@Index(['userId', 'serviceName'])
export class PasswordVault {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'service_name', length: 255 })
  serviceName: string;

  @Column({ name: 'encrypted_password', type: 'text' })
  encryptedPassword: string;

  @Column({ length: 64 })
  iv: string;

  @Column({ name: 'auth_tag', length: 64 })
  authTag: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
