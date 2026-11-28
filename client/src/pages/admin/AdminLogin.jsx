import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/ThemeToggle';
import { Lock, Mail, AlertCircle, ArrowRight, ShieldCheck, GraduationCap, Eye, EyeOff } from 'lucide-react';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const expiredParam = searchParams.get('expired');
  const isExpired = expiredParam === '1' || expiredParam === 'true';
  const defaultRedirectForRole = (role) => {
    const norm = String(role || '').toLowerCase();
    if (norm === 'faculty') return '/faculty/portal';
    if (norm === 'student') return '/student/seat-finder';
    return '/admin/dashboard';
  };

  const requestedFrom = location.state?.from?.pathname
    ? `${location.state.from.pathname}${location.state.from.search || ''}`
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        const role = String(result.user?.role || '').toLowerCase();
        const fallbackTarget = defaultRedirectForRole(role);
        let finalTarget = fallbackTarget;
        if (requestedFrom) {
          if (role === 'admin') finalTarget = requestedFrom;
          else if (role === 'faculty' && requestedFrom.startsWith('/faculty')) finalTarget = requestedFrom;
          else if (role === 'student' && requestedFrom.startsWith('/student')) finalTarget = requestedFrom;
        }
        navigate(finalTarget, { replace: true });
      } else {
        setError(result.message || 'Invalid email/username or password.');
      }
    } catch (err) {
      if (!err.response) {
        setError('Unable to reach the server. Please verify the backend service is running.');
      } else if (err.response.status === 401) {
        setError(err.response.data?.message || 'Invalid email/username or password. Please verify your credentials.');
      } else if (err.response.status === 503) {
        setError(err.response.data?.message || 'Database service is temporarily unavailable. Please retry shortly.');
      } else {
        setError(err.response.data?.message || 'Sign in failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    setForgotSent(true);
  };

  return (
    <div className="min-h-screen w-full bg-[#F7F7FB] dark:bg-[#10131C] flex flex-col justify-between px-4 py-6 sm:px-6 lg:px-8 font-sans transition-colors">
      <div className="w-full max-w-md mx-auto flex justify-end">
        <ThemeToggle compact />
      </div>

      <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto">
        {/* Institutional Header */}
        <header className="text-center mb-6">
          <div className="flex justify-center">
            <img
              src="/rgmcet-logo.jpg"
              alt="RGMCET Official Crest"
              className="w-16 h-16 object-contain rounded-xl bg-white p-1 border border-[#E5E7EB] dark:border-[#30384A]"
            />
          </div>
          <h1 className="mt-3 text-sm sm:text-base font-bold tracking-tight text-[#172033] dark:text-[#F8FAFC] uppercase">
            RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
          </h1>
          <p className="mt-0.5 text-xs font-bold text-primary tracking-wide uppercase">
            Department of Computer Science and Engineering
          </p>
          <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-1">
            ExamSeat AI — Admin &amp; Faculty Examination Portal
          </p>
        </header>

        {/* Sign In Surface */}
        <main className="es-glass-card py-7 px-5 sm:px-8">
          <div className="border-b border-[#E5E7EB] dark:border-[#30384A] pb-4 mb-5">
            <h2 className="text-base font-bold text-[#172033] dark:text-[#F8FAFC]">Admin &amp; Faculty Sign In</h2>
            <p className="text-xs text-[#64748B] dark:text-[#A1A1AA] mt-0.5">
              Sign in with your authorized Admin or Faculty credentials. Students sign in via Registration Number on the Student Portal.
            </p>
          </div>

          {isExpired && !error && (
            <div role="status" className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-center">
              <AlertCircle size={16} className="mr-2 flex-shrink-0 text-amber-700 dark:text-amber-400" />
              <span>Your previous session has expired. Please sign in again.</span>
            </div>
          )}

          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center font-medium">
              <AlertCircle size={16} className="mr-2 flex-shrink-0 text-red-600 dark:text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {forgotSent && (
            <div role="status" className="mb-4 p-3 bg-[#F8DCEB]/70 dark:bg-[#F472B6]/10 border border-primary/30 rounded-xl text-xs text-[#172033] dark:text-[#F8FAFC] flex items-center">
              <ShieldCheck size={16} className="mr-2 flex-shrink-0 text-primary" />
              <span>Password reset requests are handled by the Examination Cell Controller.</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="staff-email" className="block text-xs font-semibold text-[#172033] dark:text-[#F8FAFC] mb-1.5">
                Institutional Email or Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#64748B] dark:text-[#A1A1AA]">
                  <Mail size={16} aria-hidden="true" />
                </div>
                <input
                  id="staff-email"
                  name="email"
                  type="text"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@rgmcet.edu.in"
                  className="es-input pl-9"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="staff-password" className="block text-xs font-semibold text-[#172033] dark:text-[#F8FAFC]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                >
                  Need help signing in?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#64748B] dark:text-[#A1A1AA]">
                  <Lock size={16} aria-hidden="true" />
                </div>
                <input
                  id="staff-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="es-input pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#64748B] dark:text-[#A1A1AA] hover:text-primary cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="es-btn-primary w-full"
            >
              <span>{loading ? 'Signing in...' : 'Sign In to Exam Portal'}</span>
              {!loading && <ArrowRight size={15} className="ml-2" aria-hidden="true" />}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#E5E7EB] dark:border-[#30384A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-[#64748B] dark:text-[#A1A1AA]">
            <span>Authorized @rgmcet.edu.in accounts only.</span>
            <Link
              to="/student/seat-finder"
              className="inline-flex items-center text-primary hover:underline font-semibold"
            >
              <GraduationCap size={14} className="mr-1.5" aria-hidden="true" />
              Student Seat Finder
            </Link>
          </div>
        </main>
      </div>

      <footer className="mt-8 text-center text-xs text-[#64748B] dark:text-[#A1A1AA]">
        RGMCET (Autonomous) • Department of CSE • ExamSeat AI
      </footer>
    </div>
  );
};

export default AdminLogin;
