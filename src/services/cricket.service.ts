import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface LiveMatch {
  id: string;
  title: string;
  score: string;
  status: string;
  batsmen: { name: string; score: string }[];
  bowler: { name: string; figures: string } | null;
}

interface CricbuzzMatchCard {
  matchInfo?: {
    matchId?: number;
    matchDesc?: string;
    team1?: { name: string; shortName: string };
    team2?: { name: string; shortName: string };
  };
  matchScore?: {
    team1Score?: { inngs1?: { runs: number; wkts: number; overs: number } };
    team2Score?: { inngs1?: { runs: number; wkts: number; overs: number } };
  };
  matchStatus?: string;
}

@Injectable()
export class CricketService {
  private readonly logger = new Logger(CricketService.name);

  async getLiveScores(): Promise<LiveMatch[]> {
    const sources = [
      () => this.fetchFromCricbuzzApi(),
    ];
    for (const src of sources) {
      try {
        const result = await src();
        if (result.length > 0) return result;
      } catch {
        continue;
      }
    }
    return [];
  }

  private async fetchFromCricbuzzApi(): Promise<LiveMatch[]> {
    const res = await axios.get('https://www.cricbuzz.com/api/cricket-match/live-scores', {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json',
      },
    });
    const data = res.data as CricbuzzMatchCard[];
    if (!Array.isArray(data)) return [];
    return data.map((m: CricbuzzMatchCard): LiveMatch => {
      const info = m.matchInfo || {};
      const score = m.matchScore || {};
      const t1 = score.team1Score?.inngs1;
      const t2 = score.team2Score?.inngs1;
      const t1Name = info.team1?.shortName || info.team1?.name || 'Team 1';
      const t2Name = info.team2?.shortName || info.team2?.name || 'Team 2';
      const t1Score = t1 ? `${t1.runs}/${t1.wkts || 0} (${t1.overs} ov)` : '';
      const t2Score = t2 ? `${t2.runs}/${t2.wkts || 0} (${t2.overs} ov)` : '';
      const scoreStr = [t1Score, t2Score].filter(Boolean).join(' & ');
      return {
        id: String(info.matchId || ''),
        title: `${t1Name} vs ${t2Name}${info.matchDesc ? `, ${info.matchDesc}` : ''}`,
        score: scoreStr || 'Match yet to start',
        status: m.matchStatus || 'Live',
        batsmen: [],
        bowler: null,
      };
    });
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
    const lines = [`🏏 *${m.title}*`];
    if (m.score) lines.push(`📊 ${m.score}`);
    if (m.batsmen.length > 0) {
      lines.push(`\n*Batting:* ${m.batsmen.map(b => `${b.name} ${b.score}`).join(', ')}`);
    }
    if (m.bowler) {
      lines.push(`*Bowler:* ${m.bowler.name} (${m.bowler.figures})`);
    }
    if (m.status) lines.push(`\n_${m.status}_`);
    return lines.join('\n');
  }

  formatMatchBrief(m: LiveMatch): string {
    return `🏏 *${m.title}*\n📊 ${m.score}\n_${m.status}_`;
  }
}
