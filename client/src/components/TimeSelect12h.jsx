import React from 'react';
import { parse12HourParts, format12HourParts } from '../utils/dateTime';

const HOURS_12 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

/**
 * Unambiguous 12-hour time picker (Hour 01-12 : Minute 00-59 + independent AM/PM toggle)
 */
const TimeSelect12h = ({
  label,
  value,
  onChange,
  required = false,
  sessionHint = '',
  idPrefix = 'time',
}) => {
  const parts = parse12HourParts(value, '09:00 AM');

  const updatePart = (patch) => {
    const next = { ...parts, ...patch };
    onChange(format12HourParts(next));
  };

  const hourInt = parseInt(parts.hour, 10);
  const normSessionHint = String(sessionHint || '').trim().toUpperCase();
  const hasAnMismatch =
    (normSessionHint === 'AN' || normSessionHint === 'PM') &&
    parts.period === 'AM' &&
    (hourInt === 12 || hourInt < 7);

  return (
    <div>
      {label && (
        <label className="block text-[11px] font-bold text-navy-800 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex items-center space-x-1">
        <select
          id={`${idPrefix}-hour`}
          value={parts.hour}
          onChange={(e) => updatePart({ hour: e.target.value })}
          aria-label={`${label || 'Time'} Hour`}
          className="px-2 py-2 text-xs font-bold border border-slate-300 rounded-lg bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="font-bold text-slate-400 text-xs">:</span>
        <select
          id={`${idPrefix}-minute`}
          value={parts.minute}
          onChange={(e) => updatePart({ minute: e.target.value })}
          aria-label={`${label || 'Time'} Minute`}
          className="px-2 py-2 text-xs font-bold border border-slate-300 rounded-lg bg-white text-navy-800 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {MINUTES_60.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div
          className="flex rounded-lg border border-slate-300 overflow-hidden"
          role="group"
          aria-label={`${label || 'Time'} AM/PM`}
        >
          <button
            type="button"
            onClick={() => updatePart({ period: 'AM' })}
            aria-pressed={parts.period === 'AM'}
            className={`px-2 py-2 text-[11px] font-bold transition-colors cursor-pointer ${
              parts.period === 'AM'
                ? 'bg-primary text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => updatePart({ period: 'PM' })}
            aria-pressed={parts.period === 'PM'}
            className={`px-2 py-2 text-[11px] font-bold border-l border-slate-300 transition-colors cursor-pointer ${
              parts.period === 'PM'
                ? 'bg-primary text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            PM
          </button>
        </div>
      </div>
      {hasAnMismatch && (
        <p className="text-[10px] text-amber-700 font-semibold mt-1">
          Afternoon (PM) session selected — confirm if PM was intended.
        </p>
      )}
    </div>
  );
};

export default React.memo(TimeSelect12h);
