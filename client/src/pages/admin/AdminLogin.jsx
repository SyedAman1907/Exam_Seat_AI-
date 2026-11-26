import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
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
  const isExpired = searchParams.get('expired') === '1';
  const redirectTarget = location.state?.from?.pathname
    ? `${location.state.from.pathname}${location.state.from.search || ''}`
    : '/admin/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const result = await login(email.trim(), password);
      if (result.success) {
        navigate(redirectTarget, { replace: true });
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
    <div className="min-h-screen w-full bg-[#F5F7FA] flex flex-col justify-between px-4 py-8 sm:px-6 lg:px-8 font-sans">
      <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto">
        {/* Institutional Header */}
        <header className="text-center mb-6">
          <div className="flex justify-center">
            <img
              src="/rgmcet-logo.jpg"
              alt="RGMCET Official Crest"
              className="w-16 h-16 object-contain"
            />
          </div>
          <h1 className="mt-3 text-sm sm:text-base font-bold tracking-tight text-navy-800 uppercase">
            RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING AND TECHNOLOGY
          </h1>
          <p className="mt-0.5 text-xs font-bold text-primary tracking-wide uppercase">
            Department of Computer Science and Engineering
          </p>
          <p className="text-xs text-slate-600 mt-1">
            ExamSeat AI — Faculty &amp; Examination Cell Control Portal
          </p>
        </header>

        {/* Sign In Surface */}
        <main className="bg-white py-7 px-5 sm:px-8 border border-slate-200 rounded-xl shadow-xs">
          <div className="border-b border-slate-200 pb-4 mb-5">
            <h2 className="text-base font-bold text-navy-800">Staff &amp; Admin Sign In</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Sign in with your authorized institutional account to manage schedules, rosters, and seating.
            </p>
          </div>

          {isExpired && !error && (
            <div role="status" className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-center">
              <AlertCircle size={16} className="mr-2 flex-shrink-0 text-amber-700" />
              <span>Your previous session has expired. Please sign in again.</span>
            </div>
          )}

          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center font-medium">
              <AlertCircle size={16} className="mr-2 flex-shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {forgotSent && (
            <div role="status" className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center">
              <ShieldCheck size={16} className="mr-2 flex-shrink-0 text-primary" />
              <span>Password reset requests are handled by the Examination Cell Controller.</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="staff-email" className="block text-xs font-semibold text-navy-800 mb-1.5">
                Institutional Email or Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
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
                  className="block w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-navy-800 bg-white placeholder:text-slate-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="staff-password" className="block text-xs font-semibold text-navy-800">
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
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
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
                  className="block w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-navy-800 bg-white placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-navy-800 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="es-btn-primary w-full py-2.5 px-4 text-sm shadow-xs"
            >
              <span>{loading ? 'Signing in...' : 'Sign In to Exam Portal'}</span>
              {!loading && <ArrowRight size={15} className="ml-2" aria-hidden="true" />}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-600">
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

      <footer className="mt-8 text-center text-xs text-slate-600">
        RGMCET (Autonomous) • Department of CSE • ExamSeat AI
      </footer>
    </div>
  );
};

export default AdminLogin;
