import { getConfig, setConfig } from '../db.js';

export function getTickIntervalMs() {
  const mins = parseInt(getConfig('tick_interval_minutes')) || 20;
  return Math.max(60000, Math.min(7200000, mins * 60 * 1000));
}

export function setTickIntervalMinutes(minutes) {
  const clamped = Math.max(1, Math.min(120, minutes));
  setConfig('tick_interval_minutes', String(clamped));
  return clamped;
}
