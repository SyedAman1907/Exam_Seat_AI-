import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import api, { API_TIMEOUTS } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  formatExamTimeRange,
  computeStudentAccessInfo,
  formatTime12h,
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

  // Student personal exam list (GET /api/student/my-exams)
  const [myExams, setMyExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [studentProfile, setStudentProfile] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [error, setError] = useState('');

  // Server clock offset & live 1-second local countdown tick
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const prevStateByExamRef = useRef({});
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
        setSelectedExamId((prev) => {
          if (prev && list.some((ex) => String(ex._id) === String(prev))) return prev;
          return list.length > 0 ? list[0]._id : '';
        });
      } else {
        setScheduleError(res.data?.message || 'Unable to load your examinations.');
      }
    } catch (e) {
      if (axios.isCancel(e) || e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        return;
      }
      setScheduleError(
        e.response?.data?.message ||
        (e.code === 'ECONNABORTED'
          ? 'Request timed out while loading your examinations. Please retry.'
          : !e.response
            ? 'Unable to connect to the ExamSeat AI server. Please check backend availability and click Retry.'
            : 'Unable to fetch your examination schedule.')
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
      setSelectedExamId('');
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
      if (!ex) return { state: 'NONE', accessTimeFormatted: '', remainingMs: 0 };
      const pubIso = ex.studentAccessTime || ex.publicationTime;
      const pubMs = pubIso ? new Date(pubIso).getTime() : NaN;
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
        return { state: 'INVALID', accessTimeFormatted: accessFormatted, remainingMs: 0 };
      }
      if (ex.windowState === 'CLOSED' || ex.windowState === 'COMPLETED' || (!Number.isNaN(closeMs) && effectiveNowMs >= closeMs)) {
        return { state: 'COMPLETED', accessTimeFormatted: accessFormatted, remainingMs: 0 };
      }
      if (effectiveNowMs < pubMs) {
        return {
          state: 'PENDING',
          accessTimeFormatted: accessFormatted,
          remainingMs: pubMs - effectiveNowMs,
        };
      }
      return { state: 'OPEN', accessTimeFormatted: accessFormatted, remainingMs: 0 };
    },
    [effectiveNowMs]
  );

  const selectedExam = useMemo(() => {
    if (myExams.length === 0) return null;
    return myExams.find((ex) => String(ex._id) === String(selectedExamId)) || myExams[0];
  }, [myExams, selectedExamId]);

  const selectedAccess = useMemo(
    () => computeExamAccess(selectedExam),
    [selectedExam, computeExamAccess]
  );

  // When an exam transitions from PENDING -> OPEN locally, automatically re-fetch /my-exams so the seat object arrives from backend!
  useEffect(() => {
    if (!isStudentAuthed || myExams.length === 0) return;
    let shouldRefetch = false;
    myExams.forEach((ex) => {
      const live = computeExamAccess(ex);
      const prev = prevStateByExamRef.current[ex._id];
      prevStateByExamRef.current[ex._id] = live.state;
      if (prev === 'PENDING' && live.state === 'OPEN' && !ex.seat) {
        shouldRefetch = true;
      }
    });
    if (shouldRefetch) {
      fetchMyExams();
    }
  }, [isStudentAuthed, myExams, computeExamAccess, fetchMyExams]);

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
    <div className="min-h-screen w-full bg-[#F5F7FA] flex flex-col justify-between font-sans">
      <a
        href="#student-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:text-xs focus:font-bold"
      >
        Skip to student portal
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

          <div className="flex items-center gap-2 print:hidden">
            {isStudentAuthed && (
              <button
                type="button"
                onClick={handleStudentSignOut}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg border border-red-200 bg-white transition-colors cursor-pointer"
              >
                <LogOut size={13} />
                <span>Sign Out ({user?.registrationNumber || registrationNumber})</span>
              </button>
            )}
            <Link
              to="/admin/login"
              className="flex-shrink-0 whitespace-nowrap text-xs font-semibold text-navy-800 hover:text-primary px-3 py-2 rounded-lg border border-slate-300 hover:border-primary/50 bg-white transition-colors"
            >
              Faculty &amp; Admin Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="student-main-content" className="flex-1 w-full flex flex-col items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
        <div className="w-full max-w-5xl mx-auto min-w-0 space-y-6">
          {!isStudentAuthed ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
              {/* Left Column: Value Proposition */}
              <section aria-labelledby="seat-lookup-heading" className="lg:col-span-5 space-y-5 pt-1 min-w-0">
                <div className="space-y-2.5">
                  <p className="es-eyebrow">Official Student Examination Portal</p>
                  <h1
                    id="seat-lookup-heading"
                    className="text-2xl sm:text-3xl font-extrabold text-navy-900 tracking-tight leading-tight break-words"
                  >
                    Student Portal &amp; Seat Lookup
                  </h1>
                  <p className="text-sm text-slate-600 leading-relaxed break-words">
                    Sign in with your college Registration Number to view your scheduled UNIT examinations and your allocated classroom, bench, chair, and question paper set.
                  </p>
                </div>

                <dl className="divide-y divide-slate-200 border-t border-b border-slate-200 text-xs">
                  <div className="py-3 flex items-start gap-3">
                    <GraduationCap size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-navy-800">Registration Number Sign In</dt>
                      <dd className="text-slate-600 mt-0.5">Access your personalized exam list securely with your university registration number (e.g., 24091A0501).</dd>
                    </div>
                  </div>
                  <div className="py-3 flex items-start gap-3">
                    <Clock size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-navy-800">Scheduled Publication Time (IST)</dt>
                      <dd className="text-slate-600 mt-0.5">Seating details unlock automatically at the scheduled publication time and remain visible until 10 minutes after exam start.</dd>
                    </div>
                  </div>
                  <div className="py-3 flex items-start gap-3">
                    <ShieldCheck size={16} className="text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <dt className="font-bold text-navy-800">Private Candidate Isolation</dt>
                      <dd className="text-slate-600 mt-0.5">You can view only your own assigned classroom hall, bench, chair, and Question Paper Set.</dd>
                    </div>
                  </div>
                </dl>
              </section>

              {/* Right Column: Registration Number Sign-In Surface */}
              <section aria-label="Student Sign In Form" className="lg:col-span-7 w-full min-w-0 space-y-4">
                <div className="w-full min-w-0 bg-white p-5 sm:p-7 rounded-xl border border-slate-200 shadow-sm text-left">
                  <div className="border-b border-slate-200 pb-3.5 mb-4">
                    <h2 className="text-base font-bold text-navy-800">Student Sign In</h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Enter your registration number to access your examination schedule and seat allotment.
                    </p>
                  </div>

                  {error && (
                    <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleStudentSignIn} className="space-y-4">
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
                          maxLength={15}
                          autoComplete="off"
                          value={registrationNumber}
                          onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                          placeholder="e.g. 24091A0501"
                          className="w-full pl-9 pr-4 py-2.5 text-sm font-mono font-bold tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary uppercase text-navy-900 bg-white"
                        />
                      </div>
                    </div>

                    {needsPassword && (
                      <div>
                        <label htmlFor="student-password-input" className="block text-xs font-semibold text-navy-800 mb-1.5">
                          Student Account Password <span className="text-red-600">*</span>
                        </label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                            <KeyRound size={15} aria-hidden="true" />
                          </div>
                          <input
                            id="student-password-input"
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={signingIn}
                      className="es-btn-primary w-full py-3 px-4 text-sm shadow-xs space-x-2"
                    >
                      <span>{signingIn ? 'Signing in...' : 'View My Examinations & Seat'}</span>
                      {!signingIn && <ArrowRight size={16} aria-hidden="true" />}
                    </button>
                  </form>
                </div>
              </section>
            </div>
          ) : (
            /* Authenticated Student Dashboard & Own-Seat View */
            <div className="space-y-6">
              {/* Student Profile Summary Bar */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
                    <GraduationCap size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-navy-800">
                      {studentProfile?.name || user?.name || 'Student'}
                    </div>
                    <div className="text-xs text-slate-600 font-mono">
                      Reg. No: <strong className="text-primary">{studentProfile?.registrationNumber || user?.registrationNumber}</strong>
                      {user?.section ? ` • Section ${user.section}` : ''}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={fetchMyExams}
                  disabled={scheduleLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
                >
                  <RefreshCw size={13} className={scheduleLoading ? 'animate-spin' : ''} />
                  <span>Refresh Schedule</span>
                </button>
              </div>

              {scheduleLoading ? (
                <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-600 space-y-2">
                  <RefreshCw size={22} className="animate-spin text-primary mx-auto" />
                  <p>Loading your scheduled examinations (Asia/Kolkata)...</p>
                </div>
              ) : scheduleError ? (
                <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-5 text-center space-y-3">
                  <AlertCircle size={22} className="text-red-600 mx-auto" />
                  <p className="text-xs font-semibold text-red-900">{scheduleError}</p>
                  <button
                    type="button"
                    onClick={fetchMyExams}
                    className="es-btn-secondary text-xs px-4 py-2 text-red-700 border-red-300"
                  >
                    Retry
                  </button>
                </div>
              ) : myExams.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center space-y-2">
                  <Clock size={24} className="text-amber-700 mx-auto" />
                  <h2 className="text-sm font-bold text-amber-950">No Published Examinations Scheduled</h2>
                  <p className="text-xs text-amber-900 max-w-md mx-auto">
                    There are currently no published examinations assigned to your registration number ({user?.registrationNumber}). Check back closer to exam time.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column: My Examinations List */}
                  <div className="lg:col-span-5 space-y-3 print:hidden">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      My Scheduled Examinations ({myExams.length})
                    </h2>
                    <div className="space-y-2.5">
                      {myExams.map((ex) => {
                        const access = computeExamAccess(ex);
                        const isSelected = selectedExam && String(selectedExam._id) === String(ex._id);
                        return (
                          <button
                            key={ex._id}
                            type="button"
                            onClick={() => setSelectedExamId(ex._id)}
                            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${isSelected
                              ? 'bg-white border-primary ring-2 ring-primary/15 shadow-xs'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                                {resolveExamType(ex)}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${access.state === 'OPEN'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : access.state === 'PENDING'
                                    ? 'bg-blue-100 text-primary'
                                    : 'bg-amber-100 text-amber-900'
                                  }`}
                              >
                                {access.state === 'OPEN'
                                  ? 'Seating Open'
                                  : access.state === 'PENDING'
                                    ? `Publishes ${access.accessTimeFormatted}`
                                    : 'Window Closed'}
                              </span>
                            </div>
                            <div className="font-bold text-sm text-navy-800">
                              {ex.subjectName} <span className="font-mono text-xs text-primary">({ex.subjectCode})</span>
                            </div>
                            <div className="text-xs text-slate-600 mt-1">
                              {ex.examDate} • {formatSessionLabel(ex.session, ex.startTime)} • {formatExamTimeRange(ex)} IST
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Publication Time: <strong>{access.accessTimeFormatted} IST</strong>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Selected Exam Countdown / Own Seat Slip */}
                  <div className="lg:col-span-7">
                    {selectedExam && selectedAccess.state === 'PENDING' && (
                      <div className="bg-white rounded-xl border border-blue-200 p-7 text-center space-y-3 shadow-sm">
                        <div className="inline-flex p-3 rounded-xl bg-blue-50 text-primary border border-blue-200">
                          <Lock size={22} />
                        </div>
                        <div className="text-xs font-extrabold uppercase tracking-wider text-primary">
                          Publication Scheduled
                        </div>
                        <h3 className="text-base font-bold text-navy-800">
                          [{resolveExamType(selectedExam)}] {selectedExam.subjectName} ({selectedExam.subjectCode})
                        </h3>
                        <p className="text-sm font-medium text-navy-800">
                          Your seating arrangement will be available at{' '}
                          <strong>{selectedAccess.accessTimeFormatted}</strong>.
                        </p>
                        <div className="inline-block px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 font-mono text-base font-bold text-primary">
                          Opens in {formatCountdownHMS(selectedAccess.remainingMs)}
                        </div>
                      </div>
                    )}

                    {selectedExam && selectedAccess.state === 'COMPLETED' && (
                      <div className="bg-white rounded-xl border border-amber-200 p-7 text-center space-y-2 shadow-sm">
                        <Lock size={22} className="text-amber-700 mx-auto" />
                        <h3 className="text-sm font-bold text-amber-950">Seating Access Window Closed</h3>
                        <p className="text-xs text-amber-900">
                          Seating information is no longer available. The access window closes 10 minutes after the scheduled start time.
                        </p>
                      </div>
                    )}

                    {selectedExam && selectedAccess.state === 'OPEN' && selectedExam.seat && (
                      <section
                        aria-label="Examination Seating Slip"
                        className="es-surface w-full min-w-0 p-5 sm:p-7 space-y-5 border-2 border-primary/20 print:border-none print:shadow-none bg-white rounded-xl"
                      >
                        <div className="border-b border-slate-200 pb-4 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 mb-2">
                            <CheckCircle2 size={12} className="mr-1" aria-hidden="true" /> SEAT ALLOCATED &amp; PUBLISHED
                          </span>
                          <h2 className="text-lg font-bold text-navy-800">YOUR EXAMINATION SEATING SLIP</h2>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)
                          </p>
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                          <div>
                            <span className="text-slate-600 block text-[11px]">Registration Number</span>
                            <span className="text-base font-mono font-bold text-navy-800">
                              {selectedExam.seat.registrationNumber}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 block text-[11px]">Candidate Name</span>
                            <span className="text-base font-semibold text-navy-800">
                              {selectedExam.seat.studentName}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 block text-[11px]">Examination &amp; Subject</span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                                {resolveExamType(selectedExam)}
                              </span>
                              <span className="font-semibold text-navy-800">
                                {selectedExam.subjectName} ({selectedExam.subjectCode})
                              </span>
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-600 block text-[11px]">Date &amp; Timings</span>
                            <span className="font-semibold text-navy-800">
                              {selectedExam.examDate} • {formatSessionLabel(selectedExam.session, selectedExam.startTime)} ({formatExamTimeRange(selectedExam)})
                            </span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-slate-600 block text-[11px]">Allocated Classroom</span>
                            <span className="font-bold text-navy-800 text-sm">
                              {selectedExam.seat.classroomHall || selectedExam.seat.classroomName} (Room {selectedExam.seat.roomNumber})
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                            <span className="text-[11px] text-slate-600 uppercase font-semibold">Row</span>
                            <p className="text-sm font-bold text-navy-800 mt-0.5">{selectedExam.seat.row}</p>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                            <span className="text-[11px] text-slate-600 uppercase font-semibold">Bench</span>
                            <p className="text-sm font-bold text-navy-800 mt-0.5">{selectedExam.seat.bench}</p>
                          </div>
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                            <span className="text-[11px] text-slate-600 uppercase font-semibold">Chair / Seat</span>
                            <p className="text-sm font-bold text-navy-800 mt-0.5">
                              {selectedExam.seat.seatId || `Seat ${selectedExam.seat.seatNumber}`}
                            </p>
                          </div>
                          <div
                            className={`p-3 rounded-xl border text-center ${selectedExam.seat.questionPaperSet === 'A'
                              ? 'bg-blue-50 border-blue-300 text-blue-900'
                              : selectedExam.seat.questionPaperSet === 'B'
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                : 'bg-amber-50 border-amber-300 text-amber-900'
                              }`}
                          >
                            <span className="text-[11px] uppercase font-bold">Question Paper Set</span>
                            <p className="text-xl font-bold mt-0.5">SET {selectedExam.seat.questionPaperSet}</p>
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-1">
                          <div className="flex items-center gap-2 font-bold text-navy-800">
                            <Building size={15} className="text-primary" />
                            <span>
                              {selectedExam.seat.block}, {selectedExam.seat.floor}, Room {selectedExam.seat.roomNumber}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 pl-6">
                            {selectedExam.seat.instructions}
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
                </div>
              )}
            </div>
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
