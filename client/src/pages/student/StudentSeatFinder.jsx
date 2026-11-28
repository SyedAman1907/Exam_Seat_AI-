import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api, { API_TIMEOUTS } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import {
  formatExamTimeRange,
  computeStudentAccessInfo,
  formatSessionLabel,
} from '../../utils/dateTime';
import { resolveExamType } from '../../utils/examType';
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
  LogOut,
  ShieldCheck,
  KeyRound,
  Calendar,
} from 'lucide-react';

function formatCountdownHMS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const StudentSeatFinder = () => {
  const { user, isAuthenticated, studentLogin, logout } = useAuth();
  const isStudentAuthed = isAuthenticated && user?.role === 'student';

  // Sign-In state
  const [registrationNumber, setRegistrationNumber] = useState(
    () => (user?.role === 'student' ? user.registrationNumber || '' : '')
  );
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // Student personal exam list (GET /api/student/my-exams) -> pick ONLY the current active or next upcoming examination
  const [myExams, setMyExams] = useState([]);
  const [studentProfile, setStudentProfile] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [error, setError] = useState('');

  // Server clock offset & live 1-second countdown tick
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const prevStateRef = useRef(null);
  const myExamsAbortRef = useRef(null);

  const fetchMyExams = useCallback(async () => {
    if (!isStudentAuthed) return;
    if (myExamsAbortRef.current) {
      myExamsAbortRef.current.abort();
    }
    const controller = new AbortController();
    myExamsAbortRef.current = controller;

    setScheduleLoading(true);
    setScheduleError('');
    try {
      const res = await api.get('/student/my-exams', {
        signal: controller.signal,
        timeout: API_TIMEOUTS.DEFAULT,
      });
      if (res.data?.success) {
        if (res.data.serverNow) {
          setServerClockOffset(new Date(res.data.serverNow).getTime() - Date.now());
        }
        const list = Array.isArray(res.data.data) ? res.data.data : [];
        setMyExams(list);
        if (res.data.student) {
          setStudentProfile(res.data.student);
        }
      } else {
        setScheduleError(res.data?.message || 'Unable to load your current examination.');
      }
    } catch (e) {
      if (axios.isCancel(e) || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        return;
      }
      setScheduleError(
        e.response?.data?.message ||
        (e.code === 'ECONNABORTED'
          ? 'Request timed out while loading your examination. Please retry.'
          : !e.response
            ? 'Unable to connect to the ExamSeat AI server. Please check backend availability and click Retry.'
            : 'Unable to fetch your current examination.')
      );
    } finally {
      if (myExamsAbortRef.current === controller) {
        setScheduleLoading(false);
      }
    }
  }, [isStudentAuthed]);

  useEffect(() => {
    if (isStudentAuthed) {
      fetchMyExams();
    } else {
      setMyExams([]);
      setStudentProfile(null);
    }
    return () => {
      if (myExamsAbortRef.current) {
        myExamsAbortRef.current.abort();
      }
    };
  }, [isStudentAuthed, fetchMyExams]);

  // 1-second timer for live countdown and automatic open/close transition
  useEffect(() => {
    if (!isStudentAuthed || myExams.length === 0) return undefined;
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isStudentAuthed, myExams.length]);

  const effectiveNowMs = nowTick + serverClockOffset;

  const computeExamAccess = useCallback(
    (ex) => {
      if (!ex) return { state: 'NONE', accessTimeFormatted: '', remainingMs: 0, displayStatus: 'None' };
      const pubIso = ex.studentAccessTime || ex.publicationTime;
      const pubMs = pubIso ? new Date(pubIso).getTime() : NaN;
      const startMs = ex.startDateTime ? new Date(ex.startDateTime).getTime() : NaN;
      const closeMs = ex.windowCloseTime
        ? new Date(ex.windowCloseTime).getTime()
        : ex.endDateTime
          ? new Date(ex.endDateTime).getTime()
          : NaN;
      const accessFormatted =
        ex.accessTimeFormatted ||
        ex.publicationTimeStr ||
        computeStudentAccessInfo(ex.startTime).accessTimeFormatted;

      if (ex.windowState === 'INVALID' || Number.isNaN(pubMs)) {
        return { state: 'INVALID', accessTimeFormatted: accessFormatted, remainingMs: 0, displayStatus: 'Scheduled' };
      }
      if (ex.windowState === 'CLOSED' || ex.windowState === 'COMPLETED' || (!Number.isNaN(closeMs) && effectiveNowMs >= closeMs)) {
        return { state: 'COMPLETED', accessTimeFormatted: accessFormatted, remainingMs: 0, displayStatus: 'Window Closed' };
      }
      if (effectiveNowMs < pubMs) {
        return {
          state: 'PENDING',
          accessTimeFormatted: accessFormatted,
          remainingMs: pubMs - effectiveNowMs,
          displayStatus: 'Upcoming Examination',
        };
      }
      const isOngoing = !Number.isNaN(startMs) && effectiveNowMs >= startMs;
      return {
        state: 'OPEN',
        accessTimeFormatted: accessFormatted,
        remainingMs: 0,
        displayStatus: isOngoing ? 'Active Examination' : 'Seating Published (Active)',
      };
    },
    [effectiveNowMs]
  );

  // Select ONLY the single Current Active or Next Upcoming examination (no multi-exam card list)
  const currentExam = useMemo(() => {
    if (myExams.length === 0) return null;

    const annotated = myExams.map((ex) => ({
      exam: ex,
      access: computeExamAccess(ex),
      startMs: ex.startDateTime ? new Date(ex.startDateTime).getTime() : Number.MAX_SAFE_INTEGER,
    }));

    const active = annotated
      .filter((item) => item.access.state === 'OPEN')
      .sort((a, b) => a.startMs - b.startMs);
    if (active.length > 0) return active[0].exam;

    const upcoming = annotated
      .filter((item) => item.access.state === 'PENDING')
      .sort((a, b) => a.startMs - b.startMs);
    if (upcoming.length > 0) return upcoming[0].exam;

    return annotated[0].exam;
  }, [myExams, computeExamAccess]);

  const currentAccess = useMemo(
    () => computeExamAccess(currentExam),
    [currentExam, computeExamAccess]
  );

  // Automatically re-fetch when the current examination transitions from PENDING -> OPEN so seat details arrive immediately
  useEffect(() => {
    if (!isStudentAuthed || !currentExam) return;
    const prev = prevStateRef.current;
    prevStateRef.current = currentAccess.state;
    if (prev === 'PENDING' && currentAccess.state === 'OPEN' && !currentExam.seat) {
      fetchMyExams();
    }
  }, [isStudentAuthed, currentExam, currentAccess.state, fetchMyExams]);

  const handleStudentSignIn = async (e) => {
    e.preventDefault();
    if (signingIn) return;

    const cleanedRegNo = registrationNumber.trim().toUpperCase();
    if (!cleanedRegNo) {
      setError('Please enter your registration number.');
      return;
    }
    if (!/^[A-Z0-9]{6,15}$/.test(cleanedRegNo)) {
      setError('Enter a valid registration number (e.g. 24091A0501).');
      return;
    }

    setSigningIn(true);
    setError('');
    try {
      const res = await studentLogin(cleanedRegNo, password);
      if (res.success) {
        setNeedsPassword(false);
        setPassword('');
      } else {
        setError(res.message || 'Sign in failed.');
      }
    } catch (err) {
      const code = err.response?.data?.code;
      const msg = err.response?.data?.message;
      if (code === 'STUDENT_PASSWORD_REQUIRED') {
        setNeedsPassword(true);
        setError(msg || 'Password is required for your student account.');
      } else if (!err.response) {
        setError('Unable to connect to the ExamSeat AI server. Please retry.');
      } else {
        setError(msg || 'Registration number not found in active academic records.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleStudentSignOut = async () => {
    await logout();
    setMyExams([]);
    setStudentProfile(null);
    setError('');
    setScheduleError('');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen w-full bg-[#F7F7FB] dark:bg-[#10131C] flex flex-col justify-between font-sans transition-colors overflow-x-hidden">
      <a
        href="#student-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:text-xs focus:font-bold"
      >
        Skip to student portal
      </a>

      {/* Institutional Header */}
      <header className="w-full bg-white dark:bg-[#1B2030] border-b border-[#E5E7EB] dark:border-[#30384A] sticky top-0 z-30 shadow-2xs print:static print:border-b-2 print:shadow-none">
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 min-h-[4.5rem] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <img
              src="/rgmcet-logo.jpg"
              alt="RGMCET Official Crest"
              className="w-9 h-9 sm:w-11 sm:h-11 object-contain flex-shrink-0 rounded-lg bg-white p-0.5 border border-[#E5E7EB] dark:border-[#30384A]"
            />
            <div className="flex flex-col text-left min-w-0">
              <span className="font-bold text-[#172033] dark:text-[#F8FAFC] text-xs sm:text-sm tracking-tight leading-snug break-words">
                RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
              </span>
              <span className="text-[11px] font-semibold text-primary tracking-wide uppercase mt-0.5 break-words">
                Department of Computer Science and Engineering • ExamSeat AI
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden flex-shrink-0">
            <ThemeToggle compact />
            {isStudentAuthed && (
              <button
                type="button"
                onClick={handleStudentSignOut}
                className="h-10 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 px-3 rounded-[10px] border border-red-200 dark:border-red-800 bg-white dark:bg-[#141926] transition-colors cursor-pointer"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">Sign Out ({user?.registrationNumber || registrationNumber})</span>
                <span className="sm:hidden">Sign Out</span>
              </button>
            )}
            <Link
              to="/admin/login"
              className="h-10 inline-flex items-center flex-shrink-0 whitespace-nowrap text-xs font-semibold text-[#172033] dark:text-[#F8FAFC] hover:text-primary px-3 rounded-[10px] border border-[#E5E7EB] dark:border-[#30384A] hover:border-primary/50 bg-white dark:bg-[#141926] transition-colors"
            >
              Staff Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="student-main-content" className="flex-1 w-full flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:py-10">
        <div className="w-full max-w-4xl mx-auto min-w-0 space-y-6">
          {!isStudentAuthed ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
              {/* Left Column: Value Proposition */}
              <section aria-labelledby="seat-lookup-heading" className="lg:col-span-5 space-y-5 pt-1 min-w-0">
                <div className="space-y-2.5">
                  <p className="es-eyebrow">Official Student Examination Portal</p>
                  <h1
                    id="seat-lookup-heading"
                    className="text-2xl sm:text-3xl font-extrabold text-[#172033] dark:text-[#F8FAFC] tracking-tight leading-tight break-words"
                  >
                    Student Portal &amp; Seat Lookup
                  </h1>
                  <p className="text-sm text-[#64748B] dark:text-[#A1A1AA] leading-relaxed break-words">
                    Sign in with your college Registration Number to view the current active or upcoming examination and your allocated classroom, bench, chair, and question paper set.
                  </p>
                </div>

                <dl className="divide-y divide-[#E5E7EB] dark:divide-[#30384A] border-t border-b border-[#E5E7EB] dark:border-[#30384A] text-xs">
                  <div className="py-3 flex items-start gap-3">
                    <GraduationCap size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-[#172033] dark:text-[#F8FAFC]">Registration Number Sign In</dt>
                      <dd className="text-[#64748B] dark:text-[#A1A1AA] mt-0.5">Access your current examination seat securely with your university registration number (e.g., 24091A0501).</dd>
                    </div>
                  </div>
                  <div className="py-3 flex items-start gap-3">
                    <Clock size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-[#172033] dark:text-[#F8FAFC]">Scheduled Publication Time (IST)</dt>
                      <dd className="text-[#64748B] dark:text-[#A1A1AA] mt-0.5">Seating details unlock automatically at the scheduled publication time and remain visible until 10 minutes after exam start.</dd>
                    </div>
                  </div>
                  <div className="py-3 flex items-start gap-3">
                    <ShieldCheck size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-[#172033] dark:text-[#F8FAFC]">Private Candidate Isolation</dt>
                      <dd className="text-[#64748B] dark:text-[#A1A1AA] mt-0.5">You can view only your own assigned classroom hall, bench, chair, and Question Paper Set.</dd>
                    </div>
                  </div>
                </dl>
              </section>

              {/* Right Column: Registration Number Sign-In Surface */}
              <section aria-label="Student Sign In Form" className="lg:col-span-7 w-full min-w-0 space-y-4">
                <div className="es-glass-card w-full min-w-0 p-5 sm:p-7 text-left">
                  <div className="border-b border-[#E5E7EB] dark:border-[#30384A] pb-3.5 mb-4">
                    <h2 className="text-base font-bold text-[#172033] dark:text-[#F8FAFC]">Student Sign In</h2>
                    <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-0.5">
                      Enter your registration number to view your current examination schedule and seat allotment.
                    </p>
                  </div>

                  {error && (
                    <div role="alert" className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleStudentSignIn} className="space-y-4">
                    <div>
                      <label htmlFor="student-reg-input" className="block text-xs font-semibold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                        Registration Number <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64748B] dark:text-[#A1A1AA]">
                          <Search size={15} aria-hidden="true" />
                        </div>
                        <input
                          id="student-reg-input"
                          type="text"
                          required
                          maxLength={15}
                          autoComplete="off"
                          value={registrationNumber}
                          onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                          placeholder="e.g. 24091A0501"
                          className="es-input pl-9 font-mono font-bold tracking-wider uppercase"
                        />
                      </div>
                    </div>

                    {needsPassword && (
                      <div>
                        <label htmlFor="student-password-input" className="block text-xs font-semibold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                          Student Account Password <span className="text-red-600">*</span>
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64748B] dark:text-[#A1A1AA]">
                            <KeyRound size={15} aria-hidden="true" />
                          </div>
                          <input
                            id="student-password-input"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="es-input pl-9"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={signingIn}
                      className="es-btn-primary w-full space-x-2"
                    >
                      <span>{signingIn ? 'Signing in...' : 'View Current Examination & Seat'}</span>
                      {!signingIn && <ArrowRight size={16} aria-hidden="true" />}
                    </button>
                  </form>
                </div>
              </section>
            </div>
          ) : (
            /* Authenticated Student Single-Examination Seat View */
            <div className="space-y-6">
              {/* Student Profile Summary Bar */}
              <div className="es-glass-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary font-bold flex items-center justify-center text-sm flex-shrink-0">
                    <GraduationCap size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
                      {studentProfile?.name || user?.name || 'Student'}
                    </div>
                    <div className="text-xs text-[#64748B] dark:text-[#A1A1AA] font-mono">
                      Reg. No: <strong className="text-primary">{studentProfile?.registrationNumber || user?.registrationNumber}</strong>
                      {user?.section ? ` • Section ${user.section}` : ''}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={fetchMyExams}
                  disabled={scheduleLoading}
                  className="es-btn-secondary"
                >
                  <RefreshCw size={14} className={scheduleLoading ? 'animate-spin' : ''} />
                  <span>Refresh Status</span>
                </button>
              </div>

              {scheduleLoading ? (
                <div className="es-glass-card p-10 text-center text-xs text-[#64748B] dark:text-[#A1A1AA] space-y-2">
                  <RefreshCw size={22} className="animate-spin text-primary mx-auto" />
                  <p>Loading your current examination (Asia/Kolkata)...</p>
                </div>
              ) : scheduleError ? (
                <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-center space-y-3">
                  <AlertCircle size={22} className="text-red-600 dark:text-red-400 mx-auto" />
                  <p className="text-xs font-semibold text-red-900 dark:text-red-200">{scheduleError}</p>
                  <button
                    type="button"
                    onClick={fetchMyExams}
                    className="es-btn-secondary text-red-700 dark:text-red-300 border-red-300 dark:border-red-700"
                  >
                    Retry
                  </button>
                </div>
              ) : !currentExam ? (
                <div className="es-glass-card p-10 text-center space-y-2.5">
                  <div className="w-12 h-12 rounded-2xl bg-[#F8DCEB]/70 dark:bg-[#F472B6]/10 text-primary mx-auto flex items-center justify-center">
                    <Calendar size={22} />
                  </div>
                  <h2 className="text-base font-bold text-[#172033] dark:text-[#F8FAFC]">No Active or Upcoming Examination</h2>
                  <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] max-w-md mx-auto">
                    There is currently no active or upcoming published examination assigned to your registration number ({user?.registrationNumber}).
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Single Current Examination Overview Card */}
                  <section aria-label="Current Examination" className="es-glass-card p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#E5E7EB] dark:border-[#30384A]">
                      <div>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                          Current Examination
                        </span>
                        <h2 className="text-lg font-extrabold text-[#172033] dark:text-[#F8FAFC] mt-0.5">
                          {resolveExamType(currentExam)} • {currentExam.subjectName}{' '}
                          <span className="font-mono text-sm text-primary">({currentExam.subjectCode})</span>
                        </h2>
                      </div>
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold self-start sm:self-center ${
                          currentAccess.state === 'OPEN'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : currentAccess.state === 'PENDING'
                              ? 'bg-[#F8DCEB] text-primary dark:bg-[#F472B6]/15 dark:text-[#F472B6]'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300'
                        }`}
                      >
                        {currentAccess.displayStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 text-xs">
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA] block">
                          Examination Date
                        </span>
                        <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                          {currentExam.examDate}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA] block">
                          Session
                        </span>
                        <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                          {formatSessionLabel(currentExam.session, currentExam.startTime)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA] block">
                          Start &amp; End Time
                        </span>
                        <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                          {formatExamTimeRange(currentExam)} IST
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA] block">
                          Publication Time
                        </span>
                        <span className="text-sm font-bold text-primary mt-0.5 block">
                          {currentAccess.accessTimeFormatted} IST
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Access State Card (Pending Countdown / Window Closed / Open Seating Slip) */}
                  {currentAccess.state === 'PENDING' && (
                    <div className="es-glass-card p-7 text-center space-y-3 border-2 border-primary/25">
                      <div className="inline-flex p-3 rounded-xl bg-[#F8DCEB]/70 dark:bg-[#F472B6]/15 text-primary">
                        <Lock size={22} />
                      </div>
                      <div className="text-xs font-extrabold uppercase tracking-wider text-primary">
                        Publication Scheduled
                      </div>
                      <p className="text-sm font-medium text-[#172033] dark:text-[#F8FAFC]">
                        Your seating arrangement will be available at{' '}
                        <strong>{currentAccess.accessTimeFormatted} IST</strong>.
                      </p>
                      <div className="inline-block px-4 py-2 rounded-xl bg-[#F8DCEB]/60 dark:bg-[#F472B6]/10 border border-primary/25 font-mono text-base font-bold text-primary">
                        Opens in {formatCountdownHMS(currentAccess.remainingMs)}
                      </div>
                    </div>
                  )}

                  {currentAccess.state === 'COMPLETED' && (
                    <div className="es-glass-card p-7 text-center space-y-2 border border-amber-300 dark:border-amber-800">
                      <Lock size={22} className="text-amber-600 dark:text-amber-400 mx-auto" />
                      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">Seating Access Window Closed</h3>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Seating information is no longer visible. The access window closes 10 minutes after the scheduled examination start time.
                      </p>
                    </div>
                  )}

                  {currentAccess.state === 'OPEN' && !currentExam.seat && (
                    <div className="es-glass-card p-7 text-center space-y-2.5 border border-amber-200 dark:border-amber-800">
                      <AlertCircle size={22} className="text-amber-600 dark:text-amber-400 mx-auto" />
                      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">Seating Not Yet Assigned</h3>
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        Your seating record has not been assigned for this examination yet. Please contact the Exam Cell or refresh shortly.
                      </p>
                      <button type="button" onClick={fetchMyExams} className="es-btn-secondary text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                        <RefreshCw size={14} />
                        <span>Refresh</span>
                      </button>
                    </div>
                  )}

                  {currentAccess.state === 'OPEN' && currentExam.seat && (
                    <section
                      aria-label="Examination Seating Slip"
                      className="es-glass-card w-full min-w-0 p-5 sm:p-7 space-y-5 border-2 border-primary/25 print:border-none print:shadow-none"
                    >
                      <div className="border-b border-[#E5E7EB] dark:border-[#30384A] pb-4 text-center">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 mb-2">
                          <CheckCircle2 size={12} className="mr-1" aria-hidden="true" /> SEAT ALLOCATED &amp; PUBLISHED
                        </span>
                        <h2 className="text-lg font-bold text-[#172033] dark:text-[#F8FAFC]">YOUR EXAMINATION SEATING SLIP</h2>
                        <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-0.5">
                          Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)
                        </p>
                      </div>

                      <div className="bg-[#F7F7FB] dark:bg-[#141926] border border-[#E5E7EB] dark:border-[#30384A] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                        <div>
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Registration Number</span>
                          <span className="text-base font-mono font-bold text-[#172033] dark:text-[#F8FAFC]">
                            {currentExam.seat.registrationNumber}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Candidate Name</span>
                          <span className="text-base font-semibold text-[#172033] dark:text-[#F8FAFC]">
                            {currentExam.seat.studentName}
                          </span>
                        </div>
                        <div>
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Examination &amp; Subject</span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary text-[10px] font-bold">
                              {resolveExamType(currentExam)}
                            </span>
                            <span className="font-semibold text-[#172033] dark:text-[#F8FAFC]">
                              {currentExam.subjectName} ({currentExam.subjectCode})
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Date &amp; Timings</span>
                          <span className="font-semibold text-[#172033] dark:text-[#F8FAFC]">
                            {currentExam.examDate} • {formatSessionLabel(currentExam.session, currentExam.startTime)} ({formatExamTimeRange(currentExam)})
                          </span>
                        </div>
                        {currentExam.seat.facultyName && (
                          <div>
                            <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Faculty / Invigilator</span>
                            <span className="font-semibold text-[#172033] dark:text-[#F8FAFC]">
                              {currentExam.seat.facultyName}
                            </span>
                          </div>
                        )}
                        <div className={currentExam.seat.facultyName ? '' : 'sm:col-span-2'}>
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Section</span>
                          <span className="font-semibold text-[#172033] dark:text-[#F8FAFC]">
                            Section {currentExam.seat.section}
                          </span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-[#64748B] dark:text-[#A1A1AA] block text-[11px]">Allocated Classroom</span>
                          <span className="font-bold text-primary text-sm">
                            {currentExam.seat.classroomHall || currentExam.seat.classroomName} (Room {currentExam.seat.roomNumber})
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-[#F7F7FB] dark:bg-[#141926] p-3 rounded-xl border border-[#E5E7EB] dark:border-[#30384A] text-center">
                          <span className="text-[11px] text-[#64748B] dark:text-[#A1A1AA] uppercase font-semibold">Row</span>
                          <p className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5">{currentExam.seat.row}</p>
                        </div>
                        <div className="bg-[#F7F7FB] dark:bg-[#141926] p-3 rounded-xl border border-[#E5E7EB] dark:border-[#30384A] text-center">
                          <span className="text-[11px] text-[#64748B] dark:text-[#A1A1AA] uppercase font-semibold">Bench</span>
                          <p className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5">{currentExam.seat.bench}</p>
                        </div>
                        <div className="bg-[#F7F7FB] dark:bg-[#141926] p-3 rounded-xl border border-[#E5E7EB] dark:border-[#30384A] text-center">
                          <span className="text-[11px] text-[#64748B] dark:text-[#A1A1AA] uppercase font-semibold">Chair / Seat</span>
                          <p className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5">
                            {currentExam.seat.seatId || `Seat ${currentExam.seat.seatNumber}`}
                          </p>
                        </div>
                        <div
                          className={`p-3 rounded-xl border text-center ${
                            currentExam.seat.questionPaperSet === 'A'
                              ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                              : currentExam.seat.questionPaperSet === 'B'
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                          }`}
                        >
                          <span className="text-[11px] uppercase font-bold">Question Paper Set</span>
                          <p className="text-xl font-bold mt-0.5">SET {currentExam.seat.questionPaperSet}</p>
                        </div>
                      </div>

                      <div className="bg-[#F7F7FB] dark:bg-[#141926] border border-[#E5E7EB] dark:border-[#30384A] rounded-xl p-3.5 text-xs space-y-1">
                        <div className="flex items-center gap-2 font-bold text-[#172033] dark:text-[#F8FAFC]">
                          <Building size={15} className="text-primary" />
                          <span>
                            {currentExam.seat.block}, {currentExam.seat.floor}, Room {currentExam.seat.roomNumber}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#64748B] dark:text-[#A1A1AA] pl-6">
                          {currentExam.seat.instructions}
                        </p>
                      </div>

                      <div className="text-center pt-1 print:hidden">
                        <button type="button" onClick={handlePrint} className="es-btn-secondary">
                          <Printer size={14} />
                          <span>Print Seating Slip</span>
                        </button>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Official Academic Footer */}
      <footer className="w-full bg-white dark:bg-[#1B2030] border-t border-[#E5E7EB] dark:border-[#30384A] py-5 px-4 text-center text-xs text-[#64748B] dark:text-[#A1A1AA] print:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="font-bold text-[#172033] dark:text-[#F8FAFC] text-[11px] sm:text-xs break-words">
            RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
          </div>
          <div className="text-primary font-semibold text-[11px] mt-0.5 break-words">
            DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING
          </div>
          <div className="text-[11px] text-[#64748B] dark:text-[#A1A1AA] mt-0.5 break-words">
            ExamSeat AI – Smart Examination Seating &amp; Question Paper Allocation System
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StudentSeatFinder;
