import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldCheck, Building, Key, CheckCircle2 } from 'lucide-react';

const Settings = () => {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState({
    institutionName: 'Rajeev Gandhi Memorial College of Engineering and Technology',
    institutionSubtitle: 'Autonomous Institution | Approved by AICTE, Accredited by NBA & NAAC',
    city: 'Nandyal, Andhra Pradesh',
    defaultRegPattern: '^[0-9]{5}[A-Z0-9]{5}$',
    enforceAdjacency: true,
    setsConfig: 'A, B, C (3-Way Randomized Alternation)',
  });

  const handleSave = (e) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-navy-800 tracking-tight">System & Institutional Settings</h1>
        <p className="text-xs text-slate-500 mt-1">
          Configure institutional header details, registration formats, and question paper constraints
        </p>
      </div>

      {saved && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center">
          <CheckCircle2 size={16} className="mr-2 text-emerald-600 flex-shrink-0" />
          Settings saved successfully!
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Institution Info */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-navy-800 border-b border-slate-100 pb-2">
            <Building size={16} className="text-primary" />
            <span>Institution Header Parameters</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-navy-800">Institution Name</label>
              <input
                type="text"
                value={settings.institutionName}
                onChange={(e) => setSettings({ ...settings, institutionName: e.target.value })}
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-navy-800">Affiliation & Accreditation Line</label>
              <input
                type="text"
                value={settings.institutionSubtitle}
                onChange={(e) => setSettings({ ...settings, institutionSubtitle: e.target.value })}
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-800">Location</label>
              <input
                type="text"
                value={settings.city}
                onChange={(e) => setSettings({ ...settings, city: e.target.value })}
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        {/* Algorithm Constraints */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 text-sm font-bold text-navy-800 border-b border-slate-100 pb-2">
            <ShieldCheck size={16} className="text-primary" />
            <span>Allocation Engine & Validation Rules</span>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-navy-800">
                Default Student Registration Number Regex Pattern
              </label>
              <input
                type="text"
                value={settings.defaultRegPattern}
                onChange={(e) => setSettings({ ...settings, defaultRegPattern: e.target.value })}
                className="mt-1 block w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-[11px] text-slate-600 mt-1 block">
                Matches 10-character college roll numbers e.g. 24091A0501. Can be customized per exam.
              </span>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="enforceAdjacency"
                checked={settings.enforceAdjacency}
                onChange={(e) => setSettings({ ...settings, enforceAdjacency: e.target.checked })}
                className="rounded border-slate-300 text-primary focus:ring-primary"
              />
              <label htmlFor="enforceAdjacency" className="font-semibold text-navy-800 cursor-pointer">
                Strictly enforce same-bench question paper set adjacency rule (zero adjacent duplicate sets)
              </label>
            </div>
          </div>
        </div>

        {/* Current User Session Profile */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center space-x-2 text-sm font-bold text-navy-800 border-b border-slate-100 pb-2">
            <Key size={16} className="text-primary" />
            <span>Active Administrator Session</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-slate-500 text-[11px]">User Name</div>
              <div className="font-semibold text-navy-800 mt-0.5">{user?.name}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">Email Address</div>
              <div className="font-semibold text-navy-800 mt-0.5">{user?.email}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[11px]">Role</div>
              <div className="font-semibold text-navy-800 mt-0.5 uppercase">{user?.role}</div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold rounded-lg text-white bg-primary hover:bg-primary-hover shadow-sm transition-colors"
        >
          Save Settings
        </button>
      </form>
    </div>
  );
};

export default Settings;
