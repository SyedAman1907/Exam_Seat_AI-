import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import { formatExamTimeRange, formatSessionLabel } from '../../utils/dateTime';
import {
  Users,
  Grid3X3,
  PlusCircle,
  UploadCloud,
  ArrowRight,
  CheckCircle2,
  UserCheck,
  AlertCircle,
  Eye,
  FileDown,
  XCircle,
  Send,
  RefreshCw,
} from 'lucide-react';
import { downloadProtectedReport } from '../../utils/fileDownloader';

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });

  // Stats & Mappings
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalExaminations: 0,
    groupAExaminations: 0,
    groupBExaminations: 0,
    totalAllocations: 0,
    totalClassrooms: 0,
    pendingApprovals: 0,
    publishedExaminations: 0,
    sectionWiseAllocations: { A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0 },
    classroomUtilization: [],
  });
  const [mappings, setMappings] = useState([]);

  const [allExams, setAllExams] = useState([]);

  // Modal / Prompt State for Publish, Reject & Cancel
  const [publishModalExam, setPublishModalExam] = useState(null);
  const [rejectModalExam, setRejectModalExam] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelModalExam, setCancelModalExam] = useState(null);
  const [cancelReason, setCancelReason] = useState('Examination cancelled by Admin.');

  const pendingExams = useMemo(
    () => allExams.filter((e) => e.approvalStatus === 'PENDING_REVIEW' && !['COMPLETED', 'CANCELLED'].includes(e.status)),
    [allExams]
  );
  const approvedExams = useMemo(
    () => allExams.filter((e) => e.approvalStatus === 'APPROVED' && !['COMPLETED', 'CANCELLED'].includes(e.status)),
    [allExams]
  );
  const publishedExams = useMemo(
    () =>
      allExams.filter(
        (e) =>
          (e.visibilityStatus === 'PUBLISHED' || ['PUBLISHED', 'ONGOING'].includes(e.status)) &&
          !['COMPLETED', 'CANCELLED'].includes(e.status) &&
          e.approvalStatus !== 'CANCELLED'
      ),
    [allExams]
  );
  const completedExams = useMemo(
    () => allExams.filter((e) => e.status === 'COMPLETED' && e.approvalStatus !== 'CANCELLED'),
    [allExams]
  );
  const cancelledExams = useMemo(
    () => allExams.filter((e) => e.status === 'CANCELLED' || e.approvalStatus === 'CANCELLED'),
    [allExams]
  );

  const abortControllerRef = useRef(null);

  const fetchAllData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      const [statsRes, mappingsRes, examsRes] = await Promise.all([
        api.get('/dashboard/stats', { signal: controller.signal }),
        api.get('/mappings', { signal: controller.signal }),
        api.get('/exams?filter=all', { signal: controller.signal }),
      ]);

      if (statsRes.data.success) {
        setStats(statsRes.data.data);
      }
      if (mappingsRes.data.success) {
        setMappings(mappingsRes.data.mappings || []);
      }
      if (examsRes.data.success) {
        setAllExams(examsRes.data.data || []);
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Error fetching dashboard data:', err);
      setActionMessage({
        type: 'error',
        text: err.response?.data?.message || err.message || 'Failed to retrieve examination dashboard records from server.',
      });
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchAllData]);

  const confirmPublish = async () => {
    if (!publishModalExam) return;
    try {
      setActionLoading(true);
      setActionMessage({ type: '', text: '' });
      const res = await api.post(`/exams/${publishModalExam._id}/publish`, null, {
        timeout: API_TIMEOUTS.HEAVY_WRITE,
      });
      if (res.data.success) {
        setActionMessage({
          type: 'success',
          text: res.data.message || 'Examination approved and published successfully!',
        });
        setPublishModalExam(null);
        await fetchAllData();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: formatApiError(err, 'Failed to publish examination.'),
      });
      setPublishModalExam(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReject = (exam) => {
    setRejectModalExam(exam);
    setRejectReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectModalExam) return;
    try {
      setActionLoading(true);
      const res = await api.post(`/exams/${rejectModalExam._id}/reject`, {
        reason: rejectReason || 'Needs correction by faculty.',
      });
      if (res.data.success) {
        setActionMessage({
          type: 'info',
          text: `Examination "${rejectModalExam.subjectName}" rejected. Faculty notified to revise.`,
        });
        setRejectModalExam(null);
        await fetchAllData();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to reject examination.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenCancel = (exam) => {
    setCancelModalExam(exam);
    setCancelReason('Examination cancelled by Admin.');
  };

  const confirmCancelExam = async () => {
    if (!cancelModalExam) return;
    if (!cancelReason.trim()) {
      setActionMessage({ type: 'error', text: 'A formal cancellation reason is required.' });
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.post(`/exams/${cancelModalExam._id}/cancel`, {
        reason: cancelReason.trim(),
      });
      if (res.data.success) {
        setActionMessage({
          type: 'info',
          text: res.data.message || 'Examination cancelled successfully.',
        });
        setCancelModalExam(null);
        await fetchAllData();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to cancel examination.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const [downloadingExamId, setDownloadingExamId] = useState('');

  const downloadAttendanceSheet = async (examId) => {
    if (!examId || downloadingExamId === examId) return;
    setDownloadingExamId(examId);
    setActionMessage({ type: '', text: '' });
    try {
      await downloadProtectedReport(
        `/exams/${examId}/reports/signature-pdf`,
        'Attendance_Signature_Sheet.pdf',
        'download',
        {
          onError: (msg) => setActionMessage({ type: 'error', text: msg }),
        }
      );
    } finally {
      setDownloadingExamId('');
    }
  };

  // Reusable table for examination status sections
  const renderExamTable = (examList, emptyMsg, showAdminActions = false, badgeColor = 'blue') => {
    if (examList.length === 0) {
      return (
        <div className="py-6 px-4 text-center text-xs text-slate-400">
          {emptyMsg}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-2.5 px-3">Subject</th>
              <th className="py-2.5 px-3">Faculty</th>
              <th className="py-2.5 px-2 text-center">Section</th>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Time</th>
              <th className="py-2.5 px-2 text-center">Students</th>
              <th className="py-2.5 px-3">Classroom</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {examList.map((exam) => (
              <tr key={exam._id} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-3">
                  <div className="font-bold text-navy-800">{exam.subjectName}</div>
                  <div className="text-[10px] font-mono text-primary font-semibold">{exam.subjectCode}</div>
                </td>
                <td className="py-3 px-3 text-slate-700 font-medium">
                  {exam.facultyName || 'Dr. K. Subba Rao'}
                </td>
                <td className="py-3 px-2 text-center">
                  <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-blue-50 text-primary border border-blue-200">
                    {exam.section}
                  </span>
                </td>
                <td className="py-3 px-3 font-semibold text-navy-800 whitespace-nowrap">
                  {exam.examDate}
                </td>
                <td className="py-3 px-3 text-slate-600 whitespace-nowrap text-[11px]">
                  <div>{formatExamTimeRange(exam)}</div>
                  <div className="text-[10px] text-slate-400">{formatSessionLabel(exam.session, exam.startTime)}</div>
                </td>
                <td className="py-3 px-2 text-center font-bold text-navy-800">
                  {exam.studentCount || (exam.students ? exam.students.length : 0)}
                </td>
                <td className="py-3 px-3 whitespace-nowrap">
                  <div className="font-medium text-navy-800">{exam.classroomId?.name || 'ET BLOCK 3020'}</div>
                  <div className="text-[10px] text-slate-400">72 Seats</div>
                </td>
                <td className="py-3 px-3">
                  {exam.approvalStatus === 'PENDING_REVIEW' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      Pending Admin Review
                    </span>
                  )}
                  {exam.approvalStatus === 'APPROVED' && exam.visibilityStatus === 'SCHEDULED' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                      Approved (T-20 Schedule)
                    </span>
                  )}
                  {(exam.visibilityStatus === 'PUBLISHED' || exam.status === 'PUBLISHED' || exam.status === 'ONGOING') && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {exam.status === 'ONGOING' ? 'Ongoing Examination' : 'Live to Students'}
                    </span>
                  )}
                  {exam.approvalStatus === 'REJECTED' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                      Rejected
                    </span>
                  )}
                  {exam.approvalStatus === 'CANCELLED' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                      Cancelled
                    </span>
                  )}
                </td>
                <td className="py-3 px-3 text-right">
                  <div className="flex items-center justify-end space-x-1.5">
                    {/* View Seating Button */}
                    <button
                      onClick={() => navigate(`/admin/allocations?examId=${exam._id}`)}
                      title="View Seating Layout"
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors flex items-center"
                    >
                      <Eye size={12} className="mr-1" />
                      Seating
                    </button>

                    {/* Download Attendance PDF Button */}
                    <button
                      type="button"
                      onClick={() => downloadAttendanceSheet(exam._id)}
                      disabled={downloadingExamId === exam._id}
                      title="Download Attendance & Signature PDF (Zero FDH)"
                      className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-primary text-[11px] font-semibold transition-colors flex items-center border border-blue-200 disabled:opacity-50 cursor-pointer"
                    >
                      <FileDown size={12} className="mr-1" />
                      {downloadingExamId === exam._id ? 'Downloading...' : 'Attendance'}
                    </button>

                    {showAdminActions && (
                      <>
                        {/* Publish Examination Button */}
                        <button
                          onClick={() => setPublishModalExam(exam)}
                          disabled={actionLoading}
                          title="Approve and Publish Examination"
                          className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold transition-colors flex items-center shadow-xs cursor-pointer"
                        >
                          <Send size={11} className="mr-1" />
                          Publish
                        </button>

                        {/* Reject Examination Button */}
                        <button
                          onClick={() => handleOpenReject(exam)}
                          disabled={actionLoading}
                          title="Reject Examination"
                          className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold transition-colors border border-amber-300 cursor-pointer"
                        >
                          Reject
                        </button>

                        {/* Cancel Examination Button */}
                        <button
                          onClick={() => handleOpenCancel(exam)}
                          disabled={actionLoading}
                          title="Cancel Examination"
                          className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold transition-colors border border-red-200 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {!showAdminActions && exam.approvalStatus !== 'CANCELLED' && exam.status !== 'COMPLETED' && (
                      <button
                        onClick={() => handleOpenCancel(exam)}
                        title="Cancel Examination"
                        className="px-2 py-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 text-[11px] transition-colors cursor-pointer"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-navy-800 tracking-tight">
            Admin Examination Control & Publication Center
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous) • Department of CSE
          </p>
        </div>
        <div className="mt-3 sm:mt-0 flex items-center space-x-2">
          <button
            type="button"
            onClick={() => fetchAllData()}
            disabled={loading}
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs disabled:opacity-60"
            title="Reload dashboard examinations from database"
          >
            <RefreshCw size={14} className={`mr-1.5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            to="/admin/assignments"
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs"
          >
            <UserCheck size={14} className="mr-1.5 text-primary" />
            Faculty & Student Mapping
          </Link>
          <button
            onClick={() => navigate('/admin/exams?new=true')}
            className="inline-flex items-center px-4 py-2 border border-transparent text-xs font-semibold rounded-lg text-white bg-primary hover:bg-primary-hover shadow-sm transition-colors"
          >
            <PlusCircle size={15} className="mr-1.5" />
            Schedule Examination
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage.text && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : actionMessage.type === 'error'
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          <div className="flex items-center">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 size={16} className="mr-2 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="mr-2 flex-shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage({ type: '', text: '' })}
            className="text-[10px] font-bold underline ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Consolidated Academic Metric Summary Bar (reduces repetitive nested card borders) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Total Exams</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalExaminations}</p>
          <span className="text-xs text-slate-600">Recorded sessions</span>
        </div>

        <div className="p-4">
          <p className="text-[11px] font-bold text-primary uppercase tracking-wider">Group A</p>
          <p className="text-2xl font-bold text-primary mt-1">{stats.groupAExaminations || 0}</p>
          <span className="text-xs text-slate-600">Sections A1–A3</span>
        </div>

        <div className="p-4">
          <p className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">Group B</p>
          <p className="text-2xl font-bold text-purple-800 mt-1">{stats.groupBExaminations || 0}</p>
          <span className="text-xs text-slate-600">Sections A4–A6</span>
        </div>

        <div className="p-4">
          <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Master Students</p>
          <p className="text-2xl font-bold text-navy-900 mt-1">{stats.totalStudents}</p>
          <span className="text-xs text-slate-600">Unique candidates</span>
        </div>

        <div className="p-4">
          <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Pending Review</p>
          <p className="text-2xl font-bold text-amber-800 mt-1">{pendingExams.length}</p>
          <span className="text-xs text-slate-600">Awaiting approval</span>
        </div>

        <div className="p-4">
          <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Published Live</p>
          <p className="text-2xl font-bold text-emerald-800 mt-1">{publishedExams.length}</p>
          <span className="text-xs text-slate-600">Active portal access</span>
        </div>
      </div>

      {/* Section-Wise Allocations & Classroom Utilization Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Section-wise Allocations */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-navy-800 flex items-center">
              <Users size={14} className="mr-1.5 text-primary" />
              Section-Wise Student Allocations
            </h3>
            <span className="text-[10px] font-bold text-slate-500">6 Academic Sections</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            {['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((sec) => (
              <div key={sec} className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-[10px] font-bold text-primary block">Sec {sec}</span>
                <span className="text-base font-bold text-navy-800">{stats.sectionWiseAllocations?.[sec] || 0}</span>
                <span className="text-[9px] text-slate-400 block font-mono">
                  {['A1', 'A2', 'A3'].includes(sec) ? 'Group A' : 'Group B'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Classroom Utilization */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-navy-800 flex items-center">
              <Grid3X3 size={14} className="mr-1.5 text-primary" />
              Classroom Utilization & Mapping Status
            </h3>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {loading ? '...' : `${stats.totalClassrooms ?? (stats.classroomUtilization?.length || 0)} Active Classrooms`}
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            {(stats.classroomUtilization && stats.classroomUtilization.length > 0
              ? stats.classroomUtilization
              : []
            ).map((rm) => {
              const secMap = {
                '3010': 'A1',
                '3020': 'A2',
                '3030': 'A3',
                '3040': 'A4',
                '3050': 'A5',
                '3060': 'A6',
              };
              return (
                <div key={rm.roomNumber} className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-bold text-navy-800 block">Room {rm.roomNumber}</span>
                  <span className="text-[11px] font-semibold text-primary block">
                    {secMap[rm.roomNumber] ? `Sec ${secMap[rm.roomNumber]}` : rm.name}
                  </span>
                  <span className="text-[9px] text-emerald-600 block font-bold">{rm.capacity || 72} Seats</span>
                </div>
              );
            })}
            {!loading && (!stats.classroomUtilization || stats.classroomUtilization.length === 0) && (
              <div className="col-span-6 py-4 text-[11px] text-slate-400">
                No active classrooms configured.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FACULTY & STUDENT MAPPING */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100 gap-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-navy-800">
              Permanent Faculty &amp; Student Mappings
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Permanent subject, section, and student rosters synced across examination schedules.
            </p>
          </div>
          <Link
            to="/admin/assignments"
            className="es-btn-secondary px-3.5 py-2 text-xs self-start sm:self-center"
          >
            <UploadCloud size={14} className="mr-1.5 text-primary" />
            Manage Mappings
            <ArrowRight size={13} className="ml-1.5" />
          </Link>
        </div>

        {mappings.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-600">
            No permanent faculty mappings configured yet. Click &quot;Manage Mappings&quot; to upload faculty and student rosters.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mappings.slice(0, 6).map((m) => (
              <div key={m._id} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-navy-800 text-xs">{m.subjectName}</span>
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-blue-50 text-primary border border-blue-200">
                      {m.subjectCode}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 mt-1">
                    Faculty: <strong className="text-navy-800">{m.facultyName}</strong>
                  </div>
                  <div className="text-xs text-slate-600">
                    Section {m.section} • {m.studentCount || (m.students ? m.students.length : 0)} Students
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-600">
                  <span>Version {m.version || 1}</span>
                  <span className="text-emerald-700 font-semibold">Active Roster</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PENDING PUBLICATION (Admin Review & Publish Control) */}
      <div className="bg-white rounded-xl border border-amber-300 shadow-xs overflow-hidden">
        <div className="bg-amber-50/70 px-5 py-3.5 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-950">
              Pending Publication ({pendingExams.length})
            </h2>
            <p className="text-xs text-amber-900 mt-0.5">
              Examinations awaiting Admin review and publication approval
            </p>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider bg-white text-amber-900 border border-amber-300 px-2.5 py-1 rounded-md self-start sm:self-center">
            Approval Queue
          </span>
        </div>

        {renderExamTable(
          pendingExams,
          'No examinations currently pending Admin review. All scheduled exams have been published or approved.',
          true,
          'amber'
        )}
      </div>

      {/* SECTION 3: APPROVED EXAMINATIONS (Scheduled for T-20 Visibility) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-purple-50/60 px-5 py-3.5 border-b border-purple-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-md bg-purple-600 text-white flex items-center justify-center text-xs font-bold">3</span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-purple-950">
                Approved Examinations ({approvedExams.length})
              </h2>
            </div>
            <p className="text-xs text-purple-800 mt-0.5">
              Admin-approved examinations scheduled to become automatically visible to students exactly 20 minutes before examination start time
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-300 px-2 py-1 rounded">
            Auto-Release at T-20 Mins
          </span>
        </div>

        {renderExamTable(
          approvedExams,
          'No approved examinations awaiting T-20 automatic publication.',
          false,
          'purple'
        )}
      </div>

      {/* SECTION 4: PUBLISHED EXAMINATIONS (Live for Students) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-emerald-50/60 px-5 py-3.5 border-b border-emerald-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">4</span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-950">
                Published Examinations ({publishedExams.length})
              </h2>
            </div>
            <p className="text-xs text-emerald-800 mt-0.5">
              Live examinations currently accessible to students in the Student Seat Finder portal
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-1 rounded">
            Active in Student Portal
          </span>
        </div>

        {renderExamTable(
          publishedExams,
          'No examinations currently published and active in the Student Portal.',
          false,
          'emerald'
        )}
      </div>

      {/* 2-Column Grid for Completed & Cancelled Examinations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SECTION 5: COMPLETED EXAMINATIONS */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-md bg-slate-500 text-white flex items-center justify-center text-[10px] font-bold">5</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-navy-800">
                Completed Examinations ({completedExams.length})
              </h2>
            </div>
          </div>
          {renderExamTable(
            completedExams,
            'No completed examinations archived yet.',
            false,
            'slate'
          )}
        </div>

        {/* SECTION 6: CANCELLED EXAMINATIONS */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-red-50/50 px-4 py-3 border-b border-red-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-md bg-red-600 text-white flex items-center justify-center text-[10px] font-bold">6</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-red-900">
                Cancelled Examinations ({cancelledExams.length})
              </h2>
            </div>
          </div>
          {renderExamTable(
            cancelledExams,
            'No cancelled examinations on record.',
            false,
            'red'
          )}
        </div>
      </div>

      {/* REJECT MODAL PROMPT */}
      {rejectModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/40 backdrop-blur-sm"
            onClick={() => setRejectModalExam(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-navy-800">
                Reject Examination — {rejectModalExam.subjectName}
              </h3>
              <button
                onClick={() => setRejectModalExam(null)}
                className="text-slate-400 hover:text-navy-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Please enter the reason for rejecting this examination. The faculty member will be required to update the details and re-submit.
            </p>

            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Incorrect exam timing or classroom conflict. Please reschedule."
              className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectModalExam(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionLoading}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-xs disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PUBLISH CONFIRMATION MODAL */}
      {publishModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/40 backdrop-blur-sm"
            onClick={() => !actionLoading && setPublishModalExam(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl border border-emerald-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-navy-800">
              Approve &amp; Publish — {publishModalExam.subjectName}
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to approve and publish <strong>{publishModalExam.examName || publishModalExam.subjectName}</strong> ({publishModalExam.examDate}, {formatExamTimeRange(publishModalExam)})?
            </p>
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setPublishModalExam(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={confirmPublish}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Publishing...' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL CONFIRMATION MODAL */}
      {cancelModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-navy-900/40 backdrop-blur-sm"
            onClick={() => !actionLoading && setCancelModalExam(null)}
          />
          <div className="relative bg-white rounded-xl shadow-xl border border-red-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-navy-800">
              Cancel Examination — {cancelModalExam.subjectName}
            </h3>
            <p className="text-xs text-slate-600">
              Cancelling preserves historical records and immediately releases classroom reservations.
            </p>
            <textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Enter cancellation reason..."
              className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setCancelModalExam(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={actionLoading || !cancelReason.trim()}
                onClick={confirmCancelExam}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;