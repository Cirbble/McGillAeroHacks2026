const WEATHER_CACHE_TTL_MS = 12 * 60 * 1000;
const WEATHER_FETCH_TIMEOUT_MS = 1800;

const WEATHER_CODE_LABELS = {
    0: 'Clear sky',
    1: 'Mostly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Rain showers',
    81: 'Heavy rain showers',
    82: 'Violent rain showers',
    85: 'Snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Severe thunderstorm with hail',
};

let weatherCache = {
    cacheKey: null,
    fetchedAt: 0,
    payload: null,
};

function getWeatherLabel(code) {
    return WEATHER_CODE_LABELS[code] || 'Mixed conditions';
}

function round(value, digits = 1) {
    return Number(Number(value || 0).toFixed(digits));
}

function classifyWeather({
    stationStatus,
    windGustKph,
    visibilityKm,
    tempC,
    precipitationMm,
    precipitationProbabilityPct,
    snowfallCm,
    weatherCode,
}) {
    const issues = [];
    let riskScore = 0;

    if (stationStatus === 'offline') {
        issues.push('Station is offline and cannot support launch or relay handoff.');
        riskScore += 100;
    } else if (stationStatus === 'maintenance') {
        issues.push('Station is in maintenance mode and should be bypassed if possible.');
        riskScore += 60;
    }

    if (windGustKph >= 70) {
        issues.push(`Severe gusts at ${round(windGustKph)} km/h raise landing instability risk.`);
        riskScore += 42;
    } else if (windGustKph >= 55) {
        issues.push(`Strong crosswinds at ${round(windGustKph)} km/h may force route changes.`);
        riskScore += 28;
    } else if (windGustKph >= 40) {
        issues.push(`Elevated gusts at ${round(windGustKph)} km/h will reduce safety margin.`);
        riskScore += 12;
    }

    if (visibilityKm <= 1.5) {
        issues.push(`Visibility down to ${round(visibilityKm)} km increases approach risk.`);
        riskScore += 34;
    } else if (visibilityKm <= 4) {
        issues.push(`Visibility reduced to ${round(visibilityKm)} km, slowing pad approach.`);
        riskScore += 16;
    }

    if (tempC <= -30) {
        issues.push(`Extreme cold at ${round(tempC)} C will accelerate battery drain.`);
        riskScore += 24;
    } else if (tempC <= -24) {
        issues.push(`Cold soak at ${round(tempC)} C may reduce available range.`);
        riskScore += 12;
    }

    if (snowfallCm >= 3 || precipitationMm >= 2) {
        issues.push('Active snowfall or precipitation may obstruct sensors and landing pads.');
        riskScore += 20;
    } else if (precipitationProbabilityPct >= 60) {
        issues.push(`Forecast precipitation probability is ${round(precipitationProbabilityPct, 0)}%.`);
        riskScore += 8;
    }

    if ([45, 48, 75, 86, 95, 96, 99].includes(weatherCode)) {
        riskScore += 18;
    } else if ([71, 73, 80, 81, 82, 85].includes(weatherCode)) {
        riskScore += 10;
    }

    let condition = 'CLEAR';
    if (riskScore >= 75) {
        condition = 'SEVERE';
    } else if (riskScore >= 42) {
        condition = 'UNSTABLE';
    } else if (riskScore >= 18) {
        condition = 'WATCH';
    }

    const recommendedAction = condition === 'SEVERE'
        ? 'Hold departures through this node or reroute around it.'
        : condition === 'UNSTABLE'
            ? 'Use only if no safer corridor is available and monitor manually.'
            : condition === 'WATCH'
                ? 'Proceed with caution and keep the node on weather watch.'
                : 'Conditions are within nominal relay limits.';

    const summaryParts = [
        getWeatherLabel(weatherCode),
        `${round(tempC)} C`,
        `gusts ${round(windGustKph)} km/h`,
        `visibility ${round(visibilityKm)} km`,
    ];

    return {
        condition,
        riskScore,
        issues,
        summary: summaryParts.join(' | '),
        recommendedAction,
    };
}

function buildStaleSnapshot(snapshot) {
    return {
        ...snapshot,
        source: 'open-meteo-stale',
        stale: true,
    };
}

function hashStationSeed(stationId = '') {
    return [...String(stationId)].reduce((total, character, index) => (
        total + character.charCodeAt(0) * (index + 17)
    ), 0);
}

function buildRegionalFallbackSnapshot(station) {
    const seed = hashStationSeed(station.id);
    const normalized = (seed % 997) / 997;
    const coastalBias = station.lng > -70 ? 1 : 0;
    const northernBias = station.lat > 52 ? 1 : 0;
    const jamesBayBias = /chisasibi|wemindji|eastmain|radisson|whapmagoostui/i.test(station.id) ? 1 : 0;
    const weatherCodes = [71, 73, 3, 51];
    const weatherCode = weatherCodes[seed % weatherCodes.length];
    const tempC = round(-12 - (station.lat - 45) * 1.25 - normalized * 7 - northernBias * 3);
    const windSpeedKph = round(18 + normalized * 16 + coastalBias * 6 + jamesBayBias * 4);
    const windGustKph = round(windSpeedKph + 10 + normalized * 18 + northernBias * 4);
    const visibilityKm = round(Math.max(3, 14 - normalized * 7 - jamesBayBias * 2 - coastalBias), 1);
    const precipitationProbabilityPct = round(Math.min(92, 38 + normalized * 44 + jamesBayBias * 8), 0);
    const snowfallCm = round(Math.max(0, normalized * 3.6 + northernBias * 0.8 + (weatherCode === 73 ? 0.9 : 0)), 1);
    const precipitationMm = round(Math.max(0, snowfallCm * 0.35 + (weatherCode === 51 ? 0.6 : 0.1)), 1);

    return {
        stationId: station.id,
        stationStatus: station.status,
        observedAt: new Date().toISOString(),
        tempC,
        windSpeedKph,
        windGustKph,
        visibilityKm,
        precipitationMm,
        precipitationProbabilityPct,
        snowfallCm,
        weatherCode,
        weatherCodeLabel: getWeatherLabel(weatherCode),
        source: 'quebec-regional-analog',
        stale: false,
    };
}

function buildUnavailableSnapshot(station) {
    const analogSnapshot = buildRegionalFallbackSnapshot(station);

    return {
        ...analogSnapshot,
        ...classifyWeather(analogSnapshot),
        issues: [
            `Live weather could not be retrieved for ${station.id}. This Quebec analog is planning support, not a guaranteed observation.`,
        ],
        summary: `${analogSnapshot.weatherCodeLabel} analog | ${round(analogSnapshot.tempC)} C | gusts ${round(analogSnapshot.windGustKph)} km/h | visibility ${round(analogSnapshot.visibilityKm)} km`,
        recommendedAction: 'Treat this analog as a fallback estimate and verify locally before approving a sensitive reroute.',
    };
}

async function fetchStationWeather(station) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', station.lat);
    url.searchParams.set('longitude', station.lng);
    url.searchParams.set('current', 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility');
    url.searchParams.set('daily', 'precipitation_probability_max,snowfall_sum,wind_gusts_10m_max,weather_code');
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set('timezone', 'auto');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Weather request failed with status ${response.status}`);
        }

        const payload = await response.json();
        const rawSnapshot = {
            stationId: station.id,
            stationStatus: station.status,
            observedAt: payload.current?.time || new Date().toISOString(),
            tempC: payload.current?.temperature_2m ?? station.temp,
            windSpeedKph: payload.current?.wind_speed_10m ?? 0,
            windGustKph: payload.current?.wind_gusts_10m ?? payload.daily?.wind_gusts_10m_max?.[0] ?? 0,
            visibilityKm: round((payload.current?.visibility ?? 10000) / 1000),
            precipitationMm: payload.current?.precipitation ?? 0,
            precipitationProbabilityPct: payload.daily?.precipitation_probability_max?.[0] ?? 0,
            snowfallCm: payload.daily?.snowfall_sum?.[0] ?? 0,
            weatherCode: payload.current?.weather_code ?? payload.daily?.weather_code?.[0] ?? 0,
            weatherCodeLabel: getWeatherLabel(payload.current?.weather_code ?? payload.daily?.weather_code?.[0] ?? 0),
            source: 'open-meteo',
        };

        return {
            ...rawSnapshot,
            ...classifyWeather(rawSnapshot),
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Weather request timed out after ${WEATHER_FETCH_TIMEOUT_MS} ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export function buildWeatherIndex(snapshots = []) {
    return Object.fromEntries(snapshots.map((snapshot) => [snapshot.stationId, snapshot]));
}

export async function getWeatherSnapshots(stations = []) {
    const cacheKey = stations
        .map((station) => `${station.id}:${station.status}:${station.lat}:${station.lng}`)
        .join('|');

    if (
        weatherCache.payload
        && weatherCache.cacheKey === cacheKey
        && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_TTL_MS
    ) {
        return weatherCache.payload;
    }

    const previousByStation = buildWeatherIndex(weatherCache.payload?.stations || []);
    const settled = await Promise.allSettled(stations.map(fetchStationWeather));
    const snapshots = settled.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value;
        }

        const station = stations[index];
        const previous = previousByStation[station.id];
        if (previous?.source === 'open-meteo' || previous?.source === 'open-meteo-stale') {
            return buildStaleSnapshot(previous);
        }

        return buildUnavailableSnapshot(station);
    });

    const source = settled.every((result) => result.status === 'fulfilled')
        ? 'open-meteo'
        : snapshots.some((snapshot) => snapshot.source === 'open-meteo-stale')
            ? 'open-meteo-live+stale'
            : 'open-meteo-live+regional-analog';
    const payload = {
        updatedAt: new Date().toISOString(),
        source,
        stations: snapshots,
    };

    weatherCache = {
        cacheKey,
        fetchedAt: Date.now(),
        payload,
    };

    return payload;
}
