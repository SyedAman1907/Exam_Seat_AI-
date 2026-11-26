import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import { downloadProtectedReport } from '../../utils/fileDownloader';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Edit3,
  Search,
  Users,
  Download,
  AlertCircle,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const Students = () => {
  // Navigation tabs: 'database' | 'import'
  const [activeTab, setActiveTab] = useState('database');

  // Database View State
  const [databaseStudents, setDatabaseStudents] = useState([]);
  const [loadingDb, setLoadingDb] = useState(true);
  const [dbError, setDbError] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterSection, setFilterSection] = useState('all');
  const [filterFaculty, setFilterFaculty] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    totalRecords: 0,
    totalPages: 1,
  });
  const [availableFilters, setAvailableFilters] = useState({ subjects: [], sections: [], faculty: [] });
  const [stats, setStats] = useState({
    total: 0,
    groupA: 0,
    groupB: 0,
    masterTotal: 0,
    masterGroupA: 0,
    masterGroupB: 0,
    totalMappings: 0,
  });
  const [classroomSummary, setClassroomSummary] = useState({
    activeCount: null,
    roomNumbers: [],
    rangeLabel: 'Fetching configuration...',
  });

  // Multi-PDF Import State
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewRecords, setPreviewRecords] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [importMessage, setImportMessage] = useState({ type: '', text: '' });

  const abortControllerRef = useRef(null);
  const hasLoadedMetaRef = useRef(false);
  const lastPreviewSignatureRef = useRef('');

  // Optional manual default hints for upload
  const [uploadHints, setUploadHints] = useState({
    subjectName: '',
    facultyName: '',
    section: 'A1',
    academicYear: '2026-2027',
    group: 'Group A',
  });

  // Debounce search input cleanly (300ms) and reset pagination only when debounced search commits
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage((prev) => (prev === 1 ? prev : 1));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadStudentDatabase = useCallback(async (targetPage = page, forceMeta = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoadingDb(true);
      setDbError('');
      const params = {
        page: targetPage,
        limit: 50,
        includeMeta: !hasLoadedMetaRef.current || forceMeta ? 'true' : 'false',
      };
      if (filterSubject !== 'all') params.subject = filterSubject;
      if (filterSection !== 'all') params.section = filterSection;
      if (filterFaculty !== 'all') params.faculty = filterFaculty;
      if (filterGroup !== 'all') params.group = filterGroup;
      if (debouncedSearch) params.search = debouncedSearch;

      const res = await api.get('/students/database', {
        params,
        signal: controller.signal,
        timeout: API_TIMEOUTS.DEFAULT,
      });

      if (res.data?.success) {
        setDatabaseStudents(res.data.data || []);
        if (res.data.filtersAvailable) {
          setAvailableFilters(res.data.filtersAvailable);
        }
        if (res.data.classroomSummary) {
          setClassroomSummary(res.data.classroomSummary);
        }
        if (res.data.filtersAvailable || res.data.classroomSummary) {
          hasLoadedMetaRef.current = true;
        }
        setPagination(
          res.data.pagination || {
            page: targetPage,
            limit: 50,
            totalRecords: res.data.count || 0,
            totalPages: Math.max(1, Math.ceil((res.data.count || 0) / 50)),
          }
        );
        setStats((prev) => ({
          total: res.data.count ?? 0,
          groupA: res.data.groupACount ?? 0,
          groupB: res.data.groupBCount ?? 0,
          masterTotal: res.data.masterStats?.total ?? prev.masterTotal,
          masterGroupA: res.data.masterStats?.groupA ?? prev.masterGroupA,
          masterGroupB: res.data.masterStats?.groupB ?? prev.masterGroupB,
          totalMappings: res.data.masterStats?.totalMappings ?? prev.totalMappings,
        }));
      } else {
        setDbError(res.data?.message || 'Unable to retrieve student records.');
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Error fetching student database:', err);
      setDbError(
        err.response?.data?.message ||
        (err.code === 'ECONNABORTED'
          ? 'Request timed out while querying MongoDB. Please retry.'
          : 'Failed to load student database records. Please verify backend connection and retry.')
      );
    } finally {
      if (abortControllerRef.current === controller) {
        setLoadingDb(false);
      }
    }
  }, [filterSubject, filterSection, filterFaculty, filterGroup, debouncedSearch, page]);

  useEffect(() => {
    loadStudentDatabase(page);
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadStudentDatabase, page]);

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  // Multi-File Upload Handler
  const handleFileSelect = (e) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...filesArray]);
      setImportMessage({ type: '', text: '' });
    }
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Action 1: Preview Extracted Data (skips redundant re-extraction if unchanged files/hints already previewed)
  const handlePreviewExtraction = async () => {
    if (selectedFiles.length === 0) {
      setImportMessage({ type: 'error', text: 'Please select at least one student PDF document to extract.' });
      return;
    }

    const sig = JSON.stringify({
      files: selectedFiles.map((f) => `${f.name}:${f.size}:${f.lastModified}`),
      uploadHints,
    });
    if (sig === lastPreviewSignatureRef.current && previewRecords.length > 0) {
      setImportMessage({
        type: 'success',
        text: `Showing previously extracted preview (${previewRecords.length} records). Upload a different file or adjust hints to re-extract.`,
      });
      return;
    }

    try {
      setExtracting(true);
      setImportMessage({ type: '', text: '' });

      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });
      if (uploadHints.subjectName) formData.append('subjectName', uploadHints.subjectName);
      if (uploadHints.facultyName) formData.append('facultyName', uploadHints.facultyName);
      if (uploadHints.section) formData.append('section', uploadHints.section);
      if (uploadHints.academicYear) formData.append('academicYear', uploadHints.academicYear);
      if (uploadHints.group) formData.append('group', uploadHints.group);

      const res = await api.post('/students/multi-pdf-preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: API_TIMEOUTS.PDF_UPLOAD,
      });

      if (res.data.success) {
        lastPreviewSignatureRef.current = sig;
        setPreviewData(res.data.data.summary);
        setPreviewRecords(res.data.data.records || []);
        setIsEditing(false);
        setImportMessage({
          type: 'success',
          text: `Extracted ${res.data.data.records.length} student records from ${selectedFiles.length} file(s). Review below before confirming.`,
        });
      }
    } catch (err) {
      setImportMessage({
        type: 'error',
        text: formatApiError(err, 'Failed to extract records from uploaded documents.'),
      });
    } finally {
      setExtracting(false);
    }
  };

  // Action 2: Edit Records Inline
  const handleRecordChange = (id, field, value) => {
    setPreviewRecords((prev) =>
      prev.map((rec) => (rec.id === id ? { ...rec, [field]: value } : rec))
    );
  };

  // Action 3: Confirm and Import
  const handleConfirmImport = async () => {
    if (previewRecords.length === 0) {
      setImportMessage({ type: 'error', text: 'No records to import.' });
      return;
    }

    try {
      setConfirming(true);
      const res = await api.post(
        '/students/multi-pdf-confirm',
        { records: previewRecords },
        { timeout: API_TIMEOUTS.HEAVY_WRITE }
      );

      if (res.data.success) {
        hasLoadedMetaRef.current = false;
        lastPreviewSignatureRef.current = '';
        setImportMessage({
          type: 'success',
          text: `Successfully imported ${res.data.count} student records into the official database.`,
        });
        // Reset preview and refresh DB view
        setTimeout(() => {
          setPreviewData(null);
          setPreviewRecords([]);
          setSelectedFiles([]);
          setActiveTab('database');
          setPage(1);
          loadStudentDatabase(1, true);
        }, 900);
      }
    } catch (err) {
      setImportMessage({
        type: 'error',
        text: formatApiError(err, 'Failed to save confirmed student records.'),
      });
    } finally {
      setConfirming(false);
    }
  };

  // Action 4: Cancel Import
  const handleCancelImport = () => {
    lastPreviewSignatureRef.current = '';
    setPreviewData(null);
    setPreviewRecords([]);
    setSelectedFiles([]);
    setIsEditing(false);
    setImportMessage({ type: '', text: '' });
  };

  const [exportingExcel, setExportingExcel] = useState(false);

  // Excel Master Export
  const handleExportMasterExcel = async () => {
    if (exportingExcel) return;
    setExportingExcel(true);
    setDbError('');
    try {
      const params = {};
      if (filterSubject !== 'all') params.subject = filterSubject;
      if (filterSection !== 'all') params.section = filterSection;
      if (filterFaculty !== 'all') params.faculty = filterFaculty;
      if (filterGroup !== 'all') params.group = filterGroup;

      await downloadProtectedReport(
        '/reports/master-students-excel',
        `RGMCET_CSE_Student_Master_Database_${new Date().toISOString().split('T')[0]}.xlsx`,
        'download',
        {
          params,
          timeout: API_TIMEOUTS.REPORT_EXPORT,
          onError: (msg) => setDbError(msg || 'Failed to download student master database spreadsheet.'),
        }
      );
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200 gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-800 tracking-tight">
            Real Student Data Import & Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Rajeev Gandhi Memorial College of Engineering and Technology • Department of CSE
          </p>
        </div>

        {/* Tab Controls & Master Export */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab('database')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'database'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
          >
            <Users size={14} className="inline mr-1.5" />
            Structured Student Database
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${activeTab === 'import'
              ? 'bg-primary text-white shadow-xs'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
          >
            <UploadCloud size={14} className="inline mr-1.5" />
            Upload Student PDFs
          </button>
          <button
            type="button"
            onClick={handleExportMasterExcel}
            disabled={exportingExcel}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white shadow-xs transition-colors cursor-pointer"
            title="Download full structured student database as Excel"
          >
            <Download size={14} className="inline mr-1" />
            {exportingExcel ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* TAB 1: MULTIPLE PDF STUDENT DATA IMPORT & VERIFICATION   */}
      {/* ======================================================== */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* File Upload Box */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-navy-800">
                  Multiple PDF & Document Student Data Import
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload one or more faculty student roster PDFs. Extracts Roll Number, Faculty, Section, Student Name, Subject, Group, A1–A6 marks, and FDH roll numbers.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200">
                OCR Fallback Supported
              </span>
            </div>

            {/* Drag & Drop Multi-file input */}
            <div className="border-2 border-dashed border-slate-300 hover:border-primary/60 rounded-xl p-6 text-center transition-colors bg-slate-50/50">
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.csv"
                id="multi-file-input"
                onChange={handleFileSelect}
                className="hidden"
              />
              <label htmlFor="multi-file-input" className="cursor-pointer space-y-2 block">
                <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <UploadCloud size={24} />
                </div>
                <div className="text-xs font-bold text-navy-800">
                  Click to select multiple PDF / Excel / CSV files
                </div>
                <p className="text-[11px] text-slate-400">
                  Supports text-based and scanned PDFs, multi-page files, multi-subject documents
                </p>
              </label>
            </div>

            {/* Selected Files Badge List */}
            {selectedFiles.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-navy-800">
                    Selected Documents ({selectedFiles.length}):
                  </span>
                  <button
                    onClick={() => setSelectedFiles([])}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((f, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-100 border border-slate-200 text-slate-700"
                    >
                      <FileText size={13} className="text-primary flex-shrink-0" />
                      <span className="truncate max-w-[200px] font-medium">{f.name}</span>
                      <span className="text-[10px] text-slate-400">({(f.size / 1024).toFixed(0)} KB)</span>
                      <button
                        onClick={() => handleRemoveFile(idx)}
                        className="text-slate-400 hover:text-red-600 ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional default hint values */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Default Subject (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Auto-detected if blank"
                  value={uploadHints.subjectName}
                  onChange={(e) => setUploadHints({ ...uploadHints, subjectName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Default Faculty (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Auto-detected if blank"
                  value={uploadHints.facultyName}
                  onChange={(e) => setUploadHints({ ...uploadHints, facultyName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Section</label>
                <select
                  value={uploadHints.section}
                  onChange={(e) => setUploadHints({ ...uploadHints, section: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="A1">Section A1</option>
                  <option value="A2">Section A2</option>
                  <option value="A3">Section A3</option>
                  <option value="A4">Section A4</option>
                  <option value="A5">Section A5</option>
                  <option value="A6">Section A6</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Default Group</label>
                <select
                  value={uploadHints.group}
                  onChange={(e) => setUploadHints({ ...uploadHints, group: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Group A">Group A</option>
                  <option value="Group B">Group B</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Academic Year</label>
                <input
                  type="text"
                  value={uploadHints.academicYear}
                  onChange={(e) => setUploadHints({ ...uploadHints, academicYear: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Action Buttons: Preview Extracted Data */}
            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={handlePreviewExtraction}
                disabled={selectedFiles.length === 0 || extracting}
                className="px-4 py-2.5 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover disabled:opacity-50 transition-colors shadow-xs flex items-center space-x-2"
              >
                {extracting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin mr-1.5" />
                    <span>Extracting PDF Data & OCR...</span>
                  </>
                ) : (
                  <>
                    <FileText size={14} className="mr-1.5" />
                    <span>Preview Extracted Data</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Import Status Message */}
          {importMessage.text && (
            <div
              className={`p-4 rounded-xl text-xs flex items-start space-x-3 ${importMessage.type === 'error'
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                }`}
            >
              {importMessage.type === 'error' ? (
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="font-medium">{importMessage.text}</div>
            </div>
          )}

          {/* PREVIEW & VALIDATION TABLE (Section 6 Requirements) */}
          {previewRecords.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
              {/* Preview Header & Buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-200 gap-3">
                <div>
                  <h3 className="text-sm font-bold text-navy-800">
                    Extracted Student Records Preview ({previewRecords.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review extracted data, verify A1–A6 columns and FDH numbers. Edit inline if necessary before confirmation.
                  </p>
                </div>

                {/* 4 Required Action Buttons */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isEditing
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                  >
                    <Edit3 size={13} className="inline mr-1" />
                    {isEditing ? 'Done Editing' : 'Edit Records'}
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={confirming}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs"
                  >
                    {confirming ? 'Saving Records...' : 'Confirm and Import'}
                  </button>
                  <button
                    onClick={handleCancelImport}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-red-600 border border-slate-300 hover:bg-red-50 transition-colors"
                  >
                    Cancel Import
                  </button>
                </div>
              </div>

              {/* Summary Badges */}
              {previewData && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold uppercase">Total Extracted</span>
                    <span className="text-sm font-bold text-navy-800">{previewData.totalExtracted}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] text-emerald-700 block font-semibold uppercase">Valid Records</span>
                    <span className="text-sm font-bold text-emerald-800">{previewData.validCount}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                    <span className="text-[10px] text-blue-700 block font-semibold uppercase">Subjects Detected</span>
                    <span className="text-sm font-bold text-primary">{previewData.subjectsFound.length}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200">
                    <span className="text-[10px] text-purple-700 block font-semibold uppercase">Sections Detected</span>
                    <span className="text-sm font-bold text-purple-800">
                      {previewData.sectionsFound.join(', ') || 'A'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                    <span className="text-[10px] text-amber-700 block font-semibold uppercase">Duplicates Flagged</span>
                    <span className="text-sm font-bold text-amber-800">{previewData.duplicateCount}</span>
                  </div>
                </div>
              )}

              {/* Data Table with Columns per Prompt 5 */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 uppercase text-[10px] tracking-wider z-10">
                    <tr>
                      <th className="py-2.5 px-3 text-center">S.No</th>
                      <th className="py-2.5 px-3">Roll Number</th>
                      <th className="py-2.5 px-3">Student Name</th>
                      <th className="py-2.5 px-3">Faculty Name</th>
                      <th className="py-2.5 px-2 text-center">Section</th>
                      <th className="py-2.5 px-3">Subject Name</th>
                      <th className="py-2.5 px-2 text-center">Group</th>
                      <th className="py-2.5 px-1.5 text-center">A1</th>
                      <th className="py-2.5 px-1.5 text-center">A2</th>
                      <th className="py-2.5 px-1.5 text-center">A3</th>
                      <th className="py-2.5 px-1.5 text-center">A4</th>
                      <th className="py-2.5 px-1.5 text-center">A5</th>
                      <th className="py-2.5 px-1.5 text-center">A6</th>
                      <th className="py-2.5 px-3 text-center">FDH Roll No</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {previewRecords.map((r, i) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2 px-3 text-center text-slate-500 text-[11px]">{i + 1}</td>
                        <td className="py-2 px-3 font-mono font-bold text-navy-800">
                          {isEditing ? (
                            <input
                              type="text"
                              value={r.rollNumber}
                              onChange={(e) => handleRecordChange(r.id, 'rollNumber', e.target.value.toUpperCase())}
                              className="w-24 px-1.5 py-0.5 border border-slate-300 rounded font-mono uppercase text-xs"
                            />
                          ) : (
                            r.rollNumber
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-800">
                          {isEditing ? (
                            <input
                              type="text"
                              value={r.studentName}
                              onChange={(e) => handleRecordChange(r.id, 'studentName', e.target.value)}
                              className="w-36 px-1.5 py-0.5 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            r.studentName
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {isEditing ? (
                            <input
                              type="text"
                              value={r.facultyName}
                              onChange={(e) => handleRecordChange(r.id, 'facultyName', e.target.value)}
                              className="w-28 px-1.5 py-0.5 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            r.facultyName
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {isEditing ? (
                            <select
                              value={r.section}
                              onChange={(e) => handleRecordChange(r.id, 'section', e.target.value)}
                              className="px-1 py-0.5 border border-slate-300 rounded text-xs"
                            >
                              <option value="A">A</option>
                              <option value="B">B</option>
                              <option value="C">C</option>
                            </select>
                          ) : (
                            <span className="font-bold text-navy-800">{r.section}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-700 truncate max-w-[130px]" title={r.subjectName}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={r.subjectName}
                              onChange={(e) => handleRecordChange(r.id, 'subjectName', e.target.value)}
                              className="w-32 px-1.5 py-0.5 border border-slate-300 rounded text-xs"
                            />
                          ) : (
                            r.subjectName
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <select
                            value={r.group}
                            onChange={(e) => handleRecordChange(r.id, 'group', e.target.value)}
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${r.group === 'Group B'
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                              }`}
                          >
                            <option value="Group A">Group A</option>
                            <option value="Group B">Group B</option>
                          </select>
                        </td>
                        {['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((col) => (
                          <td key={col} className="py-2 px-1.5 text-center font-mono text-[11px] text-slate-600">
                            {isEditing ? (
                              <input
                                type="text"
                                value={r[col]}
                                onChange={(e) => handleRecordChange(r.id, col, e.target.value)}
                                className="w-8 px-0.5 py-0.5 border border-slate-300 rounded text-center text-xs"
                              />
                            ) : (
                              r[col] || '—'
                            )}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-700">
                          {isEditing ? (
                            <input
                              type="text"
                              value={r.fdhNumber}
                              onChange={(e) => handleRecordChange(r.id, 'fdhNumber', e.target.value.toUpperCase())}
                              placeholder="None"
                              className="w-24 px-1.5 py-0.5 border border-slate-300 rounded font-mono uppercase text-xs"
                            />
                          ) : (
                            r.fdhNumber || <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {r.warnings && r.warnings.length > 0 ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold cursor-help"
                              title={r.warnings.join('; ')}
                            >
                              Notice
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                              Verified
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: STRUCTURED STUDENT DATABASE VIEW & MULTI-FILTER   */}
      {/* ======================================================== */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Total Real Students
              </span>
              <span className="text-2xl font-bold text-navy-800 mt-1 block">
                {dbError ? '—' : loadingDb && stats.masterTotal === 0 && stats.total === 0 ? '...' : stats.masterTotal || stats.total}
              </span>
              <span className="text-[10px] text-slate-500">
                {dbError
                  ? 'Unavailable'
                  : `${stats.total} subject enrollments${stats.totalMappings ? ` • ${stats.totalMappings} mappings` : ''}`}
              </span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-xs">
              <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider block">
                Group A Students
              </span>
              <span className="text-2xl font-bold text-primary mt-1 block">
                {dbError ? '—' : loadingDb && stats.masterGroupA === 0 && stats.groupA === 0 ? '...' : stats.masterGroupA || stats.groupA}
              </span>
              <span className="text-[10px] text-blue-600">
                {dbError ? 'Unavailable' : `${stats.groupA} matching enrollments`}
              </span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-purple-200 shadow-xs">
              <span className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider block">
                Group B Students
              </span>
              <span className="text-2xl font-bold text-purple-800 mt-1 block">
                {dbError ? '—' : loadingDb && stats.masterGroupB === 0 && stats.groupB === 0 ? '...' : stats.masterGroupB || stats.groupB}
              </span>
              <span className="text-[10px] text-purple-600">
                {dbError ? 'Unavailable' : `${stats.groupB} matching enrollments`}
              </span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">
                ET Block Classrooms
              </span>
              <span className="text-2xl font-bold text-navy-800 mt-1 block">
                {dbError ? '—' : classroomSummary.activeCount === null ? '...' : classroomSummary.activeCount}
              </span>
              <span className="text-[10px] text-emerald-700">
                {dbError ? 'Unavailable' : classroomSummary.rangeLabel}
              </span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Subject Filter */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block uppercase">Subject</label>
                  <select
                    value={filterSubject}
                    onChange={handleFilterChange(setFilterSubject)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="all">All Subjects</option>
                    {availableFilters.subjects.map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Section Filter */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block uppercase">Section</label>
                  <select
                    value={filterSection}
                    onChange={handleFilterChange(setFilterSection)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="all">All Sections</option>
                    <option value="A1">Section A1</option>
                    <option value="A2">Section A2</option>
                    <option value="A3">Section A3</option>
                    <option value="A4">Section A4</option>
                    <option value="A5">Section A5</option>
                    <option value="A6">Section A6</option>
                  </select>
                </div>

                {/* Group Filter */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block uppercase">Group</label>
                  <select
                    value={filterGroup}
                    onChange={handleFilterChange(setFilterGroup)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="all">Both Groups</option>
                    <option value="Group A">Group A</option>
                    <option value="Group B">Group B</option>
                  </select>
                </div>

                {/* Faculty Filter */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block uppercase">Faculty</label>
                  <select
                    value={filterFaculty}
                    onChange={handleFilterChange(setFilterFaculty)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="all">All Faculty</option>
                    {availableFilters.faculty.map((fac) => (
                      <option key={fac} value={fac}>
                        {fac}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Search Box & Refresh */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                  <input
                    type="text"
                    placeholder="Search Roll No or Name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadStudentDatabase(page, true)}
                  disabled={loadingDb}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                  title="Reload student records from database"
                >
                  <RefreshCw size={14} className={loadingDb ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
          </div>

          {/* Database Table with Skeleton Loader, Error+Retry, Empty State, and Pagination */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {loadingDb ? (
              <div className="p-6 space-y-3">
                <div className="flex items-center justify-center space-x-2 text-xs font-semibold text-primary pb-2">
                  <RefreshCw size={15} className="animate-spin" />
                  <span>Loading official student records...</span>
                </div>
                {[...Array(6)].map((_, idx) => (
                  <div key={idx} className="h-8 bg-slate-100 animate-pulse rounded-md" />
                ))}
              </div>
            ) : dbError ? (
              <div className="p-10 text-center space-y-3 bg-red-50/40">
                <AlertCircle className="mx-auto text-red-500" size={36} />
                <h3 className="text-sm font-bold text-red-800">{dbError}</h3>
                <button
                  type="button"
                  onClick={() => loadStudentDatabase(page, true)}
                  className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-xs"
                >
                  <RefreshCw size={13} className="mr-1.5" />
                  Retry Loading Records
                </button>
              </div>
            ) : databaseStudents.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Users className="mx-auto text-slate-300" size={40} />
                <h3 className="text-base font-bold text-navy-800">
                  {filterSubject !== 'all' ||
                    filterSection !== 'all' ||
                    filterFaculty !== 'all' ||
                    filterGroup !== 'all' ||
                    debouncedSearch
                    ? 'No student records match the current filters.'
                    : 'No student data uploaded yet.'}
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Upload faculty student roster PDF documents or spreadsheets to import and maintain the official RGMCET CSE student master database.
                </p>
                <div className="pt-2 flex items-center justify-center gap-2">
                  {(filterSubject !== 'all' ||
                    filterSection !== 'all' ||
                    filterFaculty !== 'all' ||
                    filterGroup !== 'all' ||
                    debouncedSearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterSubject('all');
                          setFilterSection('all');
                          setFilterFaculty('all');
                          setFilterGroup('all');
                          setSearchQuery('');
                          setPage(1);
                        }}
                        className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
                      >
                        Clear Filters
                      </button>
                    )}
                  <button
                    onClick={() => setActiveTab('import')}
                    className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover shadow-xs transition-colors"
                  >
                    <UploadCloud size={14} className="mr-1.5" />
                    Upload Student PDFs
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="py-3 px-3 text-center">S.No</th>
                        <th className="py-3 px-3">Roll Number</th>
                        <th className="py-3 px-4">Student Name</th>
                        <th className="py-3 px-3">Faculty Name</th>
                        <th className="py-3 px-2 text-center">Sec</th>
                        <th className="py-3 px-3">Subject Name</th>
                        <th className="py-3 px-2 text-center">Group</th>
                        <th className="py-3 px-1 text-center">A1</th>
                        <th className="py-3 px-1 text-center">A2</th>
                        <th className="py-3 px-1 text-center">A3</th>
                        <th className="py-3 px-1 text-center">A4</th>
                        <th className="py-3 px-1 text-center">A5</th>
                        <th className="py-3 px-1 text-center">A6</th>
                        <th className="py-3 px-3 text-center">FDH Roll No</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {databaseStudents.map((st, i) => (
                        <tr key={st._id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">
                            {(pagination.page - 1) * pagination.limit + i + 1}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-navy-800">
                            {st.rollNumber}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-slate-800">
                            {st.studentName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{st.facultyName || 'CSE Faculty'}</td>
                          <td className="py-2.5 px-2 text-center">
                            <span className="px-1.5 py-0.5 rounded font-bold text-navy-800 bg-slate-100">
                              {st.section}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 font-medium">
                            {st.subjectName}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${st.group === 'Group B'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-blue-100 text-blue-800'
                                }`}
                            >
                              {st.group || 'Group A'}
                            </span>
                          </td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a1 || '—'}</td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a2 || '—'}</td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a3 || '—'}</td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a4 || '—'}</td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a5 || '—'}</td>
                          <td className="py-2.5 px-1 text-center font-mono text-[11px] text-slate-600">{st.a6 || '—'}</td>
                          <td className="py-2.5 px-3 text-center font-mono text-[11px] text-slate-700">
                            {st.fdhNumber ? (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-bold">
                                {st.fdhNumber}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Server-Side Pagination Controls */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
                  <div className="text-slate-600 font-medium">
                    Showing{' '}
                    <span className="font-bold text-navy-800">
                      {(pagination.page - 1) * pagination.limit + 1}
                    </span>
                    –
                    <span className="font-bold text-navy-800">
                      {Math.min(pagination.page * pagination.limit, pagination.totalRecords)}
                    </span>{' '}
                    of <span className="font-bold text-navy-800">{pagination.totalRecords}</span> records
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pagination.page <= 1 || loadingDb}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 font-semibold"
                    >
                      <ChevronLeft size={14} className="mr-1" />
                      Prev
                    </button>
                    <span className="text-[11px] font-bold text-navy-800 px-2">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={pagination.page >= pagination.totalPages || loadingDb}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 font-semibold"
                    >
                      Next
                      <ChevronRight size={14} className="ml-1" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Students;
