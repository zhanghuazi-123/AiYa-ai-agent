import { getUserLocation, getWeatherSummary, isWeatherQuery } from '../runtime/weather.js';
import { getHotspotsSummary, buildHotspotRuntimeContext } from '../runtime/hotspots.js';
import { getConfig, setConfig } from '../db.js';

export async function gatherContext({ isTick, message }) {
  const sections = [];

  // Weather context
  if (getConfig('context_weather_enabled') !== '0') {
    if (isWeatherQuery(message) || !getConfig('last_weather_fetched')) {
      const weather = getWeatherSummary();
      if (weather) sections.push(weather);
      if (isWeatherQuery(message)) setConfig('last_weather_fetched', new Date().toISOString());
    }
  }

  // Hotspots context
  if (getConfig('context_hotspots_enabled') !== '0' && isTick) {
    const platform = getConfig('hotspot_platform') || 'weibo';
    const hotspots = getHotspotsSummary();
    if (hotspots) sections.push(hotspots);
  }

  // Hotspot runtime context (message match or panel recently viewed)
  if (message) {
    const hotspotCtx = buildHotspotRuntimeContext(message);
    if (hotspotCtx) sections.push(hotspotCtx);
  }

  // Location context
  const city = getConfig('location_city');
  if (city) sections.push(`位置: ${city}`);

  return sections.join('\n');
}

export function formatExtraContext(sections) {
  if (!sections || sections.length === 0) return '';
  return `\n\n## Supplemental Context\n${sections}`;
}
