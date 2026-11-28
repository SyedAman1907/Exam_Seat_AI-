import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { API_TIMEOUTS, formatApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import TimeSelect12h from './TimeSelect12h';
import { downloadProtectedReport } from '../utils/fileDownloader';
import {
  getTodayKolkataIso,
  formatTime12h,
  formatSessionLabel,
  normalizeSessionCode,
  validateExamTimeRange,
  validateCustomPublicationTime,
  toMinutesFromMidnight,
  computeVisibilityWindowLabel,
} from '../utils/dateTime';
import { EXAM_TYPE_OPTIONS, buildDefaultExamTitle, resolveExamType } from '../utils/examType';
import {
  Calendar,
  Clock,
  RefreshCw,
  Search,
  Users,
  BookOpen,
  Building,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Send,
  X,
  Ban,
  ShieldCheck,
  Shuffle,
} from 'lucide-react';

function formatReadableDate(isoDate) {
  if (!isoDate) return '—';
  const match = String(isoDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(isoDate);
  const dt = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+05:30`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getExamStatusBadge(exam, mode) {
  if (!exam) return { label: 'No Examination', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  if (exam.status === 'CANCELLED' || exam.approvalStatus === 'CANCELLED') {
    return { label: 'Cancelled', cls: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (mode === 'ACTIVE' || exam.status === 'ONGOING') {
    return { label: 'Active Now', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (exam.approvalStatus === 'PENDING_REVIEW') {
    return { label: 'Pending Admin Review', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  }
  if (exam.visibilityStatus === 'PUBLISHED' || exam.status === 'PUBLISHED') {
    return { label: 'Published (Upcoming)', cls: 'bg-pink-50 text-[#E83E8C] border-pink-200' };
  }
  if (exam.approvalStatus === 'APPROVED') {
    return { label: 'Approved • Scheduled', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  return { label: mode === 'UPCOMING' ? 'Upcoming' : exam.status || 'Scheduled', cls: 'bg-pink-50 text-[#E83E8C] border-pink-200' };
}

const ExaminationManagementView = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams] = useSearchParams();
  const requestedExamId = searchParams.get('examId') || '';
  const openNewFromQuery = searchParams.get('new') === 'true';

  // Master data & current single examination
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentExam, setCurrentExam] = useState(null);
  const [currentMode, setCurrentMode] = useState('NONE');
  const [subjects, setSubjects] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [bookedRoomIds, setBookedRoomIds] = useState(new Set());

  // 4-Field Examination Configuration State
  const [selectedSubjectKey, setSelectedSubjectKey] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedClassroomId, setSelectedClassroomId] = useState('');

  // Loaded Single-Section Roster State (Sections D & E)
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterData, setRosterData] = useState(null);
  const [rosterError, setRosterError] = useState('');
  const [banner, setBanner] = useState(null);

  // Table Search & Pagination
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Schedule Modal (Single-Section Examination Creation with fixed IST AM/PM & Publication Time)
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [submittingSchedule, setSubmittingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleForm, setScheduleForm] = useState({
    examType: 'UNIT 1',
    examName: buildDefaultExamTitle({ year: 'III Year', semester: 'I Semester', examType: 'UNIT 1' }),
    examDate: getTodayKolkataIso(),
    session: 'AM',
    startTime: '09:00 AM',
    endTime: '12:00 PM',
    publicationTime: '08:50 AM',
    confirmPastPublication: false,
  });

  // Action Locks & Processing Flags
  const [actionBusy, setActionBusy] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const didInitialAutoLoadRef = useRef(false);

  // Deduplicated subjects available in selector (strictly real DB records)
  const availableSubjects = useMemo(() => {
    const byKey = new Map();
    const mappedCodes = new Set(
      mappings.map((m) => String(m.subjectCode || '').trim().toUpperCase()).filter(Boolean)
    );

    // Prioritize subjects that have active section mappings
    mappings.forEach((m) => {
      const code = String(m.subjectCode || '').trim().toUpperCase();
      const name = String(m.subjectName || '').trim();
      const key = code || name.toUpperCase();
      if (!key || byKey.has(key)) return;
      byKey.set(key, {
        key,
        subjectName: name,
        subjectCode: code,
        academicYear: m.academicYear || '2026-2027',
        year: m.year || 'III Year',
        semester: m.semester || 'I Semester',
      });
    });

    subjects.forEach((s) => {
      const code = String(s.subjectCode || '').trim().toUpperCase();
      const name = String(s.subjectName || '').trim();
      const key = code || name.toUpperCase();
      if (!key || byKey.has(key)) return;
      // Faculty see only mapped subjects; Admin sees all DB subjects (prioritizing mapped ones first)
      if (!isAdmin && !mappedCodes.has(key)) return;
      byKey.set(key, {
        key,
        subjectName: name,
        subjectCode: code,
        academicYear: s.academicYear || '2026-2027',
        year: s.year || 'III Year',
        semester: s.semester || 'I Semester',
      });
    });

    return Array.from(byKey.values()).sort((a, b) =>
      a.subjectName.localeCompare(b.subjectName)
    );
  }, [subjects, mappings, isAdmin]);

  const selectedSubject = useMemo(
    () => availableSubjects.find((s) => s.key === selectedSubjectKey) || null,
    [availableSubjects, selectedSubjectKey]
  );

  // Valid sections strictly mapped for the chosen subject
  const availableSections = useMemo(() => {
    if (!selectedSubject) return [];
    const targetCode = selectedSubject.subjectCode;
    const matched = mappings.filter((m) => {
      const mCode = String(m.subjectCode || '').trim().toUpperCase();
      return (
        mCode === targetCode ||
        String(m.subjectName || '').trim().toLowerCase() === selectedSubject.subjectName.toLowerCase()
      );
    });
    const uniqueSecs = Array.from(
      new Set(matched.map((m) => String(m.section || '').trim().toUpperCase()).filter(Boolean))
    ).sort();
    return uniqueSecs;
  }, [selectedSubject, mappings]);

  // Fetch initial workspace snapshot cleanly
  const loadWorkspaceData = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setRefreshing(true);
      else setInitialLoading(true);
      setBanner(null);

      try {
        const [examRes, subRes, mapRes, roomRes] = await Promise.all([
          requestedExamId
            ? api.get(`/exams/${requestedExamId}`)
            : api.get('/exams/current'),
          api.get('/subjects'),
          api.get('/mappings'),
          api.get('/classrooms'),
        ]);

        const examDoc = examRes.data?.data || null;
        setCurrentExam(examDoc);
        setCurrentMode(
          requestedExamId
            ? examDoc?.status === 'ONGOING'
              ? 'ACTIVE'
              : examDoc
              ? 'UPCOMING'
              : 'NONE'
            : examRes.data?.mode || (examDoc ? 'UPCOMING' : 'NONE')
        );

        const nextSubjects = Array.isArray(subRes.data?.data) ? subRes.data.data : [];
        const nextMappings = Array.isArray(mapRes.data?.mappings) ? mapRes.data.mappings : [];
        const nextRooms = Array.isArray(roomRes.data?.data)
          ? roomRes.data.data
          : Array.isArray(roomRes.data?.classrooms)
          ? roomRes.data.classrooms
          : [];

        setSubjects(nextSubjects);
        setMappings(nextMappings);
        setClassrooms(nextRooms.filter((r) => r.isActive !== false));
      } catch (err) {
        setBanner({
          type: 'error',
          text: formatApiError(err, 'Failed to load examination management workspace.'),
        });
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [requestedExamId]
  );

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Sync default Subject selection cleanly from currentExam or first mapped subject
  useEffect(() => {
    if (availableSubjects.length === 0) {
      setSelectedSubjectKey('');
      return;
    }
    setSelectedSubjectKey((prev) => {
      if (prev && availableSubjects.some((s) => s.key === prev)) return prev;
      if (currentExam?.subjectCode) {
        const match = availableSubjects.find(
          (s) => s.subjectCode === String(currentExam.subjectCode).toUpperCase()
        );
        if (match) return match.key;
      }
      return availableSubjects[0].key;
    });
  }, [availableSubjects, currentExam]);

  // Keep Section synced strictly to valid mapped sections for the selected Subject
  useEffect(() => {
    if (availableSections.length === 0) {
      setSelectedSection('');
      return;
    }
    setSelectedSection((prev) => {
      if (prev && availableSections.includes(prev)) return prev;
      return availableSections[0];
    });
  }, [availableSections]);

  // Auto-select default classroom mapped to selected Section (or current exam allocation room)
  useEffect(() => {
    if (!selectedSection || classrooms.length === 0) return;
    if (currentExam?.sectionAllocations?.length) {
      const sa = currentExam.sectionAllocations.find(
        (item) => String(item.section || '').toUpperCase() === selectedSection
      );
      if (sa?.classroomId) {
        const idStr = typeof sa.classroomId === 'object' ? sa.classroomId._id : sa.classroomId;
        if (classrooms.some((r) => String(r._id) === String(idStr))) {
          setSelectedClassroomId(String(idStr));
          return;
        }
      }
    }
    const defaultRoomMap = { A1: '3010', A2: '3020', A3: '3030', A4: '3040', A5: '3050', A6: '3060' };
    const preferredNum = defaultRoomMap[selectedSection];
    const matchedRoom = preferredNum
      ? classrooms.find((r) => String(r.roomNumber) === preferredNum)
      : null;
    setSelectedClassroomId(String((matchedRoom || classrooms[0])._id));
  }, [selectedSection, classrooms, currentExam]);

  // Check classroom booking conflicts for the current exam slot
  useEffect(() => {
    let active = true;
    async function checkBookedRooms() {
      if (!currentExam?.examDate || !currentExam?.startTime || !currentExam?.endTime) {
        setBookedRoomIds(new Set());
        return;
      }
      try {
        const res = await api.post('/exams/check-availability', {
          examDate: currentExam.examDate,
          startTime: currentExam.startTime,
          endTime: currentExam.endTime,
          session: currentExam.session || 'AM',
          group: 'ALL',
          excludeExamId: currentExam._id,
        });
        if (!active) return;
        const ids = new Set(
          (res.data?.conflicts || [])
            .map((c) => String(c.classroomId || ''))
            .filter(Boolean)
        );
        setBookedRoomIds(ids);
      } catch {
        if (active) setBookedRoomIds(new Set());
      }
    }
    checkBookedRooms();
    return () => {
      active = false;
    };
  }, [currentExam]);

  useEffect(() => {
    if (openNewFromQuery && !initialLoading) {
      openScheduleModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewFromQuery, initialLoading]);

  // Primary Action: Load Single-Section Examination Roster
  const handleLoadRoster = useCallback(
    async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!selectedSubject || !selectedSection) {
        setRosterError('Please select a Subject and a valid mapped Section before loading the roster.');
        return;
      }

      setRosterLoading(true);
      setRosterError('');
      setBanner(null);
      setCurrentPage(1);

      try {
        const params = new URLSearchParams({
          subjectCode: selectedSubject.subjectCode,
          subjectName: selectedSubject.subjectName,
          section: selectedSection,
        });
        if (currentExam?._id && String(currentExam.subjectCode || '').toUpperCase() === selectedSubject.subjectCode) {
          params.append('examId', currentExam._id);
        }
        if (selectedClassroomId) {
          params.append('classroomId', selectedClassroomId);
        }

        const res = await api.get(`/exams/section-roster?${params.toString()}`, {
          timeout: API_TIMEOUTS.DEFAULT,
        });

        if (res.data?.success && res.data?.data) {
          setRosterData(res.data.data);
          if (res.data.data.classroomConflict) {
            setBanner({
              type: 'error',
              text: `Room Conflict Warning: ${res.data.data.classroomConflict.message}`,
            });
          }
        } else {
          setRosterError(res.data?.message || 'Unable to load the selected section roster.');
        }
      } catch (err) {
        setRosterData(null);
        setRosterError(formatApiError(err, 'Failed to load section roster from database.'));
      } finally {
        setRosterLoading(false);
      }
    },
    [selectedSubject, selectedSection, selectedClassroomId, currentExam]
  );

  // Auto-load initial roster once the first valid Subject + Section + Classroom resolve
  useEffect(() => {
    if (
      !didInitialAutoLoadRef.current &&
      !initialLoading &&
      selectedSubject &&
      selectedSection &&
      selectedClassroomId
    ) {
      didInitialAutoLoadRef.current = true;
      handleLoadRoster();
    }
  }, [initialLoading, selectedSubject, selectedSection, selectedClassroomId, handleLoadRoster]);

  // Filtered & paginated roster rows
  const filteredStudents = useMemo(() => {
    const list = rosterData?.students || [];
    const q = String(deferredSearch || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (st) =>
        String(st.registrationNumber || '').toLowerCase().includes(q) ||
        String(st.studentName || '').toLowerCase().includes(q)
    );
  }, [rosterData, deferredSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedStudents = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredStudents.slice(start, start + pageSize);
  }, [filteredStudents, safePage, pageSize]);

  // Examination Scheduling Modal helpers (Fixed IST AM/PM & Publication Time rules)
  const openScheduleModal = () => {
    setScheduleError('');
    setScheduleForm({
      examType: 'UNIT 1',
      examName: buildDefaultExamTitle({
        year: selectedSubject?.year || 'III Year',
        semester: selectedSubject?.semester || 'I Semester',
        examType: 'UNIT 1',
      }),
      examDate: getTodayKolkataIso(),
      session: 'AM',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      publicationTime: '08:50 AM',
      confirmPastPublication: false,
    });
    setScheduleOpen(true);
  };

  const handleScheduleSessionSwitch = (sess) => {
    const norm = normalizeSessionCode(sess, 'AM');
    const isPM = norm === 'PM';
    setScheduleForm((prev) => {
      const sMins = toMinutesFromMidnight(prev.startTime);
      const mismatch = isPM ? sMins < 12 * 60 : sMins >= 12 * 60;
      return {
        ...prev,
        session: norm,
        ...(mismatch
          ? {
              startTime: isPM ? '02:00 PM' : '09:00 AM',
              endTime: isPM ? '05:00 PM' : '12:00 PM',
              publicationTime: isPM ? '01:50 PM' : '08:50 AM',
            }
          : {}),
      };
    });
  };

  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    if (submittingSchedule) return;
    setScheduleError('');

    if (!selectedSubject || !selectedSection || !selectedClassroomId) {
      setScheduleError('Please select Subject, Section, and Classroom in Examination Configuration first.');
      return;
    }

    const timeCheck = validateExamTimeRange(scheduleForm.startTime, scheduleForm.endTime, {
      session: scheduleForm.session,
      allowOvernight: false,
    });
    if (!timeCheck.valid) {
      setScheduleError(timeCheck.message);
      return;
    }

    const pubCheck = validateCustomPublicationTime(
      scheduleForm.examDate,
      timeCheck.startTime,
      scheduleForm.publicationTime
    );
    if (!pubCheck.valid) {
      setScheduleError(pubCheck.message);
      return;
    }
    if (pubCheck.isPast && (!isAdmin || !scheduleForm.confirmPastPublication)) {
      setScheduleError(
        `Publication Time (${pubCheck.publicationTime}) is earlier than current IST time. Choose a future time${
          isAdmin ? ' or check the Admin past-publication override.' : '.'
        }`
      );
      return;
    }

    const sectionGroup = ['A1', 'A2', 'A3'].includes(selectedSection) ? 'Group A' : 'Group B';

    setSubmittingSchedule(true);
    try {
      const res = await api.post(
        '/exams',
        {
          examName: scheduleForm.examName.trim(),
          examType: scheduleForm.examType,
          academicYear: selectedSubject.academicYear || '2026-2027',
          year: selectedSubject.year || 'III Year',
          semester: selectedSubject.semester || 'I Semester',
          subjectName: selectedSubject.subjectName,
          subjectCode: selectedSubject.subjectCode,
          section: selectedSection,
          group: sectionGroup,
          classroomId: selectedClassroomId,
          examDate: scheduleForm.examDate,
          session: scheduleForm.session,
          startTime: timeCheck.startTime,
          endTime: timeCheck.endTime,
          publicationTime: pubCheck.publicationTime,
          confirmPastPublication: Boolean(scheduleForm.confirmPastPublication),
        },
        { timeout: API_TIMEOUTS.HEAVY_WRITE }
      );

      if (res.data?.success) {
        setScheduleOpen(false);
        setBanner({
          type: 'success',
          text: res.data.message || `Scheduled single-section examination for Section ${selectedSection}.`,
        });
        await loadWorkspaceData({ silent: true });
        await handleLoadRoster();
      } else {
        setScheduleError(res.data?.message || 'Failed to schedule examination.');
      }
    } catch (err) {
      setScheduleError(formatApiError(err, 'Failed to schedule single-section examination.'));
    } finally {
      setSubmittingSchedule(false);
    }
  };

  // Admin Lifecycle Actions on Current Examination
  const handleAdminExamAction = async (actionType) => {
    if (!isAdmin || !currentExam?._id || actionBusy) return;
    let body = {};
    if (actionType === 'cancel') {
      const reason = window.prompt('Enter formal cancellation reason:');
      if (!reason || !reason.trim()) return;
      body = { reason: reason.trim() };
    }
    setActionBusy(actionType);
    setBanner(null);
    try {
      const res = await api.post(`/exams/${currentExam._id}/${actionType}`, body, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data?.success) {
        setBanner({ type: 'success', text: res.data.message || `Examination ${actionType} succeeded.` });
        await loadWorkspaceData({ silent: true });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: formatApiError(err, `Unable to ${actionType} examination.`),
      });
    } finally {
      setActionBusy('');
    }
  };

  const handleDownloadSectionPdf = async () => {
    if (!currentExam?._id || !selectedSection || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const url = currentExam.sectionAllocations?.length
        ? `/reports/${currentExam._id}/section-attendance-pdf/${selectedSection}`
        : `/reports/${currentExam._id}/attendance-pdf`;
      await downloadProtectedReport(
        url,
        `${currentExam.subjectCode}_Sec-${selectedSection}_Attendance.pdf`
      );
    } catch (err) {
      setBanner({ type: 'error', text: formatApiError(err, 'Failed to download Attendance PDF.') });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const currentStatusBadge = getExamStatusBadge(currentExam, currentMode);
  const pubCheckPreview = validateCustomPublicationTime(
    scheduleForm.examDate,
    scheduleForm.startTime,
    scheduleForm.publicationTime
  );

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* A. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[var(--es-border)]">
        <div className="min-w-0">
          <div className="es-eyebrow mb-1">Single Examination • Single Section Control</div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--es-text-primary)] tracking-tight">
            Examination Management
          </h1>
          <p className="text-xs sm:text-sm text-[var(--es-text-muted)] mt-0.5">
            Manage the current examination and section-wise seating.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => loadWorkspaceData({ silent: true })}
            disabled={refreshing}
            className="es-btn-secondary h-10 px-3.5 text-xs gap-2"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>

          <ThemeToggle />

          <button
            type="button"
            onClick={openScheduleModal}
            className="es-btn-primary h-10 px-4 text-xs gap-2 shadow-sm"
          >
            <PlusCircle size={15} aria-hidden="true" />
            <span>Schedule Examination</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            banner.type === 'error'
              ? 'bg-red-50/90 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200'
              : 'bg-emerald-50/90 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900/60 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {banner.type === 'error' ? (
              <AlertCircle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            )}
            <span className="font-medium break-words">{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="p-1 opacity-70 hover:opacity-100 cursor-pointer flex-shrink-0"
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* B. Current Examination Card (Displays ONLY the single current/upcoming exam) */}
      <section aria-label="Current Examination" className="es-glass-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[var(--es-secondary)] text-[var(--es-primary)] flex items-center justify-center">
              <Calendar size={17} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-[var(--es-text-primary)]">
                Current Examination
              </h2>
              <p className="text-[11px] text-[var(--es-text-muted)]">
                {currentMode === 'ACTIVE'
                  ? 'Live active examination currently in progress (IST)'
                  : currentMode === 'UPCOMING'
                  ? 'Next scheduled upcoming examination (IST)'
                  : 'No active or upcoming examination on record'}
              </p>
            </div>
          </div>

          {currentExam && (
            <span className={`px-3 py-1 rounded-full text-[11px] font-bold border ${currentStatusBadge.cls}`}>
              {currentStatusBadge.label}
            </span>
          )}
        </div>

        {initialLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-[var(--es-surface-muted)] border border-[var(--es-border)]" />
            ))}
          </div>
        ) : !currentExam ? (
          <div className="p-6 rounded-xl border border-dashed border-[var(--es-border)] bg-[var(--es-surface-muted)] text-center space-y-2.5">
            <Clock size={26} className="mx-auto text-[var(--es-primary)] opacity-80" />
            <div className="text-sm font-bold text-[var(--es-text-primary)]">
              No Active or Upcoming Examination
            </div>
            <p className="text-xs text-[var(--es-text-muted)] max-w-md mx-auto">
              There is currently no active or upcoming examination in MongoDB. Use the Configuration Card below to inspect a section roster or schedule a single-section examination.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
              <div className="lg:col-span-2 p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--es-text-muted)] block">
                  Examination Title
                </span>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="px-2 py-0.5 rounded bg-[var(--es-secondary)] text-[var(--es-primary)] text-[10px] font-bold">
                    {resolveExamType(currentExam)}
                  </span>
                  <span className="font-bold text-[var(--es-text-primary)] break-words">
                    {currentExam.examName}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--es-text-muted)] block">
                  Examination Date
                </span>
                <span className="font-bold text-[var(--es-text-primary)] block mt-1">
                  {formatReadableDate(currentExam.examDate)}
                </span>
                <span className="text-[10px] font-mono text-[var(--es-text-muted)]">
                  {currentExam.examDate}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--es-text-muted)] block">
                  Session
                </span>
                <span className="font-bold text-[var(--es-text-primary)] block mt-1">
                  {formatSessionLabel(currentExam.session, currentExam.startTime)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--es-text-muted)] block">
                  Start &amp; End Time (IST)
                </span>
                <span className="font-mono font-bold text-[var(--es-text-primary)] block mt-1">
                  {formatTime12h(currentExam.startTime)} – {formatTime12h(currentExam.endTime)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--es-text-muted)] block">
                  Student Publication
                </span>
                <span className="font-mono font-bold text-[var(--es-primary)] block mt-1">
                  {currentExam.publicationTimeStr || formatTime12h(currentExam.publicationTime) || 'Scheduled'}
                </span>
                <span className="text-[10px] text-[var(--es-text-muted)]">
                  {currentExam.approvalStatus === 'APPROVED' ? 'Approved' : 'Awaiting Review'}
                </span>
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--es-border)]">
                <div className="text-[11px] text-[var(--es-text-muted)]">
                  Subject: <strong className="text-[var(--es-text-primary)]">{currentExam.subjectName}</strong> ({currentExam.subjectCode})
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {currentExam.approvalStatus !== 'APPROVED' && (
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => handleAdminExamAction('approve')}
                      className="h-9 px-3 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <ShieldCheck size={14} />
                      <span>{actionBusy === 'approve' ? 'Approving...' : 'Approve'}</span>
                    </button>
                  )}
                  {currentExam.approvalStatus === 'APPROVED' &&
                    currentExam.visibilityStatus !== 'PUBLISHED' &&
                    currentExam.status !== 'PUBLISHED' && (
                      <button
                        type="button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => handleAdminExamAction('publish')}
                        className="es-btn-primary h-9 px-3.5 text-xs gap-1.5"
                      >
                        <Send size={13} />
                        <span>{actionBusy === 'publish' ? 'Publishing...' : 'Publish to Students'}</span>
                      </button>
                    )}
                  <Link
                    to={`/admin/allocations?examId=${currentExam._id}`}
                    className="es-btn-secondary h-9 px-3 text-xs gap-1.5"
                  >
                    <Shuffle size={13} className="text-[var(--es-primary)]" />
                    <span>Seating Map</span>
                  </Link>
                  {currentExam.status !== 'COMPLETED' && currentExam.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => handleAdminExamAction('cancel')}
                      className="h-9 px-3 rounded-lg text-xs font-semibold border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Ban size={13} />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* C. Examination Configuration Card (4-field responsive selector) */}
      <section aria-label="Examination Configuration" className="es-surface p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[var(--es-text-primary)] flex items-center gap-2">
              <BookOpen size={16} className="text-[var(--es-primary)]" aria-hidden="true" />
              <span>Examination Configuration</span>
            </h2>
            <p className="text-xs text-[var(--es-text-muted)] mt-0.5">
              Select a Subject, verify its Subject Code, choose ONE mapped Section, and assign a Classroom Number.
            </p>
          </div>
        </div>

        <form onSubmit={handleLoadRoster} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* 1. Subject Name */}
            <div className="min-w-0">
              <label htmlFor="cfg-subject-name" className="block text-xs font-semibold text-[var(--es-text-primary)] mb-1.5">
                Subject Name
              </label>
              <select
                id="cfg-subject-name"
                value={selectedSubjectKey}
                onChange={(e) => {
                  setSelectedSubjectKey(e.target.value);
                  setRosterData(null);
                  setRosterError('');
                }}
                disabled={availableSubjects.length === 0}
                className="es-input"
              >
                {availableSubjects.length === 0 ? (
                  <option value="">No mapped subjects available</option>
                ) : (
                  availableSubjects.map((sub) => (
                    <option key={sub.key} value={sub.key}>
                      {sub.subjectName}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 2. Subject Code (Read-Only Auto-Populated) */}
            <div className="min-w-0">
              <label htmlFor="cfg-subject-code" className="block text-xs font-semibold text-[var(--es-text-primary)] mb-1.5">
                Subject Code
              </label>
              <input
                id="cfg-subject-code"
                type="text"
                readOnly
                value={selectedSubject?.subjectCode || ''}
                placeholder="Auto-populated"
                className="es-input font-mono font-bold uppercase text-[var(--es-primary)]"
              />
            </div>

            {/* 3. Section (Strictly sections with valid mappings for selected subject) */}
            <div className="min-w-0">
              <label htmlFor="cfg-section" className="block text-xs font-semibold text-[var(--es-text-primary)] mb-1.5">
                Section
              </label>
              <select
                id="cfg-section"
                value={selectedSection}
                onChange={(e) => {
                  setSelectedSection(e.target.value);
                  setRosterData(null);
                  setRosterError('');
                }}
                disabled={availableSections.length === 0}
                className="es-input font-semibold"
              >
                {availableSections.length === 0 ? (
                  <option value="">No mapped sections found</option>
                ) : (
                  availableSections.map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 4. Classroom Number */}
            <div className="min-w-0">
              <label htmlFor="cfg-classroom" className="block text-xs font-semibold text-[var(--es-text-primary)] mb-1.5">
                Classroom Number
              </label>
              <select
                id="cfg-classroom"
                value={selectedClassroomId}
                onChange={(e) => setSelectedClassroomId(e.target.value)}
                disabled={classrooms.length === 0}
                className="es-input"
              >
                {classrooms.length === 0 ? (
                  <option value="">No active classrooms available</option>
                ) : (
                  classrooms.map((rm) => {
                    const isBooked = bookedRoomIds.has(String(rm._id));
                    return (
                      <option key={rm._id} value={rm._id}>
                        {rm.roomNumber} — {rm.name} ({rm.totalCapacity || 72} Seats){isBooked ? ' [Booked]' : ''}
                      </option>
                    );
                  })
                )}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-[var(--es-text-muted)]">
              {selectedSubject && availableSections.length === 0
                ? `No student section mappings exist yet for "${selectedSubject.subjectName}".`
                : availableSections.length > 0
                ? `Valid mapped sections for this subject: ${availableSections.join(', ')}`
                : 'Load subject mappings via Permanent Student Mapping first.'}
            </span>

            <button
              type="submit"
              disabled={rosterLoading || !selectedSubject || !selectedSection}
              className="es-btn-primary h-10 px-5 text-xs gap-2 w-full sm:w-auto shadow-sm"
            >
              <Users size={15} aria-hidden="true" />
              <span>{rosterLoading ? 'Loading Section Roster...' : 'Load Examination Roster'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* D. Selected Examination Summary */}
      {rosterData && (
        <section aria-label="Selected Examination Summary" className="es-surface p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-[var(--es-text-primary)]">
              Selected Examination Summary
            </h2>
            {currentExam?._id && (
              <button
                type="button"
                onClick={handleDownloadSectionPdf}
                disabled={downloadingPdf}
                className="es-btn-secondary h-9 px-3.5 text-xs gap-1.5"
              >
                <FileDown size={14} className="text-[var(--es-primary)]" />
                <span>{downloadingPdf ? 'Generating PDF...' : `Section ${rosterData.section} Attendance PDF`}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
            <div className="col-span-2 sm:col-span-2 lg:col-span-1 p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Subject Name</span>
              <span className="font-bold text-[var(--es-text-primary)] block mt-0.5 break-words">
                {rosterData.subject?.subjectName || '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Subject Code</span>
              <span className="font-mono font-bold text-[var(--es-primary)] block mt-0.5">
                {rosterData.subject?.subjectCode || '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Section</span>
              <span className="font-bold text-[var(--es-text-primary)] block mt-0.5">
                Section {rosterData.section}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Classroom</span>
              <span className="font-bold text-[var(--es-text-primary)] block mt-0.5">
                {rosterData.classroom?.name || rosterData.classroom?.roomNumber || 'Not Assigned'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Exam Date</span>
              <span className="font-bold text-[var(--es-text-primary)] block mt-0.5">
                {rosterData.exam?.examDate ? formatReadableDate(rosterData.exam.examDate) : 'Not Scheduled'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-surface-muted)] border border-[var(--es-border)]">
              <span className="text-[10px] font-bold uppercase text-[var(--es-text-muted)] block">Session</span>
              <span className="font-bold text-[var(--es-text-primary)] block mt-0.5">
                {rosterData.exam ? rosterData.exam.sessionLabel || formatSessionLabel(rosterData.exam.session) : '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[var(--es-secondary)] border border-[var(--es-primary)]/20">
              <span className="text-[10px] font-bold uppercase text-[var(--es-primary)] block">Total Students</span>
              <span className="text-base font-extrabold text-[var(--es-primary)] block mt-0.5">
                {rosterData.totalStudents}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* E. Single-Section Student Roster */}
      <section aria-label="Student Roster" className="es-surface overflow-hidden">
        <div className="p-5 border-b border-[var(--es-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-[var(--es-text-primary)]">
              Student Roster
            </h2>
            {rosterData && (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[var(--es-secondary)] text-[var(--es-primary)]">
                {filteredStudents.length} / {rosterData.totalStudents} Students
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--es-text-muted)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search roll no. or student name..."
                className="es-input pl-9"
              />
            </div>

            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="es-input w-24"
            >
              {[10, 25, 50, 100].map((sz) => (
                <option key={sz} value={sz}>
                  {sz} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        {rosterError && (
          <div role="alert" className="m-5 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
            <span>{rosterError}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[640px]">
            <thead className="bg-[var(--es-surface-muted)] border-b border-[var(--es-border)] text-[var(--es-text-muted)] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4 w-16 text-center">S.No.</th>
                <th className="py-3 px-4">Registration Number</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4 text-center">Section</th>
                <th className="py-3 px-4">Classroom</th>
                <th className="py-3 px-4">Seat Number</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--es-border)]">
              {rosterLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-6 mx-auto" /></td>
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-28" /></td>
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-44" /></td>
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-12 mx-auto" /></td>
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-28" /></td>
                    <td className="py-3 px-4"><div className="h-3 bg-[var(--es-surface-muted)] rounded w-24" /></td>
                  </tr>
                ))
              ) : !rosterData ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-xs text-[var(--es-text-muted)]">
                    Select Subject, Section, and Classroom above and click <strong>Load Examination Roster</strong>.
                  </td>
                </tr>
              ) : paginatedStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center space-y-2">
                    <Users size={28} className="mx-auto text-[var(--es-text-muted)] opacity-60" />
                    <div className="text-xs font-bold text-[var(--es-text-primary)]">
                      No Students Mapped to Section {rosterData.section}
                    </div>
                    <p className="text-[11px] text-[var(--es-text-muted)]">
                      {searchTerm
                        ? `No candidates match "${searchTerm}". Clear search to view all section students.`
                        : `Upload a permanent student mapping for ${rosterData.subject?.subjectName} (${rosterData.section}) to populate this roster.`}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedStudents.map((st) => (
                  <tr key={st.registrationNumber} className="hover:bg-[var(--es-surface-muted)] transition-colors">
                    <td className="py-3 px-4 text-center font-mono text-[var(--es-text-muted)]">
                      {st.sNo}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[var(--es-primary)]">
                      {st.registrationNumber}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[var(--es-text-primary)]">
                      {st.studentName}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-0.5 rounded-md font-bold bg-[var(--es-secondary)] text-[var(--es-primary)]">
                        {st.section}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--es-text-secondary)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Building size={13} className="text-[var(--es-primary)]" aria-hidden="true" />
                        <span>{st.classroomName || (st.roomNumber ? `ET BLOCK ${st.roomNumber}` : 'Unassigned')}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[var(--es-text-primary)]">
                      {st.seatNumber || (
                        <span className="font-sans font-normal text-[var(--es-text-muted)]">
                          Pending allocation
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {rosterData && filteredStudents.length > 0 && (
          <div className="px-5 py-3.5 border-t border-[var(--es-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
            <span className="text-[var(--es-text-muted)]">
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filteredStudents.length)} of{' '}
              <strong className="text-[var(--es-text-primary)]">{filteredStudents.length}</strong> students
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="es-btn-secondary h-8 px-2.5 text-xs gap-1"
              >
                <ChevronLeft size={14} />
                <span>Prev</span>
              </button>
              <span className="font-mono font-semibold px-2 text-[var(--es-text-primary)]">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="es-btn-secondary h-8 px-2.5 text-xs gap-1"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Single-Section Scheduling Modal (Corrected IST AM/PM & Custom Publication Time) */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="es-surface w-full max-w-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-[var(--es-border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--es-text-primary)]">
                  Schedule Single-Section Examination
                </h3>
                <p className="text-xs text-[var(--es-text-muted)] mt-0.5">
                  Schedules section <strong>{selectedSection || '—'}</strong> for{' '}
                  <strong>{selectedSubject?.subjectName || 'selected subject'}</strong> ({selectedSubject?.subjectCode || '—'}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleOpen(false)}
                className="p-1 text-[var(--es-text-muted)] hover:text-[var(--es-text-primary)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {scheduleError && (
              <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {scheduleError}
              </div>
            )}

            <form onSubmit={handleScheduleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-4">
                  <label className="block font-bold mb-1.5 text-[var(--es-text-primary)]">
                    Examination Type *
                  </label>
                  <select
                    value={scheduleForm.examType}
                    onChange={(e) => {
                      const nextType = e.target.value;
                      setScheduleForm((prev) => ({
                        ...prev,
                        examType: nextType,
                        examName: buildDefaultExamTitle({
                          year: selectedSubject?.year || 'III Year',
                          semester: selectedSubject?.semester || 'I Semester',
                          examType: nextType,
                        }),
                      }));
                    }}
                    className="es-input font-bold"
                  >
                    {EXAM_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-8">
                  <label className="block font-bold mb-1.5 text-[var(--es-text-primary)]">
                    Examination Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={scheduleForm.examName}
                    onChange={(e) => setScheduleForm((p) => ({ ...p, examName: e.target.value }))}
                    className="es-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1.5 text-[var(--es-text-primary)]">
                    Examination Date (IST) *
                  </label>
                  <input
                    type="date"
                    required
                    value={scheduleForm.examDate}
                    onChange={(e) => setScheduleForm((p) => ({ ...p, examDate: e.target.value }))}
                    className="es-input"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1.5 text-[var(--es-text-primary)]">
                    Session (IST) *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleScheduleSessionSwitch('AM')}
                      className={`h-10 rounded-xl font-bold border transition-colors cursor-pointer ${
                        scheduleForm.session === 'AM'
                          ? 'bg-[var(--es-primary)] text-white border-[var(--es-primary)]'
                          : 'bg-[var(--es-surface)] text-[var(--es-text-primary)] border-[var(--es-border)]'
                      }`}
                    >
                      Morning (AM)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScheduleSessionSwitch('PM')}
                      className={`h-10 rounded-xl font-bold border transition-colors cursor-pointer ${
                        scheduleForm.session === 'PM'
                          ? 'bg-[var(--es-primary)] text-white border-[var(--es-primary)]'
                          : 'bg-[var(--es-surface)] text-[var(--es-text-primary)] border-[var(--es-border)]'
                      }`}
                    >
                      Afternoon (PM)
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <TimeSelect12h
                  idPrefix="sched-start"
                  label="Start Time (IST)"
                  required
                  value={scheduleForm.startTime}
                  sessionHint={scheduleForm.session}
                  onChange={(val) => setScheduleForm((p) => ({ ...p, startTime: val }))}
                />
                <TimeSelect12h
                  idPrefix="sched-end"
                  label="End Time (IST)"
                  required
                  isEndTime
                  value={scheduleForm.endTime}
                  sessionHint={scheduleForm.session}
                  onChange={(val) => setScheduleForm((p) => ({ ...p, endTime: val }))}
                />
                <TimeSelect12h
                  idPrefix="sched-pub"
                  label="Publication Time (IST)"
                  required
                  value={scheduleForm.publicationTime}
                  sessionHint={scheduleForm.session}
                  onChange={(val) => setScheduleForm((p) => ({ ...p, publicationTime: val }))}
                />
              </div>

              <div className="p-3 rounded-xl bg-[var(--es-secondary)]/60 border border-[var(--es-primary)]/20 text-[11px] text-[var(--es-text-primary)] flex flex-wrap items-center justify-between gap-2">
                <span>
                  Window: <strong>{computeVisibilityWindowLabel(scheduleForm.startTime, scheduleForm.publicationTime)}</strong> (closes T+10 mins after start)
                </span>
                {isAdmin && pubCheckPreview.valid && pubCheckPreview.isPast && (
                  <label className="inline-flex items-center gap-1.5 font-semibold text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scheduleForm.confirmPastPublication}
                      onChange={(e) =>
                        setScheduleForm((p) => ({ ...p, confirmPastPublication: e.target.checked }))
                      }
                    />
                    <span>Confirm past publication time (Admin)</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--es-border)]">
                <button
                  type="button"
                  onClick={() => setScheduleOpen(false)}
                  className="es-btn-secondary h-10 px-4 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSchedule}
                  className="es-btn-primary h-10 px-5 text-xs gap-1.5"
                >
                  <Send size={13} />
                  <span>{submittingSchedule ? 'Scheduling...' : 'Save & Generate Seating'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExaminationManagementView;
