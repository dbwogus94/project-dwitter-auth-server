import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column('varchar', { length: 100 })
  username: string;

  @Column('varchar', { length: 100 })
  name: string;

  @Column('varchar', { length: 200 })
  password: string;

  @Column('varchar', { length: 100 })
  email: string;

  @Column('text')
  url: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}