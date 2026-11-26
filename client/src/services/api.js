import axios from 'axios';

const rawApiUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const API_BASE_URL = !rawApiUrl
  ? '/api'
  : rawApiUrl.startsWith('http') && !rawApiUrl.endsWith('/api')
    ? `${rawApiUrl}/api`
    : rawApiUrl;

export const API_TIMEOUTS = {
  DEFAULT: 30000,
  AUTH: 15000,
  HEAVY_WRITE: 90000,
  REPORT_EXPORT: 90000,
  PDF_UPLOAD: 120000,
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUTS.DEFAULT,
  headers: {
    'Content-Type': 'application/json',
  },
});

const IDEMPOTENT_METHODS = new Set(['get', 'head']);
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export function formatApiError(err, fallbackMessage = 'Request failed. Please try again.') {
  if (!err) return fallbackMessage;
  if (err.response?.data?.message) {
    return err.response.data.message;
  }
  if (err.code === 'ECONNABORTED' || String(err.message || '').toLowerCase().includes('timeout')) {
    return 'The server took too long to respond. Please check your connection and try again.';
  }
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error' || !err.response) {
    return 'Unable to reach the ExamSeat AI server. Please verify the backend service and MongoDB Atlas are online.';
  }
  return fallbackMessage;
}

// Attach JWT token to requests if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('examseat_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // For FormData requests, let browser/axios compute the multipart boundary header
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercept transient GET/HEAD failures cleanly & handle 401 session expiry
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const method = String(config.method || 'get').toLowerCase();
    const isCanceled =
      axios.isCancel(error) ||
      error.name === 'CanceledError' ||
      error.code === 'ERR_CANCELED' ||
      config.signal?.aborted;

    const status = error.response?.status;
    const isTransient =
      !isCanceled &&
      IDEMPOTENT_METHODS.has(method) &&
      config.skipRetry !== true &&
      (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || TRANSIENT_STATUSES.has(status));

    if (isTransient) {
      const retryCount = config.__retryCount || 0;
      const maxRetries = typeof config.maxRetries === 'number' ? config.maxRetries : 2;
      if (retryCount < maxRetries) {
        config.__retryCount = retryCount + 1;
        const backoffMs = 1000 * Math.pow(2, retryCount);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        if (!config.signal?.aborted) {
          return api(config);
        }
      }
    }

    const isAuthRequest =
      config.url?.includes('/auth/login') || config.url?.includes('/auth/me');
    const isLoginPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin/login');
    const isProtectedRoute =
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/faculty'));

    if (error.response && status === 401 && !isAuthRequest && !isLoginPage && isProtectedRoute) {
      localStorage.removeItem('examseat_token');
      localStorage.removeItem('examseat_user');
      window.location.href = '/admin/login?expired=true';
    }
    return Promise.reject(error);
  }
);

export default api;
