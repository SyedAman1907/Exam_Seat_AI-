import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import {
  Calendar,
  PlusCircle,
  Upload,
  Search,
  Filter,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  X,
} from 'lucide-react';

const Timetable = () => {
  const navigate = useNavigate();
  const [timetables, setTimetables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('upcoming');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    date: '2026-11-07',
    subjectName: 'CNIP',
    subjectCode: 'CS401',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'IV Year',
    semester: 'I Semester',
    section: 'A1',
    session: 'FN',
    notes: '',
  });

  useEffect(() => {
    fetchTimetables();
  }, [activeFilter]);

  const fetchTimetables = async () => {
    try {
      setLoading(true);
      const url = activeFilter === 'all' ? '/timetable' : `/timetable?filter=${activeFilter}`;
      const res = await api.get(url);
      if (res.data.success) {
        setTimetables(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load timetable:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateTimetable = async (e) => {
    e.preventDefault();
    setModalError('');
    setSubmitting(true);

    try {
      const res = await api.post('/timetable', formData);
      if (res.data.success) {
        setShowAddModal(false);
        fetchTimetables();
      }
    } catch (err) {
      setModalError(err.response?.data?.message || 'Failed to save timetable entry.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadTimetable = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      setModalError('Please choose an Excel or CSV file.');
      return;
    }

    setModalError('');
    setUploading(true);

    try {
      const data = new FormData();
      data.append('file', uploadFile);

      const res = await api.post('/timetable/import', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (res.data.success) {
        alert(res.data.message || 'Timetable uploaded successfully!');
        setShowUploadModal(false);
        setUploadFile(null);
        fetchTimetables();
      }
    } catch (err) {
      setModalError(err.response?.data?.message || 'Failed to upload timetable file.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id, name, date) => {
    if (window.confirm(`Are you sure you want to remove "${name}" on ${date} from the timetable?`)) {
      try {
        await api.delete(`/timetable/${id}`);
        fetchTimetables();
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to delete timetable entry.');
      }
    }
  };

  const handleDownloadSample = () => {
    const csvContent =
      'Examination Date,Subject Name,Subject Code,Academic Year,Department,Year,Semester,Section,Session\n' +
      '07/11/2026,CNIP,CS401,2026-2027,Computer Science and Engineering,IV Year,I Semester,A,FN\n' +
      '09/11/2026,DBMS,CS402,2026-2027,Computer Science and Engineering,IV Year,I Semester,A,FN\n' +
      '11/11/2026,Operating Systems,CS403,2026-2027,Computer Science and Engineering,IV Year,I Semester,A,FN\n' +
      '13/11/2026,Computer Networks,CS404,2026-2027,Computer Science and Engineering,IV Year,I Semester,A,FN\n' +
      '07/11/2026,Cloud Computing,CS405,2026-2027,Computer Science and Engineering,IV Year,I Semester,B,FN\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'examination-timetable-template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTimetables = timetables.filter(
    (t) =>
      t.subjectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.subjectCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.date.includes(searchTerm) ||
      (t.displayDate && t.displayDate.includes(searchTerm)) ||
      t.section.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2">
            <Calendar className="text-primary" size={24} />
            <h1 className="text-xl font-bold text-navy-800">Examination Timetable Management</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Configure examination schedules for automatic date-based subject detection during exam seating creation
          </p>
        </div>

        <div className="mt-4 sm:mt-0 flex flex-wrap gap-2">
          <button
            onClick={handleDownloadSample}
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs"
          >
            <FileSpreadsheet size={15} className="mr-1.5 text-emerald-600" />
            Download Sample CSV
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 shadow-xs"
          >
            <Upload size={15} className="mr-1.5 text-primary" />
            Upload Timetable (Excel/CSV)
          </button>
          <button
            onClick={() => {
              setModalError('');
              setShowAddModal(true);
            }}
            className="inline-flex items-center px-3.5 py-2 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary-hover shadow-xs"
          >
            <PlusCircle size={15} className="mr-1.5" />
            Add Schedule Entry
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-600 uppercase">Total Scheduled Exams</div>
          <div className="text-2xl font-bold text-navy-800 mt-1">{timetables.length}</div>
          <div className="text-[11px] text-slate-600 mt-0.5">Across all departments</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-600 uppercase">Upcoming Exams</div>
          <div className="text-2xl font-bold text-primary mt-1">
            {timetables.filter((t) => t.status === 'scheduled').length}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">Ready for auto-detection</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-600 uppercase">Subjects Configured</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">
            {new Set(timetables.map((t) => t.subjectCode)).size}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">CNIP, DBMS, OS, Networks...</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-600 uppercase">Active Sections</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">
            {new Set(timetables.map((t) => t.section)).size}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">Sections A, B, etc.</div>
        </div>
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1 bg-slate-200/70 p-1 rounded-lg self-start">
          <button
            onClick={() => setActiveFilter('upcoming')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeFilter === 'upcoming'
                ? 'bg-white text-navy-800 shadow-xs'
                : 'text-slate-600 hover:text-navy-800'
            }`}
          >
            Upcoming Examinations
          </button>
          <button
            onClick={() => setActiveFilter('today')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeFilter === 'today'
                ? 'bg-white text-navy-800 shadow-xs'
                : 'text-slate-600 hover:text-navy-800'
            }`}
          >
            Today's Examinations
          </button>
          <button
            onClick={() => setActiveFilter('completed')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeFilter === 'completed'
                ? 'bg-white text-navy-800 shadow-xs'
                : 'text-slate-600 hover:text-navy-800'
            }`}
          >
            Completed / History
          </button>
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              activeFilter === 'all'
                ? 'bg-white text-navy-800 shadow-xs'
                : 'text-slate-600 hover:text-navy-800'
            }`}
          >
            All Scheduled
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 text-slate-500" size={16} aria-hidden="true" />
          <input
            type="text"
            aria-label="Search timetable entries"
            placeholder="Search by date, subject, code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
          />
        </div>
      </div>

      {/* Timetable Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-600">Loading timetable entries...</div>
        ) : filteredTimetables.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Calendar className="mx-auto text-slate-400" size={36} aria-hidden="true" />
            <div className="text-sm font-semibold text-navy-800">No timetable entries found</div>
            <p className="text-xs text-slate-600">
              {activeFilter === 'upcoming'
                ? 'No upcoming examinations scheduled. Click "Add Schedule Entry" or upload an Excel timetable.'
                : 'Try switching filters or adjusting your search term.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Exam Date</th>
                  <th className="py-3 px-4">Subject &amp; Code</th>
                  <th className="py-3 px-4">Cohort (Dept / Year / Sem)</th>
                  <th className="py-3 px-4">Section</th>
                  <th className="py-3 px-4">Session</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTimetables.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-bold text-navy-800 text-sm">{item.displayDate || item.date}</div>
                      <div className="text-[11px] text-slate-600 font-mono">{item.date}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-navy-800 text-xs">{item.subjectName}</div>
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-primary border border-blue-200">
                        {item.subjectCode}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <div>{item.department}</div>
                      <div className="text-[11px] text-slate-600">
                        {item.year} • {item.semester} • AY {item.academicYear}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="px-2 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-navy-800 border border-slate-200">
                        Sec {item.section}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.session === 'FN'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-purple-100 text-purple-800 border border-purple-200'
                        }`}
                      >
                        {item.session === 'FN' ? 'Forenoon (FN)' : 'Afternoon (AN)'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          item.status === 'scheduled'
                            ? 'bg-emerald-100 text-emerald-800'
                            : item.status === 'active'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <CheckCircle2 size={10} className="mr-1" aria-hidden="true" />
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() =>
                          navigate(
                            `/admin/exams?new=true&date=${item.date}&section=${item.section}&session=${item.session}`
                          )
                        }
                        title="Create Exam Seating Allocation"
                        className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-white hover:bg-primary-hover transition-colors shadow-xs"
                      >
                        Create Exam <ArrowRight size={11} className="ml-1" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item._id, item.subjectName, item.displayDate || item.date)}
                        aria-label={`Delete timetable entry for ${item.subjectName}`}
                        title="Delete from Timetable"
                        className="p-1 rounded text-slate-500 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Timetable Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add Examination to Timetable">
          <div className="fixed inset-0 bg-navy-900/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-navy-800">Add Examination to Timetable</h3>
                <p className="text-xs text-slate-600">Configure subject for automatic date-based detection</p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-500 hover:text-navy-800"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center">
                <AlertCircle size={16} className="mr-2 flex-shrink-0 text-red-600" />
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreateTimetable} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Exam Date</label>
                  <input
                    type="date"
                    required
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Session</label>
                  <select
                    name="session"
                    value={formData.session}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white"
                  >
                    <option value="FN">FN (Forenoon)</option>
                    <option value="AN">AN (Afternoon)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Subject Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CNIP, DBMS, Operating Systems"
                    name="subjectName"
                    value={formData.subjectName}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Subject Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CS401, CS402"
                    name="subjectCode"
                    value={formData.subjectCode}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary uppercase font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Section</label>
                  <select
                    name="section"
                    required
                    value={formData.section}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary uppercase font-bold"
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
                  <label className="block text-xs font-semibold text-navy-800">Year</label>
                  <input
                    type="text"
                    required
                    name="year"
                    value={formData.year}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy-800">Semester</label>
                  <input
                    type="text"
                    required
                    name="semester"
                    value={formData.semester}
                    onChange={handleInputChange}
                    className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-navy-800">Department</label>
                <input
                  type="text"
                  required
                  name="department"
                  value={formData.department}
                  onChange={handleInputChange}
                  className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary-hover rounded-lg shadow-xs disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Add to Timetable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Timetable Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-navy-900/40 backdrop-blur-sm" onClick={() => setShowUploadModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-navy-800">Upload Examination Timetable</h3>
                <p className="text-xs text-slate-500">Upload an Excel (.xlsx) or CSV file with schedule dates</p>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="p-1 text-slate-400 hover:text-navy-800">
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center">
                <AlertCircle size={16} className="mr-2 flex-shrink-0 text-red-600" />
                {modalError}
              </div>
            )}

            <form onSubmit={handleUploadTimetable} className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-primary transition-colors">
                <FileSpreadsheet className="mx-auto text-primary mb-2" size={32} />
                <label className="cursor-pointer">
                  <span className="text-xs font-bold text-primary hover:underline">Choose File to Upload</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => setUploadFile(e.target.files[0])}
                  />
                </label>
                <div className="text-[11px] text-slate-500 mt-1">Supports .xlsx, .xls, .csv</div>
                {uploadFile && (
                  <div className="mt-3 p-2 bg-blue-50 text-primary font-semibold text-xs rounded-lg border border-blue-200 flex items-center justify-center">
                    <CheckCircle2 size={14} className="mr-1.5" />
                    {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="px-4 py-2 text-xs font-semibold text-white bg-primary hover:bg-primary-hover rounded-lg shadow-xs disabled:opacity-50"
                >
                  {uploading ? 'Processing File...' : 'Upload & Save Timetable'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Timetable;