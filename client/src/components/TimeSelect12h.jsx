import React from 'react';
import { Clock } from 'lucide-react';
import {
  parse12HourParts,
  format12HourParts,
  formatTime12h,
  to24Hour,
  normalizeSessionCode,
} from '../utils/dateTime';

/**
 * Direct editable 12-hour IST time picker backed by native `<input type="time">`
 * plus an explicit AM/PM toggle so morning/afternoon polarity is never ambiguous.
 */
const TimeSelect12h = ({
  label,
  value,
  onChange,
  required = false,
  sessionHint = '',
  idPrefix = 'time',
  isEndTime = false,
}) => {
  const normSessionHint = normalizeSessionCode(sessionHint, '');
  const fallback =
    normSessionHint === 'PM'
      ? isEndTime
        ? '05:00 PM'
        : '02:00 PM'
      : isEndTime
        ? '12:00 PM'
        : '09:00 AM';

  const parts = parse12HourParts(value, fallback);
  const canonicalDisplay = format12HourParts(parts);
  const value24 = to24Hour(canonicalDisplay);

  const handleTimeInputChange = (e) => {
    const raw24 = String(e.target.value || '').trim();
    if (!raw24 || !/^\d{2}:\d{2}(:\d{2})?$/.test(raw24)) {
      return;
    }
    onChange(formatTime12h(raw24, fallback));
  };

  const handlePeriodToggle = (targetPeriod) => {
    if (parts.period === targetPeriod) return;
    onChange(
      format12HourParts({
        hour: parts.hour,
        minute: parts.minute,
        period: targetPeriod,
      })
    );
  };

  const hourInt = parseInt(parts.hour, 10);
  const hasPmMismatch =
    normSessionHint === 'PM' && parts.period === 'AM' && (hourInt === 12 || hourInt < 12);
  const hasAmStartMismatch =
    !isEndTime && normSessionHint === 'AM' && parts.period === 'PM';

  return (
    <div>
      {label && (
        <label
          htmlFor={`${idPrefix}-input`}
          className="block text-[11px] font-bold text-navy-800 mb-1"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex items-center space-x-1.5">
        <div className="relative flex-1 min-w-[116px]">
          <Clock
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id={`${idPrefix}-input`}
            type="time"
            step="60"
            required={required}
            value={value24}
            onChange={handleTimeInputChange}
            aria-label={`${label || 'Time'} (Asia/Kolkata)`}
            className="w-full pl-7 pr-2 py-1.5 text-xs font-bold font-mono border border-slate-300 rounded-lg bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div
          className="flex rounded-lg border border-slate-300 overflow-hidden flex-shrink-0"
          role="group"
          aria-label={`${label || 'Time'} AM/PM`}
        >
          <button
            type="button"
            onClick={() => handlePeriodToggle('AM')}
            aria-pressed={parts.period === 'AM'}
            className={`px-2 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
              parts.period === 'AM'
                ? 'bg-primary text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => handlePeriodToggle('PM')}
            aria-pressed={parts.period === 'PM'}
            className={`px-2 py-1.5 text-[11px] font-bold border-l border-slate-300 transition-colors cursor-pointer ${
              parts.period === 'PM'
                ? 'bg-primary text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            PM
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className="font-mono font-semibold text-slate-600">
          Selected: <strong className="text-navy-800">{canonicalDisplay} IST</strong>
        </span>
      </div>
      {hasPmMismatch && (
        <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
          Afternoon (PM) session selected — verify if PM was intended.
        </p>
      )}
      {hasAmStartMismatch && (
        <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
          Morning (AM) start times must be before 12:00 PM.
        </p>
      )}
    </div>
  );
};

export default React.memo(TimeSelect12h);
