import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';

// Route-level code splitting so Student Seat Finder loads independently without Admin/Faculty chunks
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const StudentSeatFinder = lazy(() => import('./pages/student/StudentSeatFinder'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const FacultyAssignments = lazy(() => import('./pages/admin/FacultyAssignments'));
const FacultyManagement = lazy(() => import('./pages/admin/FacultyManagement'));
const SubjectManagement = lazy(() => import('./pages/admin/SubjectManagement'));
const MappingCreation = lazy(() => import('./pages/admin/MappingCreation'));
const Examinations = lazy(() => import('./pages/admin/Examinations'));
const Timetable = lazy(() => import('./pages/admin/Timetable'));
const Students = lazy(() => import('./pages/admin/Students'));
const ClassroomSettings = lazy(() => import('./pages/admin/ClassroomSettings'));
const Allocations = lazy(() => import('./pages/admin/Allocations'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const FacultyPortal = lazy(() => import('./pages/faculty/FacultyPortal'));

const RouteLoader = () => (
  <div className="min-h-[300px] flex items-center justify-center text-xs text-slate-500">
    Loading page module...
  </div>
);

// Protected Route Guard
const ProtectedRoute = ({ children, allowedRoles = ['admin', 'faculty'] }) => {
  const { user, isAuthenticated, authStatus, authError, retryAuth, clearSession } = useAuth();
  const location = useLocation();

  if (authStatus === 'initializing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F7FA] p-6 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <div className="text-xs font-semibold text-navy-800">Authenticating session...</div>
        <Link
          to="/admin/login"
          onClick={() => clearSession()}
          className="text-[11px] font-semibold text-primary underline hover:text-primary-hover"
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  if (authStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-amber-200 shadow-lg p-6 space-y-4 text-center">
          <h2 className="text-base font-bold text-navy-800">Session Verification Failed</h2>
          <p className="text-xs text-slate-600">
            {authError || 'Could not reach the authentication service.'}
          </p>
          <div className="flex items-center justify-center space-x-3 pt-2">
            <button
              type="button"
              onClick={() => retryAuth()}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-primary hover:bg-primary-hover cursor-pointer"
            >
              Retry Connection
            </button>
            <Link
              to="/admin/login"
              onClick={() => clearSession()}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
            >
              Sign In Again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || authStatus === 'unauthenticated') {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  const userRole = String(user?.role || '').toLowerCase();
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    if (userRole === 'faculty') {
      return <Navigate to="/faculty/portal" replace />;
    }
    if (userRole === 'student') {
      return <Navigate to="/student/seat-finder" replace />;
    }
    return <Navigate to="/admin/login" replace />;
  }

  return children;
};

function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={`${location.pathname}${location.search}`} title="Application View Error">
      <Suspense fallback={<RouteLoader />}>
        <Routes>
      {/* Student Portal & Registration Sign-In */}
      <Route path="/student/login" element={<StudentSeatFinder />} />
      <Route path="/student/seat-finder" element={<StudentSeatFinder />} />

      {/* Admin & Faculty Login */}
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* Protected Admin Routes (ADMIN ONLY) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="faculty" element={<FacultyManagement />} />
        <Route path="subjects" element={<SubjectManagement />} />
        <Route path="mapping-creation" element={<MappingCreation />} />
        <Route path="assignments" element={<FacultyAssignments />} />
        <Route path="exams" element={<Examinations />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="students" element={<Students />} />
        <Route path="classrooms" element={<ClassroomSettings />} />
        <Route path="allocations" element={<Allocations />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Protected Faculty Routes (FACULTY & ADMIN) */}
      <Route
        path="/faculty"
        element={
          <ProtectedRoute allowedRoles={['admin', 'faculty']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/faculty/portal" replace />} />
        <Route path="portal" element={<FacultyPortal />} />
      </Route>

      {/* Default Fallback */}
        <Route path="/" element={<Navigate to="/student/seat-finder" replace />} />
        <Route path="*" element={<Navigate to="/student/seat-finder" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
