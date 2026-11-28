import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import {
  Plus, Users, User, BookOpen, Clock, CheckCircle2, AlertCircle, RefreshCw, X, Save, Warning, ChevronRight
} from 'lucide-react';

const ACADEMIC_YEARS = ['2nd Year', '3rd Year', '4th Year'];
const SEMESTERS = ['Semester 1', 'Semester 2'];
const GROUPS = ['Group A', 'Group B'];
const GROUP_SECTIONS = {
  'Group A': ['A1', 'A2', 'A3'],
  'Group B': ['A4', 'A5', 'A6'],
};
const MAX_STUDENTS = 72;

const MappingCreation = () => {
  // Step state
  const [step, setStep] = useState(1);
  const [banner, setBanner] = useState(null);

  // Master data
  const [faculties, setFaculties] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  // Form state - step 1
  const [form, setForm] = useState({
    academicYear: '',
    semester: '',
    group: '',
    facultyName: '',
    facultyId: '',
    subjectName: '',
    subjectCode: '',
    subjectId: '',
    section: '',
    students: [],
    studentCount: 0,
    sourceFileName: 'Manual Entry',
  });

  // Derived: available sections for selected group
  const availableSections = useMemo(() =>
    form.group ? GROUP_SECTIONS[form.group] : [],
  [form.group]);

  // Load faculties and subjects
  const loadMasterData = useCallback(async () => {
    setLoadingMaster(true);
    try {
      const [fRes, sRes] = await Promise.all([
        api.get('/faculty', { params: { role: 'faculty' } }),
        api.get('/subjects', { params: { all: 'true' } }),
      ]);
      setFaculties(Array.isArray(fRes.data?.data) ? fRes.data.data : []);
      setSubjects(Array.isArray(sRes.data?.data) ? sRes.data.data : []);
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.message || 'Unable to load faculties and subjects.' });
    } finally {
      setLoadingMaster(false);
    }
  }, []);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // Filter subjects by academic year + semester when those change
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      const ayMatch = !form.academicYear || String(s.academicYear).trim() === String(form.academicYear).trim();
      const semMatch = !form.semester || String(s.semester).trim() === String(form.semester).trim();
      return ayMatch && semMatch && s.isActive !== false;
    });
  }, [subjects, form.academicYear, form.semester]);

  // Load students for selected section
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');

  const loadStudents = useCallback(async () => {
    if (!form.subjectCode || !form.section) return;
    setStudentsLoading(true);
    setStudentsError('');
    try {
      const res = await api.get('/mappings/lookup-students', {
        params: {
          subjectCode: form.subjectCode,
          subjectName: form.subjectName,
          section: form.section,
          group: form.group,
        },
      });
      if (res.data?.success) {
        const students = (res.data.students || []).map((s, idx) => ({
          ...s,
          registrationNumber: s.registrationNumber || s.rollNumber || '',
          name: s.name || s.studentName || '',
        }));
        setForm((prev) => ({
          ...prev,
          students,
          studentCount: students.length,
        }));
        if (students.length > MAX_STUDENTS) {
          setBanner({
            type: 'error',
            text: `Section ${form.section} has ${students.length} students, exceeding the 72-student limit. Split into multiple mappings before confirming.`,
          });
        } else if (students.length === 0) {
          setBanner({ type: 'error', text: `No students found for Section ${form.section}. Upload a roster first.` });
        } else {
          setBanner({ type: 'success', text: `Loaded ${students.length} student(s) for Section ${form.section}.` });
        }
      }
    } catch (err) {
      setStudentsError(err.response?.data?.message || 'Failed to load students.');
      setBanner({ type: 'error', text: studentsError });
    } finally {
      setStudentsLoading(false);
    }
  }, [form.subjectCode, form.subjectName, form.section, form.group, studentsError]);

  useEffect(() => {
    if (form.subjectCode && form.section) loadStudents();
  }, [form.subjectCode, form.section, loadStudents]);

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubjectSelect = (sub) => {
    setField('subjectName', sub.subjectName || sub.name || '');
    setField('subjectCode', sub.subjectCode || '');
    setField('subjectId', sub._id || sub.id || '');
    setField('students', []);
    setField('studentCount', 0);
    setField('section', '');
    setBanner(null);
  };

  const handleFacultySelect = (fac) => {
    setField('facultyName', fac.name || fac.facultyName || '');
    setField('facultyId', fac._id || fac.id || '');
  };

  const goNext = () => {
    // Validate current step before advancing
    if (step === 1) {
      if (!form.academicYear || !form.semester || !form.group) {
        setBanner({ type: 'error', text: 'Please select Academic Year, Semester, and Group.' });
        return;
      }
    } else if (step === 2) {
      if (!form.facultyName) {
        setBanner({ type: 'error', text: 'Please select a Faculty member.' });
        return;
      }
      if (!form.subjectName || !form.subjectCode) {
        setBanner({ type: 'error', text: 'Please select a Subject.' });
        return;
      }
    } else if (step === 3) {
      if (!form.section) {
        setBanner({ type: 'error', text: 'Please select a Section.' });
        return;
      }
      if (form.studentCount === 0) {
        setBanner({ type: 'error', text: 'Load students before confirming.' });
        return;
      }
      if (form.studentCount > MAX_STUDENTS) {
        setBanner({ type: 'error', text: 'Student count exceeds 72. Split into multiple mappings.' });
        return;
      }
    }
    setStep(step + 1);
    setBanner(null);
  };

  const goPrev = () => {
    setStep(step - 1);
    setBanner(null);
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (form.studentCount > MAX_STUDENTS || form.studentCount === 0) {
      setBanner({ type: 'error', text: 'Invalid student count. Must be between 1 and 72.' });
      return;
    }
    // Duplicate check within students
    const regSet = new Set();
    let hasDup = false;
    for (const s of form.students) {
      const reg = String(s.registrationNumber || '').trim().toUpperCase();
      if (reg) {
        if (regSet.has(reg)) hasDup = true;
        regSet.add(reg);
      }
    }
    if (hasDup) {
      setBanner({ type: 'error', text: 'Duplicate registration numbers detected in student list. Remove duplicates before confirming.' });
      return;
    }

    setBanner(null);
    try {
      const res = await api.post('/mappings', {
        facultyName: form.facultyName,
        facultyId: form.facultyId,
        subjectName: form.subjectName,
        subjectCode: form.subjectCode,
        subjectId: form.subjectId,
        section: form.section,
        group: form.group,
        academicYear: form.academicYear,
        semester: form.semester,
        students: form.students,
        replaceExisting: true,
        sourceFileName: 'Manual Entry',
      });
      if (res.data?.success) {
        setBanner({ type: 'success', text: `Mapping confirmed: ${form.subjectCode} - Section ${form.section} (${form.studentCount} students).` });
        setStep(1);
        setForm({ academicYear: '', semester: '', group: '', facultyName: '', facultyId: '', subjectName: '', subjectCode: '', subjectId: '', section: '', students: [], studentCount: 0, sourceFileName: 'Manual Entry' });
      } else {
        setBanner({ type: 'error', text: res.data?.message || 'Failed to confirm mapping.' });
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      setBanner({ type: 'error', text: msg });
      if (err.response?.data?.code === 'MAPPING_CAPACITY_EXCEEDED') {
        setBanner({ type: 'error', text: err.response?.data?.message || 'Student count exceeds 72.' });
      }
    }
  };

  const resetForm = () => {
    setStep(1);
    setForm({ academicYear: '', semester: '', group: '', facultyName: '', facultyId: '', subjectName: '', subjectCode: '', subjectId: '', section: '', students: [], studentCount: 0, sourceFileName: 'Manual Entry' });
    setBanner(null);
  };

  const stepLabel = step === 1 ? '1. Year / Semester / Group' : step === 2 ? '2. Faculty / Subject' : '3. Section / Students / Confirm';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-navy-800 flex items-center gap-2">
            <BookOpen className="text-primary" size={22} />
            <span>Create Faculty-Student Mapping</span>
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            One faculty × one subject × one academic year × one semester × one group × one section. Max 72 students.
          </p>
        </div>
        <button
          type="button"
          onClick={resetForm}
          className="px-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw size={14} /> Reset
        </button>
      </div>

      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            banner.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="ml-2 text-slate-500 hover:text-slate-800 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="bg-slate-50 rounded-xl p-3 text-xs font-bold text-slate-600 flex items-center gap-4">
        <span>Step {step} of 3</span>
        <span className="text-slate-400">/</span>
        <span>3</span>
        <span className="ml-auto text-slate-500">{stepLabel}</span>
      </div>

      {/* Step 1: Academic Year, Semester, Group */}
      {step === 1 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-bold text-navy-800 flex items-center gap-2">
            <Clock size={16} /> Academic Year &amp; Semester
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Academic Year *</label>
              <select
                value={form.academicYear}
                onChange={(e) => setField('academicYear', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Academic Year</option>
                {ACADEMIC_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Semester *</label>
              <select
                value={form.semester}
                onChange={(e) => setField('semester', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Semester</option>
                {SEMESTERS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Group *</label>
              <select
                value={form.group}
                onChange={(e) => setField('group', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Group</option>
                {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800 border border-blue-100">
            <strong>Group Sections:</strong> {form.group ? GROUP_SECTIONS[form.group].join(', ') : '—'}.
            Select a group to see which sections are available.
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={goNext} disabled={!form.academicYear || !form.semester || !form.group} className="es-btn-primary px-4 py-2 text-xs">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Faculty & Subject */}
      {step === 2 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-bold text-navy-800 flex items-center gap-2">
            <User size={16} /> Faculty &amp; Subject Selection
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Faculty *</label>
              <select
                value={form.facultyName}
                onChange={(e) => {
                  const fac = faculties.find((f) => (f.name || f.facultyName) === e.target.value);
                  if (fac) handleFacultySelect(fac);
                  else setField('facultyName', e.target.value);
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Faculty</option>
                {faculties.map((f) => (
                  <option key={f._id || f.id} value={f.name || f.facultyName}>
                    {f.name || f.facultyName} ({f.facultyId || '—'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Subject *</label>
              <select
                value={form.subjectName}
                onChange={(e) => {
                  const sub = filteredSubjects.find((s) => s.subjectName === e.target.value);
                  if (sub) handleSubjectSelect(sub);
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Select Subject</option>
                {filteredSubjects.map((s) => (
                  <option key={s._id || s.id} value={s.subjectName}>
                    {s.subjectName} ({s.subjectCode}) - {s.academicYear} {s.semester}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {form.subjectCode && (
            <div className="bg-slate-100 rounded-lg p-3 text-xs text-slate-700">
              <span className="font-bold">Subject Code:</span> {form.subjectCode}
              {form.subjectId && <span className="ml-2 text-[10px] text-slate-500">(subjectId: {form.subjectId})</span>}
            </div>
          )}
          <div className="flex justify-between">
            <button type="button" onClick={goPrev} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer">
              <ChevronRight /> Back
            </button>
            <button type="button" onClick={goNext} disabled={!form.facultyName || !form.subjectName || !form.subjectCode} className="es-btn-primary px-4 py-2 text-xs">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Section, Students, Confirm */}
      {step === 3 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-bold text-navy-800 flex items-center gap-2">
            <Users size={16} /> Section &amp; Student Confirmation
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Section *</label>
              <select
                value={form.section}
                onChange={(e) => setField('section', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                disabled={!form.group}
              >
                <option value="">Select Section</option>
                {availableSections.map((sec) => <option key={sec} value={sec}>{sec}</option>)}
              </select>
              {form.group && <p className="text-[10px] text-slate-500 mt-1">Available for {form.group}: {availableSections.join(', ')}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Student Count</label>
              <input
                type="text"
                readOnly
                value={form.studentCount}
                placeholder="0"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono font-bold"
              />
              {form.studentCount > MAX_STUDENTS && (
                <p className="text-[10px] text-red-700 mt-1">Exceeds 72-student limit!</p>
              )}
              {form.studentCount > 0 && form.studentCount <= MAX_STUDENTS && (
                <p className="text-[10px] text-emerald-700 mt-1">Within limit ({MAX_STUDENTS - form.studentCount} seats remaining)</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">Max Allowed</label>
              <input type="text" readOnly value={MAX_STUDENTS} className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono" />
            </div>
          </div>

          {studentsLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw size={14} className="animate-spin" /> Loading students...
            </div>
          )}
          {studentsError && <div className="text-[10px] text-red-700">{studentsError}</div>}

          <div className="bg-slate-50 rounded-lg p-4 overflow-x-auto border border-slate-100">
            <table className="w-full text-[10px] border-collapse">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase">
                <tr>
                  <th className="px-3 py-2">Registration Number</th>
                  <th className="px-3 py-2">Student Name</th>
                  <th className="px-3 py-2 text-center">Section</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.students.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-slate-400">No students loaded. Select a section above.</td>
                  </tr>
                ) : (
                  form.students.map((s) => (
                    <tr key={s.registrationNumber} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-mono">{s.registrationNumber}</td>
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="px-3 py-2 text-center">{s.section || form.section}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-200">
            <div className="text-xs text-slate-600">
              {form.studentCount > 0 &&
                `Total: {form.studentCount} student(s) for Section {form.section} under {form.facultyName} - {form.subjectName} ({form.subjectCode})`}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={goPrev} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer">
                <ChevronRight /> Back
              </button>
              <form onSubmit={handleConfirm} className="inline">
                <button
                  type="submit"
                  disabled={form.studentCount === 0 || form.studentCount > MAX_STUDENTS || !form.section}
                  className="es-btn-primary px-4 py-2 text-xs"
                >
                  <Save size={14} className="mr-1.5" /> Confirm Mapping
                </button>
              </form>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default MappingCreation;
