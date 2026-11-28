import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import { formatExamTimeRange, formatSessionLabel } from '../../utils/dateTime';
import { resolveExamType } from '../../utils/examType';
import {
  PlusCircle,
  CheckCircle2,
  UserCheck,
  AlertCircle,
  Eye,
  FileDown,
  XCircle,
  Send,
  RefreshCw,
  Calendar,
  Clock,
} from 'lucide-react';
import { downloadProtectedReport } from '../../utils/fileDownloader';

const Dashboard = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
  const publishLockRef = useRef(false);

  const [stats, setStats] = useState({
    totalStudents: 0,
    totalExaminations: 0,
    totalClassrooms: 0,
  });
  const [currentExam, setCurrentExam] = useState(null);
  const [currentMode, setCurrentMode] = useState('NONE');
  const [allExams, setAllExams] = useState([]);
  const [activeTab, setActiveTab] = useState('PENDING');

  // Modals for Approve, Publish, Reject, Cancel
  const [publishModalExam, setPublishModalExam] = useState(null);
  const [publishModalMode, setPublishModalMode] = useState('publish');
  const [rejectModalExam, setRejectModalExam] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelModalExam, setCancelModalExam] = useState(null);
  const [cancelReason, setCancelReason] = useState('Examination cancelled by Admin.');
  const [downloadingExamId, setDownloadingExamId] = useState('');

  const abortControllerRef = useRef(null);

  const fetchAllData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      const [statsRes, currentRes, examsRes] = await Promise.all([
        api.get('/dashboard/stats', { signal: controller.signal }),
        api.get('/exams/current', { signal: controller.signal }),
        api.get('/exams?filter=all', { signal: controller.signal }),
      ]);

      if (statsRes?.data?.success && statsRes.data.data) {
        setStats(statsRes.data.data);
      }
      if (currentRes?.data?.success) {
        setCurrentExam(currentRes.data.data || null);
        setCurrentMode(currentRes.data.mode || 'NONE');
      }
      if (examsRes?.data?.success) {
        setAllExams(examsRes.data.data || []);
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      setActionMessage({
        type: 'error',
        text: formatApiError(err, 'Failed to retrieve dashboard records from server.'),
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

  const pendingExams = useMemo(
    () => allExams.filter((e) => e.approvalStatus === 'PENDING_REVIEW' && !['COMPLETED', 'CANCELLED'].includes(e.status)),
    [allExams]
  );
  const approvedExams = useMemo(
    () => allExams.filter((e) => e.approvalStatus === 'APPROVED' && e.visibilityStatus !== 'PUBLISHED' && !['COMPLETED', 'CANCELLED'].includes(e.status)),
    [allExams]
  );
  const publishedExams = useMemo(
    () => allExams.filter((e) => (e.visibilityStatus === 'PUBLISHED' || ['PUBLISHED', 'ONGOING'].includes(e.status)) && !['COMPLETED', 'CANCELLED'].includes(e.status)),
    [allExams]
  );
  const archivedExams = useMemo(
    () => allExams.filter((e) => ['COMPLETED', 'CANCELLED'].includes(e.status) || ['CANCELLED', 'REJECTED'].includes(e.approvalStatus)),
    [allExams]
  );

  const displayedExams = useMemo(() => {
    if (activeTab === 'PENDING') return pendingExams;
    if (activeTab === 'APPROVED') return approvedExams;
    if (activeTab === 'PUBLISHED') return publishedExams;
    return archivedExams;
  }, [activeTab, pendingExams, approvedExams, publishedExams, archivedExams]);

  const confirmPublish = async () => {
    if (!publishModalExam || publishLockRef.current || actionLoading) return;
    const isApprove = publishModalMode === 'approve';
    if (!isAdmin) {
      setActionMessage({ type: 'error', text: 'Only an Administrator can perform this action.' });
      setPublishModalExam(null);
      return;
    }
    publishLockRef.current = true;
    try {
      setActionLoading(true);
      setActionMessage({ type: '', text: '' });
      const endpoint = isApprove
        ? `/exams/${publishModalExam._id}/approve`
        : `/exams/${publishModalExam._id}/publish`;
      const res = await api.post(endpoint, {}, { timeout: API_TIMEOUTS.HEAVY_WRITE });
      if (res.data?.success) {
        setActionMessage({
          type: 'success',
          text: res.data.message || (isApprove ? 'Examination approved successfully.' : 'Examination published successfully.'),
        });
        setPublishModalExam(null);
        await fetchAllData();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: formatApiError(err, isApprove ? 'Failed to approve examination.' : 'Failed to publish examination.'),
      });
      setPublishModalExam(null);
    } finally {
      publishLockRef.current = false;
      setActionLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectModalExam) return;
    try {
      setActionLoading(true);
      const res = await api.post(`/exams/${rejectModalExam._id}/reject`, {
        reason: rejectReason || 'Needs correction by faculty.',
      });
      if (res.data?.success) {
        setActionMessage({
          type: 'info',
          text: `Examination "${rejectModalExam.subjectName}" rejected.`,
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

  const confirmCancelExam = async () => {
    if (!cancelModalExam || !cancelReason.trim()) return;
    try {
      setActionLoading(true);
      const res = await api.post(`/exams/${cancelModalExam._id}/cancel`, {
        reason: cancelReason.trim(),
      });
      if (res.data?.success) {
        setActionMessage({
          type: 'info',
          text: res.data.message || 'Examination cancelled.',
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

  const downloadAttendanceSheet = async (examId) => {
    if (!examId || downloadingExamId === examId) return;
    setDownloadingExamId(examId);
    try {
      await downloadProtectedReport(
        `/exams/${examId}/reports/signature-pdf`,
        'Attendance_Signature_Sheet.pdf',
        'download',
        { onError: (msg) => setActionMessage({ type: 'error', text: msg }) }
      );
    } finally {
      setDownloadingExamId('');
    }
  };

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#E5E7EB] dark:border-[#30384A]">
        <div>
          <h1 className="text-xl font-bold text-[#172033] dark:text-[#F8FAFC] tracking-tight">
            Admin Examination Control Center
          </h1>
          <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-1">
            Monitor the current examination, approve pending schedules, and manage section seating.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchAllData()}
            disabled={loading}
            className="es-btn-secondary"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
          <Link to="/admin/assignments" className="es-btn-secondary">
            <UserCheck size={14} className="text-primary" />
            <span>Section Mappings</span>
          </Link>
          <button
            type="button"
            onClick={() => navigate('/admin/exams?new=true')}
            className="es-btn-primary"
          >
            <PlusCircle size={15} className="mr-1.5" />
            <span>Schedule Examination</span>
          </button>
        </div>
      </div>

      {/* Action Feedback */}
      {actionMessage.text && (
        <div
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${actionMessage.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
            : actionMessage.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
              : 'bg-[#F8DCEB]/60 dark:bg-[#F472B6]/10 text-[#172033] dark:text-[#F8FAFC] border-primary/30'
            }`}
        >
          <div className="flex items-center">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 size={16} className="mr-2 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="mr-2 flex-shrink-0 text-primary" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage({ type: '', text: '' })}
            className="text-[11px] font-bold underline ml-3 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Current Examination Highlight Card (Single Active or Next Upcoming) */}
      <section className="es-glass-card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-[#E5E7EB] dark:border-[#30384A]">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Current Examination
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-[#F8FAFC] mt-0.5">
              {currentExam
                ? `${resolveExamType(currentExam)} • ${currentExam.subjectName} (${currentExam.subjectCode})`
                : 'No Active or Upcoming Examination'}
            </h2>
          </div>

          {currentExam && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${currentMode === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-[#F8DCEB] text-primary dark:bg-[#F472B6]/15 dark:text-[#F472B6]'
                  }`}
              >
                {currentMode === 'ACTIVE' ? 'Active Now' : 'Upcoming Examination'}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/admin/exams?examId=${currentExam._id}`)}
                className="es-btn-secondary h-8 px-3 text-xs"
              >
                Manage Roster
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-[#E5E7EB]/60 dark:bg-white/5" />
            ))}
          </div>
        ) : !currentExam ? (
          <div className="pt-5 pb-2 flex items-center gap-3 text-xs text-[#64748B] dark:text-[#A1A1AA]">
            <Calendar size={18} className="text-primary flex-shrink-0" />
            <span>No active or upcoming examinations are currently scheduled.</span>
          </div>
        ) : (
          <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B] dark:text-[#A1A1AA] block">
                Examination Date
              </span>
              <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                {currentExam.examDate}
              </span>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B] dark:text-[#A1A1AA] block">
                Session
              </span>
              <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                {formatSessionLabel(currentExam.session, currentExam.startTime)}
              </span>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B] dark:text-[#A1A1AA] block">
                Start &amp; End Time
              </span>
              <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 flex items-center gap-1">
                <Clock size={13} className="text-primary" />
                {formatExamTimeRange(currentExam)} IST
              </span>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B] dark:text-[#A1A1AA] block">
                Section &amp; Workflow Status
              </span>
              <span className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] mt-0.5 block">
                Section {currentExam.section} • {currentExam.approvalStatus === 'PENDING_REVIEW' ? 'Pending Review' : currentExam.visibilityStatus}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Compact Metric Strip */}
      <div className="es-glass-card grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E5E7EB] dark:divide-[#30384A]">
        <div className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA]">Total Exams</p>
          <p className="text-2xl font-extrabold text-[#172033] dark:text-[#F8FAFC] mt-1">{stats.totalExaminations}</p>
        </div>
        <div className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Pending Review</p>
          <p className="text-2xl font-extrabold text-primary mt-1">{pendingExams.length}</p>
        </div>
        <div className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA]">Master Students</p>
          <p className="text-2xl font-extrabold text-[#172033] dark:text-[#F8FAFC] mt-1">{stats.totalStudents}</p>
        </div>
        <div className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] dark:text-[#A1A1AA]">Active Classrooms</p>
          <p className="text-2xl font-extrabold text-[#172033] dark:text-[#F8FAFC] mt-1">{stats.totalClassrooms || 0}</p>
        </div>
      </div>

      {/* Single Tabbed Admin Examination Approval Table (No stacked multi-card clutter) */}
      <section className="es-glass-card overflow-hidden">
        <div className="p-4 border-b border-[#E5E7EB] dark:border-[#30384A] flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
            Examination Approval &amp; Publication Queue
          </h2>
          <div className="inline-flex rounded-[10px] border border-[#E5E7EB] dark:border-[#30384A] p-1 bg-[#F7F7FB] dark:bg-[#141926] text-xs font-semibold gap-1">
            {[
              { id: 'PENDING', label: `Pending (${pendingExams.length})` },
              { id: 'APPROVED', label: `Approved (${approvedExams.length})` },
              { id: 'PUBLISHED', label: `Live (${publishedExams.length})` },
              { id: 'ARCHIVED', label: `Archive (${archivedExams.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'text-[#64748B] dark:text-[#A1A1AA] hover:text-[#172033] dark:hover:text-[#F8FAFC]'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {displayedExams.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#64748B] dark:text-[#A1A1AA]">
              No examinations in this status category.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F7FB] dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] font-semibold uppercase tracking-wider text-[11px] border-b border-[#E5E7EB] dark:border-[#30384A]">
                <tr>
                  <th className="py-3 px-4">Examination &amp; Subject</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4">Classroom</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#30384A]">
                {displayedExams.map((exam) => (
                  <tr key={exam._id} className="hover:bg-[#F8DCEB]/20 dark:hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#172033] dark:text-[#F8FAFC]">
                        {resolveExamType(exam)} • {exam.subjectName}
                      </div>
                      <div className="text-[11px] font-mono text-primary font-semibold">
                        {exam.subjectCode} • {exam.studentCount || 0} Students
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary">
                        {exam.section}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-[#172033] dark:text-[#F8FAFC]">
                      <div className="font-semibold">{exam.examDate}</div>
                      <div className="text-[11px] text-[#64748B] dark:text-[#A1A1AA]">
                        {formatExamTimeRange(exam)} IST
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#172033] dark:text-[#F8FAFC]">
                      {exam.classroomId?.name || 'ET BLOCK 3020'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/allocations?examId=${exam._id}`)}
                          className="px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#30384A] text-[11px] font-semibold text-[#172033] dark:text-[#F8FAFC] hover:border-primary cursor-pointer inline-flex items-center"
                        >
                          <Eye size={12} className="mr-1" />
                          Seating
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadAttendanceSheet(exam._id)}
                          disabled={downloadingExamId === exam._id}
                          className="px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#30384A] text-[11px] font-semibold text-primary hover:border-primary cursor-pointer inline-flex items-center disabled:opacity-50"
                        >
                          <FileDown size={12} className="mr-1" />
                          PDF
                        </button>

                        {isAdmin && exam.approvalStatus === 'PENDING_REVIEW' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setPublishModalMode('approve');
                                setPublishModalExam(exam);
                              }}
                              disabled={actionLoading}
                              className="px-2.5 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold cursor-pointer inline-flex items-center"
                            >
                              <CheckCircle2 size={12} className="mr-1" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectModalExam(exam);
                                setRejectReason('');
                              }}
                              className="px-2 py-1.5 rounded-lg bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {isAdmin &&
                          exam.approvalStatus === 'APPROVED' &&
                          exam.visibilityStatus !== 'PUBLISHED' &&
                          !['PUBLISHED', 'ONGOING', 'COMPLETED', 'CANCELLED'].includes(exam.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                setPublishModalMode('publish');
                                setPublishModalExam(exam);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer inline-flex items-center"
                            >
                              <Send size={12} className="mr-1" />
                              Publish
                            </button>
                          )}

                        {exam.approvalStatus !== 'CANCELLED' && exam.status !== 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelModalExam(exam);
                              setCancelReason('Examination cancelled by Admin.');
                            }}
                            title="Cancel Examination"
                            className="p-1.5 text-[#64748B] hover:text-red-600 rounded-lg cursor-pointer"
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Reject Modal */}
      {rejectModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1B2030] border border-[#E5E7EB] dark:border-[#30384A] rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
              Reject Examination — {rejectModalExam.subjectName}
            </h3>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection..."
              className="w-full p-3 text-xs rounded-xl border border-[#E5E7EB] dark:border-[#30384A] bg-white dark:bg-[#141926] text-[#172033] dark:text-[#F8FAFC] focus:outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModalExam(null)} className="es-btn-secondary">
                Back
              </button>
              <button type="button" onClick={handleConfirmReject} disabled={actionLoading} className="es-btn-primary bg-red-600 hover:bg-red-700">
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve / Publish Modal */}
      {publishModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1B2030] border border-[#E5E7EB] dark:border-[#30384A] rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
              {publishModalMode === 'approve' ? 'Approve Examination' : 'Publish Approved Examination'} — {publishModalExam.subjectName}
            </h3>
            <p className="text-xs text-[#64748B] dark:text-[#A1A1AA]">
              {publishModalMode === 'approve'
                ? `Approve ${publishModalExam.subjectName} (${publishModalExam.section}) on ${publishModalExam.examDate}?`
                : `Schedule publication for ${publishModalExam.subjectName} (${publishModalExam.section}) at ${publishModalExam.publicationTimeStr || 'scheduled IST'}?`}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={actionLoading} onClick={() => setPublishModalExam(null)} className="es-btn-secondary">
                Back
              </button>
              <button type="button" disabled={actionLoading} onClick={confirmPublish} className="es-btn-primary">
                {actionLoading ? 'Processing...' : publishModalMode === 'approve' ? 'Confirm Approve' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModalExam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1B2030] border border-[#E5E7EB] dark:border-[#30384A] rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
              Cancel Examination — {cancelModalExam.subjectName}
            </h3>
            <textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full p-3 text-xs rounded-xl border border-[#E5E7EB] dark:border-[#30384A] bg-white dark:bg-[#141926] text-[#172033] dark:text-[#F8FAFC] focus:outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button type="button" disabled={actionLoading} onClick={() => setCancelModalExam(null)} className="es-btn-secondary">
                Back
              </button>
              <button type="button" disabled={actionLoading || !cancelReason.trim()} onClick={confirmCancelExam} className="es-btn-primary bg-red-600 hover:bg-red-700">
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
