/**
 * Client-side Asia/Kolkata (+05:30) date and 12-hour time helpers
 */

export function getTodayKolkataIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function parse12HourParts(timeStr, fallback = '09:00 AM') {
  const src = String(timeStr || fallback)
    .trim()
    .toUpperCase()
    .replace(/\b([AP])\.?\s*M\.?\b/g, '$1M')
    .replace(/^(\d{1,2})\.(\d{2})/, '$1:$2');
  const m = src.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!m) {
    return parse12HourParts(fallback, '09:00 AM');
  }
  let h = parseInt(m[1], 10);
  const min = String(Math.min(59, Math.max(0, parseInt(m[2], 10)))).padStart(2, '0');
  let period = m[3] || (h >= 12 ? 'PM' : 'AM');
  if (h === 0) {
    h = 12;
    period = 'AM';
  } else if (h > 12) {
    h -= 12;
    period = 'PM';
  }
  return {
    hour: String(h).padStart(2, '0'),
    minute: min,
    period,
  };
}

export function format12HourParts({ hour, minute, period }) {
  const hNum = parseInt(hour, 10);
  const validH = !isNaN(hNum) && hNum >= 1 && hNum <= 12 ? hNum : 12;
  const mNum = parseInt(minute, 10);
  const validM = !isNaN(mNum) && mNum >= 0 && mNum <= 59 ? mNum : 0;
  const h = String(validH).padStart(2, '0');
  const m = String(validM).padStart(2, '0');
  const p = period === 'PM' ? 'PM' : 'AM';
  return `${h}:${m} ${p}`;
}

export function formatTime12h(timeStr, fallback = '09:00 AM') {
  if (!timeStr) return fallback ? format12HourParts(parse12HourParts(fallback)) : '';
  return format12HourParts(parse12HourParts(timeStr, fallback));
}

export const to12HourDisplay = formatTime12h;

export function toMinutesFromMidnight(timeStr) {
  const { hour, minute, period } = parse12HourParts(timeStr);
  let h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

export function to24Hour(timeStr) {
  const mins = toMinutesFromMidnight(timeStr);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const toMinutesOfDay = toMinutesFromMidnight;

export function formatExamTimeRange(examOrStart, maybeEnd = null) {
  let startRaw = examOrStart;
  let endRaw = maybeEnd;
  if (examOrStart && typeof examOrStart === 'object') {
    startRaw = examOrStart.startTime || '09:00 AM';
    endRaw = examOrStart.endTime || '12:00 PM';
  }
  return `${formatTime12h(startRaw, '09:00 AM')} – ${formatTime12h(endRaw, '12:00 PM')}`;
}

export function normalizeSessionCode(sessionInput, defaultVal = 'AM') {
  if (!sessionInput || !String(sessionInput).trim()) return defaultVal;
  const raw = String(sessionInput).trim().toUpperCase();
  if (raw === 'AM' || raw === 'MORNING' || raw === 'MORNING (AM)' || raw === 'FORENOON' || raw === 'FN') return 'AM';
  if (raw === 'PM' || raw === 'AFTERNOON' || raw === 'AFTERNOON (PM)' || raw === 'AN') return 'PM';
  if (raw.includes('MORNING') || raw.includes('(AM)')) return 'AM';
  if (raw.includes('AFTERNOON') || raw.includes('(PM)')) return 'PM';
  return raw;
}

export function formatSessionLabel(sessionInput, startTime = null) {
  const s = normalizeSessionCode(sessionInput, '');
  if (s === 'AM') return 'Morning (AM)';
  if (s === 'PM') return 'Afternoon (PM)';
  if (startTime && String(startTime).toUpperCase().includes('PM')) return 'Afternoon (PM)';
  return 'Morning (AM)';
}

export function validateExamTimeRange(startTimeStr, endTimeStr, opts = {}) {
  const { allowOvernight = false, session = null } = opts || {};
  const sMins = toMinutesFromMidnight(startTimeStr);
  const eMins = toMinutesFromMidnight(endTimeStr);
  const startCanonical = formatTime12h(startTimeStr);
  const endCanonical = formatTime12h(endTimeStr);
  const startTime24 = to24Hour(startCanonical);
  const endTime24 = to24Hour(endCanonical);

  if (session) {
    const sess = normalizeSessionCode(session, '');
    if (sess === 'AM' && sMins >= 12 * 60) {
      return {
        valid: false,
        isOvernight: false,
        message: `Invalid session timing (${startCanonical} in Morning AM): Morning (AM) examinations must start before 12:00 PM.`,
      };
    }
    if (sess === 'PM' && sMins < 12 * 60) {
      return {
        valid: false,
        isOvernight: false,
        message: `Invalid session timing (${startCanonical} in Afternoon PM): Afternoon (PM) examinations must start at or after 12:00 PM.`,
      };
    }
  }

  if (eMins > sMins) {
    return {
      valid: true,
      isOvernight: false,
      startTime: startCanonical,
      endTime: endCanonical,
      startTime24,
      endTime24,
    };
  }

  // Overnight PM -> AM span is ONLY permitted when explicitly enabled
  if (allowOvernight === true && sMins >= 12 * 60 && eMins < 12 * 60) {
    const overnightDuration = eMins + 24 * 60 - sMins;
    if (overnightDuration > 0 && overnightDuration <= 12 * 60) {
      return {
        valid: true,
        isOvernight: true,
        startTime: startCanonical,
        endTime: endCanonical,
        startTime24,
        endTime24,
      };
    }
  }

  return {
    valid: false,
    isOvernight: false,
    message: `Invalid examination timings (${startCanonical} to ${endCanonical}): End time must be strictly after start time.`,
  };
}

export function computeStudentAccessInfo(startTimeStr, customPubTimeStr = '') {
  if (customPubTimeStr && String(customPubTimeStr).trim()) {
    const canonical = formatTime12h(customPubTimeStr, startTimeStr);
    return {
      accessTimeFormatted: canonical,
      isPreviousDay: false,
      label: `${canonical} IST (Configured Publication Time)`,
    };
  }
  const { hour, minute, period } = parse12HourParts(startTimeStr);
  let h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;

  const startMins = h * 60 + m;
  const rawAccessMins = startMins - 10;
  const isPreviousDay = rawAccessMins < 0;
  const accessMins = ((rawAccessMins % (24 * 60)) + 24 * 60) % (24 * 60);
  const ah24 = Math.floor(accessMins / 60);
  const am = accessMins % 60;
  const aPeriod = ah24 >= 12 ? 'PM' : 'AM';
  let ah12 = ah24 % 12;
  if (ah12 === 0) ah12 = 12;

  const accessTimeFormatted = `${String(ah12).padStart(2, '0')}:${String(am).padStart(2, '0')} ${aPeriod}`;
  return {
    accessTimeFormatted,
    isPreviousDay,
    label: `${accessTimeFormatted} IST${isPreviousDay ? ' (prev. day)' : ''}`,
  };
}

export function subtractMinutes12h(timeStr, mins = 10) {
  const totalMins = (((toMinutesFromMidnight(timeStr) - mins) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(totalMins / 60);
  const mm = totalMins % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

export function validateCustomPublicationTime(examDate, startTimeStr, pubTimeStr) {
  if (!pubTimeStr || !String(pubTimeStr).trim()) {
    return { valid: false, message: 'Student Portal Publication Time is mandatory.' };
  }
  const startCanonical = formatTime12h(startTimeStr);
  const pubCanonical = formatTime12h(pubTimeStr);
  if (!examDate) {
    return toMinutesFromMidnight(pubCanonical) < toMinutesFromMidnight(startCanonical)
      ? { valid: true, publicationTime: pubCanonical }
      : { valid: false, message: `Publication Time (${pubCanonical}) must be strictly before Start Time (${startCanonical}).` };
  }

  const sTime24 = to24Hour(startCanonical);
  const pTime24 = to24Hour(pubCanonical);
  const startDt = new Date(`${examDate}T${sTime24}:00+05:30`);
  const pubDt = new Date(`${examDate}T${pTime24}:00+05:30`);
  if (isNaN(startDt.getTime()) || isNaN(pubDt.getTime())) {
    return { valid: false, message: 'Invalid date or publication time format.' };
  }
  if (pubDt >= startDt) {
    return {
      valid: false,
      message: `Student Portal Publication Time (${pubCanonical}) must be strictly earlier than Examination Start Time (${startCanonical}).`,
    };
  }
  return { valid: true, publicationTime: pubCanonical, isPast: pubDt < new Date() };
}

export function computeVisibilityWindowLabel(startTimeStr, customPubTimeStr = '') {
  return computeStudentAccessInfo(startTimeStr, customPubTimeStr).label;
}
