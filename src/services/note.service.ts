import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Note } from '../entities/note.entity';

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  constructor(
    @InjectRepository(Note)
    private readonly noteRepository: Repository<Note>,
  ) {}

  async saveNote(userId: string, key: string, content: string): Promise<Note> {
    const existing = await this.noteRepository.findOne({ where: { userId, key } });
    if (existing) {
      existing.content = content;
      return this.noteRepository.save(existing);
    }
    return this.noteRepository.save(this.noteRepository.create({ userId, key, content }));
  }

  async getNote(userId: string, key: string): Promise<Note | null> {
    return this.noteRepository.findOne({ where: { userId, key } });
  }

  async searchNotes(userId: string, query: string): Promise<Note[]> {
    return this.noteRepository.find({
      where: [
        { userId, key: Like(`%${query}%`) },
        { userId, content: Like(`%${query}%`) },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllNotes(userId: string): Promise<Note[]> {
    return this.noteRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteNote(userId: string, key: string): Promise<boolean> {
    const result = await this.noteRepository.delete({ userId, key });
    return (result.affected ?? 0) > 0;
  }
}
