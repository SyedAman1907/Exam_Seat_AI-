/**
 * Short-TTL read-through cache for public Student Seat Finder endpoints.
 * - Absorbs 500+ concurrent student schedule & seat lookups without saturating MongoDB Atlas.
 * - Strictly read-only (never caches mutable session/auth state or modifies allocations).
 * - Immediately invalidated locally on exam/allocation mutations, and bounded to a 5s TTL
 *   so multi-instance deployments stay consistent within seconds.
 */

const SCHEDULE_TTL_MS = Number(process.env.PORTAL_CACHE_TTL_MS) || 5000;
const SEAT_INDEX_TTL_MS = Number(process.env.SEAT_INDEX_CACHE_TTL_MS) || 10000;

const scheduleCache = new Map(); // key -> { expiresAt, value }
const scheduleInFlight = new Map(); // key -> Promise (coalesces thundering-herd misses)

const seatIndexCache = new Map(); // examId -> { expiresAt, value: { allocationMeta, byRegNo: Map } }
const seatIndexInFlight = new Map(); // examId -> Promise

async function getOrLoad(cacheMap, inFlightMap, key, ttlMs, loaderFn) {
  const now = Date.now();
  const cached = cacheMap.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (inFlightMap.has(key)) {
    return inFlightMap.get(key);
  }

  const promise = Promise.resolve()
    .then(() => loaderFn())
    .then((value) => {
      cacheMap.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlightMap.delete(key);
    });

  inFlightMap.set(key, promise);
  return promise;
}

function getScheduleCandidates(key, loaderFn, bypassCache = false) {
  if (bypassCache) {
    return loaderFn();
  }
  return getOrLoad(scheduleCache, scheduleInFlight, key, SCHEDULE_TTL_MS, loaderFn);
}

function getExamSeatIndex(examId, loaderFn, bypassCache = false) {
  const key = String(examId);
  if (bypassCache) {
    return loaderFn();
  }
  return getOrLoad(seatIndexCache, seatIndexInFlight, key, SEAT_INDEX_TTL_MS, loaderFn);
}

function invalidatePortalCache(examId = null) {
  scheduleCache.clear();
  if (examId) {
    seatIndexCache.delete(String(examId));
  } else {
    seatIndexCache.clear();
  }
}

function getPortalCacheStats() {
  return {
    scheduleEntries: scheduleCache.size,
    seatIndexEntries: seatIndexCache.size,
  };
}

module.exports = {
  getScheduleCandidates,
  getExamSeatIndex,
  invalidatePortalCache,
  getPortalCacheStats,
};
