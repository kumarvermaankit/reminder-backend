const TIMEZONE_ALIASES: Record<string, string> = {
  'ist': 'Asia/Kolkata',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'est': 'America/New_York',
  'edt': 'America/New_York',
  'gmt': 'GMT',
  'utc': 'UTC',
  'aest': 'Australia/Sydney',
  'aedt': 'Australia/Sydney',
  'cet': 'Europe/Paris',
  'bst': 'Europe/London',
};

const OFFSET_TO_IANA: Record<string, string> = {
  '-720': 'Pacific/Midway',
  '-660': 'Pacific/Honolulu',
  '-600': 'America/Anchorage',
  '-540': 'America/Los_Angeles',
  '-480': 'America/Denver',
  '-420': 'America/Chicago',
  '-360': 'America/New_York',
  '-300': 'America/Halifax',
  '-270': 'America/St_Johns',
  '-240': 'America/Sao_Paulo',
  '-180': 'America/Argentina/Buenos_Aires',
  '-60': 'Atlantic/Azores',
  '0': 'UTC',
  '60': 'Europe/Paris',
  '120': 'Europe/Athens',
  '180': 'Europe/Moscow',
  '210': 'Asia/Tehran',
  '240': 'Asia/Dubai',
  '270': 'Asia/Kabul',
  '300': 'Asia/Karachi',
  '330': 'Asia/Kolkata',
  '345': 'Asia/Kathmandu',
  '360': 'Asia/Dhaka',
  '390': 'Asia/Yangon',
  '420': 'Asia/Bangkok',
  '480': 'Asia/Shanghai',
  '510': 'Australia/Eucla',
  '540': 'Asia/Tokyo',
  '570': 'Australia/Adelaide',
  '600': 'Australia/Sydney',
  '630': 'Australia/Lord_Howe',
  '660': 'Pacific/Noumea',
  '720': 'Pacific/Auckland',
  '780': 'Pacific/Chatham',
};

const CITY_TO_TIMEZONE: Record<string, string> = {
  'mumbai': 'Asia/Kolkata',
  'delhi': 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  'bangalore': 'Asia/Kolkata',
  'bengaluru': 'Asia/Kolkata',
  'chennai': 'Asia/Kolkata',
  'hyderabad': 'Asia/Kolkata',
  'kolkata': 'Asia/Kolkata',
  'pune': 'Asia/Kolkata',
  'ahmedabad': 'Asia/Kolkata',
  'jaipur': 'Asia/Kolkata',
  'london': 'Europe/London',
  'manchester': 'Europe/London',
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  'la': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'dubai': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
  'sydney': 'Australia/Sydney',
  'melbourne': 'Australia/Sydney',
  'toronto': 'America/Toronto',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'tokyo': 'Asia/Tokyo',
  'seoul': 'Asia/Seoul',
  'shanghai': 'Asia/Shanghai',
  'beijing': 'Asia/Shanghai',
};

export const DISPLAY_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Dubai',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

export function lookupTimezone(input: string): string | null {
  let key = input.toLowerCase().trim();
  key = key.replace(/^(utc|gmt|etc\/gmt)\s*/i, '');
  if (TIMEZONE_ALIASES[key]) return TIMEZONE_ALIASES[key];

  const offsetMatch = key.match(/^([+-])?\s*(\d{1,2})(?::(\d{2})|(\d{2}))?$/);
  if (offsetMatch) {
    const sign = offsetMatch[1] === '-' ? -1 : 1;
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3] || offsetMatch[4] || '0', 10);
    const totalMinutes = sign * (hours * 60 + minutes);
    const tz = commonOffsetToIana(totalMinutes);
    if (tz) return tz;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: input });
    return input;
  } catch {
    return null;
  }
}

export function commonOffsetToIana(offsetMinutes: number): string | null {
  const rounded = Math.round(offsetMinutes / 15) * 15;
  return OFFSET_TO_IANA[String(rounded)] || null;
}

export function guessTimezoneFromLocation(location: string): string | null {
  const loc = location.toLowerCase().trim();
  return CITY_TO_TIMEZONE[loc] || null;
}

export function localDateKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-CA', { timeZone });
}

export function calendarDayDiff(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00Z`);
  const to = new Date(`${toKey}T12:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function parseTimeString(timeStr: string): { h: number; m: number } | null {
  const match = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || '0', 10);
  const mer = match[3];
  if (mer) {
    if (mer.toLowerCase() === 'pm' && h !== 12) h += 12;
    if (mer.toLowerCase() === 'am' && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return { h, m };
}

export function localTimeToUtc(timeStr: string, offsetMin: number, msgTimestamp: Date): Date | null {
  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;
  const localMin = parsed.h * 60 + parsed.m;
  const utcMin = (localMin - offsetMin + 1440) % 1440;
  const dayStart = Date.UTC(msgTimestamp.getUTCFullYear(), msgTimestamp.getUTCMonth(), msgTimestamp.getUTCDate(), 0, 0, 0, 0);
  const utcDate = new Date(dayStart + utcMin * 60000);
  if (utcDate <= msgTimestamp) {
    utcDate.setDate(utcDate.getDate() + 1);
  }
  return utcDate;
}

export function getOffsetMinutes(timezone: string, date: Date): number {
  try {
    const ms = date.getTime();
    const tzStr = date.toLocaleString('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const [datePart, timePart] = tzStr.split(', ');
    const [m, d, y] = datePart.split('/');
    const [h, mn, s] = timePart.split(':');
    const tzDate = new Date(`${y}-${m}-${d}T${h}:${mn}:${s}Z`);
    return (tzDate.getTime() - ms) / 60000;
  } catch {
    return 0;
  }
}

export function resolveDisplayTimezone(
  userTimezone: string,
  msgRef: Date,
  targetDate: Date,
): string {
  if (userTimezone && userTimezone !== 'UTC') return userTimezone;

  let bestTz = 'UTC';
  let bestScore = -1;

  for (const timeZone of DISPLAY_TIMEZONES) {
    if (timeZone === 'UTC') continue;
    const dayDiff = calendarDayDiff(
      localDateKey(msgRef, timeZone),
      localDateKey(targetDate, timeZone),
    );
    if (dayDiff < 0 || dayDiff > 14) continue;

    let score = dayDiff === 0 ? 15 : dayDiff === 1 ? 5 : 0;
    const localHour = Number(
      targetDate.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', hour12: false }),
    );
    if (localHour >= 7 && localHour <= 22) score += 10;
    else if (localHour < 6 || localHour >= 23) score -= 10;

    const msgHour = Number(
      msgRef.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', hour12: false }),
    );
    if (msgHour < 6 || msgHour >= 23) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      bestTz = timeZone;
    }
  }
  return bestTz;
}

export function formatRelativeTime(date: Date, timezone: string = 'UTC', nowRef?: Date): string {
  const now = nowRef || new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const dayDiff = calendarDayDiff(
    localDateKey(now, timezone),
    localDateKey(date, timezone),
  );

  if (dayDiff === 0) {
    if (diffMin < 1) return 'in less than a minute';
    if (diffMin < 60) return `in ${diffMin} minutes`;
    return `today at ${timeStr}`;
  }
  if (dayDiff === 1) return `tomorrow at ${timeStr}`;
  if (dayDiff > 1 && dayDiff <= 7) {
    const weekday = date.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });
    return `on ${weekday} at ${timeStr}`;
  }
  return date.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
