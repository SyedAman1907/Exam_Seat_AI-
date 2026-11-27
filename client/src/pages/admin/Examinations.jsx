import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import {
  Calendar,
  PlusCircle,
  Search,
  CheckCircle2,
  Trash2,
  Users,
  FileSpreadsheet,
  AlertCircle,
  X,
  Layers,
  BookOpen,
  Sparkles,
  Clock,
  RotateCcw,
  Check,
  AlertTriangle,
  FileDown,
  UserCheck,
  Building2,
  ChevronDown,
  ChevronUp,
  Eye,
  Archive,
  Info,
  Ban,
  Edit3,
} from 'lucide-react';
import { downloadProtectedReport } from '../../utils/fileDownloader';
import {
  getTodayKolkataIso,
  computeVisibilityWindowLabel,
  formatTime12h,
  formatExamTimeRange,
  validateExamTimeRange,
  normalizeSessionCode,
  formatSessionLabel,
  toMinutesFromMidnight,
} from '../../utils/dateTime';
import {
  EXAM_TYPE_OPTIONS,
  buildDefaultExamTitle,
  resolveExamType,
} from '../../utils/examType';
import TimeSelect12h from '../../components/TimeSelect12h';

const Examinations = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isExamIncharge = user?.role === 'exam_incharge' || user?.role === 'incharge' || isAdmin;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [exams, setExams] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formError, setFormError] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  // Expanded examination row for viewing child section allocations
  const [expandedExamId, setExpandedExamId] = useState(null);

  // Section selection checkboxes state per exam ID: { [examId]: ['A1', 'A2', ...] }
  const [selectedSectionsByExam, setSelectedSectionsByExam] = useState({});
  const [downloadingZipId, setDownloadingZipId] = useState(null);
  const [downloadingPdfsId, setDownloadingPdfsId] = useState(null);

  const getSelectedSections = (exam) => {
    const allSections = (exam.sectionAllocations || []).map((s) => s.section);
    return selectedSectionsByExam[exam._id] !== undefined
      ? selectedSectionsByExam[exam._id]
      : allSections;
  };

  const handleSelectAllSections = (exam) => {
    const allSections = (exam.sectionAllocations || []).map((s) => s.section);
    setSelectedSectionsByExam((prev) => ({ ...prev, [exam._id]: allSections }));
  };

  const handleDeselectAllSections = (exam) => {
    setSelectedSectionsByExam((prev) => ({ ...prev, [exam._id]: [] }));
  };

  const handleToggleSection = (examId, allSections, section) => {
    setSelectedSectionsByExam((prev) => {
      const current = prev[examId] !== undefined ? prev[examId] : allSections;
      const next = current.includes(section)
        ? current.filter((s) => s !== section)
        : [...current, section];
      return { ...prev, [examId]: next };
    });
  };

  const handleGenerateSelectedPdfs = async (exam) => {
    const selected = getSelectedSections(exam);
    if (selected.length === 0) {
      setActionError('Please select at least one section to generate attendance PDFs.');
      return;
    }
    setActionError('');
    setDownloadingPdfsId(exam._id);
    try {
      for (const sec of selected) {
        await downloadProtectedReport(
          `/reports/${exam._id}/section-attendance-pdf/${sec}`,
          `Attendance_${sec}.pdf`,
          'download',
          { onError: (msg) => setActionError(msg) }
        );
        // Short interval to allow browser to handle multiple downloads cleanly
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setDownloadingPdfsId(null);
    }
  };

  const handleDownloadSelectedZip = async (exam) => {
    const selected = getSelectedSections(exam);
    if (selected.length === 0) {
      setActionError('Please select at least one section to download ZIP archive.');
      return;
    }
    if (downloadingZipId === exam._id) return;
    setActionError('');
    setDownloadingZipId(exam._id);
    try {
      await downloadProtectedReport(
        `/reports/${exam._id}/attendance-zip?sections=${selected.join(',')}`,
        `Attendance_Sheets_${exam.subjectCode || 'Exam'}.zip`,
        'download',
        { onError: (msg) => setActionError(msg) }
      );
    } finally {
      setDownloadingZipId(null);
    }
  };

  // Dashboard Filter Tabs: 'all' | 'upcoming' | 'pending' | 'today' | 'approved' | 'scheduled' | 'published' | 'completed' | 'draft' | 'cancelled'
  const [activeTab, setActiveTab] = useState('all');
  const [selectedGroupView, setSelectedGroupView] = useState('ALL'); // 'ALL' | 'Group A' | 'Group B'
  const [filterAcademicYear, setFilterAcademicYear] = useState('ALL');
  const [filterSemester, setFilterSemester] = useState('ALL');
  const [filterExamType, setFilterExamType] = useState('ALL');
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [fetchError, setFetchError] = useState('');
  const [detailExam, setDetailExam] = useState(null);

  // Modal: Inspect a section's roster before creation
  const [inspectingRoster, setInspectingRoster] = useState(null);
  const [inspectSearchTerm, setInspectSearchTerm] = useState('');

  // Available subjects loaded from database permanent mappings
  const [availableSubjects, setAvailableSubjects] = useState([]);

  // Centralized Mapping Resolution State
  const [resolvingMappings, setResolvingMappings] = useState(false);
  const [resolvedMappings, setResolvedMappings] = useState([]);
  const [resolutionSummary, setResolutionSummary] = useState(null);
  const [resolutionError, setResolutionError] = useState('');

  // Centralized Examination Form State (Create + Admin Edit)
  const [editingExam, setEditingExam] = useState(null);
  const [selectedSections, setSelectedSections] = useState([]);
  const [classroomOverrides, setClassroomOverrides] = useState({});
  const [confirmControlledCorrection, setConfirmControlledCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [availabilityCheck, setAvailabilityCheck] = useState({
    loading: false,
    available: true,
    conflicts: [],
  });

  // Delete, Cancel, Approve & Reject Confirmation Modals
  const [actionError, setActionError] = useState('');
  const [loadingEditDetails, setLoadingEditDetails] = useState(false);
  const [deleteModalExam, setDeleteModalExam] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelModalExam, setCancelModalExam] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [publishModalExam, setPublishModalExam] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [rejectModalExam, setRejectModalExam] = useState(null);
  const [rejectReason, setRejectReason] = useState('Needs correction in seating or mappings.');
  const [rejecting, setRejecting] = useState(false);

  const resolveAbortRef = useRef(null);
  const resolveSeqRef = useRef(0);
  const availAbortRef = useRef(null);
  const fetchExamsAbortRef = useRef(null);
  const fetchExamsSeqRef = useRef(0);
  const skipNextTabEffectRef = useRef(false);
  const submitLockRef = useRef(false);
  const lastCreatedExamRef = useRef({ signature: '', examId: '', createdAt: 0 });
  const deleteLockRef = useRef(false);
  const titleManuallyEditedRef = useRef(false);
  const [downloadingKey, setDownloadingKey] = useState('');

  const [formData, setFormData] = useState({
    academicYear: '2026-2027',
    year: 'III Year',
    semester: 'I Semester',
    subjectName: 'Automata Theory and Compiler Design',
    subjectCode: '20A05501T',
    examType: 'UNIT 1',
    examName: buildDefaultExamTitle({ year: 'III Year', semester: 'I Semester', examType: 'UNIT 1' }),
    examDate: getTodayKolkataIso(),
    startTime: '09:00 AM',
    endTime: '12:00 PM',
    session: 'AM',
    group: 'Group A',
    allowOvernight: false,
  });

  const isEditingPublishedOrLocked = Boolean(
    editingExam &&
    (['PUBLISHED', 'LOCKED', 'ONGOING'].includes(editingExam.status) ||
      editingExam.visibilityStatus === 'PUBLISHED')
  );

  const academicYearsList = ['2026-2027', '2025-2026', '2024-2025'];
  const yearsList = [
    { value: 'II Year', label: '2nd Year (II Year)' },
    { value: 'III Year', label: '3rd Year (III Year)' },
    { value: 'IV Year', label: '4th Year (IV Year)' },
  ];
  const semestersList = [
    { value: 'I Semester', label: '1st Semester (I Sem)' },
    { value: 'II Semester', label: '2nd Semester (II Sem)' },
  ];

  // Common subjects preset for quick selection
  const quickSubjectPresets = [
    { name: 'Automata Theory and Compiler Design', code: '20A05501T', year: 'III Year', semester: 'I Semester' },
    { name: 'Computer Networks and Internet Protocols', code: '20A05502T', year: 'III Year', semester: 'I Semester' },
    { name: 'Full Stack Development', code: '20A05503T', year: 'III Year', semester: 'I Semester' },
    { name: 'Artificial Intelligence', code: '20A05502S', year: 'III Year', semester: 'I Semester' },
    { name: 'Object Oriented Analysis and Design', code: '20A05504T', year: 'III Year', semester: 'I Semester' },
    { name: 'Operating Systems', code: '20A05402T', year: 'II Year', semester: 'II Semester' },
  ];

  useEffect(() => {
    fetchClassrooms();
    fetchDistinctMappedSubjects();
  }, []);

  useEffect(() => {
    if (skipNextTabEffectRef.current) {
      skipNextTabEffectRef.current = false;
      return;
    }
    fetchExams();
  }, [activeTab, filterAcademicYear, filterSemester, filterExamType]);

  useEffect(() => {
    const newParam = searchParams.get('new');
    const createParam = searchParams.get('create');
    const editParam = searchParams.get('edit');

    if (newParam === 'true' || createParam === 'centralized') {
      openCreateModal({
        fromUrl: true,
        prefillDate: searchParams.get('date'),
        prefillSession: searchParams.get('session'),
      });
    } else if (editParam) {
      openEditExamById(editParam);
    } else {
      setShowCreateModal(false);
      setEditingExam(null);
    }
  }, [searchParams]);

  // Live Classroom Conflict Detection in Create / Edit Modal
  useEffect(() => {
    if (!showCreateModal || !formData.examDate || !formData.startTime || !formData.endTime) {
      return;
    }
    const timeCheck = validateExamTimeRange(formData.startTime, formData.endTime, {
      session: formData.session,
      allowOvernight: formData.allowOvernight,
    });
    if (!timeCheck.valid) {
      setAvailabilityCheck({ loading: false, available: false, conflicts: [], timeError: timeCheck.message });
      return;
    }

    const timer = setTimeout(async () => {
      if (availAbortRef.current) {
        availAbortRef.current.abort();
      }
      const controller = new AbortController();
      availAbortRef.current = controller;

      try {
        setAvailabilityCheck((prev) => ({ ...prev, loading: true, timeError: '' }));
        const activeSecs = resolvedMappings
          .filter((m) => selectedSections.includes(m.section))
          .map((m) => m.section);

        const res = await api.post(
          '/exams/check-availability',
          {
            examDate: formData.examDate,
            startTime: formData.startTime,
            endTime: formData.endTime,
            session: formData.session,
            group: formData.group,
            allowOvernight: Boolean(formData.allowOvernight),
            selectedSections: activeSecs.length > 0 ? activeSecs : selectedSections,
            classroomOverrides,
            excludeExamId: editingExam?._id || null,
          },
          { signal: controller.signal }
        );
        if (res.data?.success) {
          setAvailabilityCheck({
            loading: false,
            available: res.data.available,
            conflicts: res.data.conflicts || [],
            timeError: '',
          });
        }
      } catch (e) {
        if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') return;
        console.warn('[Examinations] Live availability check error:', e?.message || e);
        setAvailabilityCheck((prev) => ({
          ...prev,
          loading: false,
          availabilityError: e.response?.data?.message || '',
        }));
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      if (availAbortRef.current) {
        availAbortRef.current.abort();
      }
    };
  }, [
    showCreateModal,
    formData.examDate,
    formData.startTime,
    formData.endTime,
    formData.session,
    formData.group,
    formData.allowOvernight,
    selectedSections,
    resolvedMappings,
    classroomOverrides,
    editingExam,
  ]);

  // Trigger Automatic Faculty & Student Mapping Resolution when subject, year, semester, or group changes
  useEffect(() => {
    if (showCreateModal && (formData.subjectName || formData.subjectCode)) {
      setResolvingMappings(true);
      setResolvedMappings([]);
      setResolutionSummary(null);
      setResolutionError('');

      const timer = setTimeout(() => {
        resolveMappings(
          formData.subjectName,
          formData.subjectCode,
          formData.academicYear,
          formData.year,
          formData.semester,
          formData.group
        );
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [formData.subjectName, formData.subjectCode, formData.academicYear, formData.year, formData.semester, formData.group, showCreateModal]);

  const fetchExams = async (overrideTab = null, { preserveOnFailure = false, background = false } = {}) => {
    if (fetchExamsAbortRef.current) {
      fetchExamsAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchExamsAbortRef.current = controller;
    const seq = ++fetchExamsSeqRef.current;

    try {
      if (!preserveOnFailure && !background) {
        setLoading(true);
        setFetchError('');
      }
      if (!background) {
        setRefreshWarning('');
      }
      const tabToQuery = overrideTab || activeTab;
      const params = new URLSearchParams();
      params.append('filter', tabToQuery);
      if (filterAcademicYear !== 'ALL') params.append('academicYear', filterAcademicYear);
      if (filterSemester !== 'ALL') params.append('semester', filterSemester);
      if (filterExamType !== 'ALL') params.append('examType', filterExamType);

      const res = await api.get(`/exams?${params.toString()}`, { signal: controller.signal });
      if (seq !== fetchExamsSeqRef.current) return true;

      if (res?.data?.success && Array.isArray(res.data.data)) {
        setExams(res.data.data);
        if (typeof res.data.counts?.pendingReview === 'number') {
          setPendingReviewCount(res.data.counts.pendingReview);
        }
        setFetchError('');
        setRefreshWarning('');
        return true;
      }

      const msg = res?.data?.message || 'Unable to retrieve examinations from database.';
      if (preserveOnFailure) {
        setRefreshWarning(`Examination changes were saved, but refreshing the list failed: ${msg}`);
      } else {
        setFetchError(msg);
      }
      return false;
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return true;
      }
      if (seq !== fetchExamsSeqRef.current) return true;
      console.error('Failed to load examinations:', err);
      const errMsg = formatApiError(err, 'Failed to load examinations from server.');
      if (preserveOnFailure) {
        setRefreshWarning(
          `Examination was saved to MongoDB, but refreshing the examination list failed (${errMsg}). Click Retry Refresh to reload.`
        );
      } else {
        setFetchError(errMsg);
      }
      return false;
    } finally {
      if (seq === fetchExamsSeqRef.current && !preserveOnFailure && !background) {
        setLoading(false);
      }
    }
  };

  const fetchClassrooms = async () => {
    try {
      const res = await api.get('/classrooms');
      if (res.data.success) {
        setClassrooms(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load classrooms:', err);
    }
  };

  const fetchDistinctMappedSubjects = async () => {
    try {
      const [subRes, mapRes] = await Promise.all([
        api.get('/subjects').catch(() => ({ data: { success: false, data: [] } })),
        api.get('/mappings').catch(() => ({ data: { success: false, mappings: [] } })),
      ]);

      const merged = [];
      const seen = new Set();

      const addSubjectItem = (item) => {
        const code = String(item.subjectCode || '').trim().toUpperCase();
        const name = String(item.subjectName || '').trim();
        const key = code || name.toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push({
          subjectName: name || code,
          subjectCode: code || key,
          abbreviation: item.abbreviation || (name ? name.slice(0, 6).toUpperCase() : code),
          year: item.year || 'III Year',
          semester: item.semester || 'I Semester',
          academicYear: item.academicYear || '2026-2027',
        });
      };

      (subRes.data?.data || []).forEach(addSubjectItem);
      (mapRes.data?.mappings || []).forEach(addSubjectItem);

      merged.sort((a, b) => a.subjectName.localeCompare(b.subjectName));
      setAvailableSubjects(merged);
    } catch (err) {
      console.error('Failed to load distinct mapped subjects:', err);
    }
  };

  // Centralized Automatic Mapping Resolution (with AbortController & sequence guard against stale responses)
  const resolveMappings = async (subName, subCode, acadYear, yr, sem, grp) => {
    if (resolveAbortRef.current) {
      resolveAbortRef.current.abort();
    }
    const controller = new AbortController();
    resolveAbortRef.current = controller;
    const seq = ++resolveSeqRef.current;

    try {
      setResolvingMappings(true);
      setResolutionError('');

      const params = new URLSearchParams();
      if (subCode) params.append('subjectCode', subCode.trim());
      if (subName) params.append('subjectName', subName.trim());
      if (acadYear) params.append('academicYear', acadYear);
      if (yr) params.append('year', yr);
      if (sem) params.append('semester', sem);
      if (grp) params.append('group', grp);

      const res = await api.get(`/exams/resolve-mappings?${params.toString()}`, {
        signal: controller.signal,
      });

      if (seq !== resolveSeqRef.current) return;

      if (res.data.success && res.data.mappings && res.data.mappings.length > 0) {
        setResolvedMappings(res.data.mappings);
        setResolutionSummary(res.data.summary);
        const availableSecNames = res.data.mappings.map((m) => m.section);
        setSelectedSections((prev) => {
          if (editingExam && prev.length > 0) {
            const retained = prev.filter((s) => availableSecNames.includes(s));
            return retained.length > 0 ? retained : availableSecNames;
          }
          return availableSecNames;
        });
        if (res.data.subjectCode && !formData.subjectCode) {
          setFormData((prev) => ({ ...prev, subjectCode: res.data.subjectCode }));
        }
      } else {
        setResolvedMappings([]);
        setSelectedSections([]);
        setResolutionSummary(null);
        setResolutionError(
          res.data.message ||
          `No active permanent faculty-student mappings found for ${subName || subCode}. Please ensure student rosters are assigned under Faculty & Student Assignment.`
        );
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      if (seq !== resolveSeqRef.current) return;
      console.error('Mapping resolution error:', err);
      setResolvedMappings([]);
      setSelectedSections([]);
      setResolutionSummary(null);
      setResolutionError(
        formatApiError(err, 'Failed to resolve permanent faculty-student mappings.')
      );
    } finally {
      if (seq === resolveSeqRef.current) {
        setResolvingMappings(false);
      }
    }
  };

  const handleSelectQuickPreset = (preset) => {
    setFormData((prev) => {
      const nextYear = preset.year || prev.year;
      const nextSem = preset.semester || prev.semester;
      return {
        ...prev,
        subjectName: preset.name,
        subjectCode: preset.code,
        year: nextYear,
        semester: nextSem,
        ...(!editingExam && !titleManuallyEditedRef.current
          ? { examName: buildDefaultExamTitle({ year: nextYear, semester: nextSem, examType: prev.examType }) }
          : {}),
      };
    });
  };

  const applyExamToEditForm = (exam) => {
    setEditingExam(exam);
    titleManuallyEditedRef.current = true;
    setFormError('');
    setConfirmControlledCorrection(false);
    setCorrectionReason('');

    const existingSections = (exam.sectionAllocations || []).map((sa) => sa.section).filter(Boolean);
    const overrides = {};
    (exam.sectionAllocations || []).forEach((sa) => {
      if (sa.section && sa.classroomId) {
        overrides[sa.section] = typeof sa.classroomId === 'object' ? sa.classroomId._id : sa.classroomId;
      }
    });
    setSelectedSections(existingSections);
    setClassroomOverrides(overrides);

    setFormData({
      academicYear: exam.academicYear || '2026-2027',
      year: exam.year || 'III Year',
      semester: exam.semester || 'I Semester',
      subjectName: exam.subjectName || '',
      subjectCode: exam.subjectCode || '',
      examType: resolveExamType(exam),
      examName: exam.examName || '',
      examDate: exam.examDate || getTodayKolkataIso(),
      startTime: formatTime12h(exam.startTime, '09:00 AM'),
      endTime: formatTime12h(exam.endTime, '12:00 PM'),
      session: normalizeSessionCode(exam.session, 'AM'),
      group: exam.group || 'Group A',
      allowOvernight: Boolean(exam.allowOvernight),
    });
    setShowCreateModal(true);
  };

  const openEditExamById = async (examId) => {
    if (!examId) return;
    const cached = exams.find((e) => String(e._id) === String(examId));
    if (cached) {
      applyExamToEditForm(cached);
    } else {
      setShowCreateModal(true);
    }
    try {
      setLoadingEditDetails(true);
      const res = await api.get(`/exams/${examId}`);
      if (res.data?.success && res.data?.data?._id) {
        applyExamToEditForm(res.data.data);
      } else {
        setFormError(res.data?.message || 'Unable to load latest examination details from MongoDB.');
      }
    } catch (err) {
      setFormError(formatApiError(err, 'Failed to fetch latest examination details from MongoDB.'));
    } finally {
      setLoadingEditDetails(false);
    }
  };

  const closeExamModal = () => {
    setShowCreateModal(false);
    setEditingExam(null);
    setFormError('');
    if (
      searchParams.get('new') ||
      searchParams.get('create') ||
      searchParams.get('edit') ||
      searchParams.get('date')
    ) {
      setSearchParams({});
    }
  };

  const openCreateModal = (opts = {}) => {
    const { fromUrl = false, prefillDate = '', prefillSession = '' } = opts || {};
    setEditingExam(null);
    titleManuallyEditedRef.current = false;
    setFormError('');
    setClassroomOverrides({});
    setSelectedSections([]);
    setConfirmControlledCorrection(false);
    setCorrectionReason('');

    const sess = prefillSession ? normalizeSessionCode(prefillSession, 'AM') : 'AM';
    const isAfternoon = sess === 'PM' || sess === 'AN';
    const defSubject = availableSubjects[0];
    const defYear = defSubject?.year || 'III Year';
    const defSem = defSubject?.semester || 'I Semester';
    const defType = 'UNIT 1';
    setFormData({
      academicYear: '2026-2027',
      year: defYear,
      semester: defSem,
      subjectName: defSubject?.subjectName || 'Automata Theory and Compiler Design',
      subjectCode: defSubject?.subjectCode || '20A05501T',
      examType: defType,
      examName: buildDefaultExamTitle({ year: defYear, semester: defSem, examType: defType }),
      examDate: prefillDate || getTodayKolkataIso(),
      startTime: isAfternoon ? '02:00 PM' : '09:00 AM',
      endTime: isAfternoon ? '05:00 PM' : '12:00 PM',
      session: sess,
      group: 'Group A',
      allowOvernight: false,
    });
    setShowCreateModal(true);

    if (!fromUrl && searchParams.get('new') !== 'true') {
      setSearchParams({ new: 'true' });
    }
  };

  const openEditModal = (exam) => {
    if (!exam?._id) return;
    applyExamToEditForm(exam);
    if (searchParams.get('edit') !== String(exam._id)) {
      setSearchParams({ edit: exam._id });
    }
  };

  const handleSessionChange = (sess) => {
    const normSess = normalizeSessionCode(sess, 'AM');
    const isPM = normSess === 'PM';
    setFormData((prev) => {
      const startMins = toMinutesFromMidnight(prev.startTime || (isPM ? '09:00 AM' : '02:00 PM'));
      const endMins = toMinutesFromMidnight(prev.endTime || (isPM ? '12:00 PM' : '05:00 PM'));
      const startIsAfternoon = startMins >= 12 * 60;
      const endIsAfternoon = endMins >= 12 * 60;
      const needsDefaultForSession = isPM
        ? !startIsAfternoon || (!prev.allowOvernight && !endIsAfternoon)
        : startIsAfternoon;

      return {
        ...prev,
        session: normSess,
        ...(needsDefaultForSession
          ? {
            startTime: isPM ? '02:00 PM' : '09:00 AM',
            endTime: isPM ? '05:00 PM' : '12:00 PM',
          }
          : {}),
      };
    });
  };

  const handleToggleFormSection = (secName) => {
    setSelectedSections((prev) =>
      prev.includes(secName) ? prev.filter((s) => s !== secName) : [...prev, secName]
    );
  };

  const handleCreateOrUpdateCentralizedExam = async (e) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;
    setFormError('');

    if (!formData.subjectName || !formData.subjectCode) {
      setFormError('Subject Name and Subject Code are required.');
      return;
    }

    const timeCheck = validateExamTimeRange(formData.startTime, formData.endTime, {
      session: formData.session,
      allowOvernight: formData.allowOvernight,
    });
    if (!timeCheck.valid) {
      setFormError(timeCheck.message);
      return;
    }

    const activeMappings = resolvedMappings.filter((m) => selectedSections.includes(m.section));

    if (!editingExam && activeMappings.length === 0) {
      setFormError(
        'Cannot create examination: please select at least one permanent faculty-student section mapping.'
      );
      return;
    }

    if (editingExam && resolvedMappings.length > 0 && activeMappings.length === 0) {
      setFormError('Please select at least one section (A1–A6) for this examination.');
      return;
    }

    if (isEditingPublishedOrLocked) {
      if (!confirmControlledCorrection) {
        setFormError('Please check the Administrator Controlled Correction confirmation checkbox before saving.');
        return;
      }
      if (!correctionReason.trim()) {
        setFormError('Please enter a formal audit reason for editing a published/locked examination.');
        return;
      }
    }

    let savedExam = null;
    let savedMode = editingExam ? 'update' : 'create';
    let targetTab = activeTab === 'pending' ? 'pending' : 'all';

    const payload = {
      ...formData,
      startTime: timeCheck.startTime,
      endTime: timeCheck.endTime,
      allowOvernight: Boolean(formData.allowOvernight),
      selectedSections: activeMappings.map((m) => m.section),
      selectedMappingIds: activeMappings.map((m) => m.mappingId || m.id),
      classroomOverrides,
    };

    const creationSignature = !editingExam
      ? JSON.stringify({
          subjectCode: String(payload.subjectCode || '').trim().toUpperCase(),
          examDate: payload.examDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          group: payload.group,
          sections: payload.selectedSections,
        })
      : '';

    if (
      !editingExam &&
      creationSignature &&
      lastCreatedExamRef.current.signature === creationSignature &&
      Date.now() - lastCreatedExamRef.current.createdAt < 15000
    ) {
      setFormError(
        'This centralized examination was just created. Closing and refreshing instead of creating a duplicate.'
      );
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      if (editingExam) {
        if (isEditingPublishedOrLocked) {
          payload.confirmControlledCorrection = true;
          payload.correctionReason = correctionReason.trim();
        }
        const res = await api.put(`/exams/${editingExam._id}`, payload, {
          timeout: API_TIMEOUTS.HEAVY_WRITE,
        });
        if (res?.data?.success && res.data.data?._id) {
          savedExam = res.data.data;
          closeExamModal();
          setFetchError('');
          setRefreshWarning('');
          setSuccessBanner(res.data.message || `Examination "${savedExam.examName}" updated cleanly.`);
          setExams((prev) =>
            prev.map((ex) => (String(ex._id) === String(savedExam._id) ? savedExam : ex))
          );
          if (detailExam && detailExam._id === savedExam._id) {
            setDetailExam(savedExam);
          }
        } else {
          setFormError(res?.data?.message || 'Examination update could not be confirmed by MongoDB.');
        }
      } else {
        const res = await api.post('/exams/create-centralized', payload, {
          timeout: API_TIMEOUTS.HEAVY_WRITE,
        });
        if (res?.data?.success && res.data.data?._id) {
          savedExam = res.data.data;
          lastCreatedExamRef.current = {
            signature: creationSignature,
            examId: savedExam._id,
            createdAt: Date.now(),
          };
          closeExamModal();
          setFetchError('');
          setRefreshWarning('');
          setSuccessBanner(
            `Centralized examination "${savedExam.examName}" (${formatExamTimeRange(savedExam)}) saved to MongoDB for ${activeMappings.length} sections (${savedExam.studentCount || resolutionSummary?.uniqueStudents || 0} students). Awaiting Admin Review.`
          );
          setExams((prev) => [
            savedExam,
            ...prev.filter((ex) => String(ex._id) !== String(savedExam._id)),
          ]);
          if (savedExam.approvalStatus === 'PENDING_REVIEW') {
            setPendingReviewCount((prev) => prev + 1);
          }
          targetTab = activeTab === 'pending' ? 'pending' : 'all';
          if (activeTab !== targetTab) {
            skipNextTabEffectRef.current = true;
            setActiveTab(targetTab);
          }
        } else {
          setFormError(res?.data?.message || 'Examination save could not be confirmed by MongoDB.');
        }
      }
    } catch (err) {
      setFormError(formatApiError(err, 'Failed to save examination.'));
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }

    // Quietly synchronize list in the background without redundant dashboard/stats fetches or blocking spinners
    if (savedExam) {
      await fetchExams(savedMode === 'create' ? targetTab : null, {
        preserveOnFailure: true,
        background: true,
      });
    }
  };

  const confirmPublishExam = async () => {
    if (!publishModalExam) return;
    try {
      setPublishing(true);
      setActionError('');
      const res = await api.post(`/exams/${publishModalExam._id}/publish`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data?.success) {
        setSuccessBanner(res.data.message || 'Examination approved and scheduled for publication.');
        setPublishModalExam(null);
        await fetchExams();
      }
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to publish examination.'));
    } finally {
      setPublishing(false);
    }
  };

  const confirmRejectExam = async (e) => {
    e.preventDefault();
    if (!rejectModalExam) return;
    if (!rejectReason.trim()) {
      setActionError('A rejection reason is required.');
      return;
    }
    try {
      setRejecting(true);
      setActionError('');
      const res = await api.post(`/exams/${rejectModalExam._id}/reject`, {
        reason: rejectReason.trim(),
      });
      if (res.data?.success) {
        setSuccessBanner(`Examination "${rejectModalExam.examName || rejectModalExam.subjectName}" rejected.`);
        setRejectModalExam(null);
        setRejectReason('Needs correction in seating or mappings.');
        await fetchExams();
      }
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to reject examination.'));
    } finally {
      setRejecting(false);
    }
  };

  const confirmDeleteExam = async () => {
    if (!deleteModalExam || deleteLockRef.current || deleting) return;
    const targetExam = deleteModalExam;
    deleteLockRef.current = true;
    try {
      setDeleting(true);
      setActionError('');
      const res = await api.delete(`/exams/${targetExam._id}`);
      if (res.data?.success) {
        // Optimistically update list immediately without forcing a page reload
        setExams((prev) => prev.filter((e) => String(e._id) !== String(targetExam._id)));
        setSuccessBanner(
          res.data.message || `Examination "${targetExam.examName}" deleted and classroom bookings released.`
        );
        setDeleteModalExam(null);
      }
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to delete examination.'));
      setDeleteModalExam(null);
    } finally {
      setDeleting(false);
      deleteLockRef.current = false;
    }
  };

  const confirmCancelExam = async (e) => {
    e.preventDefault();
    if (!cancelModalExam) return;
    if (!cancelReason.trim()) {
      setActionError('A formal cancellation reason is required.');
      return;
    }
    try {
      setCancelling(true);
      setActionError('');
      const res = await api.post(`/exams/${cancelModalExam._id}/cancel`, {
        reason: cancelReason.trim(),
      });
      if (res.data?.success) {
        setSuccessBanner(
          res.data.message || 'Examination cancelled cleanly. Classroom reservations released & history preserved.'
        );
        setCancelModalExam(null);
        setCancelReason('');
        await fetchExams();
      }
    } catch (err) {
      setActionError(formatApiError(err, 'Failed to cancel examination.'));
      setCancelModalExam(null);
    } finally {
      setCancelling(false);
    }
  };

  const formatCountdown = (seconds) => {
    if (seconds === undefined || seconds === null) return null;
    if (seconds <= 0) return 'Seating allocation published.';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `Student visibility in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const filteredExams = useMemo(() => {
    let list = exams;

    if (filterExamType && filterExamType !== 'ALL') {
      list = list.filter((e) => resolveExamType(e) === filterExamType);
    }

    if (selectedGroupView && selectedGroupView !== 'ALL') {
      list = list.filter((e) => {
        const grp = (e.group || '').toUpperCase();
        if (selectedGroupView === 'Group A') {
          return grp.includes('A') || (e.section && (e.section.includes('A1') || e.section.includes('A2') || e.section.includes('A3')));
        }
        if (selectedGroupView === 'Group B') {
          return grp.includes('B') || (e.section && (e.section.includes('A4') || e.section.includes('A5') || e.section.includes('A6')));
        }
        return true;
      });
    }

    const term = deferredSearchTerm.toLowerCase().trim();
    if (!term) return list;

    return list.filter((e) => {
      const subName = (e.subjectName || '').toLowerCase();
      const subCode = (e.subjectCode || '').toLowerCase();
      const examName = (e.examName || '').toLowerCase();
      const examTypeStr = resolveExamType(e).toLowerCase();
      const secStr = (e.section || '').toLowerCase();
      const faculty = (e.facultyName || '').toLowerCase();
      const dateStr = (e.examDate || '').toLowerCase();
      const yearStr = `${e.year || ''} ${e.academicYear || ''}`.toLowerCase();

      return (
        subName.includes(term) ||
        subCode.includes(term) ||
        examName.includes(term) ||
        examTypeStr.includes(term) ||
        secStr.includes(term) ||
        faculty.includes(term) ||
        dateStr.includes(term) ||
        yearStr.includes(term)
      );
    });
  }, [exams, deferredSearchTerm, selectedGroupView, filterExamType]);

  // Filtered student list for inspection modal
  const filteredInspectStudents = useMemo(() => {
    if (!inspectingRoster || !inspectingRoster.students) return [];
    const term = inspectSearchTerm.toLowerCase().trim();
    if (!term) return inspectingRoster.students;
    return inspectingRoster.students.filter(
      (s) =>
        (s.registrationNumber || '').toLowerCase().includes(term) ||
        (s.name || s.studentName || '').toLowerCase().includes(term)
    );
  }, [inspectingRoster, inspectSearchTerm]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Calendar size={20} />
            </span>
            <h1 className="text-xl font-bold text-navy-800">
              Centralized Examination Management — Exam Incharge
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Exam Incharge schedules ONE examination per subject. All academic sections, groups, faculty members, and student rosters are automatically loaded from permanent mappings.
          </p>
        </div>

        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-2">
          <Link
            to="/admin/assignments"
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <UserCheck size={14} className="mr-1.5 text-primary" />
            Permanent Mappings
          </Link>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold bg-primary text-white hover:bg-primary-hover shadow-xs cursor-pointer"
          >
            <PlusCircle size={15} className="mr-1.5" />
            Create Centralized Examination
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2">
            <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner('')}
            className="text-[11px] font-bold text-emerald-700 underline ml-3 flex-shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Secondary Post-Save Refresh Warning (never implies creation failed) */}
      {refreshWarning && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2">
            <AlertTriangle size={17} className="text-amber-600 flex-shrink-0" />
            <span className="font-medium">{refreshWarning}</span>
          </div>
          <div className="flex items-center space-x-3 ml-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => fetchExams(null, { preserveOnFailure: true })}
              className="px-2.5 py-1 rounded bg-white border border-amber-300 text-amber-800 font-bold hover:bg-amber-100 cursor-pointer"
            >
              Retry Refresh
            </button>
            <button
              type="button"
              onClick={() => setRefreshWarning('')}
              className="text-[11px] font-bold text-amber-800 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Action Error Notification Banner */}
      {actionError && (
        <div className="p-4 bg-red-50 border border-red-300 rounded-xl text-xs text-red-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
            <span className="font-semibold">{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError('')}
            className="text-[11px] font-bold text-red-700 underline ml-3 flex-shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs, Cohort Filters, and Search Controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 bg-slate-200/70 p-1 rounded-lg text-xs font-semibold">
          {[
            { id: 'all', label: 'All Examinations' },
            { id: 'pending', label: `Pending Admin Review${pendingReviewCount > 0 ? ` (${pendingReviewCount})` : ''}` },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'today', label: "Today's Exams" },
            { id: 'approved', label: 'Approved' },
            { id: 'scheduled', label: 'Scheduled T-20' },
            { id: 'published', label: 'Published / Ongoing' },
            { id: 'completed', label: 'Completed' },
            { id: 'draft', label: 'Drafts' },
            { id: 'cancelled', label: 'Cancelled' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${activeTab === tab.id
                ? 'bg-white text-navy-800 shadow-xs font-bold'
                : 'text-slate-600 hover:text-navy-800'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Group View + Academic Year / Semester Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-1 bg-navy-50 border border-navy-200/60 p-1 rounded-lg text-xs font-bold">
              <span className="text-[10px] text-navy-700 uppercase px-2 font-bold">Group:</span>
              {[
                { id: 'ALL', label: 'All Groups' },
                { id: 'Group A', label: 'Group A (A1–A3)' },
                { id: 'Group B', label: 'Group B (A4–A6)' },
              ].map((grp) => (
                <button
                  key={grp.id}
                  onClick={() => setSelectedGroupView(grp.id)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${selectedGroupView === grp.id
                    ? 'bg-primary text-white shadow-2xs font-bold'
                    : 'text-navy-700 hover:bg-white'
                    }`}
                >
                  {grp.label}
                </button>
              ))}
            </div>

            <select
              value={filterAcademicYear}
              onChange={(e) => setFilterAcademicYear(e.target.value)}
              aria-label="Filter by Academic Year"
              className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-navy-800"
            >
              <option value="ALL">All Academic Years</option>
              {academicYearsList.map((ay) => (
                <option key={ay} value={ay}>
                  {ay}
                </option>
              ))}
            </select>

            <select
              value={filterSemester}
              onChange={(e) => setFilterSemester(e.target.value)}
              aria-label="Filter by Semester"
              className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-navy-800"
            >
              <option value="ALL">All Semesters</option>
              {semestersList.map((sem) => (
                <option key={sem.value} value={sem.value}>
                  {sem.label}
                </option>
              ))}
            </select>

            <select
              value={filterExamType}
              onChange={(e) => setFilterExamType(e.target.value)}
              aria-label="Filter by Examination Type"
              className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-navy-800"
            >
              <option value="ALL">All Exam Types</option>
              {EXAM_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => fetchExams()}
              disabled={loading}
              className="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw size={13} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="relative w-full lg:w-64">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search examinations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white font-medium"
            />
          </div>
        </div>
      </div>

      {/* Retrieval Error State (Never silently disguised as empty) */}
      {fetchError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            <span className="font-semibold">{fetchError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchExams()}
            className="px-3 py-1 rounded bg-white border border-red-300 text-red-700 font-bold hover:bg-red-100 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Examination List Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">Loading examinations from MongoDB...</div>
        ) : fetchError ? (
          <div className="p-10 text-center text-xs text-red-600">
            Could not display examinations due to a server retrieval error.
          </div>
        ) : filteredExams.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Calendar className="mx-auto text-slate-300" size={40} />
            <div className="text-sm font-bold text-navy-800">No examinations found in this view.</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Switch to "All Examinations" or click "Create Centralized Examination" above to schedule an examination.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredExams.map((exam) => {
              const countdown = formatCountdown(exam.publicationCountdownSeconds);
              const isParent = exam.isParentExam || (exam.sectionAllocations && exam.sectionAllocations.length > 0);
              const isExpanded = expandedExamId === exam._id;
              const sectionCount = exam.sectionAllocations ? exam.sectionAllocations.length : 1;

              return (
                <div key={exam._id} className="p-4 hover:bg-slate-50/70 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Left: Exam Details */}
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-navy-800 text-sm">{exam.subjectName}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-primary border border-blue-200">
                          {exam.subjectCode}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {resolveExamType(exam)}
                        </span>
                        {isParent && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 flex items-center">
                            <Layers size={11} className="mr-1" />
                            Centralized ({sectionCount} Sections)
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {exam.year || 'III Year'} • {exam.semester || 'I Semester'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-semibold text-slate-700">{exam.examName}</span>
                        <span>•</span>
                        <span className="inline-flex items-center">
                          <Calendar size={13} className="mr-1 text-slate-400" />
                          {exam.examDate} • {formatSessionLabel(exam.session, exam.startTime)} ({formatExamTimeRange(exam)})
                        </span>
                        <span>•</span>
                        <span className="font-bold text-emerald-700 inline-flex items-center">
                          <Users size={13} className="mr-1" />
                          {exam.studentCount} Registered Candidates
                        </span>
                        {exam.createdBy?.name && (
                          <>
                            <span>•</span>
                            <span className="text-slate-500">
                              Created by <strong>{exam.createdBy.name}</strong> ({exam.createdByRole || exam.createdBy.role || 'faculty'})
                            </span>
                          </>
                        )}
                      </div>

                      {/* Status / Countdown */}
                      <div className="flex items-center space-x-2 pt-0.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${exam.status === 'PUBLISHED' || exam.status === 'ONGOING'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : exam.approvalStatus === 'APPROVED'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : exam.approvalStatus === 'DRAFT'
                                ? 'bg-slate-100 text-slate-700 border border-slate-300'
                                : exam.approvalStatus === 'REJECTED' || exam.status === 'CANCELLED'
                                  ? 'bg-red-100 text-red-800 border border-red-200'
                                  : exam.status === 'COMPLETED'
                                    ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                        >
                          {exam.status === 'ONGOING'
                            ? 'ONGOING EXAMINATION'
                            : exam.status === 'COMPLETED'
                              ? 'COMPLETED'
                              : exam.status === 'CANCELLED' || exam.approvalStatus === 'CANCELLED'
                                ? 'CANCELLED'
                                : exam.approvalStatus === 'DRAFT'
                                  ? 'DRAFT'
                                  : exam.approvalStatus === 'PENDING_REVIEW'
                                    ? 'PENDING ADMIN APPROVAL'
                                    : exam.status === 'PUBLISHED'
                                      ? 'PUBLISHED TO STUDENTS'
                                      : exam.approvalStatus === 'APPROVED'
                                        ? 'APPROVED • SCHEDULED (T-20)'
                                        : exam.status}
                        </span>

                        {countdown && exam.approvalStatus === 'APPROVED' && exam.status !== 'PUBLISHED' && (
                          <span className="text-[11px] font-bold text-primary flex items-center animate-pulse">
                            <Clock size={12} className="mr-1" />
                            {countdown}
                          </span>
                        )}

                        {exam.cancellationRequested && exam.status !== 'CANCELLED' && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                            title={exam.cancellationRequestReason || 'Faculty requested cancellation'}
                          >
                            <AlertTriangle size={11} className="mr-1" />
                            Faculty Cancellation Requested: {exam.cancellationRequestReason}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
                      <button
                        type="button"
                        onClick={async () => {
                          setDetailExam(exam);
                          try {
                            const res = await api.get(`/exams/${exam._id}`);
                            if (res?.data?.success && res.data.data?._id) {
                              setDetailExam(res.data.data);
                            }
                          } catch (detailErr) {
                            console.warn('[Examinations] Background details refresh notice:', detailErr?.message);
                          }
                        }}
                        title="View Complete Examination Details"
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <Eye size={13} className="mr-1 text-primary" />
                        Details
                      </button>

                      {/* Section breakdown expander toggle */}
                      {isParent && (
                        <button
                          onClick={() => setExpandedExamId(isExpanded ? null : exam._id)}
                          className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <span className="mr-1">Sections ({sectionCount})</span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}

                      {/* Download All Attendance Sheets as ZIP */}
                      {isParent ? (
                        <button
                          type="button"
                          onClick={() => handleDownloadSelectedZip(exam)}
                          title="Download Attendance Sheets as ZIP"
                          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-hover text-xs font-bold transition-all shadow-xs cursor-pointer"
                        >
                          <Archive size={13} className="mr-1.5" />
                          {downloadingZipId === exam._id ? 'Packaging ZIP...' : 'Download Attendance (ZIP)'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={downloadingKey === `att-${exam._id}`}
                          onClick={async () => {
                            const key = `att-${exam._id}`;
                            setDownloadingKey(key);
                            try {
                              await downloadProtectedReport(
                                `/reports/${exam._id}/section-attendance-pdf/${exam.section || 'A1'}`,
                                `Attendance_${exam.section || 'A1'}.pdf`,
                                'download',
                                { onError: (msg) => setActionError(msg) }
                              );
                            } finally {
                              setDownloadingKey('');
                            }
                          }}
                          title="Download Attendance Signature PDF"
                          className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-blue-50 text-primary border border-blue-200 hover:bg-blue-100 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                        >
                          <FileDown size={13} className="mr-1.5" />
                          {downloadingKey === `att-${exam._id}` ? 'Downloading...' : 'Attendance Sheet'}
                        </button>
                      )}

                      {/* Master Seating Chart */}
                      <button
                        type="button"
                        disabled={downloadingKey === `seat-${exam._id}`}
                        onClick={async () => {
                          const key = `seat-${exam._id}`;
                          setDownloadingKey(key);
                          try {
                            await downloadProtectedReport(
                              `/reports/${exam._id}/seating-pdf`,
                              `Seating_Layout_${exam.subjectCode || 'Exam'}.pdf`,
                              'download',
                              { onError: (msg) => setActionError(msg) }
                            );
                          } finally {
                            setDownloadingKey('');
                          }
                        }}
                        title="Download Seating Blueprint PDF"
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 text-xs font-semibold cursor-pointer"
                      >
                        <FileSpreadsheet size={13} className="mr-1.5 text-slate-500" />
                        {downloadingKey === `seat-${exam._id}` ? 'Downloading...' : 'Seating Blueprint'}
                      </button>

                      {/* Admin Approval Controls */}
                      {isAdmin && exam.approvalStatus === 'PENDING_REVIEW' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPublishModalExam(exam)}
                            title="Admin: Approve Examination"
                            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold shadow-xs cursor-pointer"
                          >
                            <CheckCircle2 size={13} className="mr-1.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectModalExam(exam);
                              setRejectReason('Needs correction in seating or mappings.');
                            }}
                            title="Admin: Reject Examination"
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-semibold cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {isAdmin && exam.status !== 'COMPLETED' && exam.status !== 'CANCELLED' && exam.approvalStatus !== 'CANCELLED' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(exam)}
                            title={
                              ['PUBLISHED', 'LOCKED', 'ONGOING'].includes(exam.status)
                                ? 'Admin: Controlled Edit (Published Examination)'
                                : 'Admin: Edit Examination'
                            }
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 text-xs font-semibold cursor-pointer"
                          >
                            <Edit3 size={12} className="mr-1" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCancelModalExam(exam);
                              setCancelReason('Classroom rescheduling or administrative cancellation.');
                            }}
                            title="Admin: Cancel Examination & Release Classrooms"
                            className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-semibold cursor-pointer"
                          >
                            <Ban size={12} className="mr-1" />
                            Cancel
                          </button>
                        </>
                      )}

                      {isAdmin && exam.status !== 'ONGOING' && (
                        <button
                          type="button"
                          onClick={() => setDeleteModalExam(exam)}
                          title="Admin: Delete Examination"
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* CHILD SECTION ALLOCATIONS BREAKDOWN & SECTION-WISE ATTENDANCE SELECTION ACCORDION */}
                  {isParent && isExpanded && (
                    <div className="mt-4 pt-3 border-t border-slate-200 space-y-3 bg-slate-50/80 -mx-4 -mb-4 p-4 rounded-b-xl animate-in fade-in duration-200">
                      {/* Section Selection Toolbar */}
                      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 border-b border-slate-100 pb-2.5">
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold uppercase tracking-wider text-navy-800 flex items-center">
                              <Layers size={14} className="mr-1.5 text-primary" />
                              Section-Wise Attendance Sheets Selection ({sectionCount} Sections)
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Select sections below to generate independent PDFs with only that section's students & assigned faculty.
                            </p>
                          </div>

                          {/* Quick Select Buttons */}
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => handleSelectAllSections(exam)}
                              className="px-2 py-1 rounded text-[11px] font-bold bg-blue-50 text-primary border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeselectAllSections(exam)}
                              className="px-2 py-1 rounded text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        {/* Interactive Section Checkboxes */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {exam.sectionAllocations.map((alloc) => {
                              const isChecked = getSelectedSections(exam).includes(alloc.section);
                              return (
                                <label
                                  key={alloc.section}
                                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer select-none ${isChecked
                                    ? 'bg-blue-50 border-primary text-primary shadow-xs'
                                    : 'bg-white border-slate-200 text-slate-400 opacity-75 hover:opacity-100'
                                    }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() =>
                                      handleToggleSection(
                                        exam._id,
                                        exam.sectionAllocations.map((s) => s.section),
                                        alloc.section
                                      )
                                    }
                                    className="w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary cursor-pointer"
                                  />
                                  <span>☑ Section {alloc.section}</span>
                                </label>
                              );
                            })}
                          </div>

                          {/* Batch Action Buttons */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={downloadingPdfsId === exam._id || getSelectedSections(exam).length === 0}
                              onClick={() => handleGenerateSelectedPdfs(exam)}
                              title="Generate and download independent PDF for each selected section"
                              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50 transition-all shadow-2xs cursor-pointer"
                            >
                              <FileDown size={13} className="mr-1.5" />
                              {downloadingPdfsId === exam._id
                                ? 'Generating PDFs...'
                                : `Generate Selected (${getSelectedSections(exam).length}) PDFs`}
                            </button>

                            <button
                              type="button"
                              disabled={downloadingZipId === exam._id || getSelectedSections(exam).length === 0}
                              onClick={() => handleDownloadSelectedZip(exam)}
                              title="Download selected sections packaged into one ZIP archive"
                              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-bold disabled:opacity-50 transition-all shadow-2xs cursor-pointer"
                            >
                              <Archive size={13} className="mr-1.5" />
                              {downloadingZipId === exam._id
                                ? 'Packaging ZIP...'
                                : `Download Selected as ZIP (${getSelectedSections(exam).length})`}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Section Cards Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {exam.sectionAllocations.map((alloc, idx) => {
                          const isChecked = getSelectedSections(exam).includes(alloc.section);
                          return (
                            <div
                              key={alloc._id || idx}
                              className={`p-3.5 rounded-xl border shadow-2xs space-y-2 flex flex-col justify-between transition-all ${isChecked
                                ? 'bg-white border-blue-200 ring-1 ring-blue-100'
                                : 'bg-slate-50/60 border-slate-200 opacity-60'
                                }`}
                            >
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="inline-flex items-center space-x-1.5 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() =>
                                        handleToggleSection(
                                          exam._id,
                                          exam.sectionAllocations.map((s) => s.section),
                                          alloc.section
                                        )
                                      }
                                      className="w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary cursor-pointer"
                                    />
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-primary">
                                      Section {alloc.section}
                                    </span>
                                  </label>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                                    {alloc.group}
                                  </span>
                                </div>
                                <div className="font-bold text-navy-800 text-xs truncate">
                                  {alloc.facultyName}
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center">
                                  <Building2 size={12} className="mr-1 text-slate-400" />
                                  {alloc.classroomName || 'ET BLOCK'}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-700 flex items-center">
                                  <Users size={12} className="mr-1" />
                                  {alloc.studentCount} Students
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={downloadingKey === `sec-${exam._id}-${alloc.section}`}
                                onClick={async () => {
                                  const key = `sec-${exam._id}-${alloc.section}`;
                                  setDownloadingKey(key);
                                  try {
                                    await downloadProtectedReport(
                                      `/reports/${exam._id}/section-attendance-pdf/${alloc.section}`,
                                      `Attendance_${alloc.section}.pdf`,
                                      'download',
                                      { onError: (msg) => setActionError(msg) }
                                    );
                                  } finally {
                                    setDownloadingKey('');
                                  }
                                }}
                                title={`Download Sec ${alloc.section} Attendance PDF`}
                                className="w-full mt-2 inline-flex items-center justify-center py-1.5 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 text-primary text-[11px] font-bold border border-blue-200 disabled:opacity-50 transition-colors cursor-pointer"
                              >
                                <FileDown size={13} className="mr-1.5" />
                                {downloadingKey === `sec-${exam._id}-${alloc.section}`
                                  ? 'Downloading PDF...'
                                  : `Download Sec ${alloc.section} Attendance PDF`}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE CENTRALIZED EXAMINATION MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/40 backdrop-blur-xs"
            onClick={closeExamModal}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 max-h-[92vh] overflow-y-auto space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <div>
                <div className="flex items-center space-x-2">
                  <Sparkles size={18} className="text-primary" />
                  <h3 className="text-base font-bold text-navy-800">
                    {editingExam
                      ? `Edit Examination — ${editingExam.examName || editingExam.subjectName}`
                      : 'Centralized Examination Creation — Exam Incharge'}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingExam
                    ? 'Modify examination schedule, group/sections, or classroom assignments with real-time conflict checking.'
                    : 'Creates ONE examination. Sections, faculty mappings, classrooms, and student rosters are detected automatically.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeExamModal}
                className="p-1 text-slate-400 hover:text-navy-800 rounded-md cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {loadingEditDetails && (
              <div className="px-3.5 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-primary font-semibold">
                Refreshing latest examination record from MongoDB...
              </div>
            )}

            {isEditingPublishedOrLocked && (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start space-x-2.5">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Published / Locked Examination — Controlled Admin Correction</span>
                  <span className="text-[11px] text-amber-800">
                    Existing student seating assignments are preserved unless you change group/sections/classroom assignments. Confirm correction and provide an audit reason below before saving.
                  </span>
                </div>
              </div>
            )}

            {formError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start">
                <AlertCircle size={16} className="mr-2 flex-shrink-0 text-red-600 mt-0.5" />
                <div className="flex-1 font-medium">{formError}</div>
              </div>
            )}

            <form onSubmit={handleCreateOrUpdateCentralizedExam} className="space-y-4">
              {/* STEP 1: Academic Cohort & Subject Selection */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-navy-800 uppercase tracking-wider flex items-center">
                  <BookOpen size={14} className="mr-1.5 text-primary" />
                  Step 1: Academic Year, Semester & Subject Selection
                </div>

                {/* Academic Year, Year, Semester */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Academic Year: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.academicYear}
                      onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      {academicYearsList.map((ay) => (
                        <option key={ay} value={ay}>
                          {ay}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Year: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.year}
                      onChange={(e) => {
                        const nextYear = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          year: nextYear,
                          ...(!editingExam && !titleManuallyEditedRef.current
                            ? { examName: buildDefaultExamTitle({ year: nextYear, semester: prev.semester, examType: prev.examType }) }
                            : {}),
                        }));
                      }}
                      className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      {yearsList.map((y) => (
                        <option key={y.value} value={y.value}>
                          {y.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Semester: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.semester}
                      onChange={(e) => {
                        const nextSem = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          semester: nextSem,
                          ...(!editingExam && !titleManuallyEditedRef.current
                            ? { examName: buildDefaultExamTitle({ year: prev.year, semester: nextSem, examType: prev.examType }) }
                            : {}),
                        }));
                      }}
                      className="w-full px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      {semestersList.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject Selection Dropdown from MongoDB Master Collection */}
                <div>
                  <label className="block text-[11px] font-bold text-navy-800 mb-1">
                    Choose Subject to Schedule: <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.subjectCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const match = availableSubjects.find((s) => s.subjectCode === code);
                      if (match) {
                        setFormData((prev) => {
                          const nextYear = match.year || prev.year;
                          const nextSem = match.semester || prev.semester;
                          return {
                            ...prev,
                            subjectName: match.subjectName,
                            subjectCode: match.subjectCode,
                            year: nextYear,
                            semester: nextSem,
                            ...(!editingExam && !titleManuallyEditedRef.current
                              ? { examName: buildDefaultExamTitle({ year: nextYear, semester: nextSem, examType: prev.examType }) }
                              : {}),
                          };
                        });
                      } else {
                        setFormData((prev) => ({ ...prev, subjectCode: code }));
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg bg-white text-navy-800 shadow-2xs"
                  >
                    <option value="">-- Choose Subject to Schedule --</option>
                    {availableSubjects.map((s) => (
                      <option key={s.subjectCode} value={s.subjectCode}>
                        {s.abbreviation ? `${s.abbreviation} — ` : ''}{s.subjectName} ({s.subjectCode})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Subject Name & Subject Code Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                  <div className="sm:col-span-8">
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Subject Name: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.subjectName}
                      onChange={(e) => setFormData({ ...formData, subjectName: e.target.value })}
                      placeholder="e.g. Automata Theory and Compiler Design"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-medium"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Subject Code (Auto-populated): <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.subjectCode}
                      onChange={(e) => setFormData({ ...formData, subjectCode: e.target.value.toUpperCase() })}
                      placeholder="20A05501T"
                      className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg bg-white text-primary"
                    />
                  </div>
                </div>
              </div>

              {/* STEP 2: Examination Details (Title, Date, Session, Timings) */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-navy-800 uppercase tracking-wider flex items-center">
                  <Clock size={14} className="mr-1.5 text-primary" />
                  Step 2: Examination Title, Date & Timings
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Examination Type / Number: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.examType || 'UNIT 1'}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setFormData((prev) => ({
                          ...prev,
                          examType: nextType,
                          ...(!editingExam && !titleManuallyEditedRef.current
                            ? { examName: buildDefaultExamTitle({ year: prev.year, semester: prev.semester, examType: nextType }) }
                            : {}),
                        }));
                      }}
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg bg-white text-navy-800"
                    >
                      {EXAM_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-8">
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Examination Title: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.examName}
                      onChange={(e) => {
                        titleManuallyEditedRef.current = true;
                        setFormData((prev) => ({ ...prev, examName: e.target.value }));
                      }}
                      placeholder="e.g. III Year I Semester UNIT 1 Examination"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Exam Date: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.examDate}
                      onChange={(e) => setFormData({ ...formData, examDate: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Session (AM/PM): <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSessionChange('AM')}
                        className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${normalizeSessionCode(formData.session, 'AM') === 'AM'
                          ? 'bg-primary text-white shadow-xs'
                          : 'bg-white border border-slate-300 text-slate-700'
                          }`}
                      >
                        Morning (AM)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSessionChange('PM')}
                        className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${normalizeSessionCode(formData.session, 'AM') === 'PM'
                          ? 'bg-primary text-white shadow-xs'
                          : 'bg-white border border-slate-300 text-slate-700'
                          }`}
                      >
                        Afternoon (PM)
                      </button>
                    </div>
                  </div>

                  <div>
                    <TimeSelect12h
                      idPrefix="admin-start"
                      label="Start Time:"
                      required
                      value={formData.startTime}
                      sessionHint={formData.session}
                      onChange={(val) => setFormData((prev) => ({ ...prev, startTime: val }))}
                    />
                  </div>

                  <div>
                    <TimeSelect12h
                      idPrefix="admin-end"
                      label="End Time:"
                      required
                      isEndTime
                      value={formData.endTime}
                      sessionHint={formData.session}
                      onChange={(val) => setFormData((prev) => ({ ...prev, endTime: val }))}
                    />
                  </div>
                </div>

                <div className="px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-navy-800 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    Schedule Preview: <span className="font-mono text-navy-900">{formatExamTimeRange({ startTime: formData.startTime, endTime: formData.endTime })}</span>
                    {validateExamTimeRange(formData.startTime, formData.endTime, {
                      session: formData.session,
                      allowOvernight: formData.allowOvernight,
                    }).isOvernight && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                          Ends Next Day (Overnight)
                        </span>
                      )}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center space-x-1.5 text-[11px] font-semibold text-navy-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.allowOvernight)}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, allowOvernight: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                      />
                      <span>Overnight (Ends Next Day)</span>
                    </label>
                    <span className="font-mono font-bold text-primary">
                      Student Early Access: {computeVisibilityWindowLabel(formData.startTime)}
                    </span>
                  </div>
                </div>

                {/* Real-Time Booking Availability & Overlap Check */}
                {availabilityCheck.timeError ? (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 font-semibold flex items-center space-x-2">
                    <AlertCircle size={14} className="flex-shrink-0 text-red-600" />
                    <span>{availabilityCheck.timeError}</span>
                  </div>
                ) : availabilityCheck.loading ? (
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-500">
                    Checking real-time classroom booking overlaps...
                  </div>
                ) : !availabilityCheck.available && availabilityCheck.conflicts?.length > 0 ? (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-800 space-y-1">
                    <div className="font-bold flex items-center space-x-1.5 text-red-700">
                      <AlertTriangle size={14} />
                      <span>Classroom Booking Conflict Detected ({availabilityCheck.conflicts.length}):</span>
                    </div>
                    {availabilityCheck.conflicts.map((c, idx) => (
                      <div key={idx} className="pl-5 text-red-700">
                        Room <strong>{c.roomNumber || c.classroomName}</strong> (Section {c.section}): booked for <strong>{c.existingExamTitle || c.existingExamName}</strong> ({c.existingDate || c.existingExamDate}, {c.existingStartTime} – {c.existingEndTime})
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2 bg-emerald-50/70 border border-emerald-200 rounded-lg text-[11px] text-emerald-800 font-medium flex items-center space-x-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                    <span>No classroom time conflicts detected for selected rooms & time slot.</span>
                  </div>
                )}

                {/* Step 2b: Target Examination Group Session (Group A, Group B, or Both Groups) */}
                <div className="pt-2 border-t border-slate-200">
                  <label className="block text-[11px] font-bold text-navy-800 mb-1.5 flex items-center justify-between">
                    <span>Target Examination Group Session: <span className="text-red-500">*</span></span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      Group A and Group B can be scheduled independently or combined with individual section toggles below.
                    </span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, group: 'Group A' }))}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${formData.group === 'Group A'
                        ? 'bg-blue-50/80 border-primary shadow-xs ring-1 ring-primary'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-navy-800">Group A Only</span>
                        {formData.group === 'Group A' && (
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Sections <strong>A1, A2, A3</strong> &rarr; 3010–3030
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, group: 'Group B' }))}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${formData.group === 'Group B'
                        ? 'bg-blue-50/80 border-primary shadow-xs ring-1 ring-primary'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-navy-800">Group B Only</span>
                        {formData.group === 'Group B' && (
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Sections <strong>A4, A5, A6</strong> &rarr; 3040–3060
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, group: 'ALL' }))}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${formData.group === 'ALL' || formData.group === 'Both'
                        ? 'bg-blue-50/80 border-primary shadow-xs ring-1 ring-primary'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-navy-800">Both Groups (A &amp; B)</span>
                        {(formData.group === 'ALL' || formData.group === 'Both') && (
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Sections <strong>A1–A6</strong> (customize below)
                      </p>
                    </button>
                  </div>
                </div>
              </div>

              {/* STEP 3: AUTOMATICALLY DETECTED FACULTY & STUDENT MAPPINGS */}
              <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-navy-800 uppercase tracking-wider flex items-center">
                    <Sparkles size={14} className="mr-1.5 text-primary" />
                    Automatically Detected Faculty & Student Mappings
                  </div>

                  {resolvingMappings ? (
                    <span className="text-[11px] text-primary font-bold animate-pulse">
                      Resolving permanent mappings...
                    </span>
                  ) : resolvedMappings.length > 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {resolvedMappings.length} Sections Resolved
                    </span>
                  ) : null}
                </div>

                {resolvingMappings ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    Querying MongoDB permanent mappings for {formData.subjectName}...
                  </div>
                ) : resolutionError ? (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-start">
                    <Info size={16} className="mr-2 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>{resolutionError}</div>
                  </div>
                ) : resolvedMappings.length > 0 ? (
                  <div className="space-y-3">
                    {/* Live Synchronized Selection Summary Counters */}
                    {(() => {
                      const activeSelected = resolvedMappings.filter((m) =>
                        selectedSections.includes(m.section)
                      );
                      const selectedSecs = activeSelected.map((m) => m.section);
                      const totalSelEnrollments = activeSelected.reduce(
                        (sum, m) => sum + (m.studentCount || (m.students ? m.students.length : 0)),
                        0
                      );
                      const uniqRegSet = new Set();
                      activeSelected.forEach((m) => {
                        (m.students || []).forEach((s) => {
                          if (s.registrationNumber) uniqRegSet.add(String(s.registrationNumber).toUpperCase().trim());
                        });
                      });
                      const uniqueSelCount = uniqRegSet.size > 0 ? uniqRegSet.size : totalSelEnrollments;

                      return (
                        <div className="grid grid-cols-3 gap-2 bg-white p-3 rounded-xl border border-blue-200 text-center">
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-bold">Selected Sections</div>
                            <div className="text-base font-black text-navy-800">
                              {selectedSecs.length} Sections{selectedSecs.length > 0 ? ` (${selectedSecs.join(', ')})` : ''}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-bold">Selected Students</div>
                            <div className="text-base font-black text-primary">
                              {totalSelEnrollments} Students
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-bold">Unique Candidates</div>
                            <div className="text-base font-black text-emerald-700">
                              {uniqueSelCount} Candidates
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Section Selection Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white px-3 py-2 rounded-lg border border-slate-200">
                      <span className="font-semibold text-navy-800">
                        Selected Sections:{' '}
                        <span className="text-primary font-bold">
                          {resolvedMappings.filter((m) => selectedSections.includes(m.section)).length}
                        </span>{' '}
                        / {resolvedMappings.length}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSections(resolvedMappings.map((m) => m.section))}
                          className="px-2 py-0.5 rounded bg-blue-50 text-primary font-semibold hover:bg-blue-100 cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSections([])}
                          className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* Mappings Table */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white max-h-56 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-2.5 text-center w-9">Use</th>
                            <th className="py-2 px-3">Section</th>
                            <th className="py-2 px-3">Group</th>
                            <th className="py-2 px-3">Assigned Classroom</th>
                            <th className="py-2 px-3">Assigned Faculty</th>
                            <th className="py-2 px-3 text-center">Students</th>
                            <th className="py-2 px-3 text-center">Roster</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {resolvedMappings.map((m, idx) => {
                            const isChecked = selectedSections.includes(m.section);
                            return (
                              <tr
                                key={m.mappingId || idx}
                                className={`hover:bg-slate-50 ${!isChecked ? 'opacity-50 bg-slate-50/70' : ''}`}
                              >
                                <td className="py-1.5 px-2.5 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleToggleFormSection(m.section)}
                                    className="rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                                  />
                                </td>
                                <td className="py-1.5 px-3 font-bold text-primary">
                                  Section {m.section}
                                </td>
                                <td className="py-1.5 px-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700">
                                    {m.group}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3">
                                  {classrooms.length > 0 ? (
                                    <select
                                      value={classroomOverrides[m.section] || ''}
                                      onChange={(e) =>
                                        setClassroomOverrides((prev) => ({
                                          ...prev,
                                          [m.section]: e.target.value,
                                        }))
                                      }
                                      className="px-2 py-1 rounded text-[11px] font-semibold bg-white border border-slate-300 text-navy-800 focus:outline-none focus:ring-1 focus:ring-primary max-w-[165px]"
                                    >
                                      <option value="">
                                        Auto: {m.assignedClassroomName || `ET BLOCK ${m.assignedRoomNumber || '3010'}`}
                                      </option>
                                      {classrooms.map((c) => (
                                        <option key={c._id} value={c._id}>
                                          {c.name} ({c.roomNumber})
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-navy-50 text-navy-800 border border-navy-200">
                                      {m.assignedClassroomName || `ET BLOCK ${m.assignedRoomNumber || '3010'}`}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 px-3 font-medium text-navy-800">
                                  {m.facultyName}
                                </td>
                                <td className="py-1.5 px-3 text-center font-bold text-emerald-700 font-mono">
                                  {m.studentCount}
                                </td>
                                <td className="py-1.5 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setInspectingRoster(m);
                                      setInspectSearchTerm('');
                                    }}
                                    className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 hover:bg-primary hover:text-white text-slate-700 text-[10px] font-bold transition-colors cursor-pointer"
                                  >
                                    <Eye size={11} className="mr-1" />
                                    Inspect
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Controlled Admin Correction Confirmation (when editing Published/Locked/Ongoing exam) */}
              {isEditingPublishedOrLocked && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2.5 text-xs">
                  <label className="flex items-start space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmControlledCorrection}
                      onChange={(e) => setConfirmControlledCorrection(e.target.checked)}
                      className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-bold text-amber-900">
                      Confirm Controlled Administrator Correction for this published/locked examination
                    </span>
                  </label>
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                      Formal Audit Reason <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="e.g. Correcting afternoon slot timing from 01:45 AM to 01:45 PM"
                      className="w-full px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs text-navy-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={closeExamModal}
                  className="px-4 py-2.5 rounded-lg text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    Boolean(availabilityCheck.timeError) ||
                    (!editingExam && resolvedMappings.length === 0) ||
                    (resolvedMappings.length > 0 &&
                      resolvedMappings.filter((m) => selectedSections.includes(m.section)).length === 0)
                  }
                  className="px-5 py-2.5 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-sm transition-all disabled:opacity-50 flex items-center space-x-2 cursor-pointer"
                >
                  {submitting ? (
                    <span>{editingExam ? 'Saving Examination Changes...' : 'Generating Seating & Attendance...'}</span>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>
                        {editingExam
                          ? isEditingPublishedOrLocked
                            ? 'Apply Controlled Admin Edit'
                            : 'Save Examination Changes'
                          : `Create Centralized Examination (${resolvedMappings.filter((m) => selectedSections.includes(m.section)).length
                          } Sections)`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ROSTER INSPECTION MODAL */}
      {inspectingRoster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setInspectingRoster(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-bold text-navy-800">
                    Section {inspectingRoster.section} — {inspectingRoster.facultyName}
                  </h4>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                    {inspectingRoster.group}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inspectingRoster.subjectName} • {inspectingRoster.studentCount} Registered Candidates
                </p>
              </div>
              <button
                onClick={() => setInspectingRoster(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
                <input
                  type="text"
                  placeholder="Filter candidate roster..."
                  value={inspectSearchTerm}
                  onChange={(e) => setInspectSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                  <tr>
                    <th className="py-2 px-3 text-center w-10">#</th>
                    <th className="py-2 px-3">Registration Number</th>
                    <th className="py-2 px-3">Student Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInspectStudents.map((st, i) => (
                    <tr key={st.registrationNumber || i} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {st.sNo || i + 1}
                      </td>
                      <td className="py-1.5 px-3 font-mono font-bold text-primary">
                        {st.registrationNumber}
                      </td>
                      <td className="py-1.5 px-3 font-medium text-navy-800">
                        {st.name || st.studentName}
                      </td>
                    </tr>
                  ))}
                  {filteredInspectStudents.length === 0 && (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-slate-400 text-xs">
                        No students match the search term.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Showing {filteredInspectStudents.length} of {inspectingRoster.studentCount} candidates
              </span>
              <button
                type="button"
                onClick={() => setInspectingRoster(null)}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN VIEW EXAMINATION DETAILS MODAL */}
      {detailExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/40 backdrop-blur-xs"
            onClick={() => setDetailExam(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                    {resolveExamType(detailExam)}
                  </span>
                  <h3 className="text-sm font-bold text-navy-800">{detailExam.examName}</h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {detailExam.subjectName} ({detailExam.subjectCode}) • ID: {detailExam._id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailExam(null)}
                className="p-1 text-slate-400 hover:text-navy-800 rounded cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Academic Year & Sem</span>
                  <span className="font-bold text-navy-800">{detailExam.academicYear} • {detailExam.semester}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Session &amp; Exam Date</span>
                  <span className="font-bold text-navy-800">
                    {detailExam.examDate} • {formatSessionLabel(detailExam.session, detailExam.startTime)} ({formatExamTimeRange(detailExam)})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Group & Sections</span>
                  <span className="font-bold text-navy-800">{detailExam.group} • {detailExam.section}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Created By</span>
                  <span className="font-bold text-navy-800">{detailExam.createdBy?.name || detailExam.createdByRole || 'Staff'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Students</span>
                  <span className="font-bold text-emerald-700">{detailExam.studentCount || 0} Candidates</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Approval / Status</span>
                  <span className="font-bold text-navy-800">{detailExam.approvalStatus} / {detailExam.status}</span>
                </div>
              </div>
              {detailExam.sectionAllocations?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-navy-800">
                    Section & Classroom Mappings ({detailExam.sectionAllocations.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {detailExam.sectionAllocations.map((sa, idx) => (
                      <div key={sa._id || idx} className="p-2.5 rounded-lg border border-slate-200 bg-white">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-primary">Section {sa.section}</span>
                          <span className="text-emerald-700">{sa.studentCount} Students</span>
                        </div>
                        <div className="text-[11px] text-navy-800 font-medium">{sa.classroomName}</div>
                        <div className="text-[10px] text-slate-500">Faculty: {sa.facultyName}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = detailExam._id;
                    setDetailExam(null);
                    navigate(`/admin/allocations?examId=${id}`);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 cursor-pointer"
                >
                  Open Seating Layout
                </button>
                {(detailExam.permissions?.canEdit || detailExam.permissions?.canControlledEdit) && (
                  <button
                    type="button"
                    onClick={() => {
                      const ex = detailExam;
                      setDetailExam(null);
                      openEditModal(ex);
                    }}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 inline-flex items-center space-x-1 cursor-pointer"
                  >
                    <Edit3 size={12} />
                    <span>Edit Exam</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailExam(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVE & PUBLISH CONFIRMATION MODAL */}
      {publishModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/50 backdrop-blur-xs"
            onClick={() => !publishing && setPublishModalExam(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-emerald-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700 flex-shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-navy-900">Approve &amp; Publish Examination?</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Approving <strong>{publishModalExam.examName || publishModalExam.subjectName}</strong> ({publishModalExam.examDate}, {formatExamTimeRange(publishModalExam)}) marks it Approved / Scheduled. Student seating visibility automatically opens at scheduled start time for the configured window.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={publishing}
                onClick={() => setPublishModalExam(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={publishing}
                onClick={confirmPublishExam}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                {publishing ? 'Publishing...' : 'Approve & Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECT EXAMINATION CONFIRMATION MODAL */}
      {rejectModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/50 backdrop-blur-xs"
            onClick={() => !rejecting && setRejectModalExam(null)}
          />
          <form
            onSubmit={confirmRejectExam}
            className="relative bg-white rounded-2xl shadow-2xl border border-red-200 max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-700 flex-shrink-0">
                <AlertCircle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-navy-900">Reject Examination Submission</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Provide feedback for rejecting <strong>{rejectModalExam.examName || rejectModalExam.subjectName}</strong>.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-navy-800 mb-1">
                Rejection Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-navy-800 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={rejecting}
                onClick={() => setRejectModalExam(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={rejecting || !rejectReason.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DELETE EXAMINATION CONFIRMATION MODAL */}
      {deleteModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/50 backdrop-blur-xs"
            onClick={() => !deleting && setDeleteModalExam(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-red-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-600 flex-shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-navy-900">Delete Examination?</h3>
                <p className="text-xs text-slate-600 mt-1">
                  This will permanently remove <strong>{deleteModalExam.examName || deleteModalExam.subjectName}</strong> ({deleteModalExam.examDate}, {formatExamTimeRange(deleteModalExam)}), delete its draft seating allocations, and immediately release all reserved classrooms.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteModalExam(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Keep Exam
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDeleteExam}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL EXAMINATION CONFIRMATION MODAL */}
      {cancelModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/50 backdrop-blur-xs"
            onClick={() => !cancelling && setCancelModalExam(null)}
          />
          <form
            onSubmit={confirmCancelExam}
            className="relative bg-white rounded-2xl shadow-2xl border border-amber-200 max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 flex-shrink-0">
                <Ban size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-navy-900">Cancel Examination &amp; Preserve History</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Cancelling <strong>{cancelModalExam.examName || cancelModalExam.subjectName}</strong> ({cancelModalExam.examDate}, {formatExamTimeRange(cancelModalExam)}) marks the record as <strong>CANCELLED</strong>, retains allocation &amp; audit history in MongoDB, and releases its classroom reservations.
                </p>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-navy-800 mb-1">
                Cancellation Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Enter official reason for cancelling this examination..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-navy-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={cancelling}
                onClick={() => {
                  setCancelModalExam(null);
                  setCancelReason('');
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={cancelling || !cancelReason.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Examinations;
