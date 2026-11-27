import axios from 'axios';

const PRODUCTION_BACKEND_URL = 'https://exam-seat-ai-1.onrender.com';

function resolveApiBaseUrl() {
  const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  const isLocalhostUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw);
  const isVercelFrontendUrl = /^https?:\/\/[^/]*\.vercel\.app(\/|$)/i.test(raw);
  const isSameWindowOrigin =
    typeof window !== 'undefined' &&
    window.location?.origin &&
    raw.toLowerCase().startsWith(window.location.origin.toLowerCase()) &&
    !window.location.origin.includes('onrender.com');

  if (import.meta.env.PROD) {
    if (!raw || raw === '/api' || isLocalhostUrl || isVercelFrontendUrl || isSameWindowOrigin) {
      return `${PRODUCTION_BACKEND_URL}/api`;
    }
    return raw.startsWith('http') && !raw.endsWith('/api') ? `${raw}/api` : raw;
  }

  if (!raw) {
    return '/api';
  }
  return raw.startsWith('http') && !raw.endsWith('/api') ? `${raw}/api` : raw;
}

const API_BASE_URL = resolveApiBaseUrl();

export const API_TIMEOUTS = {
  DEFAULT: 30000,
  AUTH: 15000,
  HEAVY_WRITE: 90000,
  REPORT_EXPORT: 90000,
  PDF_UPLOAD: 120000,
};

function isBinaryResponseType(responseType) {
  return responseType === 'blob' || responseType === 'arraybuffer';
}

function generateRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function safeParseJsonPayload(rawData) {
  if (rawData === null || rawData === undefined) {
    return null;
  }

  // Never parse an already-parsed object, array, Blob, or ArrayBuffer a second time
  if (typeof rawData === 'object') {
    return rawData;
  }

  if (typeof rawData === 'string') {
    const trimmed = rawData.trim();
    // Never treat empty strings, literal "null", or double-encoded "\"null\"" as JSON objects
    if (!trimmed || trimmed === 'null' || trimmed === '"null"' || trimmed === 'undefined') {
      return null;
    }

    // Parse valid JSON strictly once; preserve actual types (null, object, array, primitive)
    // and return raw string untouched if invalid/non-JSON (e.g. HTML gateway error page).
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === 'null' || parsed === undefined) {
        return null;
      }
      return parsed;
    } catch {
      return rawData;
    }
  }

  return rawData;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUTS.DEFAULT,
  headers: {
    'Content-Type': 'application/json',
  },
  transformResponse: [
    function transformJsonSafely(data) {
      if (isBinaryResponseType(this?.responseType)) {
        return data;
      }
      return safeParseJsonPayload(data);
    },
  ],
});

const IDEMPOTENT_METHODS = new Set(['get', 'head']);
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export function formatApiError(err, fallbackMessage = 'Request failed. Please try again.') {
  if (!err) return fallbackMessage;
  if (err.response?.data && typeof err.response.data === 'object' && err.response.data.message) {
    return err.response.data.message;
  }
  if (err.isInvalidJsonResponse || err.code === 'ERR_INVALID_JSON_RESPONSE') {
    return err.message || 'Server returned an invalid or empty response. Please retry shortly.';
  }
  if (err.name === 'SyntaxError' || String(err.message || '').toLowerCase().includes('is not valid json')) {
    return 'Server returned an unexpected non-JSON response. Please refresh and verify the operation.';
  }
  if (err.code === 'ECONNABORTED' || String(err.message || '').toLowerCase().includes('timeout')) {
    return 'The server took too long to respond. Please check your connection and try again.';
  }
  if (err.code === 'ERR_NETWORK' || err.message === 'Network Error' || !err.response) {
    return 'Unable to reach the ExamSeat AI server. Please verify the backend service and MongoDB Atlas are online.';
  }
  return fallbackMessage;
}

// Attach correlation request ID & JWT token to requests
api.interceptors.request.use(
  (config) => {
    const reqId = config.headers?.['X-Request-Id'] || generateRequestId();
    config.headers['X-Request-Id'] = reqId;
    config.__requestId = reqId;

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

function logSafeApiDiagnostic({ requestId, method, url, status, reason }) {
  console.error('[API Diagnostics]', {
    requestId: requestId || 'unknown',
    method: String(method || 'GET').toUpperCase(),
    endpoint: String(url || '').split('?')[0] || 'unknown',
    status: status || 0,
    reason: reason || 'Request failed',
  });
}

// Intercept invalid JSON payloads, transient GET/HEAD failures, & 401 session expiry
api.interceptors.response.use(
  (response) => {
    if (isBinaryResponseType(response.config?.responseType)) {
      return response;
    }

    const requestId =
      response.headers?.['x-request-id'] || response.config?.__requestId || response.data?.requestId;

    const isSuccessStatus = response.status >= 200 && response.status < 300;
    if (!isSuccessStatus) {
      const errMsg =
        (response.data && typeof response.data === 'object' && response.data.message) ||
        `Request failed with HTTP status ${response.status}.`;
      logSafeApiDiagnostic({
        requestId,
        method: response.config?.method,
        url: response.config?.url,
        status: response.status,
        reason: errMsg,
      });
      const badErr = new axios.AxiosError(errMsg, 'ERR_BAD_RESPONSE', response.config, response.request, response);
      badErr.requestId = requestId;
      return Promise.reject(badErr);
    }

    // HTTP 204 No Content legitimately has an empty/null body
    if (response.status === 204) {
      return response;
    }

    if (response.data === null || typeof response.data !== 'object') {
      const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
      const reasonMsg =
        response.data === null
          ? 'Server returned an empty or null response payload.'
          : contentType.includes('text/html') ||
              (typeof response.data === 'string' && response.data.trim().startsWith('<'))
            ? 'Server returned an HTML response instead of JSON.'
            : 'Server returned an invalid or non-object JSON response.';

      logSafeApiDiagnostic({
        requestId,
        method: response.config?.method,
        url: response.config?.url,
        status: response.status,
        reason: reasonMsg,
      });

      const invalidErr = new axios.AxiosError(
        reasonMsg,
        'ERR_INVALID_JSON_RESPONSE',
        response.config,
        response.request,
        response
      );
      invalidErr.isInvalidJsonResponse = true;
      invalidErr.requestId = requestId;
      return Promise.reject(invalidErr);
    }

    return response;
  },
  async (error) => {
    const config = error.config || {};
    const method = String(config.method || 'get').toLowerCase();
    const isCanceled =
      axios.isCancel(error) ||
      error.name === 'CanceledError' ||
      error.code === 'ERR_CANCELED' ||
      config.signal?.aborted;

    const status = error.response?.status;
    const requestId =
      error.response?.headers?.['x-request-id'] ||
      error.response?.data?.requestId ||
      config.__requestId;
    error.requestId = requestId;

    if (error.response && !isBinaryResponseType(config.responseType)) {
      const rawErrData = error.response.data;
      if (rawErrData === null || typeof rawErrData !== 'object') {
        const isHtml =
          typeof rawErrData === 'string' &&
          (rawErrData.trim().startsWith('<!DOCTYPE') || rawErrData.trim().startsWith('<html'));
        const fallbackErrMsg =
          status >= 500
            ? `The backend service returned a temporary error response (HTTP ${status}). Please retry shortly.`
            : typeof rawErrData === 'string' && rawErrData.trim() && !isHtml && rawErrData.trim() !== 'null'
              ? rawErrData.trim().slice(0, 200)
              : `Server returned a non-JSON response (HTTP ${status}).`;
        error.isInvalidJsonResponse = true;
        error.message = fallbackErrMsg;
      }
    }

    if (!isCanceled && (status >= 500 || error.isInvalidJsonResponse || !error.response)) {
      logSafeApiDiagnostic({
        requestId,
        method,
        url: config.url,
        status,
        reason: error.response?.data?.message || error.message,
      });
    }

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
        const jitterMs = Math.floor(Math.random() * 400);
        const backoffMs = 1000 * Math.pow(2, retryCount) + jitterMs;
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
