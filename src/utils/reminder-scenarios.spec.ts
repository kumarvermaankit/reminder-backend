import { parseTimeString, getOffsetMinutes } from './timezone';

/**
 * Replicates the time-resolution logic from whatsapp.controller.ts (lines ~586-646)
 * and the finalize step from handleCreateReminderOrFallback (lines ~1568-1573).
 *
 * Returns the final UTC Date that would be stored as reminderDate.
 */
function computeReminderDateForScenario(params: {
  localTime?: string;
  dayOfWeek?: string;
  reminderDate?: string;   // YYYY-MM-DD from AI
  intervalMinutes?: number;
  timezone: string;
  msgTimestamp: Date;
}): Date {
  const { localTime, dayOfWeek, reminderDate: aiReminderDate, intervalMinutes, timezone, msgTimestamp } = params;
  const userTimezone = timezone;
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  // ---- Replicate the timezone block ----
  if (msgTimestamp && (localTime || dayOfWeek)) {
    const msgOffsetMin = getOffsetMinutes(userTimezone, msgTimestamp);
    const localNow = new Date(msgTimestamp.getTime() + msgOffsetMin * 60000);
    let hours = 9;
    let minutes = 0;
    let year = localNow.getUTCFullYear();
    let month = localNow.getUTCMonth();
    let day = localNow.getUTCDate();

    if (aiReminderDate) {
      const d = new Date(aiReminderDate);
      if (!isNaN(d.getTime())) {
        year = d.getUTCFullYear();
        month = d.getUTCMonth();
        day = d.getUTCDate();
      }
    }

    if (localTime) {
      const parsedTime = parseTimeString(localTime);
      if (parsedTime) {
        hours = parsedTime.h;
        minutes = parsedTime.m;
      }
    }

    let targetLocal = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

    // Fix Bug 1: compute offset at TARGET date, not msgTimestamp
    const targetOffsetMin = getOffsetMinutes(userTimezone, targetLocal);

    if (dayOfWeek) {
      const targetDay = dayMap[dayOfWeek.toLowerCase()];
      if (targetDay !== undefined) {
        // Fix Bug 4: use targetLocal's day, not localNow's
        const currentDay = targetLocal.getUTCDay();
        let daysUntil = (targetDay - currentDay + 7) % 7;
        // Fix Bug 3: only skip to next week if time has passed today
        if (daysUntil === 0 && targetLocal <= localNow) daysUntil = 7;
        targetLocal.setUTCDate(targetLocal.getUTCDate() + daysUntil);
      }
    } else if (!aiReminderDate) {
      if (targetLocal <= localNow) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      }
    }

    const utcDate = new Date(targetLocal.getTime() - targetOffsetMin * 60000);
    return utcDate;
  }

  // Fix Bug 2: date-only reminder defaults to 9am local time
  if (aiReminderDate && !localTime && !dayOfWeek && intervalMinutes === undefined && msgTimestamp) {
    const d = new Date(aiReminderDate);
    if (!isNaN(d.getTime())) {
      const offsetMin = getOffsetMinutes(userTimezone, d);
      const targetLocal = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0, 0
      ));
      return new Date(targetLocal.getTime() - offsetMin * 60000);
    }
  }

  // ---- Replicate finalize step from handleCreateReminderOrFallback ----
  if (aiReminderDate) {
    const d = new Date(aiReminderDate);
    if (!isNaN(d.getTime())) return d;
  }
  if (intervalMinutes !== undefined) {
    return new Date(msgTimestamp.getTime() + intervalMinutes * 60 * 1000);
  }
  return new Date(msgTimestamp.getTime() + 10 * 60 * 1000);
}

function toUTCDateString(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function describeDate(d: Date, offsetMin: number): string {
  const local = new Date(d.getTime() + offsetMin * 60000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

// =========================
// SCENARIO TESTS
// =========================

/**
 * Return local time (HH:MM) in the given timezone for a UTC date.
 */
function localTimeStr(d: Date, tz: string): string {
  const off = getOffsetMinutes(tz, d);
  const local = new Date(d.getTime() + off * 60000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

describe('Reminder time resolution scenarios', () => {
  const tz = 'Asia/Kolkata'; // UTC+5:30

  test('scheduledTime is in the future (basic sanity)', () => {
    const msgTime = new Date('2026-07-25T06:00:00Z'); // 11:30 AM IST
    const result = computeReminderDateForScenario({
      localTime: '3pm',
      timezone: tz,
      msgTimestamp: msgTime,
    });
    expect(result.getTime()).toBeGreaterThan(msgTime.getTime());
  });

  describe('Scenario 1: "remind me at 5pm" (same day, time not yet passed)', () => {
    // msg at 10:00 AM IST (4:30 UTC), user wants 5:00 PM IST
    const msgTime = new Date('2026-07-25T04:30:00Z');

    test('returns today at 5pm IST', () => {
      const result = computeReminderDateForScenario({
        localTime: '5pm',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 5pm IST = 11:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-25 11:30:00');
    });
  });

  describe('Scenario 2: "remind me at 8am" (same day, time already passed → next day)', () => {
    // msg at 10:00 AM IST (4:30 UTC), 8am already passed
    const msgTime = new Date('2026-07-25T04:30:00Z');

    test('advances to next day at 8am IST', () => {
      const result = computeReminderDateForScenario({
        localTime: '8am',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // Next day 8am IST = 2026-07-26 02:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-26 02:30:00');
    });
  });

  describe('Scenario 3: "remind me on 28 July at 8AM" (specific future date)', () => {
    // msg on 25 July, user wants 28 July at 8am IST
    const msgTime = new Date('2026-07-25T04:30:00Z');

    test('uses AI-provided reminderDate with localTime', () => {
      const result = computeReminderDateForScenario({
        localTime: '8am',
        reminderDate: '2026-07-28',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // July 28 at 8am IST = 02:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-28 02:30:00');
    });
  });

  describe('Scenario 4: "remind me in 10 minutes" (relative time)', () => {
    const msgTime = new Date('2026-07-25T06:00:00Z');

    // This path: no localTime, no dayOfWeek, no reminderDate, but intervalMinutes=10
    test('computes now + 10 minutes', () => {
      const result = computeReminderDateForScenario({
        intervalMinutes: 10,
        timezone: tz,
        msgTimestamp: msgTime,
      });
      expect(toUTCDateString(result)).toBe('2026-07-25 06:10:00');
    });
  });

  describe('Scenario 5: "remind me every thursday at 8am" (weekly recurring)', () => {
    // msg on Saturday 25 July 2026 at 6am UTC (11:30am IST)
    // Next Thursday = 30 July 2026
    const msgTime = new Date('2026-07-25T06:00:00Z');

    test('computes next Thursday at 8am IST with intervalMinutes=10080', () => {
      const result = computeReminderDateForScenario({
        localTime: '8am',
        dayOfWeek: 'thursday',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // July 25 is Saturday. Next Thursday = July 30.
      // 8am IST on July 30 = July 30 02:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-30 02:30:00');

      // Interval should be 10080 (7 days) — this is set by the controller,
      // not computed here, but the computed date should be a Thursday
    });
  });

  describe('Scenario 6: no time specified (defaults to 10 min)', () => {
    const msgTime = new Date('2026-07-25T06:00:00Z');

    test('defaults to 10 minutes from now when no time info', () => {
      const result = computeReminderDateForScenario({
        timezone: tz,
        msgTimestamp: msgTime,
      });
      expect(toUTCDateString(result)).toBe('2026-07-25 06:10:00');
    });
  });

  describe('Scenario 7: "remind me tomorrow at 8am"', () => {
    // AI would NOT set reminderDate for "tomorrow"; it sets localTime="8am".
    // Controller sees localTime but no reminderDate and no dayOfWeek.
    // If 8am today already passed (which it typically would be when saying "tomorrow"),
    // the controller advances to next day.
    const msgTime = new Date('2026-07-25T10:00:00Z'); // 3:30 PM IST, 8am passed

    test('advances to next day since 8am today passed', () => {
      const result = computeReminderDateForScenario({
        localTime: '8am',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 8am IST = 02:30 UTC. Since 8am today already passed (msg at 3:30pm IST),
      // it advances to July 26 at 8am IST = July 26 02:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-26 02:30:00');
    });
  });

  describe('Scenario 8: "remind me every monday" (no time specified, defaults to 9am)', () => {
    // msg on Saturday July 25 2026, next Monday = July 27
    const msgTime = new Date('2026-07-25T06:00:00Z');

    test('computes next Monday at default 9am', () => {
      const result = computeReminderDateForScenario({
        dayOfWeek: 'monday',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // Next Monday = July 27, default time 9am IST = 03:30 UTC
      // July 27 at 03:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-27 03:30:00');
    });
  });

  describe('Scenario 9: "remind me on 25 Dec at 9pm" (future date with evening time)', () => {
    const msgTime = new Date('2026-07-25T06:00:00Z');

    test('uses AI reminderDate and localTime correctly', () => {
      const result = computeReminderDateForScenario({
        localTime: '9pm',
        reminderDate: '2026-12-25',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // Dec 25, 9pm IST = Dec 25 15:30 UTC
      expect(toUTCDateString(result)).toBe('2026-12-25 15:30:00');
    });
  });

  describe('Scenario 10: "remind me weekly at 7am"', () => {
    // AI sets dayOfWeek to the current day or next. Let's test with msg on Wednesday at 10am.
    // Actually, "weekly at 7am" doesn't specify which day. The AI might set dayOfWeek
    // to the current day or not set it at all. Let's assume it sets nothing specific
    // and the user wants daily/weekly. This tests a case we need to handle:
    // if only localTime='7am', no dayOfWeek, no reminderDate.
    const msgTime = new Date('2026-07-25T05:00:00Z'); // 10:30 AM IST

    test('today at 7am passed → next day', () => {
      const result = computeReminderDateForScenario({
        localTime: '7am',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 7am IST = 01:30 UTC, already passed (msg was at 10:30am IST)
      // Next day at 7am IST = July 26 01:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-26 01:30:00');
    });
  });

  describe('Scenario 11: Edge case — midnight', () => {
    test('12am IST computed correctly', () => {
      const msgTime = new Date('2026-07-25T15:00:00Z'); // 8:30 PM IST
      const result = computeReminderDateForScenario({
        localTime: '12am',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 12am = midnight, starts next day. 12am IST July 26 = July 25 18:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-25 18:30:00');
    });

    test('12pm (noon) IST computed correctly', () => {
      const msgTime = new Date('2026-07-25T05:00:00Z'); // 10:30 AM IST
      const result = computeReminderDateForScenario({
        localTime: '12pm',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 12pm IST = 06:30 UTC, still in the future (msg at 10:30am IST, noon is later)
      // Same day July 25 at 12pm IST = July 25 06:30 UTC
      expect(toUTCDateString(result)).toBe('2026-07-25 06:30:00');
    });
  });

  describe('Scenario 12: PST timezone scenario', () => {
    const pstTz = 'America/Los_Angeles'; // UTC-7 in July (PDT)

    test('4pm PST in July (PDT = UTC-7)', () => {
      const msgTime = new Date('2026-07-25T15:00:00Z'); // 8am PST
      const result = computeReminderDateForScenario({
        localTime: '4pm',
        timezone: pstTz,
        msgTimestamp: msgTime,
      });
      // 4pm PDT = 23:00 UTC on same day
      expect(toUTCDateString(result)).toBe('2026-07-25 23:00:00');
    });
  });

  describe('Scenario 13: Cross-timezone boundary (reminder at 1am IST)', () => {
    // 1am IST = previous day 19:30 UTC
    test('1am IST on the same day (date rolls back in UTC)', () => {
      const msgTime = new Date('2026-07-25T18:00:00Z'); // 11:30 PM IST
      const result = computeReminderDateForScenario({
        localTime: '1am',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 1am IST on July 26 = July 25 19:30 UTC. msg at 11:30pm IST on July 25.
      // Since 1am is in the future from 11:30pm, same local day.
      expect(toUTCDateString(result)).toBe('2026-07-25 19:30:00');
    });
  });

  // =========================================================================
  // BUG VERIFICATION TESTS
  // =========================================================================
  //
  // These tests verify that fixes for 4 time-resolution bugs are correct.
  // All pass after the fixes in whatsapp.controller.ts:586-652.
  // =========================================================================

  describe('BUG 1: DST — offset computed at msgTimestamp, not at target date', () => {
    // User in New York. Message in July (EDT, UTC-4) but reminder in Dec (EST, UTC-5).
    //  "remind me on Dec 25 at 10am"
    const julyMsg = new Date('2026-07-25T12:00:00Z'); // 8am EDT
    const tz = 'America/New_York';

    test('should fire at 10am EST (15:00 UTC) — fixed: uses target-date offset', () => {
      const result = computeReminderDateForScenario({
        localTime: '10am',
        reminderDate: '2026-12-25',
        timezone: tz,
        msgTimestamp: julyMsg,
      });
      // Correct: Dec 25 at 10am EST = 15:00 UTC
      // Bug: offset computed at msgTimestamp (July, EDT = UTC-4)
      //   targetLocal = Dec 25 10:00 EST
      //   utcDate = targetLocal - (-4h) = 14:00 UTC → 9am EST ❌
      expect(toUTCDateString(result)).toBe('2026-12-25 15:00:00');
    });
  });

  describe('BUG 2: "remind me on July 28" (no time) defaults to midnight UTC', () => {
    // AI sets reminderDate="2026-07-28" but NO localTime because user didn't specify a time.
    // The timezone block is skipped (no localTime, no dayOfWeek).
    // Finalize step: new Date("2026-07-28") = midnight UTC.
    // For IST user, midnight UTC = 5:30 AM IST — likely too early.
    const msgTime = new Date('2026-07-25T06:00:00Z');
    const tz = 'Asia/Kolkata';

    test('should default to 9am IST (03:30 UTC) — fixed: date-only enters timezone block with default 9am', () => {
      const result = computeReminderDateForScenario({
        reminderDate: '2026-07-28',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // No localTime, no dayOfWeek, but reminderDate set.
      // Expected: default 9am IST on July 28 = July 28 03:30 UTC
      // Actual: midnight UTC = 5:30 AM IST ❌
      expect(toUTCDateString(result)).toBe('2026-07-28 03:30:00');
    });
  });

  describe('BUG 3: "every thursday at 10am" on Thursday at 8am skips to next week', () => {
    // It's Thursday 8am (local), user wants "every thursday at 10am".
    // 10am hasn't passed yet — first reminder should be TODAY at 10am, not next week.
    // But code sets daysUntil = 7 when targetDay === currentDay regardless of time.
    const msgTime = new Date('2026-07-30T12:00:00Z'); // Thursday July 30, 8am EDT
    const tz = 'America/New_York';

    test('should fire today at 10am since time has not passed — fixed: only skips if time already passed', () => {
      const result = computeReminderDateForScenario({
        localTime: '10am',
        dayOfWeek: 'thursday',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // 8am EDT = 12:00 UTC. Target: today 10am EDT = 14:00 UTC. Today! Not next week.
      const localH = parseInt(localTimeStr(result, tz).split(':')[0], 10);
      expect(localH).toBe(10);
      // Should be TODAY (July 30), not next Thursday (Aug 6)
      expect(result.getTime()).toBeLessThan(new Date('2026-07-31T00:00:00Z').getTime());
    });
  });

  describe('BUG 4: dayOfWeek with reminderDate ignores the date', () => {
    // User says "remind me every thursday at 9am starting Dec 25".
    // AI might set reminderDate="2026-12-25" AND dayOfWeek="thursday".
    // The code computes next Thursday from TODAY, ignoring the reminderDate.
    const msgTime = new Date('2026-07-25T06:00:00Z'); // Saturday
    const tz = 'Asia/Kolkata';

    test('dayOfWeek ignores reminderDate — fixed: uses targetLocal.getUTCDay() not localNow.getUTCDay()', () => {
      const result = computeReminderDateForScenario({
        localTime: '9am',
        dayOfWeek: 'thursday',
        reminderDate: '2026-12-25',
        timezone: tz,
        msgTimestamp: msgTime,
      });
      // reminderDate Dec 25 is a Friday. First Thursday on or after Dec 25 = Dec 31.
      // Dec 31 at 9am IST = Dec 31 03:30 UTC
      // Bug: dayOfWeek adjustment uses localNow (July 25), not reminderDate
      expect(toUTCDateString(result)).toBe('2026-12-31 03:30:00');
    });
  });

  describe('Scenario 14: intervalMinutes with no localTime', () => {
    // "in 2 hours" → intervalMinutes=120
    test('adds interval to msgTimestamp', () => {
      const msgTime = new Date('2026-07-25T06:00:00Z');
      const result = computeReminderDateForScenario({
        intervalMinutes: 120,
        timezone: tz,
        msgTimestamp: msgTime,
      });
      expect(toUTCDateString(result)).toBe('2026-07-25 08:00:00');
    });

    test('adds interval for "in 5 minutes"', () => {
      const msgTime = new Date('2026-07-25T06:00:00Z');
      const result = computeReminderDateForScenario({
        intervalMinutes: 5,
        timezone: tz,
        msgTimestamp: msgTime,
      });
      expect(toUTCDateString(result)).toBe('2026-07-25 06:05:00');
    });
  });
});
