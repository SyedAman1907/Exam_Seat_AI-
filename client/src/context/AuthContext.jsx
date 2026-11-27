import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('examseat_user');
      if (!saved || saved === 'null' || saved === 'undefined') {
        return null;
      }
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
      localStorage.removeItem('examseat_user');
      return null;
    } catch (err) {
      console.warn('[AuthContext] Clearing corrupted stored user metadata:', err.message);
      localStorage.removeItem('examseat_user');
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('examseat_token'));
  const [authStatus, setAuthStatus] = useState(() =>
    localStorage.getItem('examseat_token') ? 'initializing' : 'unauthenticated'
  );
  const [authError, setAuthError] = useState('');

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    setAuthError('');
    setAuthStatus('unauthenticated');
    localStorage.removeItem('examseat_token');
    localStorage.removeItem('examseat_user');
  }, []);

  const verifySession = useCallback(
    async (signal) => {
      const storedToken = localStorage.getItem('examseat_token');
      if (!storedToken) {
        clearSession();
        return;
      }

      setAuthStatus('initializing');
      setAuthError('');

      try {
        const res = await api.get('/auth/me', {
          timeout: 5000,
          signal,
        });
      if (res.data?.success && res.data?.user && typeof res.data.user === 'object') {
        setUser(res.data.user);
        setToken(storedToken);
        localStorage.setItem('examseat_user', JSON.stringify(res.data.user));
        setAuthStatus('authenticated');
      } else {
        clearSession();
      }
      } catch (err) {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
          return;
        }
        const status = err.response?.status;
        if (status === 401) {
          console.warn('[AuthContext] Session expired or invalid token (401). Clearing session.');
          clearSession();
        } else {
          const msg =
            err.response?.data?.message ||
            (err.code === 'ECONNABORTED'
              ? 'Session verification timed out while contacting the backend server.'
              : 'Unable to verify session. Backend or database may be temporarily unavailable.');
          console.warn(`[AuthContext] Session verification error (${status || err.code}):`, msg);
          setAuthError(msg);
          setAuthStatus('error');
        }
      }
    },
    [clearSession]
  );

  useEffect(() => {
    const controller = new AbortController();
    verifySession(controller.signal);
    return () => controller.abort();
  }, [verifySession]);

  const retryAuth = useCallback(() => {
    const controller = new AbortController();
    return verifySession(controller.signal);
  }, [verifySession]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.data?.success && res.data?.token && res.data?.user && typeof res.data.user === 'object') {
      const { token: newToken, user: newUser } = res.data;
      setToken(newToken);
      setUser(newUser);
      setAuthError('');
      setAuthStatus('authenticated');
      localStorage.setItem('examseat_token', newToken);
      localStorage.setItem('examseat_user', JSON.stringify(newUser));
      return { success: true };
    }
    return { success: false, message: res.data?.message || 'Sign in failed.' };
  };

  const logout = async () => {
    try {
      if (token) {
        await api.post('/auth/logout', null, { timeout: 3000 });
      }
    } catch (e) {
      console.warn('[AuthContext] Logout request failed:', e?.message || e);
    } finally {
      clearSession();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: authStatus === 'authenticated' && !!token && !!user,
        loading: authStatus === 'initializing',
        authStatus,
        authError,
        retryAuth,
        clearSession,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
