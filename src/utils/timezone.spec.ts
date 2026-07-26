import {
  lookupTimezone,
  guessTimezoneFromLocation,
  getOffsetMinutes,
  parseTimeString,
  localTimeToUtc,
  resolveDisplayTimezone,
  formatRelativeTime,
  localDateKey,
  calendarDayDiff,
} from './timezone';

describe('parseTimeString', () => {
  it('parses 12-hour format with AM/PM', () => {
    expect(parseTimeString('8am')).toEqual({ h: 8, m: 0 });
    expect(parseTimeString('8:30am')).toEqual({ h: 8, m: 30 });
    expect(parseTimeString('3pm')).toEqual({ h: 15, m: 0 });
    expect(parseTimeString('12pm')).toEqual({ h: 12, m: 0 });
    expect(parseTimeString('12am')).toEqual({ h: 0, m: 0 });
    expect(parseTimeString('11:59pm')).toEqual({ h: 23, m: 59 });
  });

  it('parses 24-hour format', () => {
    expect(parseTimeString('14')).toEqual({ h: 14, m: 0 });
    expect(parseTimeString('09:05')).toEqual({ h: 9, m: 5 });
    expect(parseTimeString('23:59')).toEqual({ h: 23, m: 59 });
  });

  it('returns null for invalid input', () => {
    expect(parseTimeString('')).toBeNull();
    expect(parseTimeString('abc')).toBeNull();
    expect(parseTimeString('25:00')).toBeNull();
    expect(parseTimeString('12:61')).toBeNull();
  });
});

describe('lookupTimezone', () => {
  it('resolves common aliases', () => {
    expect(lookupTimezone('ist')).toBe('Asia/Kolkata');
    expect(lookupTimezone('pst')).toBe('America/Los_Angeles');
    expect(lookupTimezone('est')).toBe('America/New_York');
    expect(lookupTimezone('gmt')).toBe('GMT');
    expect(lookupTimezone('utc')).toBe('UTC');
  });

  it('resolves IANA timezones', () => {
    expect(lookupTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(lookupTimezone('America/New_York')).toBe('America/New_York');
    expect(lookupTimezone('Europe/London')).toBe('Europe/London');
  });

  it('returns null for unknown timezone', () => {
    expect(lookupTimezone('xyz')).toBeNull();
    expect(lookupTimezone('')).toBeNull();
  });
});

describe('guessTimezoneFromLocation', () => {
  it('maps city names to timezones', () => {
    expect(guessTimezoneFromLocation('mumbai')).toBe('Asia/Kolkata');
    expect(guessTimezoneFromLocation('New York')).toBe('America/New_York');
    expect(guessTimezoneFromLocation('london')).toBe('Europe/London');
    expect(guessTimezoneFromLocation('tokyo')).toBe('Asia/Tokyo');
  });

  it('returns null for unknown location', () => {
    expect(guessTimezoneFromLocation('atlantis')).toBeNull();
  });
});

describe('getOffsetMinutes', () => {
  it('returns correct offset for IST (UTC+5:30)', () => {
    const date = new Date('2026-07-25T12:00:00Z');
    const offset = getOffsetMinutes('Asia/Kolkata', date);
    expect(offset).toBe(330);
  });

  it('returns correct offset for EST (UTC-5)', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const offset = getOffsetMinutes('America/New_York', date);
    expect(offset).toBe(-300);
  });

  it('returns 0 for UTC', () => {
    const date = new Date();
    expect(Math.abs(getOffsetMinutes('UTC', date))).toBeLessThan(0.1);
  });

  it('returns 0 for invalid timezone', () => {
    const date = new Date();
    expect(getOffsetMinutes('Invalid/Zone', date)).toBe(0);
  });
});

describe('localTimeToUtc', () => {
  it('converts IST time to UTC', () => {
    const msgTs = new Date('2026-07-25T06:00:00Z');
    const result = localTimeToUtc('3pm', 330, msgTs);
    expect(result).toBeDefined();
    expect(result!.toISOString()).toBe('2026-07-25T09:30:00.000Z');
  });

  it('advances to next day if time has passed', () => {
    const msgTs = new Date('2026-07-25T12:00:00Z');
    const result = localTimeToUtc('3pm', 330, msgTs);
    expect(result).toBeDefined();
    expect(result!.toISOString()).toBe('2026-07-26T09:30:00.000Z');
  });

  it('converts EST time to UTC', () => {
    const msgTs = new Date('2026-07-25T12:00:00Z');
    const result = localTimeToUtc('9am', -240, msgTs);
    expect(result).toBeDefined();
    expect(result!.toISOString()).toBe('2026-07-25T13:00:00.000Z');
  });
});

describe('localDateKey', () => {
  it('returns YYYY-MM-DD in the given timezone', () => {
    const d = new Date('2026-07-25T18:30:00Z');
    expect(localDateKey(d, 'Asia/Kolkata')).toBe('2026-07-26');
    expect(localDateKey(d, 'UTC')).toBe('2026-07-25');
  });
});

describe('calendarDayDiff', () => {
  it('calculates day difference correctly', () => {
    expect(calendarDayDiff('2026-07-25', '2026-07-26')).toBe(1);
    expect(calendarDayDiff('2026-07-25', '2026-07-25')).toBe(0);
    expect(calendarDayDiff('2026-07-25', '2026-08-01')).toBe(7);
    expect(calendarDayDiff('2026-07-26', '2026-07-25')).toBe(-1);
  });
});

describe('resolveDisplayTimezone', () => {
  it('returns user timezone if not UTC', () => {
    const msgRef = new Date('2026-07-25T06:00:00Z');
    const target = new Date('2026-07-25T06:00:00Z');
    expect(resolveDisplayTimezone('Asia/Kolkata', msgRef, target)).toBe('Asia/Kolkata');
  });

  it('returns guessed timezone for UTC users', () => {
    const msgRef = new Date('2026-07-25T03:00:00Z');
    const target = new Date('2026-07-25T03:00:00Z');
    const result = resolveDisplayTimezone('UTC', msgRef, target);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelativeTime', () => {
  it('shows "today at" for same day', () => {
    const now = new Date('2026-07-25T06:00:00Z');
    const later = new Date('2026-07-25T08:00:00Z');
    const result = formatRelativeTime(later, 'UTC', now);
    expect(result).toMatch(/today at/);
  });

  it('shows "tomorrow at" for next day', () => {
    const now = new Date('2026-07-25T06:00:00Z');
    const nextDay = new Date('2026-07-26T08:00:00Z');
    const result = formatRelativeTime(nextDay, 'UTC', now);
    expect(result).toMatch(/tomorrow at/);
  });

  it('shows weekday for 2-7 days away', () => {
    const now = new Date('2026-07-25T06:00:00Z');
    const future = new Date('2026-07-29T08:00:00Z');
    const result = formatRelativeTime(future, 'UTC', now);
    expect(result).toMatch(/on /);
  });

  it('shows "in X minutes" for near future', () => {
    const now = new Date('2026-07-25T06:00:00Z');
    const soon = new Date('2026-07-25T06:05:00Z');
    const result = formatRelativeTime(soon, 'UTC', now);
    expect(result).toBe('in 5 minutes');
  });

  it('handles timezone display correctly', () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const later = new Date('2026-07-25T09:30:00Z');
    const result = formatRelativeTime(later, 'Asia/Kolkata', now);
    expect(result).toMatch(/today at/);
  });
});
