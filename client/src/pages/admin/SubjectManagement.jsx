import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  BookOpen,
  Plus,
  Edit3,
  Trash2,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

const ACADEMIC_YEARS = ['2026-2027', '2027-2028', '2028-2029'];
const YEARS = ['II Year', 'III Year', 'IV Year'];
const SEMESTERS = ['Semester 1', 'Semester 2'];

const SubjectManagement = () => {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAcadYear, setFilterAcadYear] = useState('ALL');
  const [filterSemester, setFilterSemester] = useState('ALL');
  const [banner, setBanner] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    subjectName: '',
    subjectCode: '',
    abbreviation: '',
    department: 'Computer Science and Engineering',
    academicYear: '2026-2027',
    year: 'III Year',
    semester: 'I Semester',
    group: 'ALL',
    sections: '',
  });

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/subjects', {
        params: {
          academicYear: filterAcadYear !== 'ALL' ? filterAcadYear : undefined,
          semester: filterSemester !== 'ALL' ? filterSemester : undefined,
        },
      });
      setSubjects(res.data?.data || []);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Unable to load subject master list.',
      });
    } finally {
      setLoading(false);
    }
  }, [filterAcadYear, filterSemester]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  const openCreateModal = () => {
    setEditing(null);
    setForm({
      subjectName: '',
      subjectCode: '',
      abbreviation: '',
      department: 'Computer Science and Engineering',
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      group: '',
      sections: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (sub) => {
    setEditing(sub);
    setForm({
      subjectName: sub.subjectName || '',
      subjectCode: sub.subjectCode || '',
      abbreviation: sub.abbreviation || '',
      department: sub.department || 'Computer Science and Engineering',
      academicYear: sub.academicYear || '2026-2027',
      year: sub.year || 'III Year',
      semester: sub.semester || 'I Semester',
      group: sub.group || '',
      sections: Array.isArray(sub.sections) ? sub.sections.join(', ') : '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        ...form,
        subjectCode: form.subjectCode.trim().toUpperCase(),
        abbreviation: form.abbreviation.trim().toUpperCase(),
      };
      if (editing && !String(editing._id || '').startsWith('mapped-')) {
        await api.put(`/subjects/${editing._id}`, payload);
        setBanner({ type: 'success', text: `Updated subject ${payload.subjectCode} (${payload.academicYear} - ${payload.semester}).` });
      } else {
        await api.post('/subjects', payload);
        setBanner({ type: 'success', text: `Created subject ${payload.subjectCode} (${payload.academicYear} - ${payload.semester}).` });
      }
      setModalOpen(false);
      await loadSubjects();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Failed to save subject.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (sub) => {
    if (String(sub._id || '').startsWith('mapped-')) {
      setBanner({ type: 'error', text: 'Derived mapping subject cannot be deactivated from here. Save as a master subject first or update mappings.' });
      return;
    }
    if (!window.confirm(`Deactivate subject "${sub.subjectName}" (${sub.subjectCode})?`)) return;
    try {
      await api.delete(`/subjects/${sub._id}`);
      setBanner({ type: 'success', text: `Deactivated ${sub.subjectCode}.` });
      await loadSubjects();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Failed to deactivate subject.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-navy-800 flex items-center gap-2">
            <BookOpen className="text-primary" size={22} />
            <span>Subject Management</span>
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Manage curriculum subjects keyed uniquely by Subject Code + Academic Year + Semester.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSubjects}
            className="px-3 py-2 text-xs font-semibold border border-slate-300 bg-white text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button type="button" onClick={openCreateModal} className="es-btn-primary px-4 py-2 text-xs">
            <Plus size={15} className="mr-1.5" />
            <span>Add Subject</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            banner.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'error' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="text-slate-500 hover:text-slate-800 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div>
          <label className="text-xs font-semibold text-slate-600 mr-2">Academic Year:</label>
          <select
            value={filterAcadYear}
            onChange={(e) => setFilterAcadYear(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="ALL">All Academic Years</option>
            {ACADEMIC_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-600 mr-2">Semester:</label>
          <select
            value={filterSemester}
            onChange={(e) => setFilterSemester(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="ALL">All Semesters</option>
            {SEMESTERS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Subject Code</th>
                <th className="px-4 py-3">Subject Name</th>
                <th className="px-4 py-3">Academic Year &amp; Sem</th>
                <th className="px-4 py-3">Year / Group</th>
                <th className="px-4 py-3">Sections</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Loading subjects...
                  </td>
                </tr>
              ) : subjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No subjects found in database. Upload Permanent Mappings or click "Add Subject".
                  </td>
                </tr>
              ) : (
                subjects.map((sub) => (
                  <tr key={sub._id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-primary">
                      {sub.subjectCode}
                      {sub.abbreviation ? <span className="ml-1.5 text-[10px] text-slate-500">({sub.abbreviation})</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-navy-800">{sub.subjectName}</div>
                      <div className="text-[11px] text-slate-500">{sub.department}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>{sub.academicYear || '2026-2027'}</div>
                      <div className="text-[11px] text-slate-500">{sub.semester || 'I Semester'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {sub.year || 'III Year'} {sub.group ? `• ${sub.group}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {Array.isArray(sub.sections) && sub.sections.length > 0 ? sub.sections.join(', ') : 'All mapped'}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(sub)}
                        className="inline-flex items-center px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Edit3 size={12} className="mr-1" /> Edit
                      </button>
                      {!String(sub._id || '').startsWith('mapped-') && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(sub)}
                          className="inline-flex items-center px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 size={12} className="mr-1" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h2 className="text-sm font-bold text-navy-800">
                {editing && !String(editing._id || '').startsWith('mapped-') ? 'Update Subject' : 'Add Subject'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Subject Code *</label>
                  <input
                    type="text"
                    required
                    value={form.subjectCode}
                    onChange={(e) => setForm((p) => ({ ...p, subjectCode: e.target.value }))}
                    placeholder="20A05501T"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-navy-800 mb-1">Subject Name *</label>
                  <input
                    type="text"
                    required
                    value={form.subjectName}
                    onChange={(e) => setForm((p) => ({ ...p, subjectName: e.target.value }))}
                    placeholder="Compiler Design"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Academic Year</label>
                  <select
                    value={form.academicYear}
                    onChange={(e) => setForm((p) => ({ ...p, academicYear: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {ACADEMIC_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Year</label>
                  <select
                    value={form.year}
                    onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Semester</label>
                  <select
                    value={form.semester}
                    onChange={(e) => setForm((p) => ({ ...p, semester: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {SEMESTERS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Short Code / Abbr</label>
                  <input
                    type="text"
                    value={form.abbreviation}
                    onChange={(e) => setForm((p) => ({ ...p, abbreviation: e.target.value }))}
                    placeholder="ATCD"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Group</label>
                  <input
                    type="text"
                    value={form.group}
                    onChange={(e) => setForm((p) => ({ ...p, group: e.target.value }))}
                    placeholder="Group A / ALL"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Sections</label>
                  <input
                    type="text"
                    value={form.sections}
                    onChange={(e) => setForm((p) => ({ ...p, sections: e.target.value }))}
                    placeholder="A1, A2, A3"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg uppercase"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="es-btn-primary px-4 py-2">
                  {submitting ? 'Saving...' : 'Save Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubjectManagement;
