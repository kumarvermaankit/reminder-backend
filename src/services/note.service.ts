import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from '../entities/note.entity';

@Injectable()
export class NoteService {
  private readonly logger = new Logger(NoteService.name);

  private static readonly KEYWORD_MAP: Record<string, string[]> = {
    email: ['email', 'mail', 'e-mail', 'contact'],
    password: ['password', 'pass', 'credentials', 'login', 'key'],
    address: ['address', 'location', 'place', 'home', 'residence'],
    phone: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'contact'],
    whatsapp: ['whatsapp', 'wa', 'chat'],
    bank: ['bank', 'account', 'finance', 'payment'],
    card: ['card', 'credit card', 'debit card', 'payment'],
    name: ['name', 'full name', 'username'],
    id: ['id', 'identification', 'identity'],
    social: ['social', 'instagram', 'twitter', 'facebook', 'linkedin', 'profile'],
    url: ['url', 'link', 'website', 'site', 'web', 'page'],
    github: ['github', 'git', 'repository', 'repo'],
    meeting: ['meeting', 'call', 'zoom', 'schedule', 'appointment'],
    birthday: ['birthday', 'bday', 'dob', 'date of birth', 'born'],
    license: ['license', 'licence', 'permit', 'certificate'],
    doctor: ['doctor', 'dr', 'medical', 'health', 'appointment'],
    school: ['school', 'college', 'university', 'education', 'class', 'student'],
    work: ['work', 'job', 'office', 'company', 'employment', 'career', 'role', 'position'],
    pin: ['pin', 'pin code', 'pincode', 'zip', 'zipcode', 'postal'],
    linkedin: ['linkedin', 'profile', 'professional', 'network', 'connection'],
    resume: ['resume', 'cv', 'curriculum', 'vitae', 'application'],
    hiring: ['hiring', 'job posting', 'opening', 'position', 'recruitment', 'hr'],
    topic: ['topic', 'subject', 'theme', 'category', 'area'],
    paragraph: ['paragraph', 'text', 'content', 'passage', 'excerpt', 'section'],
    article: ['article', 'blog', 'post', 'writeup', 'publication'],
    reference: ['reference', 'source', 'citation', 'resource', 'link'],
    skill: ['skill', 'expertise', 'proficiency', 'ability', 'competency'],
    project: ['project', 'assignment', 'task', 'work', 'initiative'],
    note: ['note', 'notes', 'reminder', 'info', 'reference', 'snippet'],
    recipe: ['recipe', 'cooking', 'food', 'ingredient', 'dish'],
    travel: ['travel', 'trip', 'vacation', 'itinerary', 'destination', 'booking'],
    book: ['book', 'reading', 'library', 'literature', 'reference'],
    idea: ['idea', 'thought', 'concept', 'brainstorm', 'inspiration'],
    todo: ['todo', 'task', 'checklist', 'action', 'pending'],
    payment: ['payment', 'bill', 'invoice', 'receipt', 'transaction', 'subscription'],
    api: ['api', 'endpoint', 'token', 'key', 'integration', 'webhook'],
    server: ['server', 'hosting', 'deploy', 'infrastructure', 'config', 'setup'],
    database: ['database', 'db', 'sql', 'nosql', 'table', 'query'],
    code: ['code', 'script', 'program', 'function', 'algorithm', 'snippet'],
  };

  constructor(
    @InjectRepository(Note)
    private readonly noteRepository: Repository<Note>,
  ) {}

  private generateTags(title: string, content: string): string[] {
    const tags = new Set<string>();
    const text = `${title} ${content}`.toLowerCase();

    for (const [keyword, synonyms] of Object.entries(NoteService.KEYWORD_MAP)) {
      if (text.includes(keyword)) {
        synonyms.forEach(s => tags.add(s));
      }
    }

    return [...tags];
  }

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

    const autoTags = this.generateTags(title, content);
    const allTags = [...new Set([...(tags || []), ...autoTags])];

    const note = this.noteRepository.create({
      userId,
      title,
      content,
      category: category || 'general',
      tags: allTags,
      isPinned: false,
    });

    const savedNote = await this.noteRepository.save(note);
    this.logger.log(`Note created: ${savedNote.id} for user ${userId} with tags: [${allTags.join(', ')}]`);
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

    // OR match — any word in the query matches title, content, or tags
    const conditions = words.map((_, i) =>
      `(note.title LIKE :word${i} OR note.content LIKE :word${i} OR note.tags LIKE :word${i})`
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

    if (title) {
      note.title = title;
      // Re-generate auto tags if title or content changed
      const autoTags = this.generateTags(title, note.content);
      note.tags = [...new Set([...(tags || []), ...autoTags])];
    }
    if (content) {
      note.content = content;
      const autoTags = this.generateTags(note.title, content);
      note.tags = [...new Set([...(tags || []), ...autoTags])];
    }
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
