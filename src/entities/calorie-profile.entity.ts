import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('calorie_profiles')
export class CalorieProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', unique: true })
  userId: string;

  @Column('float')
  weight: number;

  @Column('float')
  height: number;

  @Column()
  age: number;

  @Column()
  gender: string;

  @Column({ name: 'activity_level', length: 20 })
  activityLevel: string;

  @Column({ length: 20 })
  goal: string;

  @Column({ name: 'target_weight', type: 'float', nullable: true })
  targetWeight: number;

  @Column({ name: 'daily_calorie_target', type: 'int' })
  dailyCalorieTarget: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
