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
  ShieldCheck,
  RefreshCw,
  Search,
  Eye,
  X,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const PAGE_SIZE = 10;

const FacultyAssignments = () => {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSection, setFilterSection] = useState('ALL');
  const [page, setPage] = useState(1);

  // Single Subject & Single Section mapping upload state
  const [facultyName, setFacultyName] = useState('');
  const [facultyIdCode, setFacultyIdCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [section, setSection] = useState('A1');
  const [group, setGroup] = useState('Group A');
  const [selectedFile, setSelectedFile] = useState(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [inconsistentNames, setInconsistentNames] = useState([]);

  const [uploading, setUploading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const jobPollAbortRef = useRef(null);

  const [previewStudents, setPreviewStudents] = useState([]);
  const [inspectModalRoster, setInspectModalRoster] = useState(null);
  const [rosterSearchTerm, setRosterSearchTerm] = useState('');
  const [dbSubjects, setDbSubjects] = useState([]);

  const sectionsList = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

  useEffect(() => {
    fetchMappings();
    fetchSubjects();
    return () => {
      if (jobPollAbortRef.current) {
        jobPollAbortRef.current.abort();
      }
    };
  }, []);

  const fetchSubjects = async () => {
    try {
      const res = await api.get('/subjects');
      if (res.data?.success && Array.isArray(res.data.data)) {
        setDbSubjects(res.data.data);
      }
    } catch (err) {
      console.warn('Could not load subjects master collection:', err.message);
    }
  };

  const subjectPresets = useMemo(() => {
    const map = new Map();
    dbSubjects.forEach((s) => {
      const key = String(s.subjectCode || s.subjectName || '').trim().toUpperCase();
      if (key && !map.has(key)) {
        map.set(key, {
          name: s.subjectName,
          code: s.subjectCode,
        });
      }
    });
    mappings.forEach((m) => {
      const key = String(m.subjectCode || m.subjectName || '').trim().toUpperCase();
      if (key && !map.has(key)) {
        map.set(key, {
          name: m.subjectName,
          code: m.subjectCode,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [dbSubjects, mappings]);

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
        setRefreshWarning(res.data?.message || 'Mapping saved, but refreshing the table returned an unexpected response.');
      }
      return false;
    } catch (err) {
      console.error('Failed to load faculty mappings:', err);
      if (preserveOnFailure) {
        setRefreshWarning(
          `Mapping operation succeeded, but refreshing the mappings table failed (${formatApiError(err, 'Network error')}).`
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

    throw new Error('Background mapping job is still processing. Please click Refresh shortly.');
  };

  const handleSubjectDropdown = (e) => {
    const val = e.target.value;
    if (!val) {
      setSubjectName('');
      setSubjectCode('');
      return;
    }
    const found = subjectPresets.find((p) => p.code === val || p.name === val);
    if (found) {
      setSubjectName(found.name);
      setSubjectCode(found.code);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    const allowedExt = ['.pdf', '.xlsx', '.xls', '.csv'].some((ext) => lower.endsWith(ext));
    if (!allowedExt) {
      setPreviewError('Please upload a valid PDF, Excel (.xlsx/.xls), or CSV student roster file.');
      setSelectedFile(null);
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      setPreviewError('The selected file exceeds the 40MB limit.');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setPreviewError('');
    setPreviewStudents([]);
    setInconsistentNames([]);
  };

  const handleUploadAndPreview = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setPreviewError('Please select a roster file (PDF, Excel, or CSV).');
      return;
    }
    if (!facultyName.trim()) {
      setPreviewError('Faculty Name is required.');
      return;
    }
    if (!subjectName.trim() || !subjectCode.trim()) {
      setPreviewError('Subject Name and Subject Code are required.');
      return;
    }
    if (!section) {
      setPreviewError('Section (A1–A6) is required.');
      return;
    }

    try {
      setUploading(true);
      setPreviewError('');
      setRefreshWarning('');
      setSuccessMessage('');
      setInconsistentNames([]);
      setActiveJob(null);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('uploadMode', 'single');
      formData.append('facultyName', facultyName.trim());
      if (facultyIdCode.trim()) {
        formData.append('facultyIdCode', facultyIdCode.trim().toUpperCase());
      }
      formData.append('subjectName', subjectName.trim());
      formData.append('subjectCode', subjectCode.trim().toUpperCase());
      formData.append('section', section.trim().toUpperCase());
      formData.append('group', group);

      const startRes = await api.post('/mappings/jobs/upload-preview', formData, {
        timeout: API_TIMEOUTS.PDF_UPLOAD,
      });

      let extractionData = startRes.data;
      if (startRes.data?.success && startRes.data?.data?.jobId) {
        setActiveJob(startRes.data.data);
        const completedJob = await pollJobUntilTerminal(startRes.data.data.jobId);
        if (completedJob.status === 'FAILED') {
          setPreviewError(completedJob.errorMessage || 'Failed to extract student roster from uploaded file.');
          return;
        }
        extractionData = {
          success: true,
          inconsistentNames: completedJob.summary?.inconsistentNames || [],
          mappings: completedJob.previewMappings || completedJob.mappings || [],
          students: (completedJob.previewMappings || []).flatMap((m) => m.students || []),
        };
      }

      if (extractionData?.success) {
        const mismatches = extractionData.inconsistentNames || extractionData.summary?.inconsistentNames || [];
        setInconsistentNames(Array.isArray(mismatches) ? mismatches : []);

        const extracted =
          extractionData.students ||
          extractionData.data?.students ||
          extractionData.mappings?.[0]?.students ||
          (extractionData.data?.records || []).map((r, idx) => ({
            sNo: r.serialNumber || idx + 1,
            registrationNumber: r.rollNumber,
            studentName: r.studentName,
          }));

        if (extracted && extracted.length > 0) {
          setPreviewStudents(extracted);
        } else {
          setPreviewError('No valid student records could be extracted from this file.');
        }
      } else {
        setPreviewError(extractionData?.message || 'Failed to extract student roster.');
      }
    } catch (err) {
      if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return;
      }
      setPreviewError(formatApiError(err, 'Failed to extract students from file.'));
    } finally {
      setUploading(false);
    }
  };

  const handleUpdatePreviewStudentName = (index, newName) => {
    setPreviewStudents((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], studentName: newName };
      return copy;
    });
  };

  const handleConfirmSingleMapping = async () => {
    if (!facultyName.trim() || !subjectName.trim() || !subjectCode.trim() || !section) {
      setPreviewError('Faculty Name, Subject Name, Subject Code, and Section are required.');
      return;
    }
    if (previewStudents.length === 0) {
      setPreviewError('Preview the student roster before saving.');
      return;
    }

    let savedSingle = false;
    try {
      setConfirming(true);
      setPreviewError('');
      setRefreshWarning('');

      const payload = {
        facultyName: facultyName.trim(),
        facultyIdCode: facultyIdCode.trim().toUpperCase(),
        subjectName: subjectName.trim(),
        subjectCode: subjectCode.trim().toUpperCase(),
        section: section.trim().toUpperCase(),
        group: group || 'Group A',
        replaceExisting,
        students: previewStudents.map((s, idx) => ({
          sNo: s.sNo || idx + 1,
          registrationNumber: s.registrationNumber,
          studentName: s.studentName || s.name,
        })),
      };

      const res = await api.post('/mappings/confirm', payload, { timeout: API_TIMEOUTS.HEAVY_WRITE });
      if (res.data?.success) {
        savedSingle = true;
        setSuccessMessage(
          `Saved ${previewStudents.length} students for ${subjectName} (${subjectCode}) • Section ${section}.`
        );
        setPreviewStudents([]);
        setSelectedFile(null);
        setActiveJob(null);
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

  const handleDeleteMapping = async (id, title) => {
    if (!window.confirm(`Deactivate permanent mapping for ${title}?`)) return;
    try {
      await api.delete(`/mappings/${id}`);
      await fetchMappings();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to deactivate mapping.');
    }
  };

  const deferredSearchTerm = useDeferredValue(searchTerm);

  const filteredMappings = useMemo(() => {
    const q = deferredSearchTerm.toLowerCase().trim();
    return mappings.filter((m) => {
      const matchSearch =
        !q ||
        m.facultyName?.toLowerCase().includes(q) ||
        m.subjectName?.toLowerCase().includes(q) ||
        m.subjectCode?.toLowerCase().includes(q) ||
        m.section?.toLowerCase().includes(q);
      const matchSection = filterSection === 'ALL' || m.section === filterSection;
      return matchSearch && matchSection;
    });
  }, [mappings, deferredSearchTerm, filterSection]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearchTerm, filterSection]);

  const totalPages = Math.max(1, Math.ceil(filteredMappings.length / PAGE_SIZE));
  const pagedMappings = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredMappings.slice(start, start + PAGE_SIZE);
  }, [filteredMappings, page]);

  const modalFilteredStudents = useMemo(() => {
    if (!inspectModalRoster || !inspectModalRoster.students) return [];
    if (!rosterSearchTerm.trim()) return inspectModalRoster.students;
    const term = rosterSearchTerm.toLowerCase();
    return inspectModalRoster.students.filter(
      (s) =>
        s.registrationNumber?.toLowerCase().includes(term) ||
        (s.studentName || s.name || '').toLowerCase().includes(term)
    );
  }, [inspectModalRoster, rosterSearchTerm]);

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#E5E7EB] dark:border-[#30384A]">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary">
              <UserCheck size={18} />
            </span>
            <h1 className="text-xl font-bold text-[#172033] dark:text-[#F8FAFC] tracking-tight">
              Section-Wise Faculty &amp; Student Mapping
            </h1>
          </div>
          <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-1">
            Configure ONE subject, ONE section, and ONE faculty roster at a time (PDF, Excel, or CSV).
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchMappings()}
          className="es-btn-secondary self-start sm:self-center"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Alerts */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 flex items-start">
          <CheckCircle2 size={18} className="mr-2.5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{successMessage}</div>
          <button type="button" onClick={() => setSuccessMessage('')} className="ml-2">
            <X size={14} />
          </button>
        </div>
      )}

      {previewError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-200 flex items-start">
          <AlertCircle size={18} className="mr-2.5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium whitespace-pre-line">{previewError}</div>
          <button type="button" onClick={() => setPreviewError('')} className="ml-2">
            <X size={14} />
          </button>
        </div>
      )}

      {refreshWarning && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start">
          <AlertCircle size={18} className="mr-2.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{refreshWarning}</div>
          <button type="button" onClick={() => setRefreshWarning('')} className="ml-2">
            <X size={14} />
          </button>
        </div>
      )}

      {inconsistentNames.length > 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div className="font-bold flex items-center justify-between">
            <span>Inconsistent Student Name(s) Detected ({inconsistentNames.length}) — Review Inline Before Saving</span>
            <button type="button" onClick={() => setInconsistentNames([])} className="cursor-pointer">
              <X size={14} />
            </button>
          </div>
          <ul className="list-disc pl-5 text-[11px]">
            {inconsistentNames.slice(0, 6).map((item) => (
              <li key={item.registrationNumber}>
                <span className="font-mono font-bold">{item.registrationNumber}</span>: {(item.names || []).join(' vs ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeJob && (
        <div className="es-glass-card p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#172033] dark:text-[#F8FAFC]">
              Extracting Student Roster...
            </span>
            <span className="font-mono font-bold text-primary">{activeJob.progress?.percent ?? 10}%</span>
          </div>
          <div className="w-full h-2 bg-[#F7F7FB] dark:bg-[#141926] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(8, activeJob.progress?.percent ?? 0))}%` }}
            />
          </div>
        </div>
      )}

      {/* Single Section Mapping Upload Card */}
      <section className="es-glass-card p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] dark:border-[#30384A] pb-3">
          <h2 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC] flex items-center">
            <UploadCloud size={17} className="mr-2 text-primary" />
            Upload Single Section Student Roster
          </h2>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary">
            1 Subject • 1 Section
          </span>
        </div>

        <form onSubmit={handleUploadAndPreview} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Existing Subject Preset
              </label>
              <select
                value={subjectCode || ''}
                onChange={handleSubjectDropdown}
                className="es-input"
              >
                <option value="">Custom / New Subject</option>
                {subjectPresets.map((p) => (
                  <option key={p.code || p.name} value={p.code || p.name}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Subject Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="e.g. Compiler Design"
                className="es-input"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Subject Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value.toUpperCase())}
                placeholder="e.g. 20A05501T"
                className="es-input font-mono font-bold text-primary uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Section <span className="text-red-500">*</span>
              </label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="es-input font-semibold"
              >
                {sectionsList.map((sec) => (
                  <option key={sec} value={sec}>
                    Section {sec}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Faculty Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={facultyName}
                onChange={(e) => setFacultyName(e.target.value)}
                placeholder="e.g. Dr. Rajesh Kumar"
                className="es-input"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Faculty ID
              </label>
              <input
                type="text"
                value={facultyIdCode}
                onChange={(e) => setFacultyIdCode(e.target.value.toUpperCase())}
                placeholder="FAC101"
                className="es-input font-mono uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Group
              </label>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="es-input"
              >
                <option value="Group A">Group A (A1–A3)</option>
                <option value="Group B">Group B (A4–A6)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Roster File (.pdf, .xlsx, .csv) <span className="text-red-500">*</span>
              </label>
              <label
                htmlFor="singleSectionRosterFile"
                className="es-input flex items-center justify-between cursor-pointer overflow-hidden"
              >
                <span className="truncate text-xs">
                  {selectedFile ? selectedFile.name : 'Choose PDF / Excel / CSV...'}
                </span>
                <FileText size={15} className="text-primary flex-shrink-0 ml-2" />
              </label>
              <input
                type="file"
                id="singleSectionRosterFile"
                accept=".pdf,.xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
            <label className="inline-flex items-center space-x-2 text-xs text-[#64748B] dark:text-[#A1A1AA] cursor-pointer">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                className="rounded text-primary focus:ring-primary"
              />
              <span>Update existing mapping version for this Subject &amp; Section</span>
            </label>

            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="es-btn-primary"
            >
              <UploadCloud size={15} className="mr-1.5" />
              <span>{uploading ? 'Extracting Roster...' : 'Extract & Preview Roster'}</span>
            </button>
          </div>
        </form>

        {/* Extracted Single Section Preview */}
        {previewStudents.length > 0 && (
          <div className="pt-4 border-t border-[#E5E7EB] dark:border-[#30384A] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck size={16} className="text-emerald-600" />
                <span className="text-xs font-bold text-[#172033] dark:text-[#F8FAFC]">
                  Extracted {previewStudents.length} Students for {subjectCode} ({section})
                </span>
              </div>
              <button
                type="button"
                onClick={handleConfirmSingleMapping}
                disabled={confirming}
                className="es-btn-primary bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 size={15} className="mr-1.5" />
                <span>{confirming ? 'Saving Roster...' : 'Confirm & Save Mapping'}</span>
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto border border-[#E5E7EB] dark:border-[#30384A] rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F7FB] dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] font-semibold sticky top-0 border-b border-[#E5E7EB] dark:border-[#30384A]">
                  <tr>
                    <th className="py-2 px-3 w-12">S.No.</th>
                    <th className="py-2 px-3">Registration Number</th>
                    <th className="py-2 px-3">Student Name (Click to Edit)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#30384A]">
                  {previewStudents.map((st, i) => (
                    <tr key={st.registrationNumber || i} className="hover:bg-[#F8DCEB]/20 dark:hover:bg-white/5">
                      <td className="py-1.5 px-3 font-mono text-[#64748B] dark:text-[#A1A1AA]">
                        {st.sNo || i + 1}
                      </td>
                      <td className="py-1.5 px-3 font-mono font-bold text-primary">
                        {st.registrationNumber}
                      </td>
                      <td className="py-1.5 px-3">
                        <input
                          type="text"
                          value={st.studentName || st.name || ''}
                          onChange={(e) => handleUpdatePreviewStudentName(i, e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-primary focus:outline-none text-xs text-[#172033] dark:text-[#F8FAFC]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Clean Paginated Section Mappings Table (No Card Clutter) */}
      <section className="es-glass-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#E5E7EB] dark:border-[#30384A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
              Saved Section Mappings ({filteredMappings.length})
            </h2>
            <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-0.5">
              Single-section student rosters stored in MongoDB.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              aria-label="Filter by Section"
              className="es-input w-auto min-w-[120px]"
            >
              <option value="ALL">All Sections</option>
              {sectionsList.map((sec) => (
                <option key={sec} value={sec}>Section {sec}</option>
              ))}
            </select>

            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-3 text-[#64748B] dark:text-[#A1A1AA]" size={14} />
              <input
                type="text"
                placeholder="Search subject, code, faculty..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="es-input pl-9"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-[#64748B] dark:text-[#A1A1AA]">
              Loading permanent mappings...
            </div>
          ) : pagedMappings.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Users className="mx-auto text-[#64748B]/50" size={32} />
              <div className="text-xs font-bold text-[#172033] dark:text-[#F8FAFC]">No section mappings found</div>
              <p className="text-xs text-[#64748B] dark:text-[#A1A1AA]">
                Upload a single subject &amp; section student roster above to create a permanent mapping.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F7F7FB] dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] font-semibold uppercase tracking-wider text-[11px] border-b border-[#E5E7EB] dark:border-[#30384A]">
                <tr>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Faculty</th>
                  <th className="py-3 px-4 text-right">Students</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#30384A]">
                {pagedMappings.map((m) => (
                  <tr key={m._id} className="hover:bg-[#F8DCEB]/20 dark:hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 font-bold text-[#172033] dark:text-[#F8FAFC]">{m.subjectName}</td>
                    <td className="py-3 px-4 font-mono font-bold text-primary">{m.subjectCode}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary">
                        {m.section}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#172033] dark:text-[#F8FAFC]">{m.facultyName}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#172033] dark:text-[#F8FAFC]">
                      {m.studentCount || (m.students ? m.students.length : 0)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => {
                            setInspectModalRoster(m);
                            setRosterSearchTerm('');
                          }}
                          title="View Section Roster"
                          className="p-1.5 text-[#64748B] dark:text-[#A1A1AA] hover:text-primary rounded-lg cursor-pointer"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMapping(m._id, `${m.subjectName} (${m.section})`)}
                          title="Deactivate Mapping"
                          className="p-1.5 text-[#64748B] dark:text-[#A1A1AA] hover:text-red-600 rounded-lg cursor-pointer"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-[#E5E7EB] dark:border-[#30384A] flex items-center justify-between text-xs text-[#64748B] dark:text-[#A1A1AA]">
            <span>
              Page <strong className="text-[#172033] dark:text-[#F8FAFC]">{page}</strong> of {totalPages}
            </span>
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#30384A] disabled:opacity-40 cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-[#E5E7EB] dark:border-[#30384A] disabled:opacity-40 cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Roster Inspection Modal */}
      {inspectModalRoster && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1B2030] border border-[#E5E7EB] dark:border-[#30384A] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#E5E7EB] dark:border-[#30384A] flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold text-[#172033] dark:text-[#F8FAFC]">
                    {inspectModalRoster.subjectName}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F8DCEB] dark:bg-[#F472B6]/15 text-primary">
                    {inspectModalRoster.subjectCode}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-white/10 text-[#172033] dark:text-[#F8FAFC]">
                    Section {inspectModalRoster.section}
                  </span>
                </div>
                <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-1">
                  Faculty: <strong className="text-[#172033] dark:text-[#F8FAFC]">{inspectModalRoster.facultyName}</strong> •{' '}
                  {inspectModalRoster.students ? inspectModalRoster.students.length : inspectModalRoster.studentCount} Students
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectModalRoster(null)}
                className="p-1.5 text-[#64748B] hover:text-primary rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 border-b border-[#E5E7EB] dark:border-[#30384A]">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-[#64748B]" size={14} />
                <input
                  type="text"
                  placeholder="Filter by registration number or student name..."
                  value={rosterSearchTerm}
                  onChange={(e) => setRosterSearchTerm(e.target.value)}
                  className="es-input pl-9"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F7F7FB] dark:bg-[#141926] text-[#64748B] dark:text-[#A1A1AA] font-semibold sticky top-0">
                  <tr>
                    <th className="py-2 px-3 w-12">S.No.</th>
                    <th className="py-2 px-3">Registration Number</th>
                    <th className="py-2 px-3">Student Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#30384A]">
                  {modalFilteredStudents.map((st, i) => (
                    <tr key={st.registrationNumber || i}>
                      <td className="py-2 px-3 font-mono text-[#64748B] dark:text-[#A1A1AA]">{st.sNo || i + 1}</td>
                      <td className="py-2 px-3 font-mono font-bold text-primary">{st.registrationNumber}</td>
                      <td className="py-2 px-3 font-medium text-[#172033] dark:text-[#F8FAFC]">{st.studentName || st.name}</td>
                    </tr>
                  ))}
                  {modalFilteredStudents.length === 0 && (
                    <tr>
                      <td colSpan="3" className="py-8 text-center text-[#64748B] dark:text-[#A1A1AA]">
                        No matching students found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-[#E5E7EB] dark:border-[#30384A] flex items-center justify-between text-xs">
              <span className="text-[#64748B] dark:text-[#A1A1AA]">
                Showing {modalFilteredStudents.length} of{' '}
                {inspectModalRoster.students ? inspectModalRoster.students.length : inspectModalRoster.studentCount} students
              </span>
              <button
                type="button"
                onClick={() => setInspectModalRoster(null)}
                className="es-btn-secondary"
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
