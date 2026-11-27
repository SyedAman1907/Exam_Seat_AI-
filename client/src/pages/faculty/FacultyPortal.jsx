import React, { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Users,
  Search,
  Eye,
  Filter,
  CheckCircle2,
  AlertCircle,
  X,
  FileDown,
  PlusCircle,
  Calendar,
  Layers,
  RefreshCw,
  Clock,
  GraduationCap,
  ArrowRight,
  Edit3,
  Trash2,
  Ban,
  Save,
  Send,
} from 'lucide-react';
import { downloadProtectedReport } from '../../utils/fileDownloader';
import {
  getTodayKolkataIso,
  computeVisibilityWindowLabel,
  formatExamTimeRange,
  formatTime12h,
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

const FacultyPortal = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const isExamIncharge = user?.role === 'exam_incharge' || user?.role === 'incharge' || isAdmin;

  // Portal State
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalSubjects: 0, totalSections: 0, totalEnrollments: 0 });
  const [subjects, setSubjects] = useState([]);
  const [dbSubjects, setDbSubjects] = useState([]);
  const [hierarchy, setHierarchy] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ academicYears: [], semesters: [], faculties: [] });
  const [facultyExams, setFacultyExams] = useState([]);

  // Filter States
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('ALL');
  const [selectedSemester, setSelectedSemester] = useState('ALL');
  const [selectedFaculty, setSelectedFaculty] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Expandable Subjects Set
  const [expandedKeys, setExpandedKeys] = useState(new Set());

  // Roster Detail Modal State
  const [activeSectionMapping, setActiveSectionMapping] = useState(null);
  const [rosterData, setRosterData] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');

  // Examination Management Modal States (Create / Edit / View / Delete / Cancel Request)
  const [showCreateExamModal, setShowCreateExamModal] = useState(false);
  const [editingExam, setEditingExam] = useState(null);
  const [examForm, setExamForm] = useState({
    academicYear: '2026-2027',
    year: 'III Year',
    semester: 'I Semester',
    subjectName: '',
    subjectCode: '',
    examType: 'UNIT 1',
    examName: buildDefaultExamTitle({ year: 'III Year', semester: 'I Semester', examType: 'UNIT 1' }),
    examDate: getTodayKolkataIso(),
    startTime: '09:00 AM',
    endTime: '12:00 PM',
    session: 'AM',
    group: 'ALL',
  });
  const [examTypeFilter, setExamTypeFilter] = useState('ALL');
  const [selectedSections, setSelectedSections] = useState([]);
  const [creatingExam, setCreatingExam] = useState(false);
  const [examFormError, setExamFormError] = useState('');
  const [downloadingPdfKey, setDownloadingPdfKey] = useState('');
  const deleteLockRef = useRef(false);
  const saveLockRef = useRef(false);

  // Exam Filter Tab inside Management Table
  const [examTabFilter, setExamTabFilter] = useState('ALL');
  const [examsError, setExamsError] = useState('');
  const [examDetailModal, setExamDetailModal] = useState(null);
  const [examDetailLoading, setExamDetailLoading] = useState(false);
  const [deleteConfirmExam, setDeleteConfirmExam] = useState(null);
  const [deletingExam, setDeletingExam] = useState(false);
  const [cancelRequestExam, setCancelRequestExam] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);

  // Notification Banner
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  useEffect(() => {
    loadPortalData();
  }, [selectedAcademicYear, selectedSemester, selectedFaculty]);

  const loadPortalData = async ({ preserveFeedbackOnError = false } = {}) => {
    try {
      setLoading(true);
      setExamsError('');
      const params = new URLSearchParams();
      if (selectedAcademicYear !== 'ALL') params.append('academicYear', selectedAcademicYear);
      if (selectedSemester !== 'ALL') params.append('semester', selectedSemester);
      if (isExamIncharge && selectedFaculty !== 'ALL') params.append('faculty', selectedFaculty);

      const examParams = new URLSearchParams();
      if (selectedAcademicYear !== 'ALL') examParams.append('academicYear', selectedAcademicYear);
      if (selectedSemester !== 'ALL') examParams.append('semester', selectedSemester);

      const [portalRes, examsRes, subjectsRes] = await Promise.all([
        api.get(`/mappings/portal-groups?${params.toString()}`),
        api.get(`/exams?${examParams.toString()}`),
        api.get('/subjects'),
      ]);

      if (subjectsRes?.data?.success) {
        setDbSubjects(subjectsRes.data.data || []);
      }

      if (portalRes?.data?.success) {
        setStats(portalRes.data.stats || { totalSubjects: 0, totalSections: 0, totalEnrollments: 0 });
        setSubjects(portalRes.data.subjects || []);
        setHierarchy(portalRes.data.hierarchy || []);
        setFilterOptions(portalRes.data.filters || { academicYears: [], semesters: [], faculties: [] });

        // Expand all subjects by default for clear navigation
        if (expandedKeys.size === 0 && portalRes.data.subjects?.length > 0) {
          const initialKeys = new Set(
            portalRes.data.subjects.map((s) => `${s.subjectCode}___${s.subjectName}`)
          );
          setExpandedKeys(initialKeys);
        }
      }

      if (examsRes?.data?.success) {
        setFacultyExams(examsRes.data.data || []);
      } else {
        setExamsError(examsRes?.data?.message || 'Unable to load examinations.');
      }
    } catch (err) {
      console.error('Failed to load faculty portal data:', err);
      const msg = formatApiError(err, 'Server connection error');
      setExamsError(`Unable to refresh examinations list: ${msg}`);
      if (!preserveFeedbackOnError) {
        setFeedback({
          type: 'error',
          text: `Unable to load portal data: ${msg}. Please ensure backend server is running.`,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Toggle single subject group expansion
  const toggleSubject = (subjectKey) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(subjectKey)) {
        next.delete(subjectKey);
      } else {
        next.add(subjectKey);
      }
      return next;
    });
  };

  // Expand / Collapse all subjects
  const handleToggleAll = (expand) => {
    if (expand) {
      const allKeys = new Set(filteredSubjects.map((s) => `${s.subjectCode}___${s.subjectName}`));
      setExpandedKeys(allKeys);
    } else {
      setExpandedKeys(new Set());
    }
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Filter subjects based on search query
  const filteredSubjects = useMemo(() => {
    if (!deferredSearchQuery.trim()) return subjects;
    const q = deferredSearchQuery.toLowerCase().trim();
    return subjects.filter(
      (s) =>
        s.subjectName.toLowerCase().includes(q) ||
        s.subjectCode.toLowerCase().includes(q) ||
        s.sections.some(
          (sec) =>
            sec.section.toLowerCase().includes(q) ||
            (sec.facultyName && sec.facultyName.toLowerCase().includes(q))
        )
    );
  }, [subjects, deferredSearchQuery]);

  // Subjects available for scheduling:
  // Normal faculty see ONLY their own permanently mapped subjects; Exam Incharge/Admin see all department subjects.
  const availableScheduleSubjects = useMemo(() => {
    const list = [...subjects];
    if (!isExamIncharge) {
      return list;
    }
    const seenCodes = new Set(list.map((s) => (s.subjectCode || '').toUpperCase()));
    dbSubjects.forEach((ds) => {
      const c = (ds.subjectCode || '').toUpperCase();
      if (!seenCodes.has(c)) {
        seenCodes.add(c);
        list.push({
          subjectName: ds.subjectName,
          subjectCode: ds.subjectCode,
          abbreviation: ds.abbreviation,
          sections: [],
        });
      }
    });
    return list;
  }, [subjects, dbSubjects, isExamIncharge]);
  const handleOpenRoster = async (sectionItem, subjectItem) => {
    try {
      setActiveSectionMapping({
        ...sectionItem,
        subjectName: subjectItem.subjectName,
        subjectCode: subjectItem.subjectCode,
        year: subjectItem.year,
        semester: subjectItem.semester,
        department: subjectItem.department,
      });
      setRosterLoading(true);
      setRosterError('');
      setRosterSearch('');

      const res = await api.get(`/mappings/${sectionItem.mappingId}`);
      if (res.data.success && res.data.data) {
        setRosterData(res.data.data);
      } else {
        setRosterError('Student roster details could not be retrieved.');
      }
    } catch (err) {
      console.error('Error fetching roster:', err);
      setRosterError(
        err.response?.data?.message || 'Failed to load student roster. Please check permissions.'
      );
    } finally {
      setRosterLoading(false);
    }
  };

  const handleCloseRoster = () => {
    setActiveSectionMapping(null);
    setRosterData(null);
    setRosterError('');
    setRosterSearch('');
  };

  const deferredRosterSearch = useDeferredValue(rosterSearch);

  // Filter students within open roster modal
  const modalFilteredStudents = useMemo(() => {
    const list = rosterData?.students || [];
    if (!deferredRosterSearch.trim()) return list;
    const q = deferredRosterSearch.toLowerCase().trim();
    return list.filter(
      (st) =>
        (st.registrationNumber && st.registrationNumber.toLowerCase().includes(q)) ||
        (st.name && st.name.toLowerCase().includes(q)) ||
        (st.studentName && st.studentName.toLowerCase().includes(q))
    );
  }, [rosterData, deferredRosterSearch]);

  // Helper: compute assigned sections for a given subject and group
  const getSectionsForSubjectGroup = (subName, grp) => {
    if (!subName) return [];
    const found = subjects.find(
      (s) => s.subjectName.toLowerCase() === subName.toLowerCase()
    );
    if (!found) return [];
    if (grp === 'Group A') {
      return found.sections.filter((sec) => ['A1', 'A2', 'A3'].includes(sec.section));
    }
    if (grp === 'Group B') {
      return found.sections.filter((sec) => ['A4', 'A5', 'A6'].includes(sec.section));
    }
    return found.sections;
  };

  // Automatically resolved sections for selected exam subject & group
  const currentExamSubjectSections = useMemo(
    () => getSectionsForSubjectGroup(examForm.subjectName, examForm.group),
    [subjects, examForm.subjectName, examForm.group]
  );

  // Selected section objects for payload/summary
  const activeSelectedSectionObjects = useMemo(
    () => currentExamSubjectSections.filter((s) => selectedSections.includes(s.section)),
    [currentExamSubjectSections, selectedSections]
  );

  // Handle opening Create Examination modal (available for all faculty scoped to their assigned mappings)
  const handleOpenCreateExam = (subjectItem = null) => {
    const targetSub = subjectItem || (subjects.length > 0 ? subjects[0] : null);
    const defaultSubName = targetSub?.subjectName || '';
    const defaultSections = getSectionsForSubjectGroup(defaultSubName, 'ALL').map((s) => s.section);
    const defYear = targetSub?.year || 'III Year';
    const defSem = targetSub?.semester || 'I Semester';
    const defType = 'UNIT 1';
    setEditingExam(null);
    setExamForm({
      academicYear: targetSub?.academicYear || '2026-2027',
      year: defYear,
      semester: defSem,
      subjectName: defaultSubName,
      subjectCode: targetSub?.subjectCode || '',
      examType: defType,
      examName: buildDefaultExamTitle({ year: defYear, semester: defSem, examType: defType }),
      examDate: getTodayKolkataIso(),
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'AM',
      group: 'ALL',
    });
    setSelectedSections(defaultSections);
    setExamFormError('');
    setShowCreateExamModal(true);
  };

  // Handle opening Edit Examination modal for an existing editable exam
  const handleOpenEditExam = (exam) => {
    const existingSecs =
      exam.sectionAllocations && exam.sectionAllocations.length > 0
        ? exam.sectionAllocations.map((sa) => sa.section)
        : (exam.section || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

    const normSess = normalizeSessionCode(exam.session, 'AM');
    const isPM = normSess === 'PM';
    setEditingExam(exam);
    setExamForm({
      academicYear: exam.academicYear || '2026-2027',
      year: exam.year || 'III Year',
      semester: exam.semester || 'I Semester',
      subjectName: exam.subjectName || '',
      subjectCode: exam.subjectCode || '',
      examType: resolveExamType(exam),
      examName: exam.examName || '',
      examDate: exam.examDate || getTodayKolkataIso(),
      startTime: formatTime12h(exam.startTime, isPM ? '02:00 PM' : '09:00 AM'),
      endTime: formatTime12h(exam.endTime, isPM ? '05:00 PM' : '12:00 PM'),
      session: normSess,
      group: exam.group || 'ALL',
      allowOvernight: Boolean(exam.allowOvernight),
    });
    setSelectedSections(existingSecs);
    setExamFormError('');
    setShowCreateExamModal(true);
  };

  const handleExamSessionChange = (sess) => {
    const normSess = normalizeSessionCode(sess, 'AM');
    const isPM = normSess === 'PM';
    setExamForm((prev) => {
      const startMins = toMinutesFromMidnight(prev.startTime || (isPM ? '09:00 AM' : '02:00 PM'));
      const endMins = toMinutesFromMidnight(prev.endTime || (isPM ? '12:00 PM' : '05:00 PM'));
      const startIsAfternoon = startMins >= 12 * 60;
      const endIsAfternoon = endMins >= 12 * 60;
      const needsDefault = isPM
        ? !startIsAfternoon || (!prev.allowOvernight && !endIsAfternoon)
        : startIsAfternoon;

      return {
        ...prev,
        session: normSess,
        ...(needsDefault
          ? {
              startTime: isPM ? '02:00 PM' : '09:00 AM',
              endTime: isPM ? '05:00 PM' : '12:00 PM',
            }
          : {}),
      };
    });
  };

  const handleToggleExamSection = (sectionCode) => {
    setSelectedSections((prev) =>
      prev.includes(sectionCode)
        ? prev.filter((s) => s !== sectionCode)
        : [...prev, sectionCode]
    );
  };

  // Submit Create or Edit Examination
  const handleSaveExam = async (e, saveAsDraft = false) => {
    if (e && e.preventDefault) e.preventDefault();
    setExamFormError('');

    if (!examForm.examName || !examForm.examName.trim()) {
      setExamFormError('Examination Title is required.');
      return;
    }
    if (!examForm.subjectName || !examForm.subjectCode) {
      setExamFormError('Subject Name and Subject Code are required.');
      return;
    }
    if (!examForm.examDate) {
      setExamFormError('Examination Date is required.');
      return;
    }
    const timeCheck = validateExamTimeRange(examForm.startTime, examForm.endTime, {
      session: examForm.session,
      allowOvernight: Boolean(examForm.allowOvernight),
    });
    if (!timeCheck.valid) {
      setExamFormError(timeCheck.message);
      return;
    }
    if (!activeSelectedSectionObjects || activeSelectedSectionObjects.length === 0) {
      setExamFormError(
        `Please select at least one assigned section for ${examForm.subjectName}.`
      );
      return;
    }

    if (saveLockRef.current || creatingExam) return;
    saveLockRef.current = true;
    let savedOk = false;
    try {
      setCreatingExam(true);
      const payload = {
        examName: examForm.examName.trim(),
        examType: examForm.examType || 'UNIT 1',
        subjectName: examForm.subjectName,
        subjectCode: examForm.subjectCode,
        academicYear: examForm.academicYear,
        department: 'Computer Science and Engineering',
        year: examForm.year,
        semester: examForm.semester,
        examDate: examForm.examDate,
        startTime: examForm.startTime,
        endTime: examForm.endTime,
        session: examForm.session,
        group: examForm.group,
        selectedSections: activeSelectedSectionObjects.map((s) => s.section),
        selectedMappingIds: activeSelectedSectionObjects.map((s) => s.mappingId),
      };

      if (editingExam) {
        if (saveAsDraft) {
          payload.saveAsDraft = true;
        } else {
          payload.submitForReview = true;
        }
        const res = await api.put(`/exams/${editingExam._id}`, payload, {
          timeout: API_TIMEOUTS.HEAVY_WRITE,
        });
        if (res?.data?.success && res.data.data?._id) {
          savedOk = true;
          const updatedExam = res.data.data;
          setShowCreateExamModal(false);
          setEditingExam(null);
          setExamTabFilter('ALL');
          setFacultyExams((prev) =>
            prev.map((ex) => (String(ex._id) === String(updatedExam._id) ? updatedExam : ex))
          );
          setFeedback({
            type: 'success',
            text: res.data.message || `Examination "${payload.examName}" updated and saved to database.`,
          });
        } else {
          setExamFormError(res?.data?.message || 'Database did not return the updated examination record.');
        }
      } else {
        payload.saveAsDraft = saveAsDraft;
        const res = await api.post('/exams/create-centralized', payload, {
          timeout: API_TIMEOUTS.HEAVY_WRITE,
        });
        if (res?.data?.success && res.data.data?._id) {
          savedOk = true;
          const createdExam = res.data.data;
          setShowCreateExamModal(false);
          setExamTabFilter('ALL');
          setFacultyExams((prev) => [
            createdExam,
            ...prev.filter((ex) => String(ex._id) !== String(createdExam._id)),
          ]);
          setFeedback({
            type: 'success',
            text:
              res.data.message ||
              `Examination "${payload.examName}" created across ${activeSelectedSectionObjects.length} section(s).`,
          });
        } else {
          setExamFormError(res?.data?.message || 'Database did not return the saved examination record.');
        }
      }
    } catch (err) {
      console.error('Failed to save examination:', err);
      setExamFormError(
        formatApiError(err, 'Failed to save examination. Please verify schedule and conflicts.')
      );
    } finally {
      setCreatingExam(false);
      saveLockRef.current = false;
    }

    if (savedOk) {
      await loadPortalData({ preserveFeedbackOnError: true });
    }
  };

  // Fetch & Open Examination Details Modal
  const handleOpenExamDetails = async (exam) => {
    setExamDetailModal(exam);
    setExamDetailLoading(true);
    try {
      const res = await api.get(`/exams/${exam._id}`);
      if (res.data.success && res.data.data) {
        setExamDetailModal(res.data.data);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.message || 'Failed to load full examination details.',
      });
    } finally {
      setExamDetailLoading(false);
    }
  };

  // Confirm & Execute Delete Eligible Draft/Pending Examination
  const handleConfirmDeleteExam = async () => {
    if (!deleteConfirmExam || deleteLockRef.current || deletingExam) return;
    const targetExam = deleteConfirmExam;
    deleteLockRef.current = true;
    try {
      setDeletingExam(true);
      const res = await api.delete(`/exams/${targetExam._id}`);
      if (res.data.success) {
        setFacultyExams((prev) => prev.filter((ex) => String(ex._id) !== String(targetExam._id)));
        setFeedback({
          type: 'success',
          text:
            res.data.message ||
            `Examination "${targetExam.examName}" deleted cleanly.`,
        });
        setDeleteConfirmExam(null);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatApiError(err, 'Failed to delete examination.'),
      });
      setDeleteConfirmExam(null);
    } finally {
      setDeletingExam(false);
      deleteLockRef.current = false;
    }
  };

  // Submit Cancellation Request for Approved/Published Examination
  const handleSubmitCancelRequest = async (e) => {
    e.preventDefault();
    if (!cancelRequestExam || !cancelReason.trim()) return;
    try {
      setSubmittingCancel(true);
      const res = await api.post(`/exams/${cancelRequestExam._id}/request-cancel`, {
        reason: cancelReason.trim(),
      });
      if (res.data.success) {
        setFeedback({
          type: 'success',
          text: res.data.message || 'Cancellation request submitted to Administrator.',
        });
        setCancelRequestExam(null);
        setCancelReason('');
        await loadPortalData();
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.response?.data?.message || 'Failed to submit cancellation request.',
      });
    } finally {
      setSubmittingCancel(false);
    }
  };

  // Filtered Faculty Examinations list for Management Table
  const filteredFacultyExams = useMemo(() => {
    let base = facultyExams;
    if (examTypeFilter && examTypeFilter !== 'ALL') {
      base = base.filter((ex) => resolveExamType(ex) === examTypeFilter);
    }
    if (examTabFilter === 'ALL') return base;
    if (examTabFilter === 'MINE') {
      return base.filter(
        (ex) => ex.isOwner || (user?._id && ex.createdBy === user._id)
      );
    }
    if (examTabFilter === 'DRAFT') {
      return base.filter((ex) => ex.approvalStatus === 'DRAFT' || ex.status === 'DRAFT');
    }
    if (examTabFilter === 'PENDING_REVIEW') {
      return base.filter(
        (ex) => ex.approvalStatus === 'PENDING_REVIEW' && ex.status !== 'COMPLETED'
      );
    }
    if (examTabFilter === 'PUBLISHED') {
      return base.filter(
        (ex) => ex.status === 'PUBLISHED' || ex.visibilityStatus === 'PUBLISHED'
      );
    }
    if (examTabFilter === 'COMPLETED') {
      return base.filter((ex) => ex.status === 'COMPLETED');
    }
    return base;
  }, [facultyExams, examTabFilter, examTypeFilter, user]);

  return (
    <div className="space-y-6">
      {/* 1. Header: Portal Identity & Role Info */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-200 gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="p-2 rounded-xl bg-primary text-white shadow-xs">
              <GraduationCap size={22} />
            </span>
            <div>
              <h1 className="text-xl font-bold text-navy-800 tracking-tight">
                Faculty Examination Portal
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous) • Department of CSE
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls & Identity Badge */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => loadPortalData()}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 shadow-sm transition-colors disabled:opacity-50"
            title="Refresh Mappings from Database"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-primary' : 'text-slate-500'} />
            <span className="hidden sm:inline">Refresh Mappings</span>
          </button>

          <div className="flex items-center space-x-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-xl">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'FC'}
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-navy-800">{user?.name || 'Faculty Member'}</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase tracking-wider ${
                    isAdmin
                      ? 'bg-purple-100 text-purple-800'
                      : isExamIncharge
                      ? 'bg-blue-100 text-primary'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isAdmin ? 'Admin' : isExamIncharge ? 'Exam Incharge' : 'Faculty'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate max-w-[200px]">
                {user?.email || 'faculty@rgmcet.edu.in'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification Banner */}
      {feedback.text && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
              : 'bg-red-50 text-red-900 border-red-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            )}
            <span className="font-semibold">{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback({ type: '', text: '' })}
            className="text-[10px] font-bold underline ml-3 flex-shrink-0 hover:text-navy-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Filters & Metrics Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Academic Year Filter */}
            <div className="flex items-center space-x-1.5">
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Year:
              </label>
              <select
                value={selectedAcademicYear}
                onChange={(e) => setSelectedAcademicYear(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-navy-800"
              >
                <option value="ALL">All Academic Years</option>
                {filterOptions.academicYears?.map((ay) => (
                  <option key={ay} value={ay}>
                    {ay}
                  </option>
                ))}
              </select>
            </div>

            {/* Semester Filter */}
            <div className="flex items-center space-x-1.5">
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                Sem:
              </label>
              <select
                value={selectedSemester}
                onChange={(e) => setSelectedSemester(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-navy-800"
              >
                <option value="ALL">All Semesters</option>
                {filterOptions.semesters?.map((sem) => (
                  <option key={sem} value={sem}>
                    {sem}
                  </option>
                ))}
              </select>
            </div>

            {/* Faculty Filter (Only for Exam Incharge / Admin) */}
            {isExamIncharge && filterOptions.faculties?.length > 0 && (
              <div className="flex items-center space-x-1.5">
                <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  Faculty:
                </label>
                <select
                  value={selectedFaculty}
                  onChange={(e) => setSelectedFaculty(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-navy-800 max-w-[180px]"
                >
                  <option value="ALL">All Faculty Members</option>
                  {filterOptions.faculties.map((fac) => (
                    <option key={fac} value={fac}>
                      {fac}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Subject Search */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subject or code..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary w-44 sm:w-56"
              />
            </div>
          </div>

          {/* Action Tools */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleToggleAll(true)}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Expand All
            </button>
            <button
              onClick={() => handleToggleAll(false)}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Collapse All
            </button>
            <button
              onClick={() => handleOpenCreateExam()}
              className="inline-flex items-center px-3.5 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-hover rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <PlusCircle size={14} className="mr-1.5" />
              Create New Examination
            </button>
          </div>
        </div>

        {/* Metric Summary Counters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-primary flex items-center justify-center flex-shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                Assigned Subjects
              </div>
              <div className="text-xl font-bold text-navy-800">
                {filteredSubjects.length}
                <span className="text-xs text-slate-500 font-normal ml-1">Unique Courses</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <Layers size={20} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                Assigned Sections
              </div>
              <div className="text-xl font-bold text-navy-800">
                {filteredSubjects.reduce((sum, s) => sum + (s.sections?.length || 0), 0)}
                <span className="text-xs text-slate-500 font-normal ml-1">Sections</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center flex-shrink-0">
              <Users size={20} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                Total Student Enrollments
              </div>
              <div className="text-xl font-bold text-navy-800">
                {filteredSubjects.reduce((sum, s) => sum + (s.totalStudents || 0), 0).toLocaleString()}
                <span className="text-xs text-slate-500 font-normal ml-1">Students</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Main Content: Grouped Hierarchy & Expandable Subject Groups */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 rounded-xl border border-slate-200 shadow-sm text-center">
            <RefreshCw size={28} className="animate-spin text-primary mx-auto mb-2" />
            <h3 className="text-xs font-bold text-navy-800">Loading Subject & Section Hierarchy...</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Retrieving verified permanent mappings from MongoDB</p>
          </div>
        ) : filteredSubjects.length === 0 ? (
          <div className="bg-white p-12 rounded-xl border border-slate-200 shadow-sm text-center space-y-2">
            <BookOpen size={36} className="mx-auto text-slate-300" />
            <h3 className="text-sm font-bold text-navy-800">No Subject Mappings Found</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {searchQuery
                ? `No courses match your search query "${searchQuery}". Try clearing filters.`
                : !isExamIncharge
                ? `No permanent subject sections have been assigned to ${user?.name || 'your account'} yet. Contact your department Exam Incharge or Administrator.`
                : 'No active permanent mappings found in the database. Please verify Faculty & Student Assignment configurations.'}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 px-3 py-1 text-xs font-semibold rounded bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                Clear Search Filter
              </button>
            )}
          </div>
        ) : (
          filteredSubjects.map((subject) => {
            const subjectKey = `${subject.subjectCode}___${subject.subjectName}`;
            const isExpanded = expandedKeys.has(subjectKey);

            return (
              <div
                key={subjectKey}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all"
              >
                {/* Subject Header Card */}
                <div
                  onClick={() => toggleSubject(subjectKey)}
                  className={`p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 cursor-pointer select-none transition-colors ${
                    isExpanded ? 'bg-slate-50/80 border-b border-slate-200' : 'hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start md:items-center space-x-3">
                    <span
                      className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                        isExpanded ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <BookOpen size={18} />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold text-navy-800 tracking-tight">
                          {subject.subjectName}
                        </h2>
                        <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-blue-50 text-primary border border-blue-200">
                          {subject.subjectCode}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {subject.year || 'III Year'} • {subject.semester || 'I Semester'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {subject.department || 'Computer Science and Engineering'} • {subject.academicYear || '2026-2027'}
                      </p>
                    </div>
                  </div>

                  {/* Summary & Actions on Right */}
                  <div className="flex items-center space-x-4 pl-11 md:pl-0">
                    <div className="text-right">
                      <div className="text-xs font-bold text-navy-800">
                        {subject.sections.length} Section{subject.sections.length !== 1 ? 's' : ''}
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-700">
                        {subject.totalStudents} Students Enrolled
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenCreateExam(subject);
                      }}
                      className="hidden sm:inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-lg text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
                      title={`Create examination for ${subject.subjectName}`}
                    >
                      <PlusCircle size={12} className="mr-1" />
                      Schedule Exam
                    </button>

                    <button
                      type="button"
                      aria-label="Toggle section list"
                      className="p-1 rounded-md text-slate-400 hover:text-navy-800 transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Sections Table */}
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/70 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="py-2.5 px-4 w-28">Academic Section</th>
                          <th className="py-2.5 px-4 w-28">Group</th>
                          <th className="py-2.5 px-4">Assigned Faculty</th>
                          <th className="py-2.5 px-4 text-center w-36">Enrolled Students</th>
                          <th className="py-2.5 px-4 text-right w-28">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {subject.sections.map((sec) => (
                          <tr
                            key={sec.mappingId}
                            onClick={() => handleOpenRoster(sec, subject)}
                            className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                          >
                            <td className="py-3 px-4 font-bold text-navy-800">
                              <span className="px-2.5 py-1 rounded-md font-bold bg-slate-100 text-navy-800 border border-slate-200">
                                Section {sec.section}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  sec.group === 'Group A'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-purple-50 text-purple-700 border border-purple-200'
                                }`}
                              >
                                {sec.group || 'Group A'}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-navy-800">{sec.facultyName}</div>
                              <div className="text-[10px] text-slate-500">Department of CSE</div>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="font-mono font-bold text-emerald-700 text-xs">
                                {sec.studentCount}
                              </span>
                              <span className="text-[11px] text-slate-500 ml-1">Students</span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenRoster(sec, subject);
                                }}
                                className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-lg text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 group-hover:border-primary transition-colors cursor-pointer"
                              >
                                <Eye size={12} className="mr-1 text-primary" />
                                View Roster
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 4. Student Roster Modal / Slide-over */}
      {activeSectionMapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded font-bold text-xs bg-primary text-white">
                    Section {activeSectionMapping.section}
                  </span>
                  <span className="px-2 py-0.5 rounded font-bold text-xs bg-blue-100 text-primary border border-blue-200 font-mono">
                    {activeSectionMapping.subjectCode}
                  </span>
                  <h3 className="text-sm font-bold text-navy-800">
                    {activeSectionMapping.subjectName}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-600">
                  <span>
                    Faculty: <strong>{activeSectionMapping.facultyName}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Group: <strong>{activeSectionMapping.group || 'Group A'}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Year & Sem:{' '}
                    <strong>
                      {activeSectionMapping.year || 'III Year'} - {activeSectionMapping.semester || 'I Semester'}
                    </strong>
                  </span>
                </div>
              </div>

              <button
                onClick={handleCloseRoster}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Sub-bar: Search & Total Count */}
            <div className="p-3 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Filter by roll number or name..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary w-full"
                />
              </div>

              <div className="text-xs text-slate-600 font-medium">
                Showing <strong className="text-navy-800">{modalFilteredStudents.length}</strong> of{' '}
                <strong className="text-navy-800">{rosterData?.students?.length || activeSectionMapping.studentCount}</strong> enrolled students
              </div>
            </div>

            {/* Modal Body: Student Roster Table */}
            <div className="overflow-y-auto flex-1 p-0">
              {rosterLoading ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  <RefreshCw size={24} className="animate-spin text-primary mx-auto mb-2" />
                  Loading student roster from database...
                </div>
              ) : rosterError ? (
                <div className="p-6 text-center text-xs text-red-600 bg-red-50 m-4 rounded-xl border border-red-200">
                  <AlertCircle size={24} className="mx-auto mb-1 text-red-500" />
                  <strong className="block mb-1">Access Restricted</strong>
                  <span>{rosterError}</span>
                </div>
              ) : modalFilteredStudents.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No students found matching your search.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px] sticky top-0">
                    <tr>
                      <th className="py-2 px-4 w-12 text-center">S.No.</th>
                      <th className="py-2 px-4 w-40">Registration Number</th>
                      <th className="py-2 px-4">Student Name</th>
                      <th className="py-2 px-4 w-24 text-center">Section</th>
                      <th className="py-2 px-4 w-24 text-center">Group</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {modalFilteredStudents.map((st, idx) => (
                      <tr key={st.registrationNumber || idx} className="hover:bg-slate-50/70">
                        <td className="py-2 px-4 text-center text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-4 font-mono font-bold text-navy-800">
                          {st.registrationNumber}
                        </td>
                        <td className="py-2 px-4 text-slate-800">
                          {st.name || st.studentName || 'Student'}
                        </td>
                        <td className="py-2 px-4 text-center font-bold text-slate-600">
                          {activeSectionMapping.section}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {st.group || activeSectionMapping.group || 'Group A'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <span>RGMCET Examination System — Protected Student Roster</span>
              <button
                onClick={handleCloseRoster}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition-colors shadow-2xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Faculty & Centralized Examination Creation / Edit Modal */}
      {showCreateExamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="p-1.5 rounded-lg bg-primary text-white">
                    {editingExam ? <Edit3 size={18} /> : <Calendar size={18} />}
                  </span>
                  <h3 className="text-base font-bold text-navy-800 tracking-tight">
                    {editingExam
                      ? `Edit Examination — ${editingExam.examName}`
                      : isExamIncharge
                      ? 'Create Examination — Exam Incharge'
                      : 'Create New Examination — Faculty Portal'}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingExam
                    ? 'Modify examination schedule, subject, group, or assigned sections. Conflicts and draft allocations are automatically re-verified.'
                    : 'Only subjects and sections permanently assigned to your account are shown. Classrooms, seats, and attendance rosters are auto-allocated.'}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCreateExamModal(false);
                  setEditingExam(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {examFormError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center space-x-2">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                <span className="font-medium">{examFormError}</span>
              </div>
            )}

            {/* Modal Form */}
            <form onSubmit={(e) => handleSaveExam(e, false)} className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Step 1: Cohort & Subject Selection */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-navy-800 uppercase tracking-wider flex items-center">
                  <BookOpen size={14} className="mr-1.5 text-primary" />
                  Step 1: Academic Cohort, Subject & Group Selection
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Academic Year:
                    </label>
                    <select
                      value={examForm.academicYear}
                      onChange={(e) => setExamForm({ ...examForm, academicYear: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="2026-2027">2026-2027</option>
                      <option value="2025-2026">2025-2026</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">Year:</label>
                    <select
                      value={examForm.year}
                      onChange={(e) => setExamForm({ ...examForm, year: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="III Year">III Year</option>
                      <option value="IV Year">IV Year</option>
                      <option value="II Year">II Year</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">Semester:</label>
                    <select
                      value={examForm.semester}
                      onChange={(e) => setExamForm({ ...examForm, semester: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="I Semester">I Semester</option>
                      <option value="II Semester">II Semester</option>
                    </select>
                  </div>
                </div>

                {/* Subject Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Select Assigned Subject: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={examForm.subjectName}
                      onChange={(e) => {
                        const name = e.target.value;
                        const match = availableScheduleSubjects.find((s) => s.subjectName === name);
                        const nextSections = getSectionsForSubjectGroup(name, examForm.group).map(
                          (s) => s.section
                        );
                        setExamForm({
                          ...examForm,
                          subjectName: name,
                          subjectCode: match?.subjectCode || '',
                          year: match?.year || examForm.year,
                          semester: match?.semester || examForm.semester,
                          examName: editingExam
                            ? examForm.examName
                            : name
                            ? `Mid-Term Examination I - ${name}`
                            : examForm.examName,
                        });
                        setSelectedSections(nextSections);
                      }}
                      required
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg bg-white text-navy-800"
                    >
                      <option value="">-- Choose Your Assigned Subject --</option>
                      {availableScheduleSubjects.map((s) => (
                        <option key={s.subjectCode} value={s.subjectName}>
                          {s.abbreviation ? `${s.abbreviation} — ` : ''}
                          {s.subjectName} ({s.subjectCode})
                          {s.sections && s.sections.length > 0 ? ` — ${s.sections.length} Section(s)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">Subject Code:</label>
                    <input
                      type="text"
                      readOnly
                      value={examForm.subjectCode}
                      placeholder="e.g. 20A05501T"
                      className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg bg-slate-100 text-primary cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Group A / Group B / All Assigned Sections */}
                <div className="pt-2 border-t border-slate-200/70">
                  <label className="block text-[11px] font-bold text-navy-800 mb-1.5">
                    Examination Group Scope:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      { id: 'ALL', label: 'All Assigned Sections', desc: 'All sections assigned to you' },
                      { id: 'Group A', label: 'Group A (A1, A2, A3)', desc: 'Rooms 3010 – 3030' },
                      { id: 'Group B', label: 'Group B (A4, A5, A6)', desc: 'Rooms 3040 – 3060' },
                    ].map((grpOpt) => (
                      <button
                        key={grpOpt.id}
                        type="button"
                        onClick={() => {
                          const nextSecs = getSectionsForSubjectGroup(
                            examForm.subjectName,
                            grpOpt.id
                          ).map((s) => s.section);
                          setExamForm({ ...examForm, group: grpOpt.id });
                          setSelectedSections(nextSecs);
                        }}
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                          examForm.group === grpOpt.id
                            ? 'bg-blue-50 border-primary text-navy-800 ring-1 ring-primary'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-xs font-bold">{grpOpt.label}</div>
                        <div className="text-[10px] text-slate-500">{grpOpt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Individual Section Selection Checkboxes */}
                {currentExamSubjectSections.length > 0 ? (
                  <div className="mt-3 p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-emerald-950 flex items-center">
                        <CheckCircle2 size={15} className="mr-1.5 text-emerald-600" />
                        Select Your Assigned Sections ({activeSelectedSectionObjects.length} of{' '}
                        {currentExamSubjectSections.length} Selected)
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSections(currentExamSubjectSections.map((s) => s.section))
                          }
                          className="text-[10px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setSelectedSections([])}
                          className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                        <span className="text-[11px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded">
                          {activeSelectedSectionObjects.reduce((sum, s) => sum + s.studentCount, 0)} Students
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {currentExamSubjectSections.map((sec) => {
                        const isChecked = selectedSections.includes(sec.section);
                        return (
                          <label
                            key={sec.mappingId}
                            className={`flex items-start space-x-2 p-2.5 rounded-lg border text-[11px] cursor-pointer select-none transition-all ${
                              isChecked
                                ? 'bg-white border-primary ring-1 ring-primary/30 shadow-2xs'
                                : 'bg-slate-50 border-slate-200 opacity-65 hover:opacity-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleExamSection(sec.section)}
                              className="mt-0.5 w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between font-bold">
                                <span className="text-navy-800">Section {sec.section}</span>
                                <span className="text-emerald-700">{sec.studentCount} Students</span>
                              </div>
                              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                                {sec.group || 'Group A'} • {sec.facultyName}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  examForm.subjectName && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                      No permanently assigned sections found under your account for{' '}
                      <strong>{examForm.subjectName}</strong> ({examForm.group}).
                    </div>
                  )
                )}
              </div>

              {/* Step 2: Schedule & Timings */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="text-xs font-bold text-navy-800 uppercase tracking-wider flex items-center">
                  <Clock size={14} className="mr-1.5 text-primary" />
                  Step 2: Examination Title, Date & Asia/Kolkata Timings
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Examination Type: <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={examForm.examType || 'UNIT 1'}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setExamForm((prev) => ({
                          ...prev,
                          examType: nextType,
                          ...(!editingExam
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

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Examination Title: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={examForm.examName}
                      onChange={(e) => setExamForm({ ...examForm, examName: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-medium bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Examination Date (IST): <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={examForm.examDate}
                      onChange={(e) => setExamForm({ ...examForm, examDate: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg text-navy-800 bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Session (AM/PM): <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleExamSessionChange('AM')}
                        className={`py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          normalizeSessionCode(examForm.session, 'AM') === 'AM'
                            ? 'bg-primary text-white shadow-xs'
                            : 'bg-white border border-slate-300 text-slate-700'
                        }`}
                      >
                        Morning (AM)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExamSessionChange('PM')}
                        className={`py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          normalizeSessionCode(examForm.session, 'AM') === 'PM'
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
                      label="Start Time:"
                      required
                      idPrefix="faculty-start"
                      value={examForm.startTime}
                      sessionHint={examForm.session}
                      onChange={(val) => setExamForm((prev) => ({ ...prev, startTime: val }))}
                    />
                  </div>

                  <div>
                    <TimeSelect12h
                      label="End Time:"
                      required
                      isEndTime
                      idPrefix="faculty-end"
                      value={examForm.endTime}
                      sessionHint={examForm.session}
                      onChange={(val) => setExamForm((prev) => ({ ...prev, endTime: val }))}
                    />
                  </div>
                </div>

                {(() => {
                  const tc = validateExamTimeRange(examForm.startTime, examForm.endTime, {
                    session: examForm.session,
                    allowOvernight: Boolean(examForm.allowOvernight),
                  });
                  return !tc.valid ? (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 font-semibold flex items-center space-x-2">
                      <AlertCircle size={14} className="flex-shrink-0 text-red-600" />
                      <span>{tc.message}</span>
                    </div>
                  ) : null;
                })()}

                <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-navy-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <span className="font-semibold">
                    Student Early Access (20 Minutes Before Start):
                  </span>
                  <span className="font-mono font-bold text-primary">
                    {computeVisibilityWindowLabel(examForm.startTime)}
                  </span>
                </div>

                {editingExam && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900">
                    <strong>Reallocation Policy:</strong> If date, timings, subject, or sections change, any existing draft seating records are safely superseded and regenerated cleanly.
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateExamModal(false);
                    setEditingExam(null);
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creatingExam || activeSelectedSectionObjects.length === 0}
                  onClick={() => handleSaveExam(null, true)}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-navy-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-50 transition-colors flex items-center cursor-pointer"
                >
                  <Save size={14} className="mr-1.5" />
                  {editingExam ? 'Save Draft' : 'Save as Draft'}
                </button>
                <button
                  type="submit"
                  disabled={creatingExam || activeSelectedSectionObjects.length === 0}
                  className="px-5 py-2 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-xs disabled:opacity-50 transition-colors flex items-center cursor-pointer"
                >
                  {creatingExam ? (
                    <>
                      <RefreshCw size={14} className="animate-spin mr-1.5" />
                      <span>Saving Examination...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} className="mr-1.5" />
                      <span>
                        {editingExam
                          ? `Save & Submit for Review (${activeSelectedSectionObjects.length} Sections)`
                          : `Create & Submit Examination (${activeSelectedSectionObjects.length} Sections)`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Faculty Examination Management Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-lg bg-blue-50 text-primary">
              <Calendar size={16} />
            </span>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-navy-800">
                Examination Management ({filteredFacultyExams.length})
              </h2>
              <p className="text-[11px] text-slate-500">
                Create, view, edit draft/pending examinations, delete eligible drafts, or request cancellation.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={examTypeFilter}
              onChange={(e) => setExamTypeFilter(e.target.value)}
              aria-label="Filter Faculty Exams by Examination Type"
              className="px-2.5 py-1.5 text-[11px] font-bold border border-slate-300 rounded-lg bg-white text-navy-800"
            >
              <option value="ALL">All Types</option>
              {EXAM_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-[11px] font-semibold">
            {[
              { id: 'ALL', label: `All (${facultyExams.length})` },
              { id: 'MINE', label: 'My Created' },
              { id: 'DRAFT', label: 'Drafts' },
              { id: 'PENDING_REVIEW', label: 'Pending Review' },
              { id: 'PUBLISHED', label: 'Published' },
              { id: 'COMPLETED', label: 'Completed' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setExamTabFilter(tab.id)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  examTabFilter === tab.id
                    ? 'bg-white text-navy-800 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-navy-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-slate-400">
            <RefreshCw size={22} className="animate-spin text-primary mx-auto mb-2" />
            Loading examinations from database...
          </div>
        ) : examsError ? (
          <div className="py-10 px-4 text-center space-y-2.5 bg-red-50/40">
            <AlertCircle size={30} className="mx-auto text-red-500" />
            <div className="text-xs font-bold text-red-800">{examsError}</div>
            <button
              type="button"
              onClick={() => loadPortalData()}
              className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-50 text-[11px] font-bold"
            >
              <RefreshCw size={12} className="mr-1.5" />
              Retry Loading
            </button>
          </div>
        ) : filteredFacultyExams.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Calendar size={32} className="mx-auto text-slate-300" />
            <div className="text-xs font-bold text-navy-800">No examinations found in this view.</div>
            <p className="text-[11px] text-slate-500">
              Click "Create New Examination" above to schedule an exam for your assigned sections.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Examination</th>
                  <th className="py-2.5 px-3">Subject</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Session</th>
                  <th className="py-2.5 px-3">Sections</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFacultyExams.map((exam) => (
                  <tr key={exam._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {resolveExamType(exam)}
                        </span>
                        <span className="font-bold text-navy-800">{exam.examName}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {exam.academicYear || '2026-2027'} • {exam.studentCount || 0} Students
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-navy-800">{exam.subjectName}</div>
                      <div className="font-mono text-[10px] text-primary">{exam.subjectCode}</div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-navy-800 whitespace-nowrap">
                      {exam.examDate}
                    </td>
                    <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                      <div className="font-bold">{formatSessionLabel(exam.session, exam.startTime)}</div>
                      <div className="text-[10px] text-slate-500">
                        {formatExamTimeRange(exam)}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1">
                        {(exam.section || '')
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((sec) => (
                            <span
                              key={sec}
                              className="px-2 py-0.5 rounded font-bold text-[10px] bg-blue-50 text-primary border border-blue-200"
                            >
                              {sec}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        {exam.status === 'COMPLETED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                            Completed
                          </span>
                        ) : exam.status === 'CANCELLED' || exam.approvalStatus === 'CANCELLED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            Cancelled
                          </span>
                        ) : exam.visibilityStatus === 'PUBLISHED' || exam.status === 'PUBLISHED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Published
                          </span>
                        ) : exam.approvalStatus === 'APPROVED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            Approved
                          </span>
                        ) : exam.approvalStatus === 'DRAFT' || exam.status === 'DRAFT' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            Draft
                          </span>
                        ) : exam.approvalStatus === 'REJECTED' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            Rejected
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            Pending Review
                          </span>
                        )}
                        {exam.cancellationRequested && exam.status !== 'CANCELLED' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900">
                            Cancel Requested
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleOpenExamDetails(exam)}
                          title="View Examination Details"
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors inline-flex items-center cursor-pointer"
                        >
                          <Eye size={12} className="mr-1" />
                          View
                        </button>

                        {exam.canEdit && (
                          <button
                            type="button"
                            onClick={() => handleOpenEditExam(exam)}
                            title="Edit Examination"
                            className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-primary border border-blue-200 text-[11px] font-semibold transition-colors inline-flex items-center cursor-pointer"
                          >
                            <Edit3 size={12} className="mr-1" />
                            Edit
                          </button>
                        )}

                        {exam.canDelete ? (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmExam(exam)}
                            title="Delete Draft/Pending Examination"
                            className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold transition-colors inline-flex items-center cursor-pointer"
                          >
                            <Trash2 size={12} className="mr-1" />
                            Delete
                          </button>
                        ) : exam.canRequestCancel && !exam.cancellationRequested ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelRequestExam(exam);
                              setCancelReason('');
                            }}
                            title="Request Admin Cancellation"
                            className="px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-semibold transition-colors inline-flex items-center cursor-pointer"
                          >
                            <Ban size={12} className="mr-1" />
                            Request Cancel
                          </button>
                        ) : null}

                        <button
                          type="button"
                          disabled={downloadingPdfKey === `row-${exam._id}`}
                          onClick={async () => {
                            const key = `row-${exam._id}`;
                            setDownloadingPdfKey(key);
                            try {
                              await downloadProtectedReport(
                                `/reports/${exam._id}/section-attendance-pdf/${
                                  (exam.sectionAllocations && exam.sectionAllocations[0]?.section) ||
                                  (exam.section || 'A1').split(',')[0].trim()
                                }`,
                                `Attendance_${exam.subjectCode || 'Exam'}.pdf`,
                                'download',
                                { onError: (msg) => setFeedback({ type: 'error', text: msg }) }
                              );
                            } finally {
                              setDownloadingPdfKey('');
                            }
                          }}
                          title="Download Attendance PDF"
                          className="p-1.5 rounded bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          <FileDown size={13} className={downloadingPdfKey === `row-${exam._id}` ? 'animate-pulse text-primary' : ''} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. View Examination Details Modal */}
      {examDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                    {resolveExamType(examDetailModal)}
                  </span>
                  <h3 className="text-sm font-bold text-navy-800">{examDetailModal.examName}</h3>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {examDetailModal.subjectName} ({examDetailModal.subjectCode}) • {examDetailModal.academicYear}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExamDetailModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {examDetailLoading && (
                <div className="text-center text-slate-400 py-2">Refreshing live examination details...</div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Exam Date</span>
                  <span className="font-bold text-navy-800">{examDetailModal.examDate}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Session & Time</span>
                  <span className="font-bold text-navy-800">
                    {formatSessionLabel(examDetailModal.session, examDetailModal.startTime)} ({formatExamTimeRange(examDetailModal)})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Student Early Access</span>
                  <span className="font-mono font-bold text-primary">
                    {computeVisibilityWindowLabel(examDetailModal.startTime)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Group</span>
                  <span className="font-bold text-navy-800">{examDetailModal.group || 'Group A'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Candidates</span>
                  <span className="font-bold text-emerald-700">{examDetailModal.studentCount || 0} Students</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Approval / Status</span>
                  <span className="font-bold text-navy-800">
                    {examDetailModal.approvalStatus} / {examDetailModal.status}
                  </span>
                </div>
              </div>

              {examDetailModal.sectionAllocations?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-navy-800">
                    Section-Wise Allocations & Classrooms ({examDetailModal.sectionAllocations.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {examDetailModal.sectionAllocations.map((sa, idx) => (
                      <div
                        key={sa._id || idx}
                        className="p-3 rounded-xl border border-slate-200 bg-white space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-blue-50 text-primary border border-blue-200">
                            Section {sa.section}
                          </span>
                          <span className="font-bold text-emerald-700">{sa.studentCount} Students</span>
                        </div>
                        <div className="text-[11px] font-semibold text-navy-800">
                          {sa.classroomName || `ET BLOCK ${sa.roomNumber}`}
                        </div>
                        <div className="text-[10px] text-slate-500">Faculty: {sa.facultyName}</div>
                        <button
                          type="button"
                          disabled={downloadingPdfKey === `modal-${examDetailModal._id}-${sa.section}`}
                          onClick={async () => {
                            const key = `modal-${examDetailModal._id}-${sa.section}`;
                            setDownloadingPdfKey(key);
                            try {
                              await downloadProtectedReport(
                                `/reports/${examDetailModal._id}/section-attendance-pdf/${sa.section}`,
                                `Attendance_${sa.section}.pdf`,
                                'download',
                                { onError: (msg) => setFeedback({ type: 'error', text: msg }) }
                              );
                            } finally {
                              setDownloadingPdfKey('');
                            }
                          }}
                          className="w-full mt-1 py-1 px-2 rounded bg-blue-50 hover:bg-blue-100 text-primary text-[10px] font-bold border border-blue-200 disabled:opacity-50 inline-flex items-center justify-center cursor-pointer"
                        >
                          <FileDown size={11} className="mr-1" />
                          {downloadingPdfKey === `modal-${examDetailModal._id}-${sa.section}`
                            ? 'Downloading PDF...'
                            : `Download Sec ${sa.section} Attendance PDF`}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const id = examDetailModal._id;
                  setExamDetailModal(null);
                  navigate(`/admin/allocations?examId=${id}`);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 inline-flex items-center cursor-pointer"
              >
                Open Seating Allocation View
                <ArrowRight size={13} className="ml-1" />
              </button>
              <button
                type="button"
                onClick={() => setExamDetailModal(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. In-App Delete Confirmation Dialog */}
      {deleteConfirmExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-red-100 text-red-600 flex-shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-navy-800">Confirm Examination Deletion</h3>
                <p className="text-xs text-slate-600">
                  Are you sure you want to delete this examination? Its draft allocations will be removed, while permanent student and faculty mappings remain untouched.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div>
                <span className="text-slate-500">Examination:</span>{' '}
                <strong className="text-navy-800">{deleteConfirmExam.examName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Subject:</span>{' '}
                <strong className="text-navy-800">
                  {deleteConfirmExam.subjectName} ({deleteConfirmExam.subjectCode})
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Date & Session:</span>{' '}
                <strong className="text-navy-800">
                  {deleteConfirmExam.examDate} ({deleteConfirmExam.startTime} – {deleteConfirmExam.endTime})
                </strong>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmExam(null)}
                disabled={deletingExam}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                Keep Examination
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteExam}
                disabled={deletingExam}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingExam ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. In-App Cancellation Request Modal (For Approved / Published Exams) */}
      {cancelRequestExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
          <form
            onSubmit={handleSubmitCancelRequest}
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 flex-shrink-0">
                <Ban size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-navy-800">Request Examination Cancellation</h3>
                <p className="text-xs text-slate-600">
                  This examination has already been approved or published and cannot be deleted directly. Submit a formal cancellation request to the Administrator.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-0.5">
              <div className="font-bold text-navy-800">{cancelRequestExam.examName}</div>
              <div className="text-slate-600">
                {cancelRequestExam.subjectName} • {cancelRequestExam.examDate}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-navy-800 mb-1">
                Reason for Cancellation Request <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Explain why this approved/published examination needs cancellation or rescheduling..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelRequestExam(null)}
                disabled={submittingCancel}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingCancel || !cancelReason.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                {submittingCancel ? 'Submitting...' : 'Submit Request to Admin'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default FacultyPortal;
