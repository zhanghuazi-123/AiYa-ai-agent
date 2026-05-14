import { getConfig, setConfig } from '../db.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const WEATHER_RE = /天气|weather|气温|温度|下雨|snow|rain|晴|阴|多云|风|湿度|forecast/i;

let _cache = { data: null, expiresAt: 0 };

const WEATHER_DESC_ZH = {
  'Clear': '晴朗', 'Sunny': '晴天', 'Partly cloudy': '多云',
  'Cloudy': '阴天', 'Overcast': '多云转阴', 'Mist': '薄雾',
  'Fog': '大雾', 'Light rain': '小雨', 'Rain': '雨',
  'Heavy rain': '大雨', 'Thunderstorm': '雷阵雨', 'Light snow': '小雪',
  'Snow': '雪', 'Heavy snow': '大雪', 'Blizzard': '暴风雪',
  'Hail': '冰雹', 'Sleet': '雨夹雪', 'Windy': '有风',
};

export function getUserLocation() {
  return getConfig('location_city') || 'Beijing';
}

export function setUserLocation(city) {
  setConfig('location_city', city);
}

export function isWeatherQuery(message) {
  return WEATHER_RE.test(message || '');
}

export async function fetchWeather(location) {
  const now = Date.now();
  if (_cache.data && now < _cache.expiresAt) return _cache.data;

  const loc = encodeURIComponent(location || getUserLocation());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`https://wttr.in/${loc}?format=j1&lang=zh`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AiYa/1.0' },
    });
    clearTimeout(timeout);
    const data = await res.json();

    const current = data.current_condition?.[0] || {};
    const area = data.nearest_area?.[0]?.areaName?.[0]?.value || location;
    const descEn = current.weatherDesc?.[0]?.value || '';
    const descZh = WEATHER_DESC_ZH[descEn] || descEn;

    _cache = {
      data: {
        location: area,
        tempC: current.temp_C,
        feelsLikeC: current.FeelsLikeC,
        humidity: current.humidity,
        windKmph: current.windspeedKmph,
        windDir: current.winddir16Point,
        visibility: current.visibility,
        desc: descZh,
        forecast: (data.weather || []).slice(0, 3).map(d => ({
          date: d.date,
          maxTemp: d.maxtempC,
          minTemp: d.mintempC,
          desc: d.hourly?.[4]?.weatherDesc?.[0]?.value || '',
        })),
      },
      expiresAt: now + CACHE_TTL_MS,
    };
    return _cache.data;
  } catch (e) {
    clearTimeout(timeout);
    console.error('[Weather] Failed:', e.message);
    return null;
  }
}

export function getWeatherSummary() {
  if (!_cache.data) return '';
  const w = _cache.data;
  let text = `天气 ${w.location}: ${w.desc}，${w.tempC}°C（体感 ${w.feelsLikeC}°C），湿度 ${w.humidity}%，风速 ${w.windKmph}km/h ${w.windDir || ''}`;
  if (w.forecast?.length) {
    text += '\n预报: ' + w.forecast.map(d => `${d.date} ${d.minTemp}~${d.maxTemp}°C`).join('；');
  }
  return text;
}

export function getWeatherCardProps() {
  if (!_cache.data) return null;
  const w = _cache.data;
  return {
    location: w.location,
    temp: w.tempC,
    desc: w.desc,
    humidity: w.humidity,
    wind: w.windKmph,
    forecast: w.forecast,
  };
}
