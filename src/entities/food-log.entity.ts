import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('food_logs')
export class FoodLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'log_date', type: 'date' })
  logDate: string;

  @Column({ name: 'meal_type', length: 20, nullable: true })
  mealType: string;

  @Column({ name: 'food_description', length: 500 })
  foodDescription: string;

  @Column('int')
  calories: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
