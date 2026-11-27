import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  UserCog,
  Plus,
  Search,
  Edit3,
  Trash2,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

const FacultyManagement = () => {
  const [faculties, setFaculties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('faculty');
  const [banner, setBanner] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    facultyId: '',
    password: '',
    role: 'faculty',
    department: 'Computer Science and Engineering',
    designation: 'Assistant Professor',
  });

  const loadFaculties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/faculty', {
        params: { role: roleFilter, search: search.trim() || undefined },
      });
      setFaculties(res.data?.data || []);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Unable to load faculty records.',
      });
    } finally {
      setLoading(false);
    }
  }, [roleFilter, search]);

  useEffect(() => {
    loadFaculties();
  }, [loadFaculties]);

  const openCreateModal = () => {
    setEditing(null);
    setForm({
      name: '',
      email: '',
      facultyId: '',
      password: '',
      role: 'faculty',
      department: 'Computer Science and Engineering',
      designation: 'Assistant Professor',
    });
    setModalOpen(true);
  };

  const openEditModal = (fac) => {
    setEditing(fac);
    setForm({
      name: fac.name || '',
      email: fac.email || '',
      facultyId: fac.facultyId || '',
      password: '',
      role: fac.role === 'admin' ? 'admin' : 'faculty',
      department: fac.department || 'Computer Science and Engineering',
      designation: fac.designation || 'Faculty',
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        facultyId: form.facultyId.trim().toUpperCase(),
        role: form.role,
        department: form.department.trim(),
        designation: form.designation.trim(),
      };
      if (form.password.trim()) {
        payload.password = form.password.trim();
      }
      if (editing) {
        await api.put(`/faculty/${editing._id}`, payload);
        setBanner({ type: 'success', text: `Updated ${payload.name} successfully.` });
      } else {
        await api.post('/faculty', payload);
        setBanner({ type: 'success', text: `Created faculty account for ${payload.name}.` });
      }
      setModalOpen(false);
      await loadFaculties();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Failed to save faculty account.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (fac) => {
    if (!window.confirm(`Delete faculty account for "${fac.name}" (${fac.email})?`)) return;
    try {
      await api.delete(`/faculty/${fac._id}`);
      setBanner({ type: 'success', text: `Removed "${fac.name}".` });
      await loadFaculties();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.message || 'Unable to delete faculty record.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-navy-800 flex items-center gap-2">
            <UserCog className="text-primary" size={22} />
            <span>Faculty Management</span>
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Admin-only management of Faculty IDs, institutional logins, departments, and designations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadFaculties}
            className="px-3 py-2 text-xs font-semibold border border-slate-300 bg-white text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="es-btn-primary px-4 py-2 text-xs"
          >
            <Plus size={15} className="mr-1.5" />
            <span>Add Faculty</span>
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

      {/* Search & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Faculty Name, ID, or Email..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="roleFilter" className="text-xs font-semibold text-slate-600">Role:</label>
          <select
            id="roleFilter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-navy-800"
          >
            <option value="faculty">Faculty Only</option>
            <option value="ALL">Admin &amp; Faculty</option>
            <option value="admin">Admins Only</option>
          </select>
        </div>
      </div>

      {/* Faculty Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Faculty ID</th>
                <th className="px-4 py-3">Name &amp; Designation</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Loading faculty directory...
                  </td>
                </tr>
              ) : faculties.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No faculty members found. Click "Add Faculty" or upload a mapping workbook to create faculty accounts.
                  </td>
                </tr>
              ) : (
                faculties.map((f) => (
                  <tr key={f._id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-bold text-primary">
                      {f.facultyId || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-navy-800">{f.name}</div>
                      <div className="text-[11px] text-slate-500">{f.designation || 'Faculty'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{f.email}</td>
                    <td className="px-4 py-3 text-slate-600">{f.department || 'CSE'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                          f.role === 'admin'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {f.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(f)}
                        className="inline-flex items-center px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Edit3 size={12} className="mr-1" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(f)}
                        className="inline-flex items-center px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 size={12} className="mr-1" /> Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <h2 className="text-sm font-bold text-navy-800">
                {editing ? 'Update Faculty Account' : 'Add Faculty Member'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Dr. Rajesh Kumar"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Faculty ID</label>
                  <input
                    type="text"
                    value={form.facultyId}
                    onChange={(e) => setForm((p) => ({ ...p, facultyId: e.target.value }))}
                    placeholder="FAC101"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-navy-800 mb-1">Institutional Email *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="rajesh@rgmcet.edu.in"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Department</label>
                  <input
                    type="text"
                    value={form.department}
                    onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Designation</label>
                  <input
                    type="text"
                    value={form.designation}
                    onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">Role</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="faculty">Faculty</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-navy-800 mb-1">
                    {editing ? 'New Password (optional)' : 'Initial Password'}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder={editing ? 'Leave blank to keep' : 'Default: Faculty@2026'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
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
                  {submitting ? 'Saving...' : editing ? 'Update Faculty' : 'Create Faculty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyManagement;
