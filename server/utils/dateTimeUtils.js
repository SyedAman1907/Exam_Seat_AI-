/**
 * ExamSeat AI — Centralized Date and Time Utilities for Asia/Kolkata (+05:30)
 */

const KOLKATA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatIsoDateKolkata(dt = new Date()) {
  const parsed = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(parsed.getTime())) return KOLKATA_DATE_FORMATTER.format(new Date());
  return KOLKATA_DATE_FORMATTER.format(parsed);
}

/**
 * Current instant (reference helper)
 */
function getKolkataNow() {
  return new Date();
}

/**
 * Normalizes input date string to YYYY-MM-DD
 */
function normalizeDateStr(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [yyyy, mm, dd] = str.split('-');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return str;
}

/**
 * Formats a YYYY-MM-DD string or Date cleanly to YYYY-MM-DD in Asia/Kolkata
 */
function addDaysToIsoDate(isoDate, days = 1) {
  const norm = normalizeDateStr(isoDate);
  const dt = new Date(`${norm}T00:00:00+05:30`);
  if (isNaN(dt.getTime())) return norm;
  dt.setUTCDate(dt.getUTCDate() + days);
  return KOLKATA_DATE_FORMATTER.format(dt);
}

/**
 * Converts a 12-hour or 24-hour time string (e.g., "01:45 AM", "12:45 PM", "14:10") to "HH:mm:ss"
 * Throws an explicit Error on malformed inputs.
 */
function to24HourTime(timeStr) {
  if (!timeStr || !String(timeStr).trim()) {
    throw new Error('Examination time string is required.');
  }

  let clean = String(timeStr)
    .trim()
    .toUpperCase()
    .replace(/\b([AP])\.?\s*M\.?\b/g, '$1M')
    .replace(/^(\d{1,2})\.(\d{2})/, '$1:$2');

  const match = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) {
    throw new Error(`Invalid time format: "${timeStr}". Expected format like "01:45 AM" or "12:45 PM".`);
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3] || '0', 10);
  const modifier = match[4];

  if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    throw new Error(`Invalid minutes or seconds in time: "${timeStr}".`);
  }

  if (modifier) {
    if (hours < 1 || hours > 12) {
      throw new Error(`Invalid 12-hour value (${hours}) in time: "${timeStr}".`);
    }
    if (modifier === 'PM' && hours < 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
  } else if (hours < 0 || hours > 23) {
    throw new Error(`Invalid 24-hour value (${hours}) in time: "${timeStr}".`);
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Converts a 12-hour or 24-hour time string into 24-hour "HH:mm" format
 */
function to24Hour(timeStr) {
  const full = to24HourTime(timeStr);
  return full.slice(0, 5);
}

/**
 * Converts a time string to numeric minutes from midnight [0..1439]
 */
function toMinutesFromMidnight(timeStr) {
  const [hh, mm] = to24Hour(timeStr).split(':').map((n) => parseInt(n, 10));
  return hh * 60 + mm;
}

/**
 * Canonical 12-hour Asia/Kolkata time formatter ("hh:mm AM" / "hh:mm PM").
 * Accepts 12h strings, 24h strings, or Date instances without altering genuine AM/PM.
 */
function formatTime12h(timeOrDate, fallback = '09:00 AM') {
  if (!timeOrDate) {
    return fallback ? formatTime12h(fallback, '') : '';
  }

  if (timeOrDate instanceof Date) {
    if (isNaN(timeOrDate.getTime())) return fallback || '';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(timeOrDate);
    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    const h = String(parseInt(map.hour || '12', 10)).padStart(2, '0');
    const m = String(parseInt(map.minute || '0', 10)).padStart(2, '0');
    const p = String(map.dayPeriod || 'AM').toUpperCase();
    return `${h}:${m} ${p}`;
  }

  const time24 = to24HourTime(timeOrDate);
  const [hhStr, mmStr] = time24.split(':');
  const h24 = parseInt(hhStr, 10);
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${mmStr} ${period}`;
}

/**
 * Formats an examination's canonical time range cleanly (e.g. "01:45 AM – 02:45 AM")
 */
function formatExamTimeRange(examOrStart, maybeEnd = null) {
  let startRaw = examOrStart;
  let endRaw = maybeEnd;
  if (examOrStart && typeof examOrStart === 'object' && !(examOrStart instanceof Date)) {
    startRaw = examOrStart.startTime || (examOrStart.startDateTime ? new Date(examOrStart.startDateTime) : '09:00 AM');
    endRaw = examOrStart.endTime || (examOrStart.endDateTime ? new Date(examOrStart.endDateTime) : '12:00 PM');
  }
  const s = formatTime12h(startRaw, '09:00 AM');
  const e = formatTime12h(endRaw, '12:00 PM');
  return `${s} – ${e}`;
}

/**
 * Parses examination date and time in Asia/Kolkata timezone (+05:30) into a UTC Date object
 */
function parseKolkataDateTime(dateStr, timeStr) {
  const normDate = normalizeDateStr(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normDate)) {
    throw new Error(`Invalid examination date format: "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const normTime = to24HourTime(timeStr);
  const isoString = `${normDate}T${normTime}+05:30`;
  const parsed = new Date(isoString);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date/time specification: ${dateStr} ${timeStr}`);
  }
  return parsed;
}

/**
 * Normalizes user-supplied session names/codes to canonical enum values ('AM' | 'PM' | 'FN' | 'AN')
 * while defaulting Morning variants -> 'AM' and Afternoon variants -> 'PM'.
 */
function normalizeSessionCode(sessionInput, defaultVal = 'AM') {
  if (!sessionInput || !String(sessionInput).trim()) return defaultVal;
  const raw = String(sessionInput).trim().toUpperCase();
  if (raw === 'AM' || raw === 'MORNING' || raw === 'MORNING (AM)' || raw === 'FORENOON') return 'AM';
  if (raw === 'PM' || raw === 'AFTERNOON' || raw === 'AFTERNOON (PM)') return 'PM';
  if (raw === 'FN') return 'FN';
  if (raw === 'AN') return 'AN';
  if (raw.includes('MORNING') || raw.includes('(AM)')) return 'AM';
  if (raw.includes('AFTERNOON') || raw.includes('(PM)')) return 'PM';
  return raw;
}

function isMorningSession(sessionInput) {
  const s = normalizeSessionCode(sessionInput, '');
  return s === 'AM' || s === 'FN';
}

function isAfternoonSession(sessionInput) {
  const s = normalizeSessionCode(sessionInput, '');
  return s === 'PM' || s === 'AN';
}

function isSameSessionPolarity(s1, s2) {
  if (!s1 || !s2) return false;
  return (isMorningSession(s1) && isMorningSession(s2)) || (isAfternoonSession(s1) && isAfternoonSession(s2));
}

function formatSessionLabel(sessionInput, startTime = null) {
  const s = normalizeSessionCode(sessionInput, '');
  if (s === 'AM' || s === 'FN') return 'Morning (AM)';
  if (s === 'PM' || s === 'AN') return 'Afternoon (PM)';
  if (startTime && String(startTime).toUpperCase().includes('PM')) return 'Afternoon (PM)';
  return 'Morning (AM)';
}

/**
 * Authoritatively parses start & end Asia/Kolkata timestamps, 24h ("HH:mm") & 12h strings.
 * Overnight PM -> AM spans are ONLY permitted when explicitly enabled (allowOvernight: true or explicit endDate).
 * Validates session coherence when session ('AM' | 'PM' | 'FN' | 'AN') is supplied.
 */
function parseExamDateRange(examDate, startTime, endTime, endDate = null, opts = {}) {
  const { allowOvernight = false, session = null } = opts || {};
  const normDate = normalizeDateStr(examDate);
  const canonicalStart = formatTime12h(startTime);
  const canonicalEnd = formatTime12h(endTime);
  const startTime24 = to24Hour(canonicalStart);
  const endTime24 = to24Hour(canonicalEnd);
  const startMinutes = toMinutesFromMidnight(canonicalStart);
  const endMinutes = toMinutesFromMidnight(canonicalEnd);

  if (session) {
    const sess = normalizeSessionCode(session, '');
    if (!['AM', 'PM', 'FN', 'AN'].includes(sess)) {
      throw new Error(`Invalid examination session "${session}". Expected Morning (AM) or Afternoon (PM).`);
    }
    if ((sess === 'AM' || sess === 'FN') && startMinutes >= 12 * 60) {
      throw new Error(
        `Invalid session timing (${canonicalStart} in ${sess === 'FN' ? 'FN' : 'Morning AM'}): Morning (AM) / Forenoon (FN) examinations must start before 12:00 PM.`
      );
    }
    if ((sess === 'PM' || sess === 'AN') && startMinutes < 12 * 60) {
      throw new Error(
        `Invalid session timing (${canonicalStart} in ${sess === 'AN' ? 'AN' : 'Afternoon PM'}): Afternoon (PM) / AN examinations must start at or after 12:00 PM.`
      );
    }
  }

  const startDateTime = parseKolkataDateTime(normDate, canonicalStart);
  let resolvedEndDate = endDate ? normalizeDateStr(endDate) : normDate;
  let endDateTime = parseKolkataDateTime(resolvedEndDate, canonicalEnd);
  let isOvernight = Boolean(endDate && resolvedEndDate > normDate);

  if (!endDate && endDateTime <= startDateTime) {
    if (allowOvernight === true && startMinutes >= 12 * 60 && endMinutes < 12 * 60) {
      const nextDayEnd = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
      const durationMs = nextDayEnd.getTime() - startDateTime.getTime();
      if (durationMs > 0 && durationMs <= 12 * 60 * 60 * 1000) {
        endDateTime = nextDayEnd;
        resolvedEndDate = addDaysToIsoDate(normDate, 1);
        isOvernight = true;
      }
    }
  }

  if (startDateTime >= endDateTime) {
    throw new Error(
      `Invalid examination timings (${canonicalStart} to ${canonicalEnd}): End time must be strictly after start time.`
    );
  }

  return {
    examDate: normDate,
    endDate: resolvedEndDate,
    startTime: canonicalStart,
    endTime: canonicalEnd,
    startTime24,
    endTime24,
    startDateTime,
    endDateTime,
    isOvernight,
  };
}

/**
 * Computes publication / student early access time (exactly 20 minutes before exam start time)
 */
function getPublicationTime(startDateTime) {
  return new Date(startDateTime.getTime() - 20 * 60 * 1000);
}

const getStudentAccessTime = getPublicationTime;

/**
 * Resolves and validates a mandatory custom Student Portal Publication Time in Asia/Kolkata (+05:30).
 * Validates that publicationTime is strictly earlier than startDateTime and, unless explicitly permitted
 * by Admin override, not earlier than the current clock time.
 */
function resolveCustomPublicationDateTime({
  examDate,
  startDateTime,
  publicationTime,
  now = new Date(),
  allowPastPublication = false,
} = {}) {
  if (!publicationTime || !String(publicationTime).trim()) {
    const err = new Error('Student Portal Publication Time is required.');
    err.code = 'MISSING_PUBLICATION_TIME';
    err.statusCode = 400;
    throw err;
  }

  let canonicalPub;
  let pubDateTime;
  if (publicationTime instanceof Date) {
    if (isNaN(publicationTime.getTime())) {
      const err = new Error('Invalid Student Portal Publication Time.');
      err.code = 'INVALID_PUBLICATION_TIME';
      err.statusCode = 400;
      throw err;
    }
    pubDateTime = publicationTime;
    canonicalPub = formatTime12h(pubDateTime);
  } else {
    canonicalPub = formatTime12h(String(publicationTime).trim(), '');
    pubDateTime = parseKolkataDateTime(examDate, canonicalPub);
  }

  if (startDateTime && pubDateTime >= startDateTime) {
    const err = new Error(
      `Invalid Student Portal Publication Time (${canonicalPub}): Publication time must be strictly earlier than Examination Start Time.`
    );
    err.code = 'PUBLICATION_AFTER_START';
    err.statusCode = 400;
    throw err;
  }

  if (!allowPastPublication && now && pubDateTime < now) {
    const err = new Error(
      `Selected Student Portal Publication Time (${canonicalPub}) is earlier than the current time. Please select a future publication time.`
    );
    err.code = 'PAST_PUBLICATION_TIME';
    err.statusCode = 400;
    throw err;
  }

  return {
    publicationTime: pubDateTime,
    publicationTimeStr: canonicalPub,
  };
}

/**
 * Computes the seating visibility window close time:
 * 10 minutes after scheduled exam start time, capped at exam endTime if shorter.
 */
function getSeatingWindowCloseTime(startDateTime, endDateTime = null) {
  const tenMinsAfterStart = new Date(startDateTime.getTime() + 10 * 60 * 1000);
  if (endDateTime) {
    const endMs = new Date(endDateTime).getTime();
    if (!isNaN(endMs)) {
      return new Date(Math.min(tenMinsAfterStart.getTime(), endMs));
    }
  }
  return tenMinsAfterStart;
}

/**
 * Extracts effective timestamp in Asia/Kolkata timezone, supporting optional test timestamp override
 */
function getEffectiveNow(req) {
  if (req) {
    const candidate = req.headers?.['x-test-timestamp'] ||
      req.query?.testTimestamp ||
      req.body?.testTimestamp;
    if (candidate) {
      const parsed = new Date(candidate);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return new Date();
}

/**
 * Checks whether seating visibility window is open: [accessTime, windowCloseTime)
 */
function isSeatingVisible(accessOrStartTime, windowCloseTime, now) {
  return now >= accessOrStartTime && (!windowCloseTime || now < windowCloseTime);
}

/**
 * Checks whether seating visibility window has elapsed (>= startDateTime + 10 mins)
 */
function hasSeatingWindowClosed(windowCloseTime, now) {
  return now >= windowCloseTime;
}

/**
 * Checks whether an examination has reached its scheduled end time
 */
function isExamConcluded(endDateTime, now) {
  return now >= endDateTime;
}

/**
 * Returns today's calendar date in Asia/Kolkata timezone
 */
function getTodayKolkataDate(customDate) {
  if (customDate) {
    const parsed = new Date(customDate);
    if (!isNaN(parsed.getTime())) {
      const iso = KOLKATA_DATE_FORMATTER.format(parsed);
      const [yyyy, mm, dd] = iso.split('-');
      return { iso, dmy: `${dd}/${mm}/${yyyy}` };
    }
  }

  const iso = KOLKATA_DATE_FORMATTER.format(new Date()); // 'YYYY-MM-DD'
  const [yyyy, mm, dd] = iso.split('-');
  return {
    iso,
    dmy: `${dd}/${mm}/${yyyy}`,
  };
}

module.exports = {
  getKolkataNow,
  formatIsoDateKolkata,
  normalizeDateStr,
  addDaysToIsoDate,
  to24HourTime,
  to24Hour,
  toMinutesFromMidnight,
  formatTime12h,
  formatExamTimeRange,
  normalizeSessionCode,
  isMorningSession,
  isAfternoonSession,
  isSameSessionPolarity,
  formatSessionLabel,
  parseKolkataDateTime,
  parseExamDateRange,
  getPublicationTime,
  getStudentAccessTime,
  resolveCustomPublicationDateTime,
  getSeatingWindowCloseTime,
  getEffectiveNow,
  isSeatingVisible,
  hasSeatingWindowClosed,
  isExamConcluded,
  getTodayKolkataDate,
};
