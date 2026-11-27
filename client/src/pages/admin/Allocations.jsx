import React, { useState, useEffect, useMemo, useDeferredValue, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import { downloadProtectedReport } from '../../utils/fileDownloader';
import { formatExamTimeRange, formatSessionLabel } from '../../utils/dateTime';
import {
  Shuffle,
  CheckCircle2,
  Lock,
  Globe,
  Unlock,
  FileSpreadsheet,
  FileText,
  Search,
  LayoutGrid,
  Table as TableIcon,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const AllocationStudentRow = React.memo(({ s, indexOffset, idx, fallbackSubjectCode, fallbackFacultyName }) => (
  <tr className="hover:bg-slate-50/60 transition-colors">
    <td className="py-2.5 px-3 text-slate-400 font-mono text-center">{indexOffset + idx + 1}</td>
    <td className="py-2.5 px-3 font-mono font-bold text-navy-800">{s.registrationNumber}</td>
    <td className="py-2.5 px-3 text-slate-700 font-medium">{s.name}</td>
    <td className="py-2.5 px-3 font-mono text-slate-600">{s.subjectCode || fallbackSubjectCode || '—'}</td>
    <td className="py-2.5 px-3 text-center">
      <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-navy-800">{s.section || 'A1'}</span>
    </td>
    <td className="py-2.5 px-3 text-slate-600">{s.facultyName || fallbackFacultyName || 'CSE Faculty'}</td>
    <td className="py-2.5 px-3">
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
        {s.classroomName || 'ET BLOCK 3010'}
      </span>
    </td>
    <td className="py-2.5 px-3 text-center text-slate-600 font-medium">Row {s.rowNumber}</td>
    <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-700">
      Chair {s.seatNumber || s.benchNumber}
    </td>
    <td className="py-2.5 px-3 font-mono text-slate-800">{s.seatId}</td>
    <td className="py-2.5 px-3 text-center">
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
          s.questionPaperSet === 'A'
            ? 'bg-blue-100 text-blue-800'
            : s.questionPaperSet === 'B'
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-amber-100 text-amber-800'
        }`}
      >
        Set {s.questionPaperSet}
      </span>
    </td>
  </tr>
));

const Allocations = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const examIdParam = searchParams.get('examId');

  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState(examIdParam || '');
  const [exam, setExam] = useState(null);
  const [allocation, setAllocation] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [downloadingReport, setDownloadingReport] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'visual'
  const [message, setMessage] = useState({ type: '', text: '' });

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedSet, setSelectedSet] = useState('ALL');
  const [selectedRow, setSelectedRow] = useState('ALL');
  const [selectedBench, setSelectedBench] = useState('ALL');
  const [selectedSection, setSelectedSection] = useState('ALL');
  const [selectedClassroom, setSelectedClassroom] = useState('ALL');
  const [selectedVisualRoom, setSelectedVisualRoom] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const loadAbortRef = useRef(null);

  const fetchExams = useCallback(async () => {
    try {
      const res = await api.get('/exams');
      if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        setExams(res.data.data);
        setSelectedExamId((prev) => prev || res.data.data[0]._id);
      }
    } catch (err) {
      setLoadError(formatApiError(err, 'Failed to load examinations list.'));
    }
  }, []);

  const loadExamAndAllocation = useCallback(async (examId) => {
    if (!examId) return;
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    try {
      setLoading(true);
      setLoadError('');
      setMessage({ type: '', text: '' });
      const [examRes, allocRes, versionsRes] = await Promise.all([
        api.get(`/exams/${examId}`, { signal: controller.signal }),
        api.get(`/exams/${examId}/allocation`, { signal: controller.signal }).catch((e) => {
          if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') throw e;
          return { data: { success: false } };
        }),
        api.get(`/exams/${examId}/allocation/versions`, { signal: controller.signal }).catch((e) => {
          if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') throw e;
          return { data: { success: false } };
        }),
      ]);

      if (controller.signal.aborted) return;

      if (examRes.data?.success) setExam(examRes.data.data);
      if (allocRes.data?.success) {
        setAllocation(allocRes.data.data);
      } else {
        setAllocation(null);
      }
      if (versionsRes.data?.success) {
        setVersions(versionsRes.data.data);
      } else {
        setVersions([]);
      }
      setCurrentPage(1);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      setLoadError(formatApiError(err, 'Failed to load seating allocation details.'));
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchExams();
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort();
    };
  }, [fetchExams]);

  useEffect(() => {
    if (selectedExamId) {
      loadExamAndAllocation(selectedExamId);
    }
  }, [selectedExamId, loadExamAndAllocation]);

  // Actions
  const handleGenerate = async () => {
    if (actionLoading) return;
    if (!selectedExamId) {
      setMessage({ type: 'error', text: 'Please select an examination first.' });
      return;
    }
    try {
      setActionLoading('generate');
      setMessage({ type: '', text: '' });
      const res = await api.post(`/exams/${selectedExamId}/allocate`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setAllocation(res.data.data);
        setCurrentPage(1);
        setMessage({
          type: 'success',
          text: `Seating and question paper set allocation generated successfully (Version ${res.data.data.version})!`,
        });
        api
          .get(`/exams/${selectedExamId}/allocation/versions`)
          .then((vRes) => {
            if (vRes.data?.success) setVersions(vRes.data.data);
          })
          .catch(() => {});
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: formatApiError(err, 'Failed to generate seating allocation.'),
      });
    } finally {
      setActionLoading('');
    }
  };

  const handleVerify = async () => {
    if (actionLoading) return;
    if (!selectedExamId) {
      setMessage({ type: 'error', text: 'Please select an examination first.' });
      return;
    }
    try {
      setActionLoading('verify');
      const res = await api.post(`/exams/${selectedExamId}/verify`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setAllocation(res.data.data);
        setMessage({
          type: 'success',
          text: 'Allocation verified! All bench adjacency constraints satisfied with 0 violations.',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: formatApiError(err, 'Verification failed.') });
    } finally {
      setActionLoading('');
    }
  };

  const handleLock = async () => {
    if (actionLoading) return;
    if (!selectedExamId) {
      setMessage({ type: 'error', text: 'Please select an examination first.' });
      return;
    }
    try {
      setActionLoading('lock');
      const res = await api.post(`/exams/${selectedExamId}/lock`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setAllocation(res.data.data);
        setMessage({
          type: 'success',
          text: `Allocation Version ${res.data.data.version} is now LOCKED. No accidental modifications can be made.`,
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: formatApiError(err, 'Failed to lock allocation.') });
    } finally {
      setActionLoading('');
    }
  };

  const handlePublish = async () => {
    if (actionLoading) return;
    if (!selectedExamId) {
      setMessage({ type: 'error', text: 'Please select an examination first.' });
      return;
    }
    try {
      setActionLoading('publish');
      const res = await api.post(`/exams/${selectedExamId}/publish`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setAllocation(res.data.data);
        setMessage({
          type: 'success',
          text: `Allocation PUBLISHED! Students can now view their seat assignments 20 minutes before exam start.`,
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: formatApiError(err, 'Failed to publish allocation.') });
    } finally {
      setActionLoading('');
    }
  };

  const handleUnlock = async () => {
    if (actionLoading) return;
    if (!selectedExamId) {
      setMessage({ type: 'error', text: 'Please select an examination first.' });
      return;
    }
    const reason = prompt('Please enter the reason for unlocking this allocation:');
    if (!reason) return;

    try {
      setActionLoading('unlock');
      const res = await api.post(`/exams/${selectedExamId}/unlock`, { reason }, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setAllocation(res.data.data);
        setMessage({
          type: 'success',
          text: 'Allocation unlocked. You can now modify classroom or regenerate seating.',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: formatApiError(err, 'Failed to unlock.') });
    } finally {
      setActionLoading('');
    }
  };

  // Download helpers (uses shared downloadProtectedReport with PDF integrity verification & deferred URL revoke)
  const handleDownloadReport = async (type) => {
    if (!selectedExamId || downloadingReport === type) return;
    setDownloadingReport(type);
    setMessage({ type: '', text: '' });
    try {
      const ext = type === 'excel' ? 'xlsx' : 'pdf';
      const cleanSubject = (exam?.subjectCode || 'Exam').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fallbackFilename = `${type}_${cleanSubject}.${ext}`;
      const result = await downloadProtectedReport(
        `/exams/${selectedExamId}/reports/${type}`,
        fallbackFilename,
        'download',
        {
          timeout: API_TIMEOUTS.REPORT_EXPORT,
          onError: (errMsg) => setMessage({ type: 'error', text: errMsg }),
        }
      );
      if (result.success) {
        setMessage({
          type: 'success',
          text: `Downloaded "${result.filename || fallbackFilename}" successfully.`,
        });
      }
    } finally {
      setDownloadingReport('');
    }
  };

  // Memoized section & classroom summaries
  const sectionList = useMemo(() => {
    if (allocation?.sectionSummaries && allocation.sectionSummaries.length > 0) {
      return allocation.sectionSummaries;
    }
    if (exam?.sectionAllocations && exam.sectionAllocations.length > 0) {
      return exam.sectionAllocations.map((sa) => ({
        section: sa.section,
        facultyName: sa.facultyName || exam?.facultyName || 'CSE Faculty',
        studentCount:
          sa.studentCount ||
          (allocation?.students || []).filter((s) => s.section === sa.section).length,
        classroomsUsed: sa.classroomName ? [sa.classroomName] : ['ET BLOCK 3010'],
        status: sa.allocationStatus || 'GENERATED',
      }));
    }
    return Object.entries(
      (allocation?.students || []).reduce((acc, s) => {
        const sec = s.section || 'A1';
        if (!acc[sec]) {
          acc[sec] = {
            section: sec,
            facultyName: s.facultyName || exam?.facultyName || 'CSE Faculty',
            count: 0,
            rooms: new Set(),
          };
        }
        acc[sec].count++;
        if (s.classroomName) acc[sec].rooms.add(s.classroomName);
        return acc;
      }, {})
    ).map(([sec, data]) => ({
      section: sec,
      facultyName: data.facultyName,
      studentCount: data.count,
      classroomsUsed: Array.from(data.rooms),
      status: 'GENERATED',
    }));
  }, [allocation, exam]);

  const facultyBySectionMap = useMemo(() => {
    const map = {};
    sectionList.forEach((sec) => {
      if (sec.section) map[sec.section] = sec.facultyName;
    });
    return map;
  }, [sectionList]);

  const classroomList = useMemo(() => {
    if (allocation?.classroomSummaries && allocation.classroomSummaries.length > 0) {
      return allocation.classroomSummaries;
    }
    return Object.entries(
      (allocation?.students || []).reduce((acc, s) => {
        const room = s.classroomName || 'ET BLOCK 3010';
        if (!acc[room]) acc[room] = { classroomName: room, section: s.section || 'A1', allocated: 0 };
        acc[room].allocated++;
        return acc;
      }, {})
    ).map(([room, data]) => ({
      classroomName: room,
      section: data.section,
      allocatedStudents: data.allocated,
      capacity: 72,
      availableSeats: Math.max(0, 72 - data.allocated),
    }));
  }, [allocation]);

  const availableSections = useMemo(
    () => ['ALL', ...Array.from(new Set((allocation?.students || []).map((s) => s.section).filter(Boolean)))],
    [allocation]
  );
  const availableClassrooms = useMemo(
    () => ['ALL', ...Array.from(new Set((allocation?.students || []).map((s) => s.classroomName).filter(Boolean)))],
    [allocation]
  );

  // Set default visual room if not set or room switched on exam change
  useEffect(() => {
    if (classroomList.length > 0 && (!selectedVisualRoom || !classroomList.some((c) => c.classroomName === selectedVisualRoom))) {
      setSelectedVisualRoom(classroomList[0].classroomName);
    }
  }, [classroomList, selectedVisualRoom]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch, selectedSet, selectedRow, selectedBench, selectedSection, selectedClassroom]);

  // Memoized Filtered Students for Table View
  const filteredStudents = useMemo(() => {
    const studentsList = allocation?.students || [];
    const q = deferredSearch.trim().toLowerCase();
    return studentsList.filter((s) => {
      if (q) {
        const matchReg = (s.registrationNumber || '').toLowerCase().includes(q);
        const matchName = (s.name || '').toLowerCase().includes(q);
        if (!matchReg && !matchName) return false;
      }
      if (selectedSet !== 'ALL' && s.questionPaperSet !== selectedSet) return false;
      if (selectedRow !== 'ALL' && String(s.rowNumber) !== selectedRow) return false;
      if (selectedBench !== 'ALL' && String(s.benchNumber) !== selectedBench) return false;
      if (selectedSection !== 'ALL' && s.section !== selectedSection) return false;
      if (selectedClassroom !== 'ALL' && s.classroomName !== selectedClassroom) return false;
      return true;
    });
  }, [allocation, deferredSearch, selectedSet, selectedRow, selectedBench, selectedSection, selectedClassroom]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStartIdx = (safePage - 1) * pageSize;
  const paginatedStudents = useMemo(
    () => filteredStudents.slice(pageStartIdx, pageStartIdx + pageSize),
    [filteredStudents, pageStartIdx, pageSize]
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Exam Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-navy-800 tracking-tight">Seating & Question Paper Allocation</h1>
          <p className="text-xs text-slate-500 mt-1">
            Section-wise multi-classroom distribution with strictly enforced bench question paper set alternation (A, B, C)
          </p>
        </div>

        <div className="mt-3 sm:mt-0 flex items-center space-x-2">
          <label className="text-xs font-semibold text-navy-800">Exam:</label>
          <select
            value={selectedExamId}
            onChange={(e) => {
              setSelectedExamId(e.target.value);
              setSearchParams({ examId: e.target.value });
            }}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
          >
            {exams.map((ex) => (
              <option key={ex._id} value={ex._id}>
                {ex.subjectCode} — {ex.subjectName} ({ex.examDate})
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-3.5 rounded-lg text-xs flex items-center justify-between gap-3 border bg-red-50 text-red-700 border-red-200">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
            <span className="font-semibold">{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadExamAndAllocation(selectedExamId)}
            className="inline-flex items-center px-2.5 py-1 rounded bg-white border border-red-300 text-red-700 font-bold hover:bg-red-100 cursor-pointer"
          >
            <RefreshCw size={12} className="mr-1" />
            Retry
          </button>
        </div>
      )}

      {message.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-lg text-xs flex items-center justify-between gap-3 border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          <div className="flex items-center space-x-2">
            {message.type === 'success' ? (
              <CheckCircle2 size={16} className="mr-1 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle size={16} className="mr-1 text-red-600 flex-shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setMessage({ type: '', text: '' })}
            className="text-slate-400 hover:text-slate-700 font-bold px-1.5 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Allocation Metrics Banner */}
      {loading ? (
        <div className="bg-white p-10 rounded-xl border border-slate-200 shadow-sm text-center space-y-2">
          <RefreshCw size={28} className="animate-spin text-primary mx-auto" />
          <div className="text-xs font-semibold text-navy-800">Loading seating allocation from Atlas...</div>
          <div className="text-[11px] text-slate-400">Fetching room assignments and candidate set codes</div>
        </div>
      ) : allocation ? (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-navy-800">
                  Allocation Version {allocation.version}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    allocation.status === 'PUBLISHED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : allocation.status === 'LOCKED'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {allocation.status}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Seed: {allocation.randomSeed ? allocation.randomSeed.slice(0, 16) : '—'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {exam?.examType ? `${exam.examType} • ` : ''}{exam?.subjectName} ({exam?.subjectCode}) • {formatSessionLabel(exam?.session, exam?.startTime)} ({formatExamTimeRange(exam)}) • {sectionList.length} Section(s) ({sectionList.map((s) => s.section).join(', ')}) • {classroomList.length} Classroom(s)
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {allocation.status !== 'LOCKED' && allocation.status !== 'PUBLISHED' && (
                <>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={Boolean(actionLoading)}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-primary hover:bg-primary-hover shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Shuffle size={13} className="mr-1.5" />
                    {actionLoading === 'generate' ? 'Regenerating...' : 'Regenerate'}
                  </button>
                  <button
                    type="button"
                    onClick={handleVerify}
                    disabled={Boolean(actionLoading)}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <CheckCircle2 size={13} className="mr-1.5 text-emerald-600" />
                    {actionLoading === 'verify' ? 'Verifying...' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    onClick={handleLock}
                    disabled={Boolean(actionLoading)}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Lock size={13} className="mr-1.5" />
                    {actionLoading === 'lock' ? 'Locking...' : 'Lock Allocation'}
                  </button>
                </>
              )}

              {allocation.status === 'LOCKED' && (
                <>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={Boolean(actionLoading)}
                    className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Globe size={13} className="mr-1.5" />
                    {actionLoading === 'publish' ? 'Publishing...' : 'Publish to Student Portal'}
                  </button>
                  <button
                    type="button"
                    onClick={handleUnlock}
                    disabled={Boolean(actionLoading)}
                    className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Unlock size={13} className="mr-1.5" />
                    {actionLoading === 'unlock' ? 'Unlocking...' : 'Unlock'}
                  </button>
                </>
              )}

              {allocation.status === 'PUBLISHED' && (
                <button
                  onClick={handleUnlock}
                  disabled={actionLoading}
                  className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 transition-colors"
                >
                  <Unlock size={13} className="mr-1.5" />
                  Unpublish / Modify
                </button>
              )}
            </div>
          </div>

          {/* Overall Examination Summary: Total Students, Total Sections, Classrooms Used, Total Seats, Sets, Validation */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Total Unique Students</div>
              <div className="text-lg font-bold text-navy-800">{allocation.totalOccupiedSeats}</div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Total Sections</div>
              <div className="text-lg font-bold text-navy-800">{sectionList.length}</div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Classrooms Used</div>
              <div className="text-lg font-bold text-navy-800">{classroomList.length}</div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Total Available Seats</div>
              <div className="text-lg font-bold text-navy-800">{allocation.totalAvailableSeats}</div>
            </div>

            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-blue-700">Set A Count</div>
              <div className="text-lg font-bold text-blue-800">{allocation.setDistribution?.A || 0}</div>
            </div>

            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-emerald-700">Set B Count</div>
              <div className="text-lg font-bold text-emerald-800">{allocation.setDistribution?.B || 0}</div>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-center">
              <div className="text-[10px] uppercase font-semibold text-amber-700">Set C Count</div>
              <div className="text-lg font-bold text-amber-800">{allocation.setDistribution?.C || 0}</div>
            </div>
          </div>

          {/* Section-Wise and Classroom-Wise Allocation Summary Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            {/* Section-wise Allocation Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
              <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-navy-800 uppercase tracking-wider">
                  Section-Wise Allocation Breakdown
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {sectionList.length} Section(s)
                </span>
              </div>
              <div className="overflow-x-auto max-h-48">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Section</th>
                      <th className="py-2 px-3 font-semibold">Assigned Faculty</th>
                      <th className="py-2 px-3 font-semibold text-center">Students</th>
                      <th className="py-2 px-3 font-semibold">Classrooms Used</th>
                      <th className="py-2 px-3 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sectionList.map((sec) => (
                      <tr key={sec.section} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-bold text-navy-800">Section {sec.section}</td>
                        <td className="py-2 px-3 text-slate-700">{sec.facultyName || 'CSE Faculty'}</td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-navy-800">
                          {sec.studentCount}
                        </td>
                        <td className="py-2 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            {(sec.classroomsUsed || []).join(', ') || 'ET BLOCK 3010'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {sec.status || 'GENERATED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Classroom-wise Allocation Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
              <div className="bg-slate-50 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-navy-800 uppercase tracking-wider">
                  Classroom Distribution Breakdown
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {classroomList.length} Classroom(s)
                </span>
              </div>
              <div className="overflow-x-auto max-h-48">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Classroom</th>
                      <th className="py-2 px-3 font-semibold text-center">Section</th>
                      <th className="py-2 px-3 font-semibold text-center">Allocated Students</th>
                      <th className="py-2 px-3 font-semibold text-center">Capacity</th>
                      <th className="py-2 px-3 font-semibold text-center">Available Seats</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classroomList.map((cls, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-bold text-navy-800">{cls.classroomName}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded font-bold bg-slate-100 text-slate-700">
                            {cls.section}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700">
                          {cls.allocatedStudents}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-600">
                          {cls.capacity || 84}
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-blue-700">
                          {cls.availableSeats}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Quick PDF & Excel Download Bar */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
            <span className="text-xs text-slate-500 font-medium">Download Examination Documents:</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadReport('master-pdf')}
                disabled={downloadingReport === 'master-pdf'}
                className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 hover:border-primary text-navy-800 hover:text-primary bg-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <FileText size={13} className="mr-1 text-primary" />
                {downloadingReport === 'master-pdf' ? 'Downloading...' : 'Master Allocation PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReport('signature-pdf')}
                disabled={downloadingReport === 'signature-pdf'}
                className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 hover:border-primary text-navy-800 hover:text-primary bg-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <FileText size={13} className="mr-1 text-emerald-600" />
                {downloadingReport === 'signature-pdf' ? 'Downloading...' : 'Attendance Sheet PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReport('seating-pdf')}
                disabled={downloadingReport === 'seating-pdf'}
                className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 hover:border-primary text-navy-800 hover:text-primary bg-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <FileText size={13} className="mr-1 text-purple-600" />
                {downloadingReport === 'seating-pdf' ? 'Downloading...' : 'Seating Chart PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadReport('excel')}
                disabled={downloadingReport === 'excel'}
                className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 hover:border-emerald-600 text-navy-800 hover:text-emerald-700 bg-white shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <FileSpreadsheet size={13} className="mr-1 text-emerald-700" />
                {downloadingReport === 'excel' ? 'Downloading...' : 'Excel (.xlsx)'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm text-center">
          <Shuffle size={36} className="mx-auto text-primary/60 mb-2" />
          <h2 className="text-sm font-bold text-navy-800">No seating allocation generated.</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Click below to generate section-wise randomized seating for {exam?.studentCount || 0} students across available ET BLOCK classrooms and assign balanced Set A, B, and C question papers with strict bench alternation.
          </p>
          <button
            onClick={handleGenerate}
            disabled={actionLoading || !selectedExamId || exams.length === 0}
            className="mt-4 inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg text-white bg-primary hover:bg-primary-hover shadow-sm disabled:opacity-50 transition-colors"
          >
            <Shuffle size={14} className="mr-1.5" />
            {actionLoading ? 'Generating Allocation...' : `Generate Section-Wise Seating Allocation`}
          </button>
        </div>
      )}

      {/* Main Allocation Views (Table vs Visual) */}
      {allocation && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* View Switcher & Table Filters */}
          <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  viewMode === 'table'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <TableIcon size={14} className="mr-1.5" />
                Student-Wise Table
              </button>
              <button
                onClick={() => setViewMode('visual')}
                className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  viewMode === 'visual'
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <LayoutGrid size={14} className="mr-1.5" />
                Classroom Visual View
              </button>
            </div>

            {viewMode === 'table' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search roll no or name..."
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary w-36 sm:w-48"
                  />
                </div>

                {/* Section filter */}
                <select
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                >
                  <option value="ALL">All Sections</option>
                  {availableSections.filter((s) => s !== 'ALL').map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))}
                </select>

                {/* Classroom filter */}
                <select
                  value={selectedClassroom}
                  onChange={(e) => setSelectedClassroom(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                >
                  <option value="ALL">All Classrooms</option>
                  {availableClassrooms.filter((c) => c !== 'ALL').map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>

                {/* Set filter */}
                <select
                  value={selectedSet}
                  onChange={(e) => setSelectedSet(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                >
                  <option value="ALL">All Sets</option>
                  <option value="A">Set A</option>
                  <option value="B">Set B</option>
                  <option value="C">Set C</option>
                </select>

                {/* Row filter */}
                <select
                  value={selectedRow}
                  onChange={(e) => setSelectedRow(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                >
                  <option value="ALL">All Rows</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((r) => (
                    <option key={r} value={String(r)}>
                      Row {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {viewMode === 'visual' && (
              <div className="flex items-center space-x-2">
                <label className="text-xs font-semibold text-navy-800">Viewing Room:</label>
                <select
                  value={selectedVisualRoom}
                  onChange={(e) => setSelectedVisualRoom(e.target.value)}
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white font-medium text-navy-800"
                >
                  {classroomList.map((c) => (
                    <option key={c.classroomName} value={c.classroomName}>
                      {c.classroomName} ({c.section})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* VIEW A: Student-Wise Table View */}
          {viewMode === 'table' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold w-10 text-center">S.No</th>
                    <th className="py-2.5 px-3 font-semibold">Registration Number</th>
                    <th className="py-2.5 px-3 font-semibold">Student Name</th>
                    <th className="py-2.5 px-3 font-semibold">Subject</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Academic Section</th>
                    <th className="py-2.5 px-3 font-semibold">Assigned Faculty</th>
                    <th className="py-2.5 px-3 font-semibold">Classroom</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Row</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Chair Number</th>
                    <th className="py-2.5 px-3 font-semibold">Seat ID</th>
                    <th className="py-2.5 px-3 font-semibold text-center">QP Set</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedStudents.map((s, idx) => (
                    <AllocationStudentRow
                      key={s.registrationNumber || s.seatId || `${pageStartIdx}-${idx}`}
                      s={s}
                      indexOffset={pageStartIdx}
                      idx={idx}
                      fallbackSubjectCode={exam?.subjectCode}
                      fallbackFacultyName={facultyBySectionMap[s.section] || exam?.facultyName}
                    />
                  ))}
                </tbody>
              </table>
              {filteredStudents.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  No students found matching the selected filters.
                </div>
              ) : (
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                  <div className="text-slate-600">
                    Showing <strong className="text-navy-800">{pageStartIdx + 1}</strong>–
                    <strong className="text-navy-800">{Math.min(pageStartIdx + pageSize, filteredStudents.length)}</strong> of{' '}
                    <strong className="text-navy-800">{filteredStudents.length}</strong> allocated candidates
                  </div>
                  <div className="flex items-center space-x-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                      aria-label="Rows per page"
                    >
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="inline-flex items-center px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft size={13} className="mr-0.5" />
                      Prev
                    </button>
                    <span className="font-semibold text-navy-800 px-1">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="inline-flex items-center px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                    >
                      Next
                      <ChevronRight size={13} className="ml-0.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW B: Classroom Visual Blueprint */}
          {viewMode === 'visual' && (
            <div className="p-6 space-y-6">
              {/* Podium Indicator */}
              <div className="w-full py-2 bg-navy-800 text-white text-center rounded-lg text-xs font-semibold tracking-wider uppercase">
                {selectedVisualRoom || 'CLASSROOM'} — BLACKBOARD / INSTRUCTOR STAGE (FRONT)
              </div>

              {/* Dynamic Rows in Selected Room */}
              {(() => {
                const roomStudents = (allocation.students || []).filter(
                  (s) => !selectedVisualRoom || s.classroomName === selectedVisualRoom
                );
                const distinctRows = Array.from(new Set(roomStudents.map((s) => s.rowNumber))).sort((a, b) => a - b);
                const rowsToRender = distinctRows.length > 0 ? distinctRows : [1, 2, 3];

                return rowsToRender.map((rowNum) => {
                  const rowStudents = roomStudents.filter((s) => s.rowNumber === rowNum);
                  const benchGroups = {};
                  rowStudents.forEach((s) => {
                    if (!benchGroups[s.benchNumber]) benchGroups[s.benchNumber] = [];
                    benchGroups[s.benchNumber].push(s);
                  });

                  const distinctBenches = Array.from(new Set(rowStudents.map((s) => s.benchNumber))).sort((a, b) => a - b);
                  const benchesToRender = distinctBenches.length > 0 ? distinctBenches : [1, 2, 3, 4, 5, 6];

                  return (
                    <div key={rowNum} className="space-y-2">
                      <div className="text-xs font-bold text-navy-800 uppercase tracking-wider">
                        Row {rowNum}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {benchesToRender.map((benchNum) => {
                          const benchSeats = (benchGroups[benchNum] || []).sort(
                            (a, b) => a.seatNumber - b.seatNumber
                          );

                          return (
                            <div
                              key={benchNum}
                              className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                            >
                              <div className="text-[10px] font-bold uppercase text-slate-500">
                                Bench {benchNum}
                              </div>

                              <div className="flex flex-wrap gap-1.5">
                                {benchSeats.map((seat) => (
                                  <div
                                    key={seat.seatId}
                                    className={`flex-1 min-w-[50px] p-1.5 rounded border text-center ${
                                      seat.questionPaperSet === 'A'
                                        ? 'bg-blue-50 border-blue-300 text-blue-900'
                                        : seat.questionPaperSet === 'B'
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                        : 'bg-amber-50 border-amber-300 text-amber-900'
                                    }`}
                                  >
                                    <div className="text-[10px] font-mono font-bold truncate">
                                      {seat.registrationNumber.slice(-4)}
                                    </div>
                                    <div
                                      className={`text-[10px] font-bold mt-0.5 rounded px-1 ${
                                        seat.questionPaperSet === 'A'
                                          ? 'bg-blue-600 text-white'
                                          : seat.questionPaperSet === 'B'
                                          ? 'bg-emerald-600 text-white'
                                          : 'bg-amber-600 text-white'
                                      }`}
                                    >
                                      Set {seat.questionPaperSet}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Visual Legend */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center space-x-6 text-xs font-semibold">
                <span className="flex items-center">
                  <span className="w-3.5 h-3.5 rounded bg-blue-600 inline-block mr-1.5"></span>
                  Set A (Blue)
                </span>
                <span className="flex items-center">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-600 inline-block mr-1.5"></span>
                  Set B (Green)
                </span>
                <span className="flex items-center">
                  <span className="w-3.5 h-3.5 rounded bg-amber-600 inline-block mr-1.5"></span>
                  Set C (Amber)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Allocations;
