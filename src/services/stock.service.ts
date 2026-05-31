import { Injectable, Logger } from '@nestjs/common';
import yahooFinance from 'yahoo-finance2';

export interface StockQuote {
  symbol: string;
  company: string;
  price: number;
  currency: string;
  changePercent: number;
  change: number;
  dayHigh: number;
  dayLow: number;
  marketCap: number;
}

const COMPANY_MAP: Record<string, string> = {
  'reliance': 'RELIANCE.NS',
  'reliance industries': 'RELIANCE.NS',
  'tata motors': 'TATAMOTORS.NS',
  'tata': 'TATAMOTORS.NS',
  'tcs': 'TCS.NS',
  'infosys': 'INFY.NS',
  'infy': 'INFY.NS',
  'hdfc': 'HDFCBANK.NS',
  'hdfc bank': 'HDFCBANK.NS',
  'icici': 'ICICIBANK.NS',
  'icici bank': 'ICICIBANK.NS',
  'sbi': 'SBIN.NS',
  'state bank': 'SBIN.NS',
  'bharti': 'BHARTIARTL.NS',
  'airtel': 'BHARTIARTL.NS',
  'itc': 'ITC.NS',
  'wipro': 'WIPRO.NS',
  'hcl': 'HCLTECH.NS',
  'hcl tech': 'HCLTECH.NS',
  'zomato': 'ZOMATO.NS',
  'paytm': 'PAYTM.NS',
  'one 97': 'PAYTM.NS',
  'adani': 'ADANIENT.NS',
  'adani enterprises': 'ADANIENT.NS',
  'adani ports': 'ADANIPORTS.NS',
  'asian paints': 'ASIANPAINT.NS',
  'bajaj finance': 'BAJFINANCE.NS',
  'bajaj finserv': 'BAJAJFINSV.NS',
  'maruti': 'MARUTI.NS',
  'maruti suzuki': 'MARUTI.NS',
  'sun pharma': 'SUNPHARMA.NS',
  'sun pharmaceutical': 'SUNPHARMA.NS',
  'kotak': 'KOTAKBANK.NS',
  'kotak mahindra': 'KOTAKBANK.NS',
  'nifty': '^NSEI',
  'sensex': '^BSESN',
  'bank nifty': '^NSEBANK',
};

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  async getQuote(query: string): Promise<StockQuote | null> {
    const symbol = this.resolveSymbol(query);
    if (!symbol) return null;
    try {
      const result: any = await yahooFinance.quote(symbol);
      if (!result || !result.regularMarketPrice) return null;
      return {
        symbol: result.symbol || symbol,
        company: result.shortName || result.longName || query,
        price: result.regularMarketPrice,
        currency: result.currency || 'INR',
        changePercent: result.regularMarketChangePercent || 0,
        change: result.regularMarketChange || 0,
        dayHigh: result.regularMarketDayHigh || 0,
        dayLow: result.regularMarketDayLow || 0,
        marketCap: result.marketCap || 0,
      };
    } catch (e: any) {
      this.logger.error(`Failed to fetch quote for ${symbol}: ${e.message}`);
      return null;
    }
  }

  async getMultiQuote(queries: string[]): Promise<StockQuote[]> {
    const symbols = queries.map(q => this.resolveSymbol(q)).filter(Boolean) as string[];
    if (symbols.length === 0) return [];
    try {
      const results: any = await yahooFinance.quote(symbols);
      const arr = Array.isArray(results) ? results : [results];
      return arr
        .filter((r: any) => r && r.regularMarketPrice)
        .map((r: any) => ({
          symbol: r.symbol,
          company: r.shortName || r.longName || '',
          price: r.regularMarketPrice,
          currency: r.currency || 'INR',
          changePercent: r.regularMarketChangePercent || 0,
          change: r.regularMarketChange || 0,
          dayHigh: r.regularMarketDayHigh || 0,
          dayLow: r.regularMarketDayLow || 0,
          marketCap: r.marketCap || 0,
        }));
    } catch (e: any) {
      this.logger.error(`Failed to fetch multi quote: ${e.message}`);
      return [];
    }
  }

  formatQuote(quote: StockQuote): string {
    const arrow = quote.change >= 0 ? '📈' : '📉';
    const sign = quote.change >= 0 ? '+' : '';
    const capStr = quote.marketCap > 0
      ? `\n💰 Market cap: ₹${(quote.marketCap / 1e7).toFixed(0)}Cr`
      : '';
    return `${arrow} *${quote.company}* (${quote.symbol.replace('.NS', '')})
   ₹${quote.price.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)
   Day range: ₹${quote.dayLow.toFixed(2)} - ₹${quote.dayHigh.toFixed(2)}${capStr}`;
  }

  private resolveSymbol(query: string): string | null {
    const clean = query.toLowerCase().trim();
    if (COMPANY_MAP[clean]) return COMPANY_MAP[clean];
    if (clean.endsWith('.ns') || clean.endsWith('.bo') || clean.startsWith('^')) return clean.toUpperCase();
    if (/^\d{4,}$/.test(clean)) return `${clean}.NS`;
    return null;
  }
}
