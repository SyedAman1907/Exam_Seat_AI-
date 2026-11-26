import api, { API_TIMEOUTS, formatApiError } from '../services/api';

// Prevent duplicate simultaneous downloads of the exact same endpoint from double-clicks
const inFlightDownloads = new Map();

function resolveExtension(filename, contentType) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.zip') || contentType.includes('zip')) return '.zip';
  if (lower.endsWith('.xlsx') || contentType.includes('spreadsheetml') || contentType.includes('excel')) return '.xlsx';
  if (lower.endsWith('.csv') || contentType.includes('text/csv')) return '.csv';
  return '.pdf';
}

function resolveMimeType(ext, contentType) {
  if (contentType && !contentType.includes('application/octet-stream') && !contentType.includes('text/plain')) {
    return contentType.split(';')[0].trim();
  }
  if (ext === '.zip') return 'application/zip';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.csv') return 'text/csv;charset=utf-8';
  return 'application/pdf';
}

function parseFilenameFromDisposition(disposition, fallbackFilename) {
  if (!disposition) return fallbackFilename;
  // Support RFC 5987 filename*=UTF-8''... and standard filename="..."
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/['"]/g, '').trim());
    } catch {
      return utf8Match[1].replace(/['"]/g, '').trim();
    }
  }
  const stdMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
  if (stdMatch && stdMatch[1]) {
    const cleaned = stdMatch[1].replace(/['"]/g, '').trim();
    if (cleaned) return cleaned;
  }
  return fallbackFilename;
}

/**
 * Downloads a protected institutional report (PDF / ZIP / XLSX) using the authenticated Axios client.
 * - Deduplicates rapid double-clicks on the same endpoint.
 * - Validates binary non-empty response and checks `%PDF-` signature for PDF files.
 * - Defers ObjectURL revocation by 60s so Chrome/Edge downloads never abort mid-stream.
 *
 * @param {string} endpoint
 * @param {string} fallbackFilename
 * @param {'download' | 'view'} mode
 * @param {object} [options] - { silentAlert?: boolean, onError?: (msg: string) => void, onSuccess?: (filename: string) => void, timeout?: number, params?: object }
 * @returns {Promise<{ success: boolean, filename?: string, error?: string, deduplicated?: boolean }>}
 */
export const downloadProtectedReport = async (
  endpoint,
  fallbackFilename = 'document.pdf',
  mode = 'download',
  options = {}
) => {
  const { silentAlert = false, onError, onSuccess, timeout = API_TIMEOUTS.REPORT_EXPORT, params } = options || {};
  const requestKey = `${endpoint}::${params ? JSON.stringify(params) : ''}`;

  if (inFlightDownloads.has(requestKey)) {
    return inFlightDownloads.get(requestKey);
  }

  const task = (async () => {
    try {
      const res = await api.get(endpoint, {
        params,
        responseType: 'blob',
        timeout,
      });

      const rawBlob = res.data;
      const responseContentType = String(res.headers?.['content-type'] || '').toLowerCase();

      if (!(rawBlob instanceof Blob) || rawBlob.size === 0) {
        throw new Error('The generated file was empty. Please regenerate the seating allocation and retry.');
      }

      // Check if server returned JSON or HTML error payload wrapped inside a Blob
      if (responseContentType.includes('application/json') || responseContentType.includes('text/html')) {
        const text = await rawBlob.text();
        let parsed = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = {};
        }
        throw new Error(parsed.message || 'Server returned an unexpected response instead of a downloadable document.');
      }

      const filename = parseFilenameFromDisposition(res.headers?.['content-disposition'], fallbackFilename);
      const ext = resolveExtension(filename, responseContentType);
      const finalContentType = resolveMimeType(ext, responseContentType);

      // Verify PDF integrity header (%PDF-) to avoid saving corrupted or JSON error blobs
      if (ext === '.pdf') {
        const headerSlice = await rawBlob.slice(0, 16).text();
        if (!headerSlice.startsWith('%PDF-')) {
          const maybeText = await rawBlob.slice(0, 512).text();
          let jsonErr = null;
          try {
            jsonErr = JSON.parse(maybeText)?.message;
          } catch { }
          throw new Error(jsonErr || 'Downloaded PDF content was invalid or corrupted. Please try again.');
        }
      }

      const typedBlob = new Blob([rawBlob], { type: finalContentType });
      const blobUrl = window.URL.createObjectURL(typedBlob);

      // Always initiate an immediate file download so async browser popup blockers never drop the file
      triggerDownload(blobUrl, filename, mode === 'view' ? '_self' : undefined);

      setTimeout(() => {
        try {
          window.URL.revokeObjectURL(blobUrl);
        } catch (e) {
          console.warn('[Download] ObjectURL revoke note:', e?.message);
        }
      }, 60000);

      if (typeof onSuccess === 'function') onSuccess(filename);
      return { success: true, filename };
    } catch (err) {
      console.error('[Download Protected Report Error]:', err);
      let errorMessage = 'Failed to download document. Please try again.';

      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.message) errorMessage = json.message;
        } catch (e) {
          console.warn('[Download] Blob error decode fallback:', e?.message);
        }
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.response?.status === 401) {
        errorMessage = 'Session expired or unauthenticated. Please log in to proceed.';
      } else if (err.response?.status === 403) {
        errorMessage = 'Access denied. You do not have permission to download this document.';
      } else if (err.response?.status === 404) {
        errorMessage = 'Document or seating allocation not found for this examination.';
      } else {
        errorMessage = formatApiError(err, errorMessage);
      }

      if (typeof onError === 'function') {
        onError(errorMessage);
      } else if (!silentAlert) {
        alert(errorMessage);
      }
      return { success: false, error: errorMessage };
    } finally {
      inFlightDownloads.delete(requestKey);
    }
  })();

  inFlightDownloads.set(requestKey, task);
  return task;
};

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default downloadProtectedReport;
