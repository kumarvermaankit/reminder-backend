import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface LiveMatch {
  id: string;
  title: string;
  score: string;
  status: string;
}

export interface DetailedMatch extends LiveMatch {
  matchFormat?: string;
  venue?: string;
  seriesName?: string;
  shortStatus?: string;
  currBatTeamName?: string;
  batsmanStriker?: PlayerStats;
  batsmanNonStriker?: PlayerStats;
  bowlerStriker?: PlayerStats;
  bowlerNonStriker?: PlayerStats;
  partnership?: { runs: number; balls: number };
  lastWicket?: string;
  currentRunRate?: number;
  overs?: number;
  inningsScores?: InningsScore[];
}

export interface PlayerStats {
  name: string;
  runs?: number;
  balls?: number;
  fours?: number;
  sixes?: number;
  strikeRate?: string;
  overs?: number;
  maidens?: number;
  economy?: number;
  wickets?: number;
}

export interface InningsScore {
  batTeamName: string;
  score: number;
  wickets: number;
  overs: number;
}

@Injectable()
export class CricketService {
  private readonly logger = new Logger(CricketService.name);

  async getLiveScores(): Promise<LiveMatch[]> {
    try {
      const html = await this.fetchPage('https://www.cricbuzz.com/cricket-match/live-scores');
      const rawData = this.extractRawData(html);
      if (!rawData || rawData.length === 0) return [];
      return this.parseMatches(rawData);
    } catch (e) {
      this.logger.error(`Failed to fetch cricket scores: ${e.message}`);
      return [];
    }
  }

  async getDetailedMatch(matchId: string): Promise<DetailedMatch | null> {
    try {
      const html = await this.fetchPage(`https://www.cricbuzz.com/live-cricket-scores/${matchId}`);
      const raw = this.extractPushData(html);
      if (!raw) return null;
      return this.parseDetailedMatch(matchId, raw);
    } catch (e) {
      this.logger.error(`Failed to fetch detailed match ${matchId}: ${e.message}`);
      return null;
    }
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
    if (m.status === '🔴 Live' || m.status === 'In Progress') {
      return `🏏 *${m.title}*
📊 ${m.score || 'No score yet'}
_${m.status}_`;
    }
    return `🏏 *${m.title}*
📊 ${m.score || 'No score yet'}
_${m.status}_`;
  }

  formatDetailedMatch(m: DetailedMatch): string {
    let out = `🏏 *${m.title}*`;
    if (m.seriesName) out += `\n📌 ${m.seriesName}`;
    if (m.venue) out += `\n📍 ${m.venue}`;

    const s1 = m.matchFormat?.toUpperCase() === 'TEST' ? '\n───' : '';
    out += s1;

    if (m.inningsScores && m.inningsScores.length > 0) {
      for (const inn of m.inningsScores) {
        out += `\n${inn.batTeamName}: ${inn.score}/${inn.wickets} (${inn.overs} ov)`;
      }
    } else if (m.score) {
      out += `\n📊 ${m.score}`;
    }

    out += `\n_${m.status}_`;

    if (m.shortStatus) out += `\n_${m.shortStatus}_`;

    if (m.batsmanStriker) {
      out += `\n🏏 ${this.formatPlayer(m.batsmanStriker, 'bat')}*`;
    }
    if (m.batsmanNonStriker) {
      out += `\n🏏 ${this.formatPlayer(m.batsmanNonStriker, 'bat')}`;
    }

    if (m.partnership) {
      out += `\n🤝 Partnership: ${m.partnership.runs} runs off ${m.partnership.balls} balls`;
    }

    if (m.currentRunRate) {
      out += `\n📈 CRR: ${m.currentRunRate.toFixed(2)}`;
    }

    if (m.bowlerStriker) {
      out += `\n🎯 ${this.formatPlayer(m.bowlerStriker, 'bowl')}`;
    }

    if (m.lastWicket) {
      out += `\n⬅️ Last Wkt: ${m.lastWicket}`;
    }

    return out;
  }

  formatMatchBrief(m: LiveMatch): string {
    return `🏏 *${m.title}*\n📊 ${m.score}\n_${m.status}_`;
  }

  private formatPlayer(p: PlayerStats, type: 'bat' | 'bowl'): string {
    if (type === 'bat') {
      let s = `${p.name} ${p.runs || 0} (${p.balls || 0})`;
      if (p.fours || p.sixes) {
        const parts: string[] = [];
        if (p.fours) parts.push(`4s: ${p.fours}`);
        if (p.sixes) parts.push(`6s: ${p.sixes}`);
        s += ` [${parts.join(', ')}]`;
      }
      if (p.strikeRate) s += ` SR: ${p.strikeRate}`;
      return s;
    }
    let s = `${p.name} ${p.overs || 0}-${p.maidens || 0}-${p.runs || 0}-${p.wickets || 0}`;
    if (p.economy) s += ` (Econ: ${p.economy})`;
    return s;
  }

  private async fetchPage(url: string): Promise<string> {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    return res.data;
  }

  private extractRawData(html: string): any[] | null {
    const pushRe = /<script>self\.__next_f\.push\(\[1,"([^]*?)"\]\)<\/script>/g;
    let m: RegExpExecArray | null;
    while ((m = pushRe.exec(html)) !== null) {
      const raw = m[1];
      if (!raw.includes('seriesMatches')) continue;
      const start = raw.indexOf('\\"matches\\":[');
      if (start < 0) continue;
      let after = raw.substring(start + 12);
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

  private extractPushData(html: string): string | null {
    const pushRe = /<script>self\.__next_f\.push\(\[1,"([^]*?)"\]\)<\/script>/g;
    let allData = '';
    let m: RegExpExecArray | null;
    while ((m = pushRe.exec(html)) !== null) {
      allData += m[1];
    }
    if (!allData.includes('miniscore')) return null;
    return allData;
  }

  private parseMatches(raw: any[]): LiveMatch[] {
    const result: LiveMatch[] = [];
    const now = Date.now();

    for (const entry of raw) {
      let matchObj = entry.match || entry;
      let info = matchObj.matchInfo || {};
      let score = matchObj.matchScore || {};

      if (!info.matchId) {
        const seriesMatches = entry.seriesMatches || [];
        for (const sm of seriesMatches) {
          const wrapper = sm.seriesAdWrapper || sm;
          const matches = wrapper.matches || [];
          for (const m of matches) {
            matchObj = m.match || m;
            info = matchObj.matchInfo || {};
            score = matchObj.matchScore || {};
            if (info.matchId) break;
          }
          if (info.matchId) break;
        }
      }

      if (!info.matchId) continue;

      const s1 = score.team1Score?.inngs1;
      const s2 = score.team2Score?.inngs1;

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
    return result;
  }

  private parseDetailedMatch(matchId: string, raw: string): DetailedMatch | null {
    try {
      const msJson = this.extractJson(raw, 'miniscore');
      if (!msJson) return null;
      const ms = JSON.parse(msJson);

      const miIdx = raw.indexOf('matchInfo');
      let mi = null;
      if (miIdx >= 0) {
        const miJson = this.extractJson(raw.substring(miIdx), 'matchInfo');
        if (miJson) mi = JSON.parse(miJson);
      }

      const matchInfo = mi || {};
      const team1SName = matchInfo.team1?.teamSName || matchInfo.team1?.teamName || '';
      const team2SName = matchInfo.team2?.teamSName || matchInfo.team2?.teamName || '';

      const inningsList = ms.matchScoreDetails?.inningsScoreList || ms.batTeamScoreObj?.teamInningsArray || [];

      return {
        id: matchId,
        title: `${team1SName} vs ${team2SName}${matchInfo.matchDesc ? `, ${matchInfo.matchDesc}` : ''}`,
        score: inningsList.length > 0
          ? inningsList.map((i: any) => `${i.batTeamName}: ${i.score}/${i.wickets} (${i.overs} ov)`).join(' & ')
          : '',
        status: ms.status || matchInfo.state || '',
        matchFormat: matchInfo.matchFormat,
        venue: matchInfo.venueInfo ? `${matchInfo.venueInfo.ground}, ${matchInfo.venueInfo.city}` : undefined,
        seriesName: matchInfo.seriesName,
        shortStatus: matchInfo.shortStatus,
        currBatTeamName: ms.batTeam?.teamName || undefined,
        batsmanStriker: ms.batsmanStriker,
        batsmanNonStriker: ms.batsmanNonStriker,
        bowlerStriker: ms.bowlerStriker,
        bowlerNonStriker: ms.bowlerNonStriker,
        partnership: ms.partnerShip,
        lastWicket: ms.lastWicket,
        currentRunRate: ms.currentRunRate,
        overs: ms.overs,
        inningsScores: inningsList.map((i: any) => ({
          batTeamName: i.batTeamName,
          score: i.score,
          wickets: i.wickets,
          overs: i.overs,
        })),
      };
    } catch (e) {
      this.logger.error(`Failed to parse detailed match ${matchId}: ${e.message}`);
      return null;
    }
  }

  private extractJson(raw: string, key: string): string | null {
    const idx = raw.indexOf(`"${key}"`);
    if (idx < 0) return null;
    const jsonStart = raw.indexOf('{', idx);
    if (jsonStart < 0) return null;
    let depth = 0;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
    let jsonStr = raw.substring(jsonStart, jsonEnd);
    jsonStr = jsonStr.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    return jsonStr;
  }
}
