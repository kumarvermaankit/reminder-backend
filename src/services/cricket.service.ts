import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface LiveMatch {
  id: string;
  title: string;
  score: string;
  status: string;
}

@Injectable()
export class CricketService {
  private readonly logger = new Logger(CricketService.name);

  async getLiveScores(): Promise<LiveMatch[]> {
    try {
      const html = await this.fetchPage();
      const rawData = this.extractRawData(html);
      if (!rawData || rawData.length === 0) return [];
      return this.parseMatches(rawData);
    } catch (e) {
      this.logger.error(`Failed to fetch cricket scores: ${e.message}`);
      return [];
    }
  }

  private async fetchPage(): Promise<string> {
    const res = await axios.get('https://www.cricbuzz.com/cricket-match/live-scores', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    return res.data;
  }

  /** Extract match data from Next.js __next_f push #26. */
  private extractRawData(html: string): any[] | null {
    // Find the __next_f push that has "matches": with seriesMatches
    const pushRe = /<script>self\.__next_f\.push\(\[1,"([^]*?)"\]\)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = pushRe.exec(html)) !== null) {
      const raw = m[1];
      if (!raw.includes('seriesMatches')) continue;
      // Extract the JSON after \"matches\":[
      const start = raw.indexOf('\\"matches\\":[');
      if (start < 0) continue;
      let after = raw.substring(start + 12);
      // Find matching close bracket — track nesting
      let depth = 0;
      let end = 0;
      for (let i = 0; i < after.length; i++) {
        const ch = after[i];
        if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === 0) continue;
      const jsonStr = after.substring(0, end)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '')
        .replace(/\\\\/g, '\\');
      try {
        return JSON.parse(jsonStr);
      } catch { continue; }
    }
    return null;
  }

  /** Convert raw Cricbuzz matches to our LiveMatch format. */
  private parseMatches(raw: any[]): LiveMatch[] {
    const result: LiveMatch[] = [];
    const now = Date.now();

    for (const entry of raw) {
      const seriesMatches = entry.seriesMatches || [];
      for (const sm of seriesMatches) {
        const wrapper = sm.seriesAdWrapper || sm;
        const matches = wrapper.matches || [];
        for (const m of matches) {
          const match = m.match || m;
          const info = match.matchInfo || {};
          const score = match.matchScore || {};
          const s1 = score.team1Score?.inngs1;
          const s2 = score.team2Score?.inngs1;

          // Skip old completed matches (more than 6h ago)
          const startDate = parseInt(info.startDate, 10);
          if (info.state === 'Complete' && startDate && (now - startDate) > 21600000) continue;

          const t1 = info.team1?.teamSName || info.team1?.teamName || 'T1';
          const t2 = info.team2?.teamSName || info.team2?.teamName || 'T2';

          const fmt = (s: any) =>
            s ? `${s.runs || 0}/${s.wkts || 0} (${s.overs || 0} ov)` : '';

          const parts = [fmt(s1), fmt(s2)].filter(Boolean);
          const scoreStr = parts.length > 0 ? parts.join(' & ') : '';

          let status = info.status || info.state || '';
          if (status === 'In Progress') status = '🔴 Live';
          else if (status === 'Complete') status = '✅ Completed';
          else if (status === 'Toss') status = '🔄 Toss about to start';

          result.push({
            id: String(info.matchId || ''),
            title: `${t1} vs ${t2}${info.matchDesc ? `, ${info.matchDesc}` : ''}`,
            score: scoreStr,
            status,
          });
        }
      }
    }
    return result;
  }

  async searchMatch(query: string): Promise<LiveMatch | null> {
    const matches = await this.getLiveScores();
    const lower = query.toLowerCase();
    return matches.find(m =>
      m.title.toLowerCase().includes(lower) ||
      m.title.toLowerCase().split(' vs ').some(t => lower.includes(t) || t.includes(lower))
    ) || matches[0] || null;
  }

  formatMatch(m: LiveMatch): string {
    return `🏏 *${m.title}*
📊 ${m.score || 'No score yet'}
_${m.status}_`;
  }

  formatMatchBrief(m: LiveMatch): string {
    return `🏏 *${m.title}*\n📊 ${m.score}\n_${m.status}_`;
  }
}
