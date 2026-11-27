import { useState, useEffect, useCallback } from 'react';
import api, { API_TIMEOUTS, formatApiError } from '../../services/api';
import { downloadProtectedReport } from '../../utils/fileDownloader';
import { formatExamTimeRange, formatSessionLabel } from '../../utils/dateTime';
import { resolveExamType } from '../../utils/examType';
import {
  FileText,
  FileSpreadsheet,
  Download,
  Printer,
  Layers,
  Users,
  GraduationCap,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

const Reports = () => {
  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [exam, setExam] = useState(null);
  const [allocation, setAllocation] = useState(null);
  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  // Selected sections for batch report generation
  const [selectedReportSections, setSelectedReportSections] = useState([]);

  // Master filters for global exports
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [availableFaculty, setAvailableFaculty] = useState([]);
  const [selectedExportSubject, setSelectedExportSubject] = useState('');
  const [selectedExportFaculty, setSelectedExportFaculty] = useState('');

  const fetchExams = useCallback(async () => {
    try {
      setLoadingExams(true);
      setFeedback({ type: '', text: '' });
      const res = await api.get('/exams');
      if (res.data.success) {
        const list = res.data.data || [];
        setExams(list);
        if (list.length > 0) {
          setSelectedExamId((prev) => prev || list[0]._id);
        }
      }
    } catch (err) {
      setFeedback({ type: 'error', text: formatApiError(err, 'Failed to load examinations.') });
    } finally {
      setLoadingExams(false);
    }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const res = await api.get('/students/filters');
      if (res.data.success && res.data.filtersAvailable) {
        const subs = res.data.filtersAvailable.subjects || [];
        const facs = res.data.filtersAvailable.faculty || [];
        setAvailableSubjects(subs);
        setAvailableFaculty(facs);
        if (subs.length > 0) setSelectedExportSubject(subs[0]);
        if (facs.length > 0) setSelectedExportFaculty(facs[0]);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchExams();
    fetchFilterOptions();
  }, [fetchExams, fetchFilterOptions]);

  const loadExamDetails = useCallback(async (id) => {
    try {
      setLoadingDetails(true);
      const [eRes, aRes] = await Promise.all([
        api.get(`/exams/${id}`),
        api.get(`/exams/${id}/allocation`).catch(() => ({ data: { success: false } })),
      ]);
      if (eRes.data.success) {
        setExam(eRes.data.data);
        const secs = (eRes.data.data.sectionAllocations || []).map((s) => s.section);
        setSelectedReportSections(secs);
      }
      if (aRes.data?.success) setAllocation(aRes.data.data);
      else setAllocation(null);
    } catch (err) {
      setFeedback({ type: 'error', text: formatApiError(err, 'Failed to load exam allocation details.') });
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      loadExamDetails(selectedExamId);
    }
  }, [selectedExamId, loadExamDetails]);

  const handleSelectAllReportSections = () => {
    const all = (exam?.sectionAllocations || []).map((s) => s.section);
    setSelectedReportSections(all);
  };

  const handleDeselectAllReportSections = () => {
    setSelectedReportSections([]);
  };

  const handleToggleReportSection = (sec) => {
    setSelectedReportSections((prev) =>
      prev.includes(sec) ? prev.filter((s) => s !== sec) : [...prev, sec]
    );
  };

  const handleGenerateSelectedReportPdfs = async () => {
    if (selectedReportSections.length === 0) {
      setFeedback({ type: 'error', text: 'Please select at least one section to generate attendance PDFs.' });
      return;
    }
    if (downloading) return;
    setDownloading('selected-pdfs');
    setFeedback({ type: '', text: '' });
    let downloadedCount = 0;
    try {
      for (const sec of selectedReportSections) {
        const result = await handleExamDownload(`section-attendance-pdf/${sec}`, `Attendance_${sec}`, '', true);
        if (result?.success) downloadedCount++;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (downloadedCount > 0) {
        setFeedback({ type: 'success', text: `Downloaded ${downloadedCount} section attendance PDF(s) cleanly.` });
      }
    } finally {
      setDownloading('');
    }
  };

  // Exam-specific downloads
  const handleExamDownload = async (type, title, queryParams = '', suppressSuccessBanner = false) => {
    if (!selectedExamId) {
      setFeedback({ type: 'error', text: 'Please select an examination first.' });
      return { success: false };
    }
    const downloadKey = `${type}${queryParams ? `?${queryParams}` : ''}`;
    if (!suppressSuccessBanner && downloading === downloadKey) return { success: false };

    if (!suppressSuccessBanner) {
      setDownloading(downloadKey);
      setFeedback({ type: '', text: '' });
    }
    try {
      const endpoint = `/exams/${selectedExamId}/reports/${type}${queryParams ? `?${queryParams}` : ''}`;
      const ext = type.includes('zip') ? 'zip' : type === 'excel' ? 'xlsx' : 'pdf';
      const cleanCode = (exam?.subjectCode || 'Exam').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fallbackName = `${title.replace(/\s+/g, '_')}_${cleanCode}.${ext}`;

      const result = await downloadProtectedReport(endpoint, fallbackName, 'download', {
        timeout: API_TIMEOUTS.REPORT_EXPORT,
        onError: (msg) => setFeedback({ type: 'error', text: msg }),
      });

      if (result.success && !suppressSuccessBanner) {
        setFeedback({ type: 'success', text: `Downloaded "${result.filename || fallbackName}" successfully.` });
      }
      return result;
    } finally {
      if (!suppressSuccessBanner) {
        setDownloading('');
      }
    }
  };

  // Global exports (Master Student Data, Subject-wise, Faculty-wise)
  const handleGlobalDownload = async (endpoint, title) => {
    if (downloading === title) return;
    setDownloading(title);
    setFeedback({ type: '', text: '' });
    try {
      const fallbackName = `${title.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const result = await downloadProtectedReport(endpoint, fallbackName, 'download', {
        timeout: API_TIMEOUTS.REPORT_EXPORT,
        onError: (msg) => setFeedback({ type: 'error', text: msg }),
      });
      if (result.success) {
        setFeedback({ type: 'success', text: `Exported "${result.filename || fallbackName}" cleanly.` });
      }
    } finally {
      setDownloading('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200 gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy-800 tracking-tight">
            Institutional Report & Document Center
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Rajeev Gandhi Memorial College of Engineering and Technology • Department of CSE
          </p>
        </div>

        {/* Selected Examination Dropdown */}
        {exams.length > 0 && (
          <div className="flex items-center space-x-2">
            <label className="text-xs font-bold text-navy-800">Target Exam:</label>
            <select
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white shadow-xs"
            >
              {exams.map((ex) => (
                <option key={ex._id} value={ex._id}>
                  [{resolveExamType(ex)}] {ex.subjectName} ({ex.subjectCode}) • {ex.group || 'Group A'} • {ex.examDate} ({formatSessionLabel(ex.session, ex.startTime)})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {feedback.text && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-3 border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
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
          <div className="flex items-center space-x-2">
            {feedback.type === 'error' && (
              <button
                type="button"
                onClick={() => (selectedExamId ? loadExamDetails(selectedExamId) : fetchExams())}
                className="px-2.5 py-1 rounded bg-white border border-red-300 text-red-700 font-bold hover:bg-red-100 inline-flex items-center cursor-pointer"
              >
                <RefreshCw size={12} className="mr-1" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setFeedback({ type: '', text: '' })}
              className="text-slate-400 hover:text-slate-700 font-bold px-1.5 cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {loadingExams && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center space-x-2">
          <RefreshCw size={14} className="animate-spin text-primary" />
          <span>Loading examinations and report templates...</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* SECTION 1: MASTER INSTITUTIONAL EXCEL EXPORTS (1, 2, 3) */}
      {/* ======================================================== */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Master Student Data & Departmental Roster Exports
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Report 1: Student Master Data Excel */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <FileSpreadsheet size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">1. Student Master Data Excel</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Full institutional spreadsheet with S.No, Roll Number, Student Name, Faculty, Section, Subject, Group (A/B), and A1–A6 marks.
              </p>
            </div>
            <button
              onClick={() => handleGlobalDownload('/reports/master-students-excel', 'Student_Master_Database')}
              disabled={downloading === 'Student_Master_Database'}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs"
            >
              <Download size={14} className="mr-1.5" />
              {downloading === 'Student_Master_Database' ? 'Exporting...' : 'Export Master Excel'}
            </button>
          </div>

          {/* Report 2: Subject-Wise Student List */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-primary flex items-center justify-center">
                <GraduationCap size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">2. Subject-Wise Student List</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Filtered student list by subject including section and group enrollment breakdown.
              </p>
              {availableSubjects.length > 0 && (
                <select
                  value={selectedExportSubject}
                  onChange={(e) => setSelectedExportSubject(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white mt-1"
                >
                  {availableSubjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={() =>
                handleGlobalDownload(
                  `/reports/subject-wise-excel?subject=${encodeURIComponent(selectedExportSubject || 'All')}`,
                  `Subject_${selectedExportSubject || 'All'}_List`
                )
              }
              disabled={downloading.includes('Subject_')}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-primary hover:bg-primary-hover disabled:opacity-50 transition-colors shadow-xs"
            >
              <Download size={14} className="mr-1.5" />
              Download Subject List
            </button>
          </div>

          {/* Report 3: Faculty-Wise Student List */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                <Users size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">3. Faculty-Wise Student List</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Departmental roster categorized by course faculty with student enrollment records.
              </p>
              {availableFaculty.length > 0 && (
                <select
                  value={selectedExportFaculty}
                  onChange={(e) => setSelectedExportFaculty(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded-md bg-white mt-1"
                >
                  {availableFaculty.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={() =>
                handleGlobalDownload(
                  `/reports/faculty-wise-excel?faculty=${encodeURIComponent(selectedExportFaculty || 'All')}`,
                  `Faculty_${selectedExportFaculty || 'All'}_List`
                )
              }
              disabled={downloading.includes('Faculty_')}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors shadow-xs"
            >
              <Download size={14} className="mr-1.5" />
              Download Faculty List
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* SECTION 2: EXAMINATION & SEATING REPORTS (4, 5, 6, 7)    */}
      {/* ======================================================== */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Examination Allocation & Attendance Documents
          </h2>
          {exam && (
            <span className="text-xs font-bold text-navy-800">
              {exam.subjectName} ({exam.subjectCode}) • Hall: {exam.classroomId?.name || 'ET BLOCK'}
            </span>
          )}
        </div>

        {/* Selected Exam Overview Pill */}
        {exam && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-3">
              <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold text-[10px]">
                {resolveExamType(exam)}
              </span>
              <span className="font-bold text-navy-800">{exam.examName}</span>
              <span className="text-slate-400">•</span>
              <span className="font-medium text-slate-600">
                {exam.examDate} ({formatSessionLabel(exam.session, exam.startTime)} • {formatExamTimeRange(exam)})
              </span>
              <span className="text-slate-400">•</span>
              <span className="font-bold text-primary">Classroom: {exam.classroomId?.name || 'ET BLOCK'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold">
                {exam.group || 'Group A'}
              </span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${allocation ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}
              >
                {allocation ? `Allocated (v${allocation.version})` : 'Allocation Pending'}
              </span>
            </div>
          </div>
        )}

        {/* Section 2b: Centralized Faculty & Section Attendance Sheets with Section Selection */}
        {exam?.sectionAllocations && exam.sectionAllocations.length > 0 && (
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-navy-800">
                  Section-Wise Attendance Sheets Selection ({exam.sectionAllocations.length} Sections)
                </h3>
                <p className="text-xs text-slate-500">
                  Select sections to generate dedicated attendance PDFs containing only that section's students & assigned faculty.
                </p>
              </div>

              {/* Quick Select & Batch Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllReportSections}
                  className="px-2 py-1 rounded text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllReportSections}
                  className="px-2 py-1 rounded text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  Deselect All
                </button>
                <button
                  type="button"
                  onClick={handleGenerateSelectedReportPdfs}
                  disabled={downloading === 'selected-pdfs' || selectedReportSections.length === 0}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Download size={13} className="mr-1.5" />
                  {downloading === 'selected-pdfs'
                    ? 'Generating...'
                    : `Generate Selected (${selectedReportSections.length}) PDFs`}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExamDownload(
                      'attendance-zip',
                      `Attendance_Sheets_${exam.subjectCode}`,
                      `sections=${selectedReportSections.join(',')}`
                    )
                  }
                  disabled={downloading === 'attendance-zip' || selectedReportSections.length === 0}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-hover text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Download size={13} className="mr-1.5" />
                  {downloading === 'attendance-zip'
                    ? 'Archiving...'
                    : `Download Selected (ZIP)`}
                </button>
              </div>
            </div>

            {/* Checkbox pills */}
            <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-xs font-bold text-navy-800 mr-1">Active Selection:</span>
              {exam.sectionAllocations.map((alloc) => {
                const isChecked = selectedReportSections.includes(alloc.section);
                return (
                  <label
                    key={alloc.section}
                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-bold border transition-all cursor-pointer select-none ${isChecked
                      ? 'bg-blue-50 border-primary text-primary shadow-2xs'
                      : 'bg-white border-slate-200 text-slate-400 opacity-75 hover:opacity-100'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleReportSection(alloc.section)}
                      className="w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary cursor-pointer"
                    />
                    <span>☑ Section {alloc.section}</span>
                  </label>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {exam.sectionAllocations.map((alloc) => {
                const isChecked = selectedReportSections.includes(alloc.section);
                return (
                  <div
                    key={alloc.section}
                    className={`p-3.5 rounded-lg border flex flex-col justify-between space-y-2 transition-all ${isChecked
                      ? 'bg-slate-50 border-blue-200 shadow-2xs ring-1 ring-blue-100'
                      : 'bg-slate-50/50 border-slate-200 opacity-60'
                      }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="inline-flex items-center space-x-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleReportSection(alloc.section)}
                            className="w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary cursor-pointer"
                          />
                          <span className="font-bold text-xs text-primary bg-blue-100 px-2 py-0.5 rounded">
                            Section {alloc.section}
                          </span>
                        </label>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {alloc.studentCount} Candidates
                        </span>
                      </div>
                      <div className="text-xs font-bold text-navy-800 mt-1">
                        {alloc.facultyName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Classroom: {alloc.classroomName || 'ET BLOCK'}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleExamDownload(
                          `section-attendance-pdf/${alloc.section}`,
                          `Attendance_${alloc.section}`
                        )
                      }
                      disabled={downloading === `section-attendance-pdf/${alloc.section}`}
                      className="w-full inline-flex items-center justify-center py-1.5 px-3 text-xs font-bold rounded-lg text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
                    >
                      <Download size={13} className="mr-1.5" />
                      Download Sec {alloc.section} PDF
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Report 4: Group A Attendance Sheet */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
                <Printer size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">4. Group A Attendance Sheet (PDF)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Official attendance sheet for Group A candidates with S.No, Registration Number, Student Name, Set (A/B/C), and Candidate Signature line.
              </p>
            </div>
            <button
              onClick={() => handleExamDownload('group-attendance-pdf', 'Group_A_Attendance_Sheet', 'group=Group A')}
              disabled={!allocation || loadingDetails || downloading.startsWith('group-attendance-pdf?group=Group A')}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-primary hover:bg-primary-hover disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} className="mr-1.5" />
              {downloading === 'group-attendance-pdf?group=Group A' ? 'Generating PDF...' : 'Download Group A Attendance (PDF)'}
            </button>
          </div>

          {/* Report 5: Group B Attendance Sheet */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                <Printer size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">5. Group B Attendance Sheet (PDF)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Official attendance sheet for Group B candidates with S.No, Registration Number, Student Name, Set (A/B/C), and Candidate Signature line.
              </p>
            </div>
            <button
              onClick={() => handleExamDownload('group-attendance-pdf', 'Group_B_Attendance_Sheet', 'group=Group B')}
              disabled={!allocation || loadingDetails || downloading.startsWith('group-attendance-pdf?group=Group B')}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} className="mr-1.5" />
              {downloading === 'group-attendance-pdf?group=Group B' ? 'Generating PDF...' : 'Download Group B Attendance (PDF)'}
            </button>
          </div>

          {/* Report 6: Classroom Seating Chart */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                <Layers size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">6. Classroom Seating Chart (PDF)</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Landscape top-down visual blueprint of the examination room displaying benches, seats, candidate rolls, and color-coded question paper sets (A/B/C) for door posting.
              </p>
            </div>
            <button
              onClick={() => handleExamDownload('seating-pdf', 'Classroom_Seating_Chart')}
              disabled={!allocation || loadingDetails || downloading === 'seating-pdf'}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} className="mr-1.5" />
              {downloading === 'seating-pdf' ? 'Generating PDF...' : 'Download Seating Chart (PDF)'}
            </button>
          </div>

          {/* Report 7: Examination Allocation PDF */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                <FileText size={18} />
              </div>
              <h3 className="text-sm font-bold text-navy-800">7. Examination Allocation PDF</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Master allocation list displaying Roll Number, Candidate Name, Group, Row, Bench, Seat ID, and question paper set with institutional sign-off block.
              </p>
            </div>
            <button
              onClick={() => handleExamDownload('master-pdf', 'Master_Allocation')}
              disabled={!allocation || loadingDetails || downloading === 'master-pdf'}
              className="w-full inline-flex items-center justify-center py-2 px-3 text-xs font-bold rounded-lg text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              <Download size={14} className="mr-1.5" />
              {downloading === 'master-pdf' ? 'Generating PDF...' : 'Download Master Allocation (PDF)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
