import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from '../entities/note.entity';

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  constructor(
    @InjectRepository(Note)
    private readonly noteRepository: Repository<Note>,
  ) {}

  async createNote(
    userId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ): Promise<Note> {
    if (!title || !content) {
      throw new BadRequestException('Title and content are required');
    }

    const note = this.noteRepository.create({
      userId,
      title,
      content,
      category: category || 'general',
      tags: tags || [],
      isPinned: false,
    });

    const savedNote = await this.noteRepository.save(note);
    this.logger.log(`Note created: ${savedNote.id} for user ${userId}`);
    return savedNote;
  }

  async getNoteById(noteId: string, userId: string): Promise<Note> {
    const note = await this.noteRepository.findOne({
      where: { id: noteId, userId },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return note;
  }

  async getAllNotesByUser(userId: string): Promise<Note[]> {
    return await this.noteRepository.find({
      where: { userId },
      order: { isPinned: 'DESC', createdAt: 'DESC' },
    });
  }

  async getNotesByCategory(userId: string, category: string): Promise<Note[]> {
    return await this.noteRepository.find({
      where: { userId, category },
      order: { isPinned: 'DESC', createdAt: 'DESC' },
    });
  }

  async searchNotes(userId: string, query: string): Promise<Note[]> {
    const words = query
      .replace(/[_\-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) return [];

    // Exact title match first
    const exact = await this.noteRepository.findOne({
      where: { userId, title: query },
    });
    if (exact) return [exact];

    // OR match — any word in the query matches title or content
    const conditions = words.map((_, i) =>
      `(note.title LIKE :word${i} OR note.content LIKE :word${i})`
    ).join(' OR ');

    const params: Record<string, string> = { userId };
    words.forEach((w, i) => { params[`word${i}`] = `%${w}%`; });

    return await this.noteRepository
      .createQueryBuilder('note')
      .where('note.userId = :userId', params)
      .andWhere(`(${conditions})`)
      .orderBy('note.isPinned', 'DESC')
      .addOrderBy('note.createdAt', 'DESC')
      .getMany();
  }

  async updateNote(
    noteId: string,
    userId: string,
    title?: string,
    content?: string,
    category?: string,
    tags?: string[],
  ): Promise<Note> {
    const note = await this.getNoteById(noteId, userId);

    if (title) note.title = title;
    if (content) note.content = content;
    if (category) note.category = category;
    if (tags) note.tags = tags;

    const updatedNote = await this.noteRepository.save(note);
    this.logger.log(`Note updated: ${noteId}`);
    return updatedNote;
  }

  async togglePin(noteId: string, userId: string): Promise<Note> {
    const note = await this.getNoteById(noteId, userId);
    note.isPinned = !note.isPinned;
    const updatedNote = await this.noteRepository.save(note);
    this.logger.log(`Note pinned status toggled: ${noteId}`);
    return updatedNote;
  }

  async deleteNote(noteId: string, userId: string): Promise<void> {
    const note = await this.getNoteById(noteId, userId);
    await this.noteRepository.remove(note);
    this.logger.log(`Note deleted: ${noteId}`);
  }

  async deleteAllNotes(userId: string): Promise<void> {
    await this.noteRepository.delete({ userId });
    this.logger.log(`All notes deleted for user: ${userId}`);
  }
}
