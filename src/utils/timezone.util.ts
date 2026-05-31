export const DISPLAY_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Dubai',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

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

const CITY_TIMEZONES: Record<string, string> = {
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

export function lookupTimezone(input: string): string | null {
  const key = input.toLowerCase().trim();
  if (TIMEZONE_ALIASES[key]) return TIMEZONE_ALIASES[key];
  try {
    Intl.DateTimeFormat(undefined, { timeZone: input });
    return input;
  } catch {
    return null;
  }
}

export function guessTimezoneFromLocation(location: string): string | null {
  const loc = location.toLowerCase().trim();
  return CITY_TIMEZONES[loc] || null;
}

export function localDateKey(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-CA', { timeZone });
}

export function calendarDayDiff(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00Z`);
  const to = new Date(`${toKey}T12:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
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

    let score = dayDiff === 1 ? 20 : dayDiff === 0 ? 12 : dayDiff <= 7 ? 4 : 0;
    const localHour = Number(
      targetDate.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', hour12: false }),
    );
    if (localHour >= 7 && localHour <= 22) score += 5;

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
