import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import ThemeToggle from '../components/ThemeToggle';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Grid3X3,
  Shuffle,
  FileSpreadsheet,
  Settings,
  LogOut,
  Menu,
  X,
  ExternalLink,
  GraduationCap,
  Layers,
  Clock,
  UserCheck,
  BookOpen,
  UserCog,
} from 'lucide-react';

const ADMIN_NAV_GROUPS = [
  {
    label: 'Examination Control',
    items: [
      { name: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
      { name: 'Examination Requests & Scheduling', path: '/admin/exams', icon: Calendar },
      { name: 'Faculty Exam Scheduling', path: '/faculty/portal', icon: Layers },
      { name: 'Seating Allocations', path: '/admin/allocations', icon: Shuffle },
    ],
  },
  {
    label: 'Academic Master & Mappings',
    items: [
      { name: 'Faculty Management', path: '/admin/faculty', icon: UserCog },
      { name: 'Subject Management', path: '/admin/subjects', icon: BookOpen },
      { name: 'Permanent Student Mapping', path: '/admin/assignments', icon: UserCheck },
      { name: 'Student Management', path: '/admin/students', icon: Users },
    ],
  },
  {
    label: 'Infrastructure & Reports',
    items: [
      { name: 'Classroom Management', path: '/admin/classrooms', icon: Grid3X3 },
      { name: 'Examination Timetable', path: '/admin/timetable', icon: Clock },
      { name: 'Attendance & Exam Reports', path: '/admin/reports', icon: FileSpreadsheet },
      { name: 'System Settings', path: '/admin/settings', icon: Settings },
    ],
  },
];

const FACULTY_NAV_GROUPS = [
  {
    label: 'Faculty Examination Workspace',
    items: [
      { name: 'My Subjects & Exam Scheduling', path: '/faculty/portal', icon: Layers },
    ],
  },
];

const AdminLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const isAdmin = user?.role === 'admin';
  const navGroups = isAdmin ? ADMIN_NAV_GROUPS : FACULTY_NAV_GROUPS;
  const homePath = isAdmin ? '/admin/dashboard' : '/faculty/portal';

  const renderNavGroups = (onItemClick) => (
    <nav aria-label="Portal Navigation" className="space-y-5">
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {group.label}
          </div>
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onItemClick}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-slate-700 hover:text-navy-800 hover:bg-slate-100'
                  }`
                }
              >
                <Icon size={16} className="mr-2.5 flex-shrink-0" aria-hidden="true" />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F7F7FB] dark:bg-[#10131C] flex flex-col font-sans overflow-x-hidden">
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:text-xs focus:font-bold"
      >
        Skip to main content
      </a>

      {/* Top Academic Header */}
      <header className="w-full bg-white/90 dark:bg-[#1B2030]/90 backdrop-blur-md border-b border-slate-200 dark:border-[#30384A] sticky top-0 z-40 shadow-2xs">
        <div className="px-3 sm:px-6 lg:px-8 py-2.5 min-h-[4.5rem] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-navy-800 hover:bg-slate-100 flex-shrink-0 cursor-pointer"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <Link to={homePath} className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img
                src="/rgmcet-logo.jpg"
                alt="RGMCET Official Crest"
                className="w-9 h-9 sm:w-11 sm:h-11 object-contain flex-shrink-0"
              />
              <div className="flex flex-col text-left min-w-0">
                <span className="font-bold text-navy-800 tracking-tight text-xs sm:text-sm leading-snug break-words">
                  RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
                </span>
                <span className="text-[11px] font-semibold text-primary tracking-wide uppercase mt-0.5 break-words">
                  Department of Computer Science &amp; Engineering • ExamSeat AI
                </span>
              </div>
            </Link>
          </div>

          {/* Right Utility & Profile */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <ThemeToggle className="h-9 px-2.5 sm:px-3" />
            <Link
              to="/student/seat-finder"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center text-xs font-semibold text-slate-700 hover:text-primary px-3 py-1.5 rounded-lg border border-slate-300 hover:border-primary/50 bg-slate-50 transition-colors"
            >
              <GraduationCap size={15} className="mr-1.5 text-primary" aria-hidden="true" />
              <span>Student Portal</span>
              <ExternalLink size={12} className="ml-1.5 opacity-75" aria-hidden="true" />
            </Link>

            <div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-navy-800">{user?.name || (isAdmin ? 'Administrator' : 'Faculty Member')}</div>
                <div className="text-[11px] font-medium text-slate-600 uppercase tracking-wide">
                  {isAdmin ? 'Admin' : 'Faculty'}
                </div>
              </div>
              <div
                aria-hidden="true"
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xs"
              >
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'EX'}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Sign out"
                title="Sign out"
                className="p-2 rounded-lg text-slate-600 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex min-w-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col bg-white border-r border-slate-200 p-4 justify-between">
          <div className="space-y-5">
            <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[11px] uppercase font-bold text-slate-500 tracking-wider">Campus Block</div>
              <div className="text-xs font-bold text-navy-800 mt-0.5">
                RGMCET (Autonomous)
              </div>
              <div className="text-xs text-slate-600 mt-0.5">Nandyal, Andhra Pradesh</div>
            </div>

            {renderNavGroups(undefined)}
          </div>

          <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 text-center">
            ExamSeat AI • Dept. of CSE
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Mobile Navigation">
            <div
              className="fixed inset-0 bg-navy-900/45"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-72 max-w-[85%] bg-white flex flex-col p-4 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                <div className="flex items-center space-x-2">
                  <img src="/rgmcet-logo.jpg" alt="RGMCET Crest" className="w-8 h-8 object-contain" />
                  <span className="font-bold text-navy-800 text-xs">RGMCET Exam Portal</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {renderNavGroups(() => setMobileMenuOpen(false))}
              </div>

              <div className="pt-4 border-t border-slate-200 space-y-2">
                <Link
                  to="/student/seat-finder"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center w-full px-3 py-2 text-xs font-semibold text-primary rounded-lg bg-blue-50 hover:bg-blue-100"
                >
                  <GraduationCap size={16} className="mr-2.5" />
                  Student Seat Finder
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center w-full px-3 py-2 text-xs font-semibold text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  <LogOut size={16} className="mr-2.5" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          <main id="admin-main-content" className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
            <ErrorBoundary resetKey={`${location.pathname}${location.search}`} title="Module Rendering Error">
              <Outlet />
            </ErrorBoundary>
          </main>

          <footer className="bg-white border-t border-slate-200 py-3.5 px-4 sm:px-8 text-center text-xs text-slate-600">
            <div className="font-bold text-navy-800 text-xs">
              RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
            </div>
            <div className="text-primary font-semibold text-[11px] mt-0.5">
              Department of Computer Science and Engineering • ExamSeat AI
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default AdminLayout;
