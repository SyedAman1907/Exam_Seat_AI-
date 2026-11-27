import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api, { API_TIMEOUTS } from '../../services/api';
import { formatExamTimeRange, computeStudentAccessInfo, formatTime12h, formatSessionLabel } from '../../utils/dateTime';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Building,
  GraduationCap,
  Lock,
  ArrowRight,
  Printer,
  RefreshCw,
} from 'lucide-react';

function formatCountdownHMS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const StudentSeatFinder = () => {
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [activeExams, setActiveExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [todayInfo, setTodayInfo] = useState({ iso: '', display: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const prevUnlockStateRef = useRef(null);
  const scheduleAbortRef = useRef(null);
  const lookupAbortRef = useRef(null);
  const lastLookupRef = useRef({ key: '', at: 0 });
  const isFetchingScheduleRef = useRef(false);

  const fetchActiveExams = useCallback(async ({ force = false } = {}) => {
    if (isFetchingScheduleRef.current && !force) {
      return;
    }
    if (scheduleAbortRef.current) {
      scheduleAbortRef.current.abort();
    }
    const controller = new AbortController();
    scheduleAbortRef.current = controller;
    isFetchingScheduleRef.current = true;

    setInitialLoading(true);
    setScheduleError('');
    try {
      const res = await api.get('/student/active-exams', {
        signal: controller.signal,
        timeout: API_TIMEOUTS.DEFAULT,
      });
      if (res.data?.success && Array.isArray(res.data.data)) {
        if (res.data.serverNow) {
          setServerClockOffset(new Date(res.data.serverNow).getTime() - Date.now());
        }
        const list = res.data.data;
        setActiveExams(list);
        setTodayInfo({
          iso: res.data.todayDate || '',
          display: res.data.todayDisplayDate || '',
          message: res.data.message || '',
        });
        setSelectedExamId((prev) => {
          if (list.length === 1) return list[0]._id;
          if (prev && list.some((ex) => ex._id === prev)) return prev;
          return '';
        });
      } else {
        setScheduleError(res.data?.message || 'Unable to load examination schedule.');
      }
    } catch (e) {
      if (axios.isCancel(e) || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        return;
      }
      console.warn('[StudentSeatFinder] Active exams load error:', e?.message || e);
      const status = e.response?.status;
      setScheduleError(
        e.response?.data?.message ||
        (e.code === 'ECONNABORTED'
          ? 'Schedule lookup timed out while contacting the server. Please retry.'
          : !e.response
            ? 'Unable to connect to the ExamSeat AI server. Please check backend availability and click Retry.'
            : status === 503
              ? 'Examination schedule service is temporarily unavailable. Please retry shortly.'
              : 'Unable to fetch examination schedule. Please retry shortly.')
      );
    } finally {
      if (scheduleAbortRef.current === controller) {
        isFetchingScheduleRef.current = false;
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchActiveExams();
    return () => {
      if (scheduleAbortRef.current) scheduleAbortRef.current.abort();
      if (lookupAbortRef.current) lookupAbortRef.current.abort();
    };
  }, [fetchActiveExams]);

  // Lightweight 1-second local tick (zero API polling) whenever exams or active result exist
  useEffect(() => {
    if (activeExams.length === 0 && !result) return;
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [activeExams.length, result]);

  const currentExam = useMemo(() => {
    if (activeExams.length === 1) return activeExams[0];
    if (!selectedExamId) return null;
    return activeExams.find((ex) => ex._id === selectedExamId) || null;
  }, [activeExams, selectedExamId]);

  const effectiveNowMs = nowTick + serverClockOffset;

  // Dynamically compute live access status for the selected examination
  const liveAccessState = useMemo(() => {
    if (!currentExam) {
      return { state: 'NONE', accessTimeFormatted: '', remainingMs: 0 };
    }
    const accessMs = currentExam.studentAccessTime
      ? new Date(currentExam.studentAccessTime).getTime()
      : NaN;
    const closeMs = currentExam.windowCloseTime
      ? new Date(currentExam.windowCloseTime).getTime()
      : currentExam.endDateTime
        ? new Date(currentExam.endDateTime).getTime()
        : NaN;
    const accessFormatted =
      currentExam.accessTimeFormatted || computeStudentAccessInfo(currentExam.startTime).accessTimeFormatted;

    if (currentExam.windowState === 'INVALID' || Number.isNaN(accessMs)) {
      return { state: 'INVALID', accessTimeFormatted: accessFormatted, remainingMs: 0 };
    }
    if (!Number.isNaN(closeMs) && effectiveNowMs >= closeMs) {
      return { state: 'COMPLETED', accessTimeFormatted: accessFormatted, remainingMs: 0 };
    }
    if (effectiveNowMs < accessMs) {
      return {
        state: 'PENDING',
        accessTimeFormatted: accessFormatted,
        remainingMs: accessMs - effectiveNowMs,
      };
    }
    return { state: 'OPEN', accessTimeFormatted: accessFormatted, remainingMs: 0 };
  }, [currentExam, effectiveNowMs]);

  // Auto-clear prior lock notice as soon as the 20-minute early access countdown reaches zero
  useEffect(() => {
    const prev = prevUnlockStateRef.current;
    prevUnlockStateRef.current = liveAccessState.state;
    if (prev === 'PENDING' && liveAccessState.state === 'OPEN') {
      setError('');
    }
  }, [liveAccessState.state]);

  // Monitor exam conclusion while student slip is displayed
  useEffect(() => {
    if (!result?.windowCloseTime) return;
    const closeTime = new Date(result.windowCloseTime).getTime();
    if (effectiveNowMs >= closeTime) {
      setResult(null);
      setError('Seating information is no longer available. The examination seating access window has closed.');
    }
  }, [result, effectiveNowMs]);

  const handleLookup = async (e) => {
    e.preventDefault();
    if (loading) return;

    const cleanedRegNo = registrationNumber.trim().toUpperCase();
    if (!cleanedRegNo) {
      setError('Please enter a valid registration number.');
      return;
    }

    if (!/^[A-Z0-9]{10}$/.test(cleanedRegNo)) {
      setError('Enter a valid registration number (10 alphanumeric characters, e.g. 24091A0501).');
      return;
    }

    if (activeExams.length === 0) {
      setError('No published examinations scheduled for today.');
      return;
    }

    if (activeExams.length > 1 && !selectedExamId) {
      setError('Please select an examination from today’s schedule.');
      return;
    }

    const targetExamId = selectedExamId || (activeExams.length === 1 ? activeExams[0]._id : undefined);
    const lookupKey = `${cleanedRegNo}:${targetExamId || 'auto'}`;
    if (
      result &&
      result.registrationNumber === cleanedRegNo &&
      lastLookupRef.current.key === lookupKey &&
      Date.now() - lastLookupRef.current.at < 2000
    ) {
      return;
    }

    if (lookupAbortRef.current) {
      lookupAbortRef.current.abort();
    }
    const controller = new AbortController();
    lookupAbortRef.current = controller;

    try {
      setLoading(true);
      setError('');
      setResult(null);

      const res = await api.post(
        '/student/lookup',
        {
          registrationNumber: cleanedRegNo,
          examId: targetExamId,
        },
        {
          signal: controller.signal,
          timeout: API_TIMEOUTS.DEFAULT,
        }
      );

      if (res.data?.success && res.data?.data) {
        if (res.data.data.serverNow) {
          setServerClockOffset(new Date(res.data.data.serverNow).getTime() - Date.now());
        }
        lastLookupRef.current = { key: lookupKey, at: Date.now() };
        setResult(res.data.data);
      } else {
        setError(res.data?.message || 'Unable to retrieve seating information. Please try again.');
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      if (err.response?.data?.serverNow) {
        setServerClockOffset(new Date(err.response.data.serverNow).getTime() - Date.now());
      }
      setResult(null);

      const status = err.response?.status;
      const serverMsg = err.response?.data?.message;
      const isServerOrNetworkFailure =
        !err.response ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ERR_NETWORK' ||
        status >= 500;

      if (status === 429) {
        setError(serverMsg || 'Too many lookup requests. Please wait a few seconds and try again.');
      } else if (isServerOrNetworkFailure) {
        setError('Unable to retrieve seating information. Please try again.');
      } else if (status === 404) {
        setError(serverMsg || 'No published seating record found.');
      } else {
        setError(serverMsg || 'Unable to retrieve seating information. Please try again.');
      }
    } finally {
      if (lookupAbortRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen w-full bg-[#F5F7FA] flex flex-col justify-between font-sans">
      <a
        href="#student-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:text-xs focus:font-bold"
      >
        Skip to seat lookup
      </a>

      {/* Institutional Header */}
      <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs print:static print:border-b-2 print:shadow-none">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 min-h-[4.5rem] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <img
              src="/rgmcet-logo.jpg"
              alt="RGMCET Official Crest"
              className="w-9 h-9 sm:w-11 sm:h-11 object-contain flex-shrink-0"
            />
            <div className="flex flex-col text-left min-w-0">
              <span className="font-bold text-navy-800 text-xs sm:text-sm tracking-tight leading-snug break-words">
                RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
              </span>
              <span className="text-[11px] font-semibold text-primary tracking-wide uppercase mt-0.5 break-words">
                Department of Computer Science and Engineering • ExamSeat AI
              </span>
            </div>
          </div>

          <Link
            to="/admin/login"
            className="print:hidden flex-shrink-0 whitespace-nowrap text-xs font-semibold text-navy-800 hover:text-primary px-3 py-2 rounded-lg border border-slate-300 hover:border-primary/50 bg-white transition-colors"
          >
            Faculty &amp; Admin Sign In
          </Link>
        </div>
      </header>

      {/* Main Content — Asymmetric Editorial Lookup Hero */}
      <main id="student-main-content" className="flex-1 w-full flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
        <div className="w-full max-w-5xl mx-auto min-w-0 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
            {/* Left Column: Clear Value Proposition & Institutional Rules (What / Who / Why) */}
            <section aria-labelledby="seat-lookup-heading" className="lg:col-span-5 space-y-5 pt-1 min-w-0">
              <div className="space-y-2.5">
                <p className="es-eyebrow">Official Examination Cell Portal</p>
                <h1
                  id="seat-lookup-heading"
                  className="text-2xl sm:text-3xl font-extrabold text-navy-900 tracking-tight leading-tight break-words"
                >
                  Examination Hall &amp; Seat Lookup
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed break-words">
                  Verify your allocated ET BLOCK classroom, row, bench, chair number, and assigned question paper set before reporting to the examination hall.
                </p>
              </div>

              <dl className="divide-y divide-slate-200 border-t border-b border-slate-200 text-xs">
                <div className="py-3 flex items-start gap-3">
                  <GraduationCap size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="font-bold text-navy-800">For RGMCET CSE Candidates</dt>
                    <dd className="text-slate-600 mt-0.5">Look up seating using your 10-character college registration number (e.g., 24091A0501).</dd>
                  </div>
                </div>
                <div className="py-3 flex items-start gap-3">
                  <Clock size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="font-bold text-navy-800">20-Minute Early Access (IST)</dt>
                    <dd className="text-slate-600 mt-0.5">Seat details unlock automatically 20 minutes before examination start time and close 10 minutes after start.</dd>
                  </div>
                </div>
                <div className="py-3 flex items-start gap-3">
                  <Building size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="font-bold text-navy-800">Classroom &amp; Set Allocation</dt>
                    <dd className="text-slate-600 mt-0.5">Confirm your room (ET BLOCK 3010–3060) and Question Paper Set (A, B, or C) prior to entry.</dd>
                  </div>
                </div>
              </dl>
            </section>

            {/* Right Column: Dominant Primary Lookup Surface */}
            <section aria-label="Seat Search Form" className="lg:col-span-7 w-full min-w-0 space-y-4">
              <div className="w-full min-w-0 bg-white p-5 sm:p-7 rounded-xl border border-slate-200 shadow-sm text-left">
                <div className="border-b border-slate-200 pb-3.5 mb-4">
                  <h2 className="text-base font-bold text-navy-800">Look Up Your Allocated Seat</h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Select today&apos;s examination (if multiple) and enter your registration number.
                  </p>
                </div>

                {/* Today's Examination Status / Selector */}
                {initialLoading ? (
                  <div className="py-8 text-center text-xs font-medium text-slate-600 flex flex-col items-center gap-2">
                    <RefreshCw size={20} className="animate-spin text-primary" aria-hidden="true" />
                    <span>Checking today’s official examination schedule (Asia/Kolkata)...</span>
                  </div>
                ) : scheduleError ? (
                  <div
                    role="alert"
                    className="w-full max-w-full min-w-0 p-4 sm:p-5 rounded-xl bg-red-50 border border-red-200 text-red-900 flex flex-col items-center justify-center text-center gap-3"
                  >
                    <AlertCircle size={22} className="text-red-600 flex-shrink-0" aria-hidden="true" />
                    <p className="w-full font-semibold text-xs leading-relaxed break-words">
                      {scheduleError}
                    </p>
                    <button
                      type="button"
                      onClick={() => fetchActiveExams({ force: true })}
                      disabled={initialLoading}
                      className="es-btn-secondary w-full sm:w-auto gap-1.5 px-4 py-2 text-xs text-red-700 border-red-300 hover:bg-red-100"
                    >
                      <RefreshCw size={12} className={initialLoading ? 'animate-spin' : ''} aria-hidden="true" />
                      <span>Retry Schedule Check</span>
                    </button>
                  </div>
                ) : activeExams.length === 0 ? (
                  <div className="w-full min-w-0 p-5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col items-center justify-center text-center gap-2.5">
                    <Clock size={22} className="text-amber-700 flex-shrink-0" aria-hidden="true" />
                    <p className="font-bold text-sm text-amber-950 break-words">
                      No examinations scheduled for today.
                    </p>
                    <p className="text-xs text-amber-900 max-w-md mx-auto leading-relaxed break-words">
                      There are no published examinations on record for today ({todayInfo.display || 'IST'}). Please consult the official departmental timetable or contact the Exam Cell.
                    </p>
                    <button
                      type="button"
                      onClick={() => fetchActiveExams({ force: true })}
                      disabled={initialLoading}
                      className="es-btn-secondary mt-1 w-full sm:w-auto gap-1.5 px-4 py-2 text-xs text-amber-900 border-amber-300 hover:bg-amber-100"
                    >
                      <RefreshCw size={12} aria-hidden="true" />
                      <span>Refresh Schedule</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleLookup} className="space-y-4 text-left w-full min-w-0">
                    {activeExams.length > 1 && (
                      <div className="w-full min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <label htmlFor="student-exam-select" className="block text-xs font-semibold text-navy-800">
                            Select Today&apos;s Examination <span className="text-red-600">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => fetchActiveExams({ force: true })}
                            className="inline-flex items-center flex-shrink-0 text-xs font-semibold text-primary hover:underline cursor-pointer"
                          >
                            <RefreshCw size={11} className="mr-1" aria-hidden="true" />
                            Refresh
                          </button>
                        </div>
                        <select
                          id="student-exam-select"
                          value={selectedExamId}
                          onChange={(e) => {
                            setSelectedExamId(e.target.value);
                            setError('');
                            setResult(null);
                          }}
                          required
                          className="w-full max-w-full min-w-0 px-3 py-2.5 text-xs font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white truncate"
                        >
                          <option value="">-- Choose Today&apos;s Subject / Examination --</option>
                          {activeExams.map((ex) => (
                            <option key={ex._id} value={ex._id}>
                              {ex.examName ? `${ex.examName} — ` : ''}{ex.subjectName} ({ex.subjectCode}) • {formatExamTimeRange(ex)} IST • {formatSessionLabel(ex.session, ex.startTime)} • Sec {ex.section}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Synchronized Examination Details Banner */}
                    {currentExam && (
                      <div className="w-full min-w-0 p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 text-xs">
                        <div className="space-y-1 min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-primary break-words">
                            {currentExam.examName || "Today's Scheduled Examination"}
                          </div>
                          <div className="font-bold text-navy-800 text-sm break-words">
                            {currentExam.subjectName} ({currentExam.subjectCode})
                          </div>
                          <div className="text-xs text-slate-700 font-medium break-words">
                            {formatSessionLabel(currentExam.session, currentExam.startTime)} • <strong>{formatExamTimeRange(currentExam)} IST</strong>
                          </div>
                          <div className="text-xs text-slate-600 break-words">
                            Access Opens: <strong className="text-navy-800">{liveAccessState.accessTimeFormatted} IST</strong> • Sections {currentExam.sections?.length ? currentExam.sections.join(', ') : currentExam.section}
                          </div>
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1.5 flex-shrink-0">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold border ${liveAccessState.state === 'OPEN'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : liveAccessState.state === 'PENDING'
                                ? 'bg-blue-50 text-primary border-blue-200'
                                : 'bg-amber-50 text-amber-900 border-amber-200'
                              }`}
                          >
                            {liveAccessState.state === 'OPEN'
                              ? 'Seat Access Open'
                              : liveAccessState.state === 'PENDING'
                                ? `Opens at ${liveAccessState.accessTimeFormatted} IST`
                                : liveAccessState.state === 'INVALID'
                                  ? 'Schedule Unavailable'
                                  : 'Access Window Closed'}
                          </span>
                          {activeExams.length === 1 && (
                            <button
                              type="button"
                              onClick={() => fetchActiveExams({ force: true })}
                              title="Refresh Schedule"
                              aria-label="Refresh active examination schedule"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-slate-300 text-slate-700 hover:text-primary text-[11px] font-semibold cursor-pointer"
                            >
                              <RefreshCw size={11} aria-hidden="true" />
                              <span>Refresh</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Locked State vs Active Seat Lookup Form */}
                    {currentExam && liveAccessState.state === 'PENDING' ? (
                      <div className="p-5 rounded-lg bg-blue-50/80 border border-blue-200 text-center space-y-2.5">
                        <div className="inline-flex p-2 rounded-lg bg-white border border-blue-200 text-primary">
                          <Lock size={18} aria-hidden="true" />
                        </div>
                        <div className="text-xs font-extrabold uppercase tracking-wider text-primary">
                          Access Scheduled
                        </div>
                        <p className="text-xs font-medium text-navy-800 leading-relaxed max-w-md mx-auto">
                          Your examination seating information will become available at{' '}
                          <strong>{liveAccessState.accessTimeFormatted} IST</strong>, 20 minutes before your examination starts.
                        </p>
                        <div className="inline-block px-3.5 py-1.5 rounded-lg bg-white border border-blue-200 font-mono text-sm font-bold text-primary">
                          Opens in {formatCountdownHMS(liveAccessState.remainingMs)}
                        </div>
                      </div>
                    ) : currentExam && liveAccessState.state === 'COMPLETED' ? (
                      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-center text-xs text-amber-950 font-medium">
                        Seating information is no longer available. This examination has concluded.
                      </div>
                    ) : currentExam && liveAccessState.state === 'INVALID' ? (
                      <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-center text-xs text-red-800 font-medium">
                        Examination schedule is missing or invalid. Please contact the Exam Cell.
                      </div>
                    ) : (
                      <>
                        <div>
                          <label htmlFor="student-reg-input" className="block text-xs font-semibold text-navy-800 mb-1.5">
                            Registration Number <span className="text-red-600">*</span>
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                              <Search size={15} aria-hidden="true" />
                            </div>
                            <input
                              id="student-reg-input"
                              type="text"
                              required
                              maxLength={12}
                              autoComplete="off"
                              aria-describedby="reg-number-hint"
                              value={registrationNumber}
                              onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                              placeholder="e.g. 24091A0501"
                              className="w-full pl-9 pr-4 py-2.5 text-sm font-mono font-bold tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary uppercase text-navy-900 bg-white placeholder:text-slate-500 placeholder:font-normal placeholder:tracking-normal"
                            />
                          </div>
                          <p id="reg-number-hint" className="text-xs text-slate-600 mt-1.5">
                            Enter your 10-character college registration number (for example, <span className="font-mono font-semibold text-navy-800">24091A0501</span>).
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={loading || (activeExams.length > 1 && !selectedExamId)}
                          className="es-btn-primary w-full py-3 px-4 text-sm shadow-xs space-x-2"
                        >
                          {loading ? (
                            <span>Looking up your examination seat...</span>
                          ) : (
                            <>
                              <span>Find My Seat</span>
                              <ArrowRight size={16} aria-hidden="true" />
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </form>
                )}
              </div>

              {/* Status / Alert Message */}
              {error && (
                <div
                  role="alert"
                  className={`w-full max-w-full min-w-0 p-4 rounded-xl text-xs flex items-start gap-3 ${error.includes('window has closed') ||
                    error.includes('no longer available') ||
                    error.includes('concluded') ||
                    error.includes('not been published')
                    ? 'bg-amber-50 border border-amber-300 text-amber-950'
                    : error.includes('become available at') || error.includes('20 minutes before') || error.includes('available at') || error.includes('start time')
                      ? 'bg-blue-50 border border-blue-200 text-blue-950'
                      : 'bg-red-50 border border-red-200 text-red-800'
                    }`}
                >
                  {error.includes('window has closed') ||
                    error.includes('no longer available') ||
                    error.includes('concluded') ||
                    error.includes('not been published') ? (
                    <Lock size={18} className="text-amber-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  ) : error.includes('become available at') || error.includes('20 minutes before') || error.includes('available at') || error.includes('start time') ? (
                    <Clock size={18} className="text-blue-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  ) : (
                    <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  )}
                  <div className="space-y-1 min-w-0 flex-1 text-left">
                    <span className="font-bold block uppercase tracking-wide text-[11px]">
                      {error.includes('window has closed') || error.includes('no longer available') || error.includes('concluded')
                        ? 'Access Window Closed'
                        : error.includes('not been published')
                          ? 'Seating Not Published'
                          : error.includes('become available at') || error.includes('20 minutes before') || error.includes('available at') || error.includes('start time')
                            ? 'Access Scheduled'
                              : error.includes('Too many')
                                ? 'Too Many Requests'
                                : error.includes('Unable to retrieve seating information')
                                  ? 'Server Error'
                                  : error.includes('valid registration number')
                                    ? 'Invalid Registration Number'
                                    : 'No Seating Record Found'}
                    </span>
                    <p className="font-medium text-xs leading-relaxed break-words">{error}</p>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Student Seating Slip (Rendered when found) */}
          {result && (
            <section
              aria-label="Examination Seating Slip"
              className="es-surface w-full min-w-0 p-4 sm:p-8 space-y-6 border-2 border-primary/20 print:border-none print:shadow-none"
            >
              <div className="border-b border-slate-200 pb-4 text-center">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 mb-2">
                  <CheckCircle2 size={12} className="mr-1" aria-hidden="true" /> ALLOCATION VERIFIED &amp; PUBLISHED
                </span>
                <h2 className="text-lg font-bold text-navy-800">YOUR EXAMINATION DETAILS</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)
                </p>
              </div>

              {/* Primary Candidate Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Registration Number</span>
                  <span className="text-base font-mono font-bold text-navy-800">
                    {result.registrationNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Candidate Name</span>
                  <span className="text-base font-semibold text-navy-800">
                    {result.studentName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Examination / Subject</span>
                  <span className="font-semibold text-navy-800">
                    {result.subjectName} ({result.subjectCode})
                  </span>
                  <span className="text-[11px] text-slate-600 block mt-0.5">
                    {result.academicYear} • {result.semester}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Academic Group &amp; Section</span>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                      {result.group || 'Group A'}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-navy-100 text-navy-800 border border-navy-200">
                      Section {result.section}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Examination Date &amp; Session</span>
                  <span className="font-medium text-slate-800">
                    {result.examDate} • {formatSessionLabel(result.session, result.startTime)} ({result.examinationTime || formatTime12h(result.startTime)})
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 block text-[11px] font-medium">Assigned Faculty</span>
                  <span className="font-semibold text-navy-800">
                    {result.faculty || result.facultyName || 'Department Faculty'}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-600 block text-[11px] font-medium">Allocated Classroom</span>
                  <span className="font-bold text-navy-800">
                    {result.classroomHall || result.classroomName} (Room {result.roomNumber})
                  </span>
                </div>
              </div>

              {/* Seating Parameters & Set Code */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-600 uppercase font-semibold">Row Number</span>
                  <p className="text-sm font-bold text-navy-800 mt-0.5">{result.row}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-600 uppercase font-semibold">Bench Number</span>
                  <p className="text-sm font-bold text-navy-800 mt-0.5">{result.bench}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-600 uppercase font-semibold">Chair Number</span>
                  <p className="text-sm font-bold text-navy-800 mt-0.5">{result.seatId || `Seat ${result.seatNumber}`}</p>
                  <span className="text-[11px] text-slate-600 font-mono">Chair #{result.seatNumber}</span>
                </div>
                <div
                  className={`p-3 rounded-xl border text-center ${result.questionPaperSet === 'A'
                    ? 'bg-blue-50 border-blue-300 text-blue-900'
                    : result.questionPaperSet === 'B'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-amber-50 border-amber-300 text-amber-900'
                    }`}
                >
                  <span className="text-[11px] uppercase font-bold">Question Paper Set</span>
                  <p className="text-xl font-bold mt-0.5">SET {result.questionPaperSet}</p>
                </div>
              </div>

              {/* Hall Location */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-xs min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Building size={16} className="text-primary flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0 break-words">
                    <span className="font-bold text-navy-800">{result.classroomHall}</span>
                    <span className="text-slate-600 ml-1.5">
                      ({result.block}, {result.floor}, Room {result.roomNumber})
                    </span>
                  </div>
                </div>
              </div>

              {/* Print Slip Button */}
              <div className="text-center pt-2 print:hidden">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="es-btn-secondary"
                >
                  <Printer size={14} aria-hidden="true" />
                  Print Seating Slip
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Official Academic Footer */}
      <footer className="w-full bg-white border-t border-slate-200 py-5 px-4 text-center text-xs text-slate-600 print:hidden">
        <div className="max-w-6xl mx-auto">
          <div className="font-bold text-navy-800 text-[11px] sm:text-xs break-words">
            RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
          </div>
          <div className="text-primary font-semibold text-[11px] mt-0.5 break-words">
            DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5 break-words">
            ExamSeat AI – Smart Examination Seating &amp; Question Paper Allocation System
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StudentSeatFinder;
