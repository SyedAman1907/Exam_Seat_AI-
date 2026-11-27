import { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import axios from 'axios';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import {
  Users,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  FileText,
  Trash2,
  Layers,
  ShieldCheck,
  RefreshCw,
  Search,
  Eye,
  X,
  Sparkles,
  Info,
  UserCheck,
} from 'lucide-react';

const FacultyAssignments = () => {
  // Permanent mappings list
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGroup, setFilterGroup] = useState('ALL');
  const [filterSection, setFilterSection] = useState('ALL');

  // Upload workflow mode: 'multi' (auto-extract multi-subject roster) or 'single'
  const [uploadMode, setUploadMode] = useState('multi');

  // Single form states
  const [facultyName, setFacultyName] = useState('Dr. K. Subba Rao');
  const [subjectName, setSubjectName] = useState('CNIP');
  const [subjectCode, setSubjectCode] = useState('20A05502T');
  const [section, setSection] = useState('A1');
  const [group, setGroup] = useState('Group A');
  const [selectedFile, setSelectedFile] = useState(null);
  const [replaceExisting, setReplaceExisting] = useState(true);

  // Preview & Background Job states
  const [uploading, setUploading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [retryingJob, setRetryingJob] = useState(false);
  const jobPollAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (jobPollAbortRef.current) {
        jobPollAbortRef.current.abort();
      }
    };
  }, []);

  // Single roster preview
  const [previewStudents, setPreviewStudents] = useState([]);

  // Multi-roster preview
  const [isMultiRoster, setIsMultiRoster] = useState(false);
  const [multiSummary, setMultiSummary] = useState(null);
  const [multiMappings, setMultiMappings] = useState([]);

  // Modal for inspecting a specific roster
  const [inspectModalRoster, setInspectModalRoster] = useState(null);
  const [rosterSearchTerm, setRosterSearchTerm] = useState('');
  const [dbSubjects, setDbSubjects] = useState([]);

  // Timetable subject presets (fallback)
  const defaultSubjectPresets = [
    { name: 'Object Oriented Analysis and Design', code: '20A05504T' },
    { name: 'Automata Theory and Compiler Design', code: '20A05501T' },
    { name: 'Artificial Intelligence', code: '20A05502S' },
    { name: 'Introduction to Quantum Technologies and Applications', code: '20A05505T' },
    { name: 'Computer Networks', code: '20A05502T' },
  ];

  const sectionsList = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

  useEffect(() => {
    fetchMappings();
    fetchSubjects();
  }, []);

  const fetchSubjects = async () => {
    try {
      const res = await api.get('/subjects');
      if (res.data.success && res.data.data) {
        setDbSubjects(res.data.data);
      }
    } catch (err) {
      console.warn('Could not load subjects master collection:', err.message);
    }
  };

  const subjectPresets = useMemo(() => {
    if (dbSubjects && dbSubjects.length > 0) {
      return dbSubjects.map((s) => ({
        name: s.subjectName,
        code: s.subjectCode,
        abbreviation: s.abbreviation,
      }));
    }
    return defaultSubjectPresets;
  }, [dbSubjects]);

  const fetchMappings = async ({ preserveOnFailure = false } = {}) => {
    try {
      if (!preserveOnFailure) {
        setLoading(true);
      }
      const res = await api.get('/mappings');
      if (res.data?.success) {
        setMappings(res.data.mappings || []);
        setRefreshWarning('');
        return true;
      }
      if (preserveOnFailure) {
        setRefreshWarning(res.data?.message || 'Mapping was saved, but refreshing the active mappings list returned an unexpected response.');
      }
      return false;
    } catch (err) {
      console.error('Failed to load faculty mappings:', err);
      if (preserveOnFailure) {
        setRefreshWarning(
          `Mapping operation succeeded, but refreshing the mappings table failed (${formatApiError(err, 'Network error')}). Click Refresh to reload.`
        );
      }
      return false;
    } finally {
      if (!preserveOnFailure) {
        setLoading(false);
      }
    }
  };

  const pollJobUntilTerminal = async (jobId) => {
    if (jobPollAbortRef.current) {
      jobPollAbortRef.current.abort();
    }
    const controller = new AbortController();
    jobPollAbortRef.current = controller;

    const maxWaitMs = 5 * 60 * 1000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (controller.signal.aborted) {
        throw new axios.CanceledError('Polling aborted');
      }
      const statusRes = await api.get(`/mappings/jobs/${jobId}`, {
        signal: controller.signal,
        timeout: API_TIMEOUTS.DEFAULT,
      });
      const job = statusRes.data?.data;
      if (!job) {
        throw new Error('Background job status payload was empty.');
      }
      setActiveJob(job);

      if (['COMPLETED', 'PARTIAL_FAILED', 'FAILED'].includes(job.status)) {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    throw new Error('Background mapping job is still processing. Please check Refresh shortly.');
  };

  const handleSubjectSelect = (preset) => {
    setSubjectName(preset.name);
    setSubjectCode(preset.code);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setPreviewError('Please upload a valid PDF document containing the student roster.');
        setSelectedFile(null);
        return;
      }
      if (file.size > 40 * 1024 * 1024) {
        setPreviewError('The selected file exceeds the 40MB limit. Please upload a smaller PDF.');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
      setPreviewError('');
      setPreviewStudents([]);
      setIsMultiRoster(false);
      setMultiMappings([]);
      setMultiSummary(null);
    }
  };

  const handleUploadAndPreview = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setPreviewError('Please select a student roster PDF file to upload.');
      return;
    }

    if (uploadMode === 'single') {
      if (!facultyName.trim()) {
        setPreviewError('Faculty Name is required.');
        return;
      }
      if (!subjectName.trim()) {
        setPreviewError('Subject Name is required.');
        return;
      }
      if (!subjectCode.trim()) {
        setPreviewError('Subject Code is required.');
        return;
      }
      if (!section) {
        setPreviewError('Section (A1–A6) is required.');
        return;
      }
    }

    try {
      setUploading(true);
      setPreviewError('');
      setRefreshWarning('');
      setSuccessMessage('');
      setActiveJob(null);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('uploadMode', uploadMode);
      if (uploadMode === 'single') {
        formData.append('facultyName', facultyName.trim());
        formData.append('subjectName', subjectName.trim());
        formData.append('subjectCode', subjectCode.trim());
        formData.append('section', section.trim().toUpperCase());
        formData.append('group', group);
      }

      const startRes = await api.post('/mappings/jobs/upload-preview', formData, {
        timeout: API_TIMEOUTS.PDF_UPLOAD,
      });

      let extractionData = startRes.data;
      if (startRes.data?.success && startRes.data?.data?.jobId) {
        setActiveJob(startRes.data.data);
        const completedJob = await pollJobUntilTerminal(startRes.data.data.jobId);
        if (completedJob.status === 'FAILED') {
          setPreviewError(completedJob.errorMessage || 'Failed to extract student rosters from PDF.');
          return;
        }
        extractionData = {
          success: true,
          isMultiRoster: completedJob.isMultiRoster,
          summary: completedJob.summary,
          mappings: completedJob.previewMappings || completedJob.mappings || [],
          students: (completedJob.previewMappings || []).flatMap((m) => m.students || []),
        };
      }

      if (extractionData?.success) {
        if (extractionData.isMultiRoster && extractionData.mappings && extractionData.mappings.length > 0) {
          setIsMultiRoster(true);
          setMultiMappings(extractionData.mappings);
          setMultiSummary(extractionData.summary);
          setPreviewStudents([]);
        } else {
          setIsMultiRoster(false);
          const extracted =
            extractionData.students ||
            extractionData.data?.students ||
            (extractionData.mappings?.[0]?.students) ||
            (extractionData.data?.records || []).map((r, idx) => ({
              sNo: r.serialNumber || idx + 1,
              registrationNumber: r.rollNumber,
              studentName: r.studentName,
            }));

          if (extracted && extracted.length > 0) {
            setPreviewStudents(extracted);
          } else {
            setPreviewError(
              'No valid student records could be extracted from this PDF. Please verify that the PDF contains tabular registration numbers and student names.'
            );
          }
        }
      } else {
        setPreviewError(extractionData?.message || 'Failed to extract student rosters.');
      }
    } catch (err) {
      if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return;
      }
      console.error('[FacultyAssignments] Upload preview failed:', err);
      setPreviewError(formatApiError(err, 'Failed to extract students from PDF.'));
    } finally {
      setUploading(false);
    }
  };

  // Update multi mapping row inline
  const handleUpdateMultiMapping = (index, field, value) => {
    setMultiMappings((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // Confirm single mapping
  const handleConfirmSingleMapping = async () => {
    if (!facultyName.trim() || !subjectName.trim() || !section) {
      setPreviewError('Faculty Name, Subject, and Section are mandatory.');
      return;
    }

    if (previewStudents.length === 0) {
      setPreviewError('Please preview and verify the student roster before confirming.');
      return;
    }

    let savedSingle = false;
    try {
      setConfirming(true);
      setPreviewError('');
      setRefreshWarning('');

      const payload = {
        facultyName: facultyName.trim(),
        subjectName: subjectName.trim(),
        subjectCode: subjectCode.trim() || 'SUB-CODE',
        section: section.trim().toUpperCase(),
        group: group || 'Group A',
        replaceExisting,
        students: previewStudents.map((s, idx) => ({
          sNo: s.sNo || idx + 1,
          registrationNumber: s.registrationNumber,
          studentName: s.studentName,
        })),
      };

      const res = await api.post('/mappings/confirm', payload, { timeout: API_TIMEOUTS.HEAVY_WRITE });

      if (res.data?.success) {
        savedSingle = true;
        setSuccessMessage(
          `Successfully permanently mapped ${previewStudents.length} students to ${subjectName} (${section}) under ${facultyName}. These students will now load automatically for examinations.`
        );
        setPreviewStudents([]);
        setSelectedFile(null);
      } else {
        setPreviewError(res.data?.message || 'Failed to confirm faculty mapping.');
      }
    } catch (err) {
      setPreviewError(formatApiError(err, 'Failed to confirm faculty mapping.'));
    } finally {
      setConfirming(false);
    }

    if (savedSingle) {
      await fetchMappings({ preserveOnFailure: true });
    }
  };

  const applyCompletedBatchJobResult = (job) => {
    const savedCount = job.savedMappings?.length || 0;
    const failedCount = job.failedItems?.length || 0;

    if (job.status === 'COMPLETED') {
      setSuccessMessage(
        `Successfully saved ${savedCount} independent subject-wise mappings (${job.totalEnrollments} enrollments across ${job.uniqueStudents} unique students) into MongoDB!`
      );
      setIsMultiRoster(false);
      setMultiMappings([]);
      setMultiSummary(null);
      setSelectedFile(null);
      return true;
    }

    if (job.status === 'PARTIAL_FAILED') {
      setSuccessMessage(
        `Saved ${savedCount} verified mapping(s) safely (${job.totalEnrollments} enrollments). ${failedCount} mapping(s) require attention and can be retried below without duplicating saved records.`
      );
      setPreviewError(
        job.failedItems
          .slice(0, 5)
          .map((f) => `${f.subjectCode || f.subjectName} (${f.section || '?'}): ${f.error}`)
          .join('\n')
      );
      return savedCount > 0;
    }

    setPreviewError(
      job.errorMessage ||
        (failedCount > 0
          ? job.failedItems
              .slice(0, 5)
              .map((f) => `${f.subjectCode || f.subjectName} (${f.section || '?'}): ${f.error}`)
              .join('\n')
          : 'Failed to save batch mappings.')
    );
    return false;
  };

  // Confirm batch multi mappings using background job workflow
  const handleConfirmBatchMappings = async () => {
    if (multiMappings.length === 0) {
      setPreviewError('No mappings to confirm.');
      return;
    }

    let shouldRefresh = false;
    try {
      setConfirming(true);
      setPreviewError('');
      setRefreshWarning('');

      const payload = {
        mappings: multiMappings,
        replaceExisting,
        sourceFileName: selectedFile ? selectedFile.name : 'Roster.pdf',
      };

      const startRes = await api.post('/mappings/jobs/confirm-batch', payload, {
        timeout: API_TIMEOUTS.DEFAULT,
      });

      if (startRes.data?.success && startRes.data?.data?.jobId) {
        setActiveJob(startRes.data.data);
        const completedJob = await pollJobUntilTerminal(startRes.data.data.jobId);
        shouldRefresh = applyCompletedBatchJobResult(completedJob);
      } else {
        setPreviewError(startRes.data?.message || 'Failed to queue batch confirmation job.');
      }
    } catch (err) {
      if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return;
      }
      const errList = err.response?.data?.errors;
      const errMsg = errList && Array.isArray(errList)
        ? `${err.response?.data?.message || 'Validation failed'}:\n${errList.slice(0, 5).join('\n')}`
        : formatApiError(err, 'Failed to confirm batch mappings.');
      setPreviewError(errMsg);
    } finally {
      setConfirming(false);
    }

    if (shouldRefresh) {
      await fetchMappings({ preserveOnFailure: true });
    }
  };

  const handleRetryFailedJob = async () => {
    if (!activeJob?.jobId || retryingJob) return;
    let shouldRefresh = false;
    try {
      setRetryingJob(true);
      setPreviewError('');
      setRefreshWarning('');
      const res = await api.post(`/mappings/jobs/${activeJob.jobId}/retry`, null, {
        timeout: API_TIMEOUTS.DEFAULT,
      });
      if (res.data?.success && res.data?.data?.jobId) {
        setActiveJob(res.data.data);
        const completedJob = await pollJobUntilTerminal(res.data.data.jobId);
        shouldRefresh = applyCompletedBatchJobResult(completedJob);
      }
    } catch (err) {
      setPreviewError(formatApiError(err, 'Failed to retry failed mappings.'));
    } finally {
      setRetryingJob(false);
    }
    if (shouldRefresh) {
      await fetchMappings({ preserveOnFailure: true });
    }
  };

  const handleDeleteMapping = async (id, title) => {
    if (window.confirm(`Are you sure you want to deactivate permanent mapping for ${title}?`)) {
      try {
        await api.delete(`/mappings/${id}`);
        await fetchMappings();
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to delete mapping.');
      }
    }
  };

  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Filtered active mappings
  const filteredMappings = useMemo(() => {
    const q = deferredSearchTerm.toLowerCase();
    return mappings.filter((m) => {
      const matchSearch =
        !q ||
        m.facultyName.toLowerCase().includes(q) ||
        m.subjectName.toLowerCase().includes(q) ||
        m.subjectCode.toLowerCase().includes(q) ||
        m.section.toLowerCase().includes(q) ||
        (m.group && m.group.toLowerCase().includes(q));

      const matchGroup = filterGroup === 'ALL' || m.group === filterGroup;
      const matchSection = filterSection === 'ALL' || m.section === filterSection;

      return matchSearch && matchGroup && matchSection;
    });
  }, [mappings, deferredSearchTerm, filterGroup, filterSection]);

  // Filtered students for inspection modal
  const modalFilteredStudents = useMemo(() => {
    if (!inspectModalRoster || !inspectModalRoster.students) return [];
    if (!rosterSearchTerm.trim()) return inspectModalRoster.students;
    const term = rosterSearchTerm.toLowerCase();
    return inspectModalRoster.students.filter(
      (s) =>
        s.registrationNumber.toLowerCase().includes(term) ||
        s.studentName.toLowerCase().includes(term)
    );
  }, [inspectModalRoster, rosterSearchTerm]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <UserCheck size={20} />
            </span>
            <h1 className="text-xl font-bold text-navy-800 tracking-tight">
              Faculty, Subject & Student Permanent Mapping
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Intelligently separates multi-subject PDF nominal lists into independent rosters per faculty, section and group. Students are permanently mapped in MongoDB and auto-load during examination creation.
          </p>
        </div>
        <button
          onClick={fetchMappings}
          className="mt-3 sm:mt-0 inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs cursor-pointer"
        >
          <RefreshCw size={13} className="mr-1.5" />
          Refresh
        </button>
      </div>

      {/* Global Alerts */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start shadow-xs">
          <CheckCircle2 size={18} className="mr-2.5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{successMessage}</div>
          <button
            onClick={() => setSuccessMessage('')}
            className="text-emerald-500 hover:text-emerald-700 ml-2"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {previewError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start shadow-xs">
          <AlertCircle size={18} className="mr-2.5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium whitespace-pre-line">{previewError}</div>
          <button
            onClick={() => setPreviewError('')}
            className="text-red-500 hover:text-red-700 ml-2"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {refreshWarning && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start shadow-xs">
          <AlertCircle size={18} className="mr-2.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{refreshWarning}</div>
          <button
            onClick={() => setRefreshWarning('')}
            className="text-amber-500 hover:text-amber-700 ml-2"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {activeJob && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-navy-800">
                Background Job ({activeJob.jobType === 'UPLOAD_PREVIEW' ? 'PDF Extraction' : 'Batch Mapping Save'})
              </span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                ID: {activeJob.jobId}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  activeJob.status === 'COMPLETED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : activeJob.status === 'PARTIAL_FAILED'
                      ? 'bg-amber-100 text-amber-800'
                      : activeJob.status === 'FAILED'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-blue-100 text-blue-700'
                }`}
              >
                {activeJob.status}
              </span>
            </div>
            <div className="flex items-center space-x-3 text-[11px] font-semibold">
              <span className="text-emerald-700">Completed: {activeJob.progress?.completed ?? 0}</span>
              <span className="text-red-600">Failed: {activeJob.progress?.failed ?? 0}</span>
              <span className="text-slate-600">Pending: {activeJob.progress?.pending ?? 0}</span>
            </div>
          </div>

          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                activeJob.status === 'FAILED'
                  ? 'bg-red-500'
                  : activeJob.status === 'PARTIAL_FAILED'
                    ? 'bg-amber-500'
                    : 'bg-primary'
              }`}
              style={{ width: `${Math.min(100, Math.max(5, activeJob.progress?.percent ?? 0))}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
            <span>{activeJob.progress?.currentStage || 'Processing...'}</span>
            {activeJob.jobType === 'CONFIRM_BATCH' &&
              (activeJob.failedItems?.length || 0) > 0 &&
              ['PARTIAL_FAILED', 'FAILED'].includes(activeJob.status) && (
                <button
                  type="button"
                  onClick={handleRetryFailedJob}
                  disabled={retryingJob}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {retryingJob ? 'Retrying Failed Mappings...' : `Retry Failed (${activeJob.failedItems.length})`}
                </button>
              )}
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Mapping Creation / Upload Form (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-navy-800 flex items-center">
                <UploadCloud size={16} className="mr-2 text-primary" />
                Upload Student Roster PDF
              </h2>
              <span className="text-[10px] bg-blue-50 text-primary font-bold px-2 py-0.5 rounded border border-blue-200">
                AI Multi-Roster Parser
              </span>
            </div>

            {/* Workflow Mode Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => setUploadMode('multi')}
                className={`py-1.5 px-3 rounded-md transition-all text-center flex items-center justify-center space-x-1.5 ${uploadMode === 'multi'
                  ? 'bg-white text-primary shadow-xs font-bold'
                  : 'text-slate-600 hover:text-navy-800'
                  }`}
              >
                <Sparkles size={13} className="text-amber-500" />
                <span>Multi-Subject PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('single')}
                className={`py-1.5 px-3 rounded-md transition-all text-center flex items-center justify-center space-x-1.5 ${uploadMode === 'single'
                  ? 'bg-white text-primary shadow-xs font-bold'
                  : 'text-slate-600 hover:text-navy-800'
                  }`}
              >
                <Layers size={13} />
                <span>Single Subject</span>
              </button>
            </div>

            {uploadMode === 'multi' ? (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-[11px] text-amber-900 space-y-1">
                <div className="font-bold flex items-center">
                  <Info size={13} className="mr-1.5 text-amber-600" />
                  Intelligent Multi-Roster Separation
                </div>
                <p className="text-amber-800 leading-relaxed">
                  Upload complete nominal rolls (e.g. <strong>Group-A.pdf</strong> or <strong>Group-B.pdf</strong>). The system automatically separates all 27 distinct subject rosters, accurately assigns each section (A1–A6) and faculty member, and avoids cross-subject duplicate errors.
                </p>
              </div>
            ) : null}

            <form onSubmit={handleUploadAndPreview} className="space-y-3.5">
              {uploadMode === 'single' && (
                <>
                  {/* Faculty Name */}
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Faculty Name: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={facultyName}
                      onChange={(e) => setFacultyName(e.target.value)}
                      placeholder="e.g. Dr. K. Subba Rao"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white font-medium"
                    />
                  </div>

                  {/* Subject Presets & Custom Name */}
                  <div>
                    <label className="block text-[11px] font-bold text-navy-800 mb-1">
                      Subject Name: <span className="text-red-500">*</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {subjectPresets.slice(0, 4).map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => handleSubjectSelect(p)}
                          className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${subjectName === p.name
                            ? 'bg-primary text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                          {p.name.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      required
                      value={subjectName}
                      onChange={(e) => setSubjectName(e.target.value)}
                      placeholder="e.g. Computer Networks and Internet Protocols"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white font-medium"
                    />
                  </div>

                  {/* Subject Code, Section & Group */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-navy-800 mb-1">
                        Code: <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={subjectCode}
                        onChange={(e) => setSubjectCode(e.target.value)}
                        placeholder="20A05502T"
                        className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-navy-800 mb-1">
                        Section: <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={section}
                        onChange={(e) => setSection(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-navy-800"
                      >
                        {sectionsList.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-navy-800 mb-1">
                        Group: <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={group}
                        onChange={(e) => setGroup(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white text-navy-800"
                      >
                        <option value="Group A">Group A</option>
                        <option value="Group B">Group B</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Student PDF File Dropzone */}
              <div>
                <label className="block text-[11px] font-bold text-navy-800 mb-1">
                  Select Roster PDF Document: <span className="text-red-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-300 hover:border-primary/60 rounded-xl p-4 text-center bg-slate-50/50 transition-colors">
                  <input
                    type="file"
                    id="studentPdfFile"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <label htmlFor="studentPdfFile" className="cursor-pointer block space-y-1.5">
                    <FileText size={28} className="mx-auto text-primary" />
                    <div className="text-xs font-semibold text-navy-800">
                      {selectedFile ? selectedFile.name : 'Click to select Student PDF document'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {uploadMode === 'multi'
                        ? 'Supports 50+ pages multi-subject nominal lists (Group A & Group B)'
                        : 'Extracts 10-digit Registration Numbers (24091A0501...) & Names'}
                    </div>
                  </label>
                </div>
              </div>

              {/* Version Replacement Option */}
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="replaceVer"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="rounded text-primary focus:ring-primary"
                />
                <label htmlFor="replaceVer" className="text-[11px] text-slate-600 cursor-pointer">
                  Update/Replace existing mapping versions if already configured
                </label>
              </div>

              {/* Preview Button */}
              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center space-x-2 cursor-pointer"
              >
                {uploading ? (
                  <span>Analyzing & Extracting Rosters...</span>
                ) : (
                  <>
                    <UploadCloud size={15} />
                    <span>Extract & Preview Student Rosters</span>
                  </>
                )}
              </button>
            </form>

            {/* Single Mapping Preview Table */}
            {!isMultiRoster && previewStudents.length > 0 && (
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck size={16} className="text-emerald-600" />
                    <span className="text-xs font-bold text-navy-800">
                      Extracted {previewStudents.length} Students
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    Ready to Save
                  </span>
                </div>

                <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                      <tr>
                        <th className="py-1.5 px-2.5 text-center w-10">#</th>
                        <th className="py-1.5 px-3">Reg. Number</th>
                        <th className="py-1.5 px-3">Student Name</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewStudents.slice(0, 15).map((st, i) => (
                        <tr key={st.registrationNumber || i} className="hover:bg-slate-50">
                          <td className="py-1 px-2.5 text-center text-slate-400 font-mono text-[10px]">
                            {st.sNo || i + 1}
                          </td>
                          <td className="py-1 px-3 font-mono font-bold text-primary">
                            {st.registrationNumber}
                          </td>
                          <td className="py-1 px-3 font-medium text-navy-800">
                            {st.studentName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previewStudents.length > 15 && (
                  <p className="text-[10px] text-slate-500 text-center">
                    ...and {previewStudents.length - 15} more verified student records.
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleConfirmSingleMapping}
                  disabled={confirming}
                  className="w-full py-2.5 px-4 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  {confirming ? (
                    <span>Saving Permanent Roster to MongoDB...</span>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Confirm & Permanently Save Mapping</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Multi-Roster Preview OR Active Permanent Mappings List (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* MULTI-ROSTER EXTRACTION PREVIEW BANNER & TABLE */}
          {isMultiRoster && multiSummary && (
            <div className="bg-white p-5 rounded-xl border-2 border-primary/30 shadow-md space-y-4 animate-in fade-in duration-300">
              {/* Header and Action */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
                      <Sparkles size={18} />
                    </span>
                    <h2 className="text-sm font-bold text-navy-800">
                      Multi-Subject Roster Extracted Successfully
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {multiSummary.totalPages} pages processed • {multiSummary.totalMappings} independent rosters identified
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleConfirmBatchMappings}
                  disabled={confirming}
                  className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {confirming ? (
                    <span>Saving {multiMappings.length} Mappings to MongoDB...</span>
                  ) : (
                    <>
                      <CheckCircle2 size={15} className="mr-1.5" />
                      <span>Confirm & Save All ({multiMappings.length}) Mappings</span>
                    </>
                  )}
                </button>
              </div>

              {/* Extraction Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Total Rosters
                  </div>
                  <div className="text-lg font-black text-navy-800 mt-0.5">
                    {multiSummary.totalMappings}
                  </div>
                  <div className="text-[10px] text-slate-400">Independent mappings</div>
                </div>

                <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200">
                  <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                    Total Enrollments
                  </div>
                  <div className="text-lg font-black text-primary mt-0.5">
                    {multiSummary.totalEnrollments || multiSummary.totalStudentEnrollments}
                  </div>
                  <div className="text-[10px] text-blue-500">Subject-student pairs</div>
                </div>

                <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                    Unique Students
                  </div>
                  <div className="text-lg font-black text-emerald-800 mt-0.5">
                    {multiSummary.uniqueStudents || multiSummary.totalUniqueStudents}
                  </div>
                  <div className="text-[10px] text-emerald-600">Enrolled across subjects</div>
                </div>

                <div className="bg-purple-50/60 p-3 rounded-xl border border-purple-200">
                  <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">
                    Sections & Group
                  </div>
                  <div className="text-sm font-black text-purple-900 mt-1">
                    {(multiSummary.sections || multiSummary.sectionsDetected || []).join(', ')}
                  </div>
                  <div className="text-[10px] text-purple-600 font-semibold">
                    {multiSummary.group || 'Group A'}
                  </div>
                </div>
              </div>

              {/* Mapping Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="py-2 px-2.5 text-center w-8">#</th>
                        <th className="py-2 px-2.5">Subject & Code</th>
                        <th className="py-2 px-2.5">Faculty Name</th>
                        <th className="py-2 px-2 text-center">Sec</th>
                        <th className="py-2 px-2 text-center">Group</th>
                        <th className="py-2 px-2.5 text-center">Students</th>
                        <th className="py-2 px-2 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {multiMappings.map((m, idx) => (
                        <tr key={m.id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2 px-2 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={m.subjectName}
                              onChange={(e) => handleUpdateMultiMapping(idx, 'subjectName', e.target.value)}
                              className="w-full font-bold text-navy-800 text-[11px] bg-transparent border-b border-transparent hover:border-slate-300 focus:border-primary focus:outline-none"
                              title="Click to edit subject name"
                            />
                            <input
                              type="text"
                              value={m.subjectCode}
                              onChange={(e) => handleUpdateMultiMapping(idx, 'subjectCode', e.target.value)}
                              placeholder="CODE"
                              className="font-mono text-[10px] text-primary font-bold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-primary focus:outline-none"
                              title="Click to edit subject code"
                            />
                          </td>
                          <td className="py-2 px-2.5">
                            <input
                              type="text"
                              value={m.facultyName}
                              onChange={(e) => handleUpdateMultiMapping(idx, 'facultyName', e.target.value)}
                              className="w-full text-[11px] font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-primary focus:outline-none"
                              title="Click to edit faculty name"
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <select
                              value={m.section}
                              onChange={(e) => handleUpdateMultiMapping(idx, 'section', e.target.value)}
                              className="text-[10px] font-bold px-1 py-0.5 rounded border border-slate-300 bg-white"
                            >
                              {sectionsList.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                              {m.group}
                            </span>
                          </td>
                          <td className="py-2 px-2.5 text-center font-mono font-bold text-emerald-700 text-xs">
                            {m.students.length}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setInspectModalRoster(m);
                                setRosterSearchTerm('');
                              }}
                              className="inline-flex items-center px-2 py-1 rounded text-[10px] font-semibold bg-slate-100 hover:bg-primary hover:text-white text-slate-700 transition-colors cursor-pointer"
                              title="View student list"
                            >
                              <Eye size={11} className="mr-1" />
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE PERMANENT MAPPINGS LIST */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-navy-800 flex items-center">
                  <Layers size={16} className="mr-2 text-primary" />
                  Active Permanent Mappings ({filteredMappings.length} / {mappings.length})
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Pre-configured faculty & section student pools for autonomous examination creation
                </p>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-52">
                <Search className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
                <input
                  type="text"
                  placeholder="Search mappings..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Filter Tabs for Group and Section */}
            <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-[10px] font-bold">
                {['ALL', 'Group A', 'Group B'].map((grp) => (
                  <button
                    key={grp}
                    onClick={() => setFilterGroup(grp)}
                    className={`px-2 py-1 rounded transition-colors cursor-pointer ${filterGroup === grp
                      ? 'bg-white text-primary shadow-2xs font-extrabold'
                      : 'text-slate-600 hover:text-navy-800'
                      }`}
                  >
                    {grp === 'ALL' ? 'All Groups' : grp}
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg text-[10px] font-bold">
                {['ALL', ...sectionsList].map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setFilterSection(sec)}
                    className={`px-1.5 py-1 rounded transition-colors cursor-pointer ${filterSection === sec
                      ? 'bg-primary text-white font-extrabold'
                      : 'text-slate-600 hover:text-navy-800'
                      }`}
                  >
                    {sec}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Loading faculty-student mappings...
              </div>
            ) : filteredMappings.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Users className="mx-auto text-slate-300" size={36} />
                <div className="text-xs font-bold text-navy-800">No mappings matched your filter.</div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Upload Group A or Group B nominal PDFs on the left to automatically configure all 27 subject-wise mappings.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {filteredMappings.map((m) => (
                  <div
                    key={m._id}
                    className="p-3.5 rounded-xl border border-slate-200 hover:border-primary/40 bg-white transition-all shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-navy-800 text-xs sm:text-sm">
                          {m.subjectName}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-primary border border-blue-200">
                          {m.subjectCode}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                          Section {m.section}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          {m.group || 'Group A'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-slate-100 text-slate-600">
                          v{m.version || 1}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 flex items-center space-x-3">
                        <span>
                          Faculty: <strong className="text-navy-800">{m.facultyName}</strong>
                        </span>
                        <span>•</span>
                        <span className="inline-flex items-center font-semibold text-emerald-700">
                          <Users size={12} className="mr-1" />
                          {m.studentCount || (m.students ? m.students.length : 0)} Enrolled Students
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Permanently stored in MongoDB • Auto-loads on examination creation
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 sm:self-center">
                      <button
                        onClick={() => {
                          setInspectModalRoster(m);
                          setRosterSearchTerm('');
                        }}
                        title="View Enrolled Students"
                        className="p-1.5 text-slate-600 hover:text-primary hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Eye size={15} />
                      </button>
                      <button
                        onClick={() =>
                          handleDeleteMapping(m._id, `${m.subjectName} (${m.section} - ${m.group})`)
                        }
                        title="Deactivate Mapping"
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ROSTER INSPECTION MODAL */}
      {inspectModalRoster && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold text-navy-800">
                    {inspectModalRoster.subjectName}
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-100 text-primary">
                    {inspectModalRoster.subjectCode}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                    Section {inspectModalRoster.section}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                    {inspectModalRoster.group}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Faculty: <strong className="text-slate-800">{inspectModalRoster.facultyName}</strong> •{' '}
                  <span className="text-emerald-700 font-bold">
                    {inspectModalRoster.students ? inspectModalRoster.students.length : inspectModalRoster.studentCount}{' '}
                    Students
                  </span>
                </p>
              </div>
              <button
                onClick={() => setInspectModalRoster(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search within Modal */}
            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 text-slate-400" size={13} />
                <input
                  type="text"
                  placeholder="Filter students by name or registration number..."
                  value={rosterSearchTerm}
                  onChange={(e) => setRosterSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Modal Body: Student List Table */}
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
                  {modalFilteredStudents.map((st, i) => (
                    <tr key={st.registrationNumber || i} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {st.sNo || i + 1}
                      </td>
                      <td className="py-1.5 px-3 font-mono font-bold text-primary">
                        {st.registrationNumber}
                      </td>
                      <td className="py-1.5 px-3 font-medium text-navy-800">
                        {st.studentName || st.name}
                      </td>
                    </tr>
                  ))}
                  {modalFilteredStudents.length === 0 && (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-slate-400 text-xs">
                        No students match the search term.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Showing {modalFilteredStudents.length} of{' '}
                {inspectModalRoster.students ? inspectModalRoster.students.length : inspectModalRoster.studentCount}{' '}
                students
              </span>
              <button
                type="button"
                onClick={() => setInspectModalRoster(null)}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold text-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyAssignments;
