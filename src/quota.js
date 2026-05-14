const WINDOW_SEC = 60;
const RPM_LIMIT = 500;
const TPM_LIMIT = 20_000_000;

const requestTimestamps = [];
let tokenCount = 0;
let rateLimitedUntil = 0;

export function recordUsage(tokens) {
  const now = Date.now();
  requestTimestamps.push(now);
  tokenCount += tokens;
  // Trim old entries
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - WINDOW_SEC * 1000) {
    requestTimestamps.shift();
  }
}

export function shouldThrottle() {
  if (rateLimitedUntil > Date.now()) return true;
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - WINDOW_SEC * 1000) {
    requestTimestamps.shift();
  }
  const rpmUsed = requestTimestamps.length;
  if (rpmUsed >= RPM_LIMIT * 0.95) return true;
  if (tokenCount >= TPM_LIMIT * 0.95) return true;
  return false;
}

export function setRateLimited() {
  rateLimitedUntil = Date.now() + 10 * 60 * 1000;
}

export function getQuotaStatus() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - WINDOW_SEC * 1000) {
    requestTimestamps.shift();
  }
  return {
    rpmUsed: `${requestTimestamps.length}/${RPM_LIMIT}`,
    tpmUsed: `${tokenCount}/${TPM_LIMIT}`,
    ratio: ((requestTimestamps.length / RPM_LIMIT) * 100).toFixed(1) + '%',
    rateLimited: rateLimitedUntil > now,
  };
}
