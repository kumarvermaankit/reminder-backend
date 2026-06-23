import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface Ipo {
  name: string;
  date: string;
  size: string;
  priceBand: string;
  type: 'mainboard' | 'sme' | 'upcoming' | 'filed';
  platform?: string;
  gmp?: string;
}

@Injectable()
export class IpoService {
  private readonly logger = new Logger(IpoService.name);

  async getCurrentIPOs(): Promise<Ipo[]> {
    try {
      const html = await this.fetchPage('https://www.ipowatch.in/');
      const tables = this.extractTables(html);
      const mainboard = this.parseCurrentTable(tables[0] || '', 'mainboard');
      const sme = this.parseCurrentTable(tables[1] || '', 'sme');
      const result = [...mainboard, ...sme];
      return await this.enrichWithGMP(result);
    } catch (e) {
      this.logger.error(`Failed to fetch current IPOs: ${e.message}`);
      return [];
    }
  }

  async getUpcomingIPOs(): Promise<Ipo[]> {
    try {
      const html = await this.fetchPage('https://www.ipowatch.in/upcoming-ipo/');
      const tables = this.extractTables(html);
      const mainboard = this.parseUpcomingTable(tables[0] || '', 'mainboard');
      const sme = this.parseUpcomingSMETable(tables[1] || '', 'sme');
      const filed = this.parseFiledTable(tables[2] || '');
      const result = [...mainboard, ...sme, ...filed];
      return await this.enrichWithGMP(result);
    } catch (e) {
      this.logger.error(`Failed to fetch upcoming IPOs: ${e.message}`);
      return [];
    }
  }

  async searchIPO(query: string): Promise<Ipo[]> {
    const lower = query.toLowerCase();
    const all = await this.getAllIPOs();
    return all.filter(
      ipo =>
        ipo.name.toLowerCase().includes(lower) ||
        ipo.type.toLowerCase().includes(lower),
    );
  }

  private async getAllIPOs(): Promise<Ipo[]> {
    const [current, upcoming] = await Promise.all([
      this.getCurrentIPOs(),
      this.getUpcomingIPOs(),
    ]);
    return [...current, ...upcoming];
  }

  formatIpoList(ipos: Ipo[], title: string): string {
    if (ipos.length === 0) return `No ${title.toLowerCase()} available right now.`;
    const lines = ipos.map((ipo, i) => {
      const gmpStr = ipo.gmp && ipo.gmp !== '₹0' ? ` | GMP ${ipo.gmp}` : '';
      return `${i + 1}. *${ipo.name}* — ${ipo.date}\n   📊 ${ipo.size} | ${ipo.priceBand}${gmpStr}`;
    });
    return `📈 *${title}*\n\n${lines.join('\n\n')}`;
  }

  formatIpo(i: Ipo): string {
    const gmpStr = i.gmp && i.gmp !== '₹0' ? `\n💹 GMP: ${i.gmp}` : '';
    return `📈 *${i.name}*
📅 ${i.date}
💰 Size: ${i.size}
💵 Price: ${i.priceBand}${gmpStr}
🏷️ ${i.type.toUpperCase()}${i.platform ? ` | ${i.platform}` : ''}`;
  }

  async getGMPData(): Promise<Map<string, string>> {
    try {
      const html = await this.fetchPage('https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/');
      const tables = this.extractTables(html);
      if (tables.length === 0) return new Map();
      const rows = this.getRows(tables[0]);
      const map = new Map<string, string>();
      for (let i = 1; i < rows.length; i++) {
        const cells = this.getCells(rows[i]);
        if (cells.length < 2) continue;
        const name = this.cleanCell(cells[0]);
        const gmp = this.cleanCell(cells[1]);
        if (name && gmp && gmp !== '₹0') {
          map.set(name.toLowerCase(), gmp);
        }
      }
      return map;
    } catch (e) {
      this.logger.error(`Failed to fetch GMP data: ${e.message}`);
      return new Map();
    }
  }

  private async enrichWithGMP(ipos: Ipo[]): Promise<Ipo[]> {
    try {
      const gmpMap = await this.getGMPData();
      return ipos.map(ipo => ({
        ...ipo,
        gmp: gmpMap.get(ipo.name.toLowerCase()) || undefined,
      }));
    } catch {
      return ipos;
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    return res.data;
  }

  private extractTables(html: string): string[] {
    return html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
  }

  private parseCurrentTable(tableHtml: string, type: 'mainboard' | 'sme'): Ipo[] {
    const rows = this.getRows(tableHtml);
    if (rows.length < 2) return [];
    const result: Ipo[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = this.getCells(rows[i]);
      if (cells.length < 3) continue;
      const name = this.cleanCell(cells[0]);
      const date = this.cleanCell(cells[1]);
      const size = this.cleanCell(cells[2]);
      if (!name || !date) continue;
      result.push({ name, date, size, priceBand: '', type });
    }
    return result;
  }

  private parseUpcomingTable(tableHtml: string, type: 'mainboard' | 'sme'): Ipo[] {
    const rows = this.getRows(tableHtml);
    if (rows.length < 2) return [];
    const result: Ipo[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = this.getCells(rows[i]);
      if (cells.length < 4) continue;
      const name = this.cleanCell(cells[0]);
      const date = this.cleanCell(cells[1]);
      const size = this.cleanCell(cells[2]);
      const priceBand = this.cleanCell(cells[3]);
      if (!name || !date) continue;
      result.push({ name, date, size, priceBand, type, platform: type === 'sme' ? this.cleanCell(cells[4] || '') : undefined });
    }
    return result;
  }

  private parseUpcomingSMETable(tableHtml: string, type: 'sme'): Ipo[] {
    const rows = this.getRows(tableHtml);
    if (rows.length < 2) return [];
    const result: Ipo[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = this.getCells(rows[i]);
      if (cells.length < 5) continue;
      const name = this.cleanCell(cells[0]);
      const date = this.cleanCell(cells[1]);
      const size = this.cleanCell(cells[2]);
      const priceBand = this.cleanCell(cells[3]);
      const platform = this.cleanCell(cells[4]);
      if (!name || !date) continue;
      result.push({ name, date, size, priceBand, type, platform });
    }
    return result;
  }

  private parseFiledTable(tableHtml: string): Ipo[] {
    const rows = this.getRows(tableHtml);
    if (rows.length < 2) return [];
    const result: Ipo[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = this.getCells(rows[i]);
      if (cells.length < 2) continue;
      const name = this.cleanCell(cells[0]);
      const date = this.cleanCell(cells[1]);
      const priceBand = this.cleanCell(cells[2] || '');
      const size = this.cleanCell(cells[3] || '');
      if (!name) continue;
      result.push({ name, date: date || 'TBA', size, priceBand, type: 'filed' });
    }
    return result;
  }

  private getRows(tableHtml: string): string[] {
    return tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  }

  private getCells(rowHtml: string): string[] {
    return rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
  }

  private cleanCell(cellHtml: string): string {
    return cellHtml
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
