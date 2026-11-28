import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import {
  parse12HourParts,
  format12HourParts,
  normalizeSessionCode,
} from '../utils/dateTime';

/**
 * Clean 12-hour digital IST time picker (h-10 unified height):
 *   [ hh ] : [ mm ]   [ AM | PM ]
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

  const [hourDraft, setHourDraft] = useState(parts.hour);
  const [minuteDraft, setMinuteDraft] = useState(parts.minute);
  const [editingField, setEditingField] = useState(null);

  useEffect(() => {
    if (editingField !== 'hour') {
      setHourDraft(parts.hour);
    }
    if (editingField !== 'minute') {
      setMinuteDraft(parts.minute);
    }
  }, [parts.hour, parts.minute, editingField]);

  const commitTime = (nextHourRaw, nextMinuteRaw, nextPeriod = parts.period) => {
    const hInt = parseInt(nextHourRaw, 10);
    const clampedH = Number.isNaN(hInt) ? parseInt(parts.hour, 10) : Math.min(12, Math.max(1, hInt));
    const mInt = parseInt(nextMinuteRaw, 10);
    const clampedM = Number.isNaN(mInt) ? parseInt(parts.minute, 10) : Math.min(59, Math.max(0, mInt));
    const formattedH = String(clampedH).padStart(2, '0');
    const formattedM = String(clampedM).padStart(2, '0');
    setHourDraft(formattedH);
    setMinuteDraft(formattedM);
    onChange(
      format12HourParts({
        hour: formattedH,
        minute: formattedM,
        period: nextPeriod,
      })
    );
  };

  const handleHourChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
    setHourDraft(digits);
    if (digits.length === 2) {
      const n = parseInt(digits, 10);
      if (n >= 1 && n <= 12) {
        onChange(
          format12HourParts({
            hour: String(n).padStart(2, '0'),
            minute: parts.minute,
            period: parts.period,
          })
        );
      }
    }
  };

  const handleMinuteChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
    setMinuteDraft(digits);
    if (digits.length === 2) {
      const n = parseInt(digits, 10);
      if (n >= 0 && n <= 59) {
        onChange(
          format12HourParts({
            hour: parts.hour,
            minute: String(n).padStart(2, '0'),
            period: parts.period,
          })
        );
      }
    }
  };

  const stepHour = (delta) => {
    const cur = parseInt(parts.hour, 10) || 12;
    const next = ((cur - 1 + delta + 12) % 12) + 1;
    commitTime(String(next), parts.minute, parts.period);
  };

  const stepMinute = (delta) => {
    const cur = parseInt(parts.minute, 10) || 0;
    const next = (cur + delta + 60) % 60;
    commitTime(parts.hour, String(next), parts.period);
  };

  const handlePeriodToggle = (targetPeriod) => {
    if (parts.period === targetPeriod) return;
    commitTime(parts.hour, parts.minute, targetPeriod);
  };

  const hasPmMismatch =
    !isEndTime && normSessionHint === 'PM' && parts.period === 'AM';
  const hasAmStartMismatch =
    !isEndTime && normSessionHint === 'AM' && parts.period === 'PM';

  return (
    <div className="min-w-0">
      {label && (
        <label
          htmlFor={`${idPrefix}-hour`}
          className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* Clean Digital [HH : MM] Input Group matching h-10 */}
        <div className="h-10 flex items-center px-2.5 border border-[#E5E7EB] dark:border-[#30384A] rounded-[10px] bg-white dark:bg-[#141926] focus-within:ring-2 focus-within:ring-primary/25 focus-within:border-primary shadow-2xs">
          <Clock size={14} className="text-[#64748B] dark:text-[#A1A1AA] mr-1.5 flex-shrink-0" aria-hidden="true" />
          <input
            id={`${idPrefix}-hour`}
            type="text"
            inputMode="numeric"
            maxLength={2}
            required={required}
            value={hourDraft}
            onFocus={(e) => {
              setEditingField('hour');
              e.target.select();
            }}
            onChange={handleHourChange}
            onBlur={() => {
              setEditingField(null);
              commitTime(hourDraft, parts.minute, parts.period);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepHour(1);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                stepHour(-1);
              }
            }}
            aria-label={`${label || 'Time'} Hour (01-12)`}
            className="w-7 text-center text-xs font-bold font-mono text-[#172033] dark:text-[#F8FAFC] bg-transparent focus:outline-none tabular-nums"
          />
          <span className="font-bold text-[#64748B] dark:text-[#A1A1AA] text-xs px-0.5 select-none">:</span>
          <input
            id={`${idPrefix}-minute`}
            type="text"
            inputMode="numeric"
            maxLength={2}
            required={required}
            value={minuteDraft}
            onFocus={(e) => {
              setEditingField('minute');
              e.target.select();
            }}
            onChange={handleMinuteChange}
            onBlur={() => {
              setEditingField(null);
              commitTime(parts.hour, minuteDraft, parts.period);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                stepMinute(5);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                stepMinute(-5);
              }
            }}
            aria-label={`${label || 'Time'} Minute (00-59)`}
            className="w-7 text-center text-xs font-bold font-mono text-[#172033] dark:text-[#F8FAFC] bg-transparent focus:outline-none tabular-nums"
          />
        </div>

        {/* Single AM/PM Toggle matching h-10 */}
        <div
          className="h-10 inline-flex rounded-[10px] border border-[#E5E7EB] dark:border-[#30384A] overflow-hidden flex-shrink-0"
          role="group"
          aria-label={`${label || 'Time'} AM/PM`}
        >
          <button
            type="button"
            onClick={() => handlePeriodToggle('AM')}
            aria-pressed={parts.period === 'AM'}
            className={`px-3 text-xs font-bold transition-colors cursor-pointer ${
              parts.period === 'AM'
                ? 'bg-primary text-white'
                : 'bg-white dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] hover:bg-[#F8DCEB]/50 dark:hover:bg-white/5'
            }`}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => handlePeriodToggle('PM')}
            aria-pressed={parts.period === 'PM'}
            className={`px-3 text-xs font-bold border-l border-[#E5E7EB] dark:border-[#30384A] transition-colors cursor-pointer ${
              parts.period === 'PM'
                ? 'bg-primary text-white'
                : 'bg-white dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] hover:bg-[#F8DCEB]/50 dark:hover:bg-white/5'
            }`}
          >
            PM
          </button>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="font-mono font-medium text-[#64748B] dark:text-[#A1A1AA]">
          Selected: <strong className="text-[#172033] dark:text-[#F8FAFC]">{canonicalDisplay} IST</strong>
        </span>
      </div>
      {hasPmMismatch && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold mt-0.5">
          Afternoon (PM) session selected — confirm PM timing.
        </p>
      )}
      {hasAmStartMismatch && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold mt-0.5">
          Morning (AM) start times must be before 12:00 PM.
        </p>
      )}
    </div>
  );
};

export default React.memo(TimeSelect12h);
