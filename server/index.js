import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Drone from './models/Drone.js';
import Station from './models/Station.js';
import Delivery from './models/Delivery.js';
import Line from './models/Line.js';
import { callGeminiJson, callSnowflakeCortex, getOperationalInsights, getPathOperationalInsights } from './services/ai.js';
import {
    DELIVERY_STATUSES,
    buildAdminNotifications,
    buildDefaultRecommendation,
    buildDroneRelocationReport,
    buildOverviewMetrics,
    buildPathWeatherReport,
    findBestRoute,
    formatEstimatedTime,
    planDroneRelocation,
    planDeliveryOperation,
} from './services/operations.js';
import { buildWeatherIndex, getWeatherSnapshots } from './services/weather.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env'), override: true });

const app = express();
app.use(cors());
app.use(express.json());

const SEED_DRONES = [
    { id: 'DRN-409', droneId: 8341, name: 'Relay Alpha', model: 'DDC Sparrow', status: 'on_route', assignment: 'RLY-9095', battery: 68, batteryHealth: 92, speed: 72, location: 'En route to Radisson', target_location: 'Radisson', time_of_arrival: '18 min' },
    { id: 'DRN-102', droneId: 2719, name: 'Relay Beta', model: 'DDC Robin XL', status: 'ready', assignment: 'RLY-9094', battery: 100, batteryHealth: 98, speed: 0, location: 'Mistissini' },
    { id: 'DRN-311', droneId: 5082, name: 'Relay Gamma', model: 'DDC Sparrow', status: 'charging', assignment: null, battery: 45, batteryHealth: 87, speed: 0, location: 'Nemaska' },
    { id: 'DRN-205', droneId: 6647, name: 'Relay Delta', model: 'DJI FlyCart 30', status: 'ready', assignment: null, battery: 100, batteryHealth: 95, speed: 0, location: 'Chisasibi' },
    { id: 'DRN-518', droneId: 9184, name: 'Relay Echo', model: 'DDC Robin XL', status: 'on_route', assignment: 'RLY-9094', battery: 74, batteryHealth: 96, speed: 68, location: 'En route to Eastmain', target_location: 'Eastmain', time_of_arrival: '22 min' },
];

const SEED_STATIONS = [
    { id: 'Montreal', type: 'distribution', status: 'online', battery: 100, temp: 2, lat: 45.5017, lng: -73.5673, max_drone_capacity: 12 },
    { id: 'Quebec City', type: 'distribution', status: 'online', battery: 98, temp: -1, lat: 46.8139, lng: -71.2082, max_drone_capacity: 10 },
    { id: 'Trois-Rivières', type: 'distribution', status: 'online', battery: 97, temp: 0, lat: 46.3432, lng: -72.5418, max_drone_capacity: 8 },
    { id: 'Sept-Îles', type: 'distribution', status: 'online', battery: 93, temp: -8, lat: 50.2030, lng: -66.3801, max_drone_capacity: 8 },
    { id: 'Gaspé', type: 'distribution', status: 'online', battery: 91, temp: -4, lat: 48.8282, lng: -64.4782, max_drone_capacity: 6 },
    { id: 'Saguenay', type: 'distribution', status: 'online', battery: 96, temp: -6, lat: 48.4284, lng: -71.0537, max_drone_capacity: 8 },
    { id: 'Chibougamau Hub', type: 'distribution', status: 'online', battery: 100, temp: -8, lat: 49.9166, lng: -74.3680, max_drone_capacity: 8 },
    { id: 'Mistissini', type: 'transit', status: 'online', battery: 94, temp: -14, lat: 50.4221, lng: -73.8683, max_drone_capacity: 4 },
    { id: 'Nemaska', type: 'transit', status: 'online', battery: 88, temp: -16, lat: 51.6911, lng: -76.2356, max_drone_capacity: 4 },
    { id: 'Waskaganish', type: 'transit', status: 'maintenance', battery: 12, temp: -19, lat: 51.4833, lng: -78.7500, max_drone_capacity: 4 },
    { id: 'Eastmain', type: 'transit', status: 'online', battery: 91, temp: -18, lat: 52.2333, lng: -78.5167, max_drone_capacity: 4 },
    { id: 'Wemindji', type: 'transit', status: 'online', battery: 85, temp: -20, lat: 53.0103, lng: -78.8311, max_drone_capacity: 4 },
    { id: 'Chisasibi', type: 'pick_up', status: 'online', battery: 100, temp: -22, lat: 53.7940, lng: -78.9069, max_drone_capacity: 6 },
    { id: 'Whapmagoostui', type: 'pick_up', status: 'online', battery: 100, temp: -25, lat: 55.2530, lng: -77.7652, max_drone_capacity: 6 },
    { id: 'Shawinigan', type: 'transit', status: 'online', battery: 95, temp: -1, lat: 46.5709, lng: -72.7468, max_drone_capacity: 4 },
    { id: 'La Tuque', type: 'transit', status: 'online', battery: 90, temp: -4, lat: 47.4457, lng: -72.7895, max_drone_capacity: 4 },
    { id: 'Roberval', type: 'transit', status: 'online', battery: 88, temp: -7, lat: 48.5199, lng: -72.2333, max_drone_capacity: 4 },
    { id: 'Rivière-du-Loup', type: 'transit', status: 'online', battery: 89, temp: -4, lat: 47.8337, lng: -69.5407, max_drone_capacity: 4 },
    { id: 'Rimouski', type: 'transit', status: 'online', battery: 90, temp: -5, lat: 48.4474, lng: -68.5304, max_drone_capacity: 4 },
    { id: 'Baie-Comeau', type: 'transit', status: 'online', battery: 87, temp: -8, lat: 49.2167, lng: -68.1500, max_drone_capacity: 6 },
    { id: 'Matane', type: 'transit', status: 'online', battery: 86, temp: -6, lat: 48.8520, lng: -67.5270, max_drone_capacity: 4 },
    { id: 'Fermont', type: 'transit', status: 'online', battery: 83, temp: -14, lat: 52.7891, lng: -67.0849, max_drone_capacity: 4 },
    { id: 'Schefferville', type: 'transit', status: 'online', battery: 79, temp: -17, lat: 54.8029, lng: -66.8165, max_drone_capacity: 4 },
    { id: 'LaGrande Relay', type: 'transit', status: 'online', battery: 76, temp: -20, lat: 53.7500, lng: -73.6700, max_drone_capacity: 4 },
    { id: 'Radisson', type: 'transit', status: 'online', battery: 81, temp: -22, lat: 53.7833, lng: -77.6167, max_drone_capacity: 4 },
    { id: 'Percé', type: 'pick_up', status: 'online', battery: 84, temp: -3, lat: 48.5240, lng: -64.2132, max_drone_capacity: 4 },
    { id: 'Havre-Saint-Pierre', type: 'pick_up', status: 'online', battery: 82, temp: -10, lat: 50.2333, lng: -63.5833, max_drone_capacity: 4 },
];

const SEED_LINES = [
    {
        id: 'blue',
        name: 'Blue Line',
        color: '#2563eb',
        stations: ['Montreal', 'Trois-Rivières', 'Shawinigan', 'La Tuque', 'Roberval', 'Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain'],
    },
    {
        id: 'orange',
        name: 'Orange Line',
        color: '#f97316',
        stations: ['Eastmain', 'Wemindji', 'Chisasibi', 'Whapmagoostui'],
    },
    {
        id: 'green',
        name: 'Green Line',
        color: '#16a34a',
        stations: ['Montreal', 'Quebec City', 'Saguenay', 'Rivière-du-Loup', 'Rimouski', 'Baie-Comeau', 'Sept-Îles', 'Havre-Saint-Pierre'],
    },
    {
        id: 'purple',
        name: 'Purple Line',
        color: '#7c3aed',
        stations: ['Sept-Îles', 'Fermont', 'Schefferville', 'LaGrande Relay', 'Radisson', 'Chisasibi'],
    },
    {
        id: 'teal',
        name: 'Teal Line',
        color: '#0891b2',
        stations: ['Rimouski', 'Matane', 'Gaspé', 'Percé'],
    },
    {
        id: 'aurora',
        name: 'Aurora Line',
        color: '#eab308',
        stations: ['Mistissini', 'Nemaska', 'Eastmain', 'Wemindji'],
    },
    {
        id: 'northlink',
        name: 'Northlink Line',
        color: '#ef4444',
        stations: ['Chibougamau Hub', 'LaGrande Relay', 'Radisson', 'Whapmagoostui'],
    },
];

const SEED_DELIVERIES = [
    {
        id: 'RLY-9082',
        payload: 'Insulin (5kg)',
        origin: 'Chibougamau Hub',
        destination: 'Chisasibi',
        priority: 'Routine',
        status: 'IN_TRANSIT',
        currentLeg: 2,
        totalLegs: 5,
        lastStation: 'Nemaska',
        eta: generateETA(96),
        solanaTx: '8xGhf9...4jK12v',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Chisasibi'],
        reasoning: 'Routine replenishment currently moving northbound.',
        estimatedTime: '1h 36m',
        estimatedMinutes: 96,
        createdAt: new Date(Date.now() - 1000 * 60 * 60),
    },
    {
        id: 'RLY-9083',
        payload: 'Antibiotics (2kg)',
        origin: 'Chibougamau Hub',
        destination: 'Whapmagoostui',
        priority: 'Urgent',
        status: 'HANDOFF',
        currentLeg: 1,
        totalLegs: 6,
        lastStation: 'Mistissini',
        eta: generateETA(138),
        solanaTx: '2zLpq9...9mN41x',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Chisasibi', 'Whapmagoostui'],
        reasoning: 'Urgent payload staged for the long-haul northern corridor.',
        estimatedTime: '2h 18m',
        estimatedMinutes: 138,
        createdAt: new Date(Date.now() - 1000 * 60 * 20),
    },
    {
        id: 'RLY-9084',
        payload: 'Emergency epinephrine auto-injectors',
        origin: 'Chibougamau Hub',
        destination: 'Whapmagoostui',
        priority: 'Emergency',
        status: 'READY_TO_LAUNCH',
        currentLeg: 0,
        totalLegs: 6,
        lastStation: 'Chibougamau Hub',
        eta: generateETA(142),
        solanaTx: '7mHq42...1dA90x',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Chisasibi', 'Whapmagoostui'],
        reasoning: 'Emergency dispatch prepared for launch pending corridor clearance.',
        estimatedTime: '2h 22m',
        estimatedMinutes: 142,
        createdAt: new Date(Date.now() - 1000 * 60 * 8),
    },
    {
        id: 'RLY-9094',
        payload: 'Cold-chain vaccines (1.2kg)',
        origin: 'Chibougamau Hub',
        destination: 'Wemindji',
        priority: 'Urgent',
        status: 'IN_TRANSIT',
        currentLeg: 2,
        totalLegs: 4,
        lastStation: 'Nemaska',
        eta: generateETA(84),
        solanaTx: '4kQa82...7nT55u',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Eastmain', 'Wemindji'],
        reasoning: 'Cold-chain mission currently using the direct inland bypass around Waskaganish.',
        estimatedTime: '1h 24m',
        estimatedMinutes: 84,
        createdAt: new Date(Date.now() - 1000 * 60 * 14),
    },
    {
        id: 'RLY-9095',
        payload: 'Dialysis support kits (3.4kg)',
        origin: 'Chibougamau Hub',
        destination: 'Whapmagoostui',
        priority: 'Emergency',
        status: 'READY_TO_LAUNCH',
        currentLeg: 0,
        totalLegs: 3,
        lastStation: 'Chibougamau Hub',
        eta: generateETA(118),
        solanaTx: '6tMx94...2kV31f',
        route: ['Chibougamau Hub', 'LaGrande Relay', 'Radisson', 'Whapmagoostui'],
        reasoning: 'Emergency northern dispatch staged on the long-haul Northlink spine to preserve capacity on the James Bay branch.',
        estimatedTime: '1h 58m',
        estimatedMinutes: 118,
        createdAt: new Date(Date.now() - 1000 * 60 * 4),
    },
    {
        id: 'RLY-9080',
        payload: 'Blood Samples (2kg)',
        origin: 'Chibougamau Hub',
        destination: 'Mistissini',
        priority: 'Routine',
        status: 'DELIVERED',
        currentLeg: 1,
        totalLegs: 1,
        lastStation: 'Mistissini',
        eta: new Date(Date.now() - 1000 * 60 * 30),
        solanaTx: '9aBz21...3qW55y',
        route: ['Chibougamau Hub', 'Mistissini'],
        reasoning: 'Short-range direct delivery to nearest community.',
        estimatedTime: '30m',
        estimatedMinutes: 30,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
    },
];

function generateETA(minutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
}

function serializeDoc(doc) {
    const serialized = doc.toObject();
    delete serialized._id;
    delete serialized.__v;
    delete serialized.updatedAt;
    return serialized;
}

function sendApiError(res, err) {
    if (err.name === 'ValidationError') {
        return res.status(400).json({ error: err.message });
    }

    if (err.code === 11000) {
        const duplicateField = Object.keys(err.keyPattern || {})[0] || 'record';
        return res.status(409).json({ error: `${duplicateField} already exists.` });
    }

    return res.status(500).json({ error: err.message });
}

async function generateUniqueId(model, prefix) {
    let id;
    let exists = true;

    while (exists) {
        id = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
        exists = await model.exists({ id });
    }

    return id;
}

function normalizeEvents(events = []) {
    return Array.isArray(events)
        ? events.map((event) => ({
            ...event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        }))
        : [];
}

function buildDronePayload(payload = {}) {
    return {
        id: payload.id,
        droneId: payload.droneId,
        name: payload.name,
        model: payload.model,
        location: payload.location,
        battery: Number(payload.battery ?? 100),
        batteryHealth: Number(payload.batteryHealth ?? 100),
        status: payload.status || 'ready',
        target_location: payload.target_location || null,
        origin_location: payload.origin_location || null,
        time_of_arrival: payload.time_of_arrival || null,
        relocationRoute: Array.isArray(payload.relocationRoute) ? payload.relocationRoute.filter(Boolean) : [],
        recommendedRelocationRoute: Array.isArray(payload.recommendedRelocationRoute) ? payload.recommendedRelocationRoute.filter(Boolean) : [],
        relocationDistanceKm: payload.relocationDistanceKm ?? null,
        relocationRemainingDistanceKm: payload.relocationRemainingDistanceKm ?? payload.relocationDistanceKm ?? null,
        relocationRouteState: payload.relocationRouteState || 'CLEAR',
        relocationWeatherState: payload.relocationWeatherState || 'CLEAR',
        relocationWarnings: Array.isArray(payload.relocationWarnings) ? payload.relocationWarnings : [],
        relocationRecommendedAction: payload.relocationRecommendedAction || '',
        relocationRerouteCount: Number(payload.relocationRerouteCount || 0),
        lastRelocationReroutedAt: payload.lastRelocationReroutedAt ? new Date(payload.lastRelocationReroutedAt) : null,
        assignment: payload.assignment || null,
        speed: Number(payload.speed || 0),
    };
}

function clearDroneRelocationState(drone) {
    return {
        ...drone,
        relocationRoute: [],
        recommendedRelocationRoute: [],
        relocationDistanceKm: null,
        relocationRemainingDistanceKm: null,
        relocationRouteState: 'CLEAR',
        relocationWeatherState: 'CLEAR',
        relocationWarnings: [],
        relocationRecommendedAction: '',
        relocationRerouteCount: 0,
        lastRelocationReroutedAt: null,
    };
}

function buildDeliveryPayload(payload) {
    const estimatedMinutes = Number(payload.estimated_time_minutes || payload.estimatedMinutes || 120);
    const route = Array.isArray(payload.route) ? payload.route.filter(Boolean) : [];
    const totalLegs = Number(payload.estimated_legs || payload.totalLegs || Math.max(route.length - 1, 1));
    const currentLeg = Number(payload.currentLeg ?? 0);

    return {
        id: payload.id,
        payload: payload.payload,
        origin: payload.origin || 'Chibougamau Hub',
        destination: payload.destination,
        priority: payload.priority || 'Routine',
        status: DELIVERY_STATUSES.includes(payload.status) ? payload.status : 'PENDING_DISPATCH',
        currentLeg,
        totalLegs,
        lastStation: payload.lastStation || payload.origin || 'Chibougamau Hub',
        eta: payload.eta ? new Date(payload.eta) : generateETA(estimatedMinutes),
        solanaTx: payload.solanaTx || `tx_${Math.random().toString(36).slice(2, 10)}...`,
        route,
        reasoning: payload.reasoning || '',
        estimatedTime: payload.estimatedTime || formatEstimatedTime(estimatedMinutes),
        estimatedMinutes,
        routeDistanceKm: payload.routeDistanceKm ?? null,
        remainingDistanceKm: payload.remainingDistanceKm ?? payload.routeDistanceKm ?? null,
        weightKg: payload.weightKg ?? payload.weight_kg ?? null,
        routeState: payload.routeState || 'CLEAR',
        weatherState: payload.weatherState || 'CLEAR',
        routeWarnings: Array.isArray(payload.routeWarnings) ? payload.routeWarnings : [],
        recommendedAction: payload.recommendedAction || '',
        recommendedRoute: Array.isArray(payload.recommendedRoute) ? payload.recommendedRoute.filter(Boolean) : route,
        manualAttentionRequired: Boolean(payload.manualAttentionRequired),
        rerouteCount: Number(payload.rerouteCount || 0),
        lastReroutedAt: payload.lastReroutedAt ? new Date(payload.lastReroutedAt) : null,
        events: normalizeEvents(payload.events),
    };
}

function setIfChanged(doc, key, value) {
    const current = doc.get(key);
    if (JSON.stringify(current) === JSON.stringify(value)) return false;
    doc.set(key, value);
    return true;
}

function buildDeliveryUpdate(current, planned) {
    const merged = {
        ...current,
        ...planned,
        status: current.status === 'DELIVERED' ? 'DELIVERED' : planned.status,
        currentLeg: current.status === 'DELIVERED'
            ? Math.max(current.totalLegs || 0, planned.totalLegs || 0)
            : Number(current.currentLeg || planned.currentLeg || 0),
        totalLegs: planned.totalLegs || current.totalLegs,
        lastStation: current.status === 'DELIVERED'
            ? current.destination
            : current.currentLeg > 0
                ? current.lastStation || current.origin
                : current.origin || planned.origin,
        eta: current.status === 'DELIVERED'
            ? current.eta
            : generateETA(planned.estimatedMinutes || current.estimatedMinutes || 120),
        solanaTx: current.solanaTx,
        createdAt: current.createdAt,
    };

    return buildDeliveryPayload(merged);
}

async function syncOperationalDeliveries(deliveryDocs, stations, lines, weatherByStation) {
    const serialized = [];

    for (const deliveryDoc of deliveryDocs) {
        const current = serializeDoc(deliveryDoc);
        const planned = planDeliveryOperation({
            deliveryInput: current,
            stations,
            lines,
            weatherByStation,
            mode: 'automatic',
        });

        const next = buildDeliveryUpdate(current, planned);
        // Overview reads should stay read-only. Persisting weather-derived updates during
        // GET requests causes race conditions when multiple panels fetch deliveries at once.
        serialized.push(next);
    }

    return serialized.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

async function syncOperationalDrones(droneDocs, stations, lines, weatherByStation) {
    return droneDocs.map((droneDoc) => {
        const current = buildDronePayload(droneDoc);

        if (current.status !== 'relocating' || !current.target_location) {
            return current;
        }

        try {
            const planned = planDroneRelocation({
                droneInput: current,
                stations,
                lines,
                weatherByStation,
                mode: 'automatic',
            });

            return {
                ...current,
                ...planned,
                relocationReport: buildDroneRelocationReport(planned, weatherByStation),
            };
        } catch (err) {
            return {
                ...current,
                relocationRouteState: 'BLOCKED',
                relocationWeatherState: 'SEVERE',
                relocationWarnings: [{
                    stationId: current.target_location,
                    severity: 'SEVERE',
                    title: 'Relocation route unavailable',
                    detail: err.message,
                    issues: [err.message],
                    summary: err.message,
                }],
                relocationRecommendedAction: err.message,
                relocationReport: {
                    droneId: current.id,
                    routeState: 'BLOCKED',
                    statusTone: 'danger',
                    headline: 'Relocation route unavailable',
                    summary: err.message,
                    operationalEffect: 'The drone cannot continue on a connected corridor under the current graph and weather conditions.',
                    severeCount: 1,
                    unstableCount: 0,
                    watchCount: 0,
                    impactedStops: 1,
                    routeDistanceKm: current.relocationDistanceKm ?? null,
                    remainingDistanceKm: current.relocationRemainingDistanceKm ?? current.relocationDistanceKm ?? null,
                    routePreview: `${current.origin_location || current.location} → ${current.target_location}`,
                    routeStops: Array.isArray(current.relocationRoute) ? current.relocationRoute.length : 0,
                    rerouteActive: false,
                    manualRerouteSuggested: false,
                    manualRerouteHint: 'No safer relocation corridor is currently available.',
                    recommendedAction: err.message,
                    topWarning: {
                        stationId: current.target_location,
                        detail: err.message,
                    },
                    weatherSignals: [],
                },
            };
        }
    });
}

async function buildOperationalOverview() {
    const [deliveryDocs, stations, droneDocs, lines] = await Promise.all([
        Delivery.find({}).sort({ createdAt: -1 }),
        Station.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Drone.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Line.find({}, '-_id -__v -createdAt -updatedAt').lean(),
    ]);

    const weather = await getWeatherSnapshots(stations);
    const weatherStations = [...weather.stations].sort((left, right) => right.riskScore - left.riskScore);
    const weatherByStation = buildWeatherIndex(weatherStations);
    const deliveries = await syncOperationalDeliveries(deliveryDocs, stations, lines, weatherByStation);
    const drones = await syncOperationalDrones(droneDocs, stations, lines, weatherByStation);
    const metrics = buildOverviewMetrics({ deliveries, stations, weatherStations });
    const notifications = buildAdminNotifications(deliveries);
    const recommendation = buildDefaultRecommendation({ notifications, metrics, weatherStations });
    const highlightPriority = ['REROUTED', 'WEATHER_HOLD', 'IN_TRANSIT', 'HANDOFF', 'READY_TO_LAUNCH', 'PENDING_DISPATCH', 'AWAITING_REVIEW'];
    const highlightedDeliveryId = highlightPriority
        .map((status) => deliveries.find((delivery) => delivery.status === status)?.id)
        .find(Boolean)
        || deliveries[0]?.id
        || null;

    return {
        updatedAt: new Date().toISOString(),
        deliveries,
        stations,
        drones,
        lines,
        weather: {
            updatedAt: weather.updatedAt,
            source: weather.source,
            stations: weatherStations,
        },
        metrics,
        notifications,
        recommendation,
        highlightedDeliveryId,
    };
}

async function buildPathInsightPayload(deliveryId) {
    const overview = await buildOperationalOverview();
    const delivery = overview.deliveries.find((entry) => entry.id === deliveryId);

    if (!delivery) {
        return null;
    }

    const weatherByStation = buildWeatherIndex(overview.weather.stations);
    const pathReport = buildPathWeatherReport(delivery, weatherByStation);
    const insight = await getPathOperationalInsights({
        delivery,
        pathReport,
    });

    return {
        delivery,
        ...insight,
    };
}

function buildAnalyticsPrompt({ deliveries, stations, drones, weatherStations }) {
    const deliverySummary = deliveries
        .map((delivery) => `${delivery.id}: ${delivery.payload} from ${delivery.origin} to ${delivery.destination}, status=${delivery.status}, priority=${delivery.priority}, eta=${delivery.estimatedTime}`)
        .join('\n');
    const stationSummary = stations
        .map((station) => `${station.id}: type=${station.type}, status=${station.status}, battery=${station.battery}%, temp=${station.temp}°C`)
        .join('\n');
    const droneSummary = drones
        .map((drone) => `${drone.id} (${drone.name}): status=${drone.status}, battery=${drone.battery}%, location=${drone.location}`)
        .join('\n');
    const weatherSummary = weatherStations
        .slice(0, 8)
        .map((station) => `${station.stationId}: ${station.condition}, ${station.summary}`)
        .join('\n');

    return `You are the Aero'ed Corridor Intelligence Engine — an analytics assistant for a medical drone relay corridor in Northern Quebec, Canada.

Use the live records below to answer questions about deliveries, weather risk, fleet status, corridor resilience, and operational analytics. Answer concisely and compute metrics from the records when asked.

DELIVERIES:
${deliverySummary || 'No deliveries yet.'}

STATIONS:
${stationSummary || 'No stations configured.'}

DRONES:
${droneSummary || 'No drones registered.'}

WEATHER WATCH:
${weatherSummary || 'No weather observations available.'}

Business context:
- Aero'ed orchestrates relay-style medical drone corridors for remote Northern Quebec communities.
- Each relay leg is roughly 15-20 km with battery swaps at each node.
- Weather, handoff continuity, and route resilience are the core operator concerns.
- Savings should be explained relative to charter or helicopter alternatives when relevant.

Keep answers to 2-6 sentences and use light markdown only when it improves clarity.`;
}

const GEMINI_DISPATCH_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['payload', 'weight_kg', 'origin', 'destination', 'priority', 'route', 'estimated_legs', 'estimated_time_minutes', 'reasoning'],
    properties: {
        payload: { type: 'string' },
        weight_kg: { type: 'number' },
        origin: { type: 'string' },
        destination: { type: 'string' },
        priority: { type: 'string', enum: ['Routine', 'Urgent', 'Emergency'] },
        route: { type: 'array', items: { type: 'string' } },
        estimated_legs: { type: 'number' },
        estimated_time_minutes: { type: 'number' },
        reasoning: { type: 'string' },
    },
};

async function getRoutingContext() {
    const [stations, lines] = await Promise.all([
        Station.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Line.find({}, '-_id -__v -createdAt -updatedAt').lean(),
    ]);
    const weather = await getWeatherSnapshots(stations);

    return {
        stations,
        lines,
        weather,
        weatherByStation: buildWeatherIndex(weather.stations),
    };
}

function buildDispatchPlanningPrompt(userPrompt, stations, weatherStations) {
    const relevantStations = stations
        .filter((station) => ['distribution', 'transit', 'pick_up'].includes(station.type))
        .map((station) => {
            const weather = weatherStations.find((entry) => entry.stationId === station.id);
            const weatherNote = weather && weather.condition !== 'CLEAR'
                ? `, weather=${weather.condition}, issue=${weather.issues?.[0] || weather.summary}`
                : '';
            return `- ${station.id}: type=${station.type}, status=${station.status}${weatherNote}`;
        })
        .join('\n');

    const destinations = stations
        .filter((station) => station.type !== 'distribution')
        .map((station) => station.id)
        .join(', ');

    return `You are the Aero'ed AI Dispatch Engine for a medical drone relay corridor in Northern Quebec.

Parse the user request into a structured dispatch manifest. Use only the listed corridor nodes. If the request is vague, infer the most reasonable medical payload and priority. Mention weather or maintenance risk in the reasoning when relevant.

LIVE NETWORK STATE:
${relevantStations}

AVAILABLE DESTINATIONS:
${destinations}

Return only JSON that matches the required schema.

USER REQUEST:
${userPrompt}`;
}

function buildFallbackDispatchPlan(prompt, stations) {
    const normalizedPrompt = String(prompt || '').trim();
    const lowerPrompt = normalizedPrompt.toLowerCase();
    const destinations = stations.filter((station) => station.type !== 'distribution').map((station) => station.id);
    const destination = destinations.find((stationId) => lowerPrompt.includes(stationId.toLowerCase())) || 'Chisasibi';
    const priority = /(emergency|stat|immediately|critical)/i.test(normalizedPrompt)
        ? 'Emergency'
        : /(urgent|tonight|asap|priority)/i.test(normalizedPrompt)
            ? 'Urgent'
            : 'Routine';
    const payloadMatch = normalizedPrompt.match(/(?:send|deliver|ship)\s+(.+?)(?:\s+from|\s+to|$)/i);
    const payload = payloadMatch?.[1]?.trim()
        ? payloadMatch[1].trim().replace(/\b\w/g, (character) => character.toUpperCase())
        : 'Medical supplies';
    const weightMatch = normalizedPrompt.match(/(\d+(?:\.\d+)?)\s*(kg|kilograms?)/i);
    const weightKg = weightMatch ? Number(weightMatch[1]) : priority === 'Emergency' ? 2 : 4;

    return {
        payload,
        weight_kg: weightKg,
        origin: 'Chibougamau Hub',
        destination,
        priority,
        route: ['Chibougamau Hub', destination],
        estimated_legs: 1,
        estimated_time_minutes: priority === 'Emergency' ? 70 : 95,
        reasoning: 'Gemini structured output was unavailable, so the backend generated a fallback manifest from the request text.',
        model: 'fallback-parser',
    };
}

function buildAvoidCombinations(route = []) {
    const internalStops = route.slice(1, -1);
    const combinations = [];

    internalStops.forEach((stationId, index) => {
        combinations.push([stationId]);
        for (let secondIndex = index + 1; secondIndex < internalStops.length; secondIndex += 1) {
            combinations.push([stationId, internalStops[secondIndex]]);
        }
    });

    return combinations;
}

function findDemoRoutePair(stations = [], lines = [], weatherByStation = {}) {
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    const origins = stations.filter((station) => station.type === 'distribution');
    const destinations = stations.filter((station) => station.type === 'pick_up');
    const candidateOrigins = origins.length > 0 ? origins : stations;
    const candidateDestinations = destinations.length > 0 ? destinations : stations;

    let bestPair = null;

    candidateOrigins.forEach((origin) => {
        candidateDestinations.forEach((destination) => {
            if (!origin?.id || !destination?.id || origin.id === destination.id) return;

            const bestRoute = findBestRoute({
                origin: origin.id,
                destination: destination.id,
                lines,
                stationsById,
                weatherByStation,
                mode: 'automatic',
            });

            if (bestRoute.length < 3) return;

            let alternateRoute = [];
            buildAvoidCombinations(bestRoute).forEach((avoidStations) => {
                const candidateRoute = findBestRoute({
                    origin: origin.id,
                    destination: destination.id,
                    lines,
                    stationsById,
                    weatherByStation,
                    avoidStations,
                    mode: 'automatic',
                });

                if (
                    candidateRoute.length > bestRoute.length
                    && JSON.stringify(candidateRoute) !== JSON.stringify(bestRoute)
                    && candidateRoute[0] === origin.id
                    && candidateRoute[candidateRoute.length - 1] === destination.id
                    && (alternateRoute.length === 0 || candidateRoute.length > alternateRoute.length)
                ) {
                    alternateRoute = candidateRoute;
                }
            });

            if (!alternateRoute.length) return;

            const score = alternateRoute.length - bestRoute.length;
            if (!bestPair || score > bestPair.score) {
                bestPair = {
                    origin: origin.id,
                    destination: destination.id,
                    bestRoute,
                    alternateRoute,
                    score,
                };
            }
        });
    });

    return bestPair;
}

function buildDemoDeliveryScenario({ scenario = 'random', stations = [], lines = [], weatherByStation = {} }) {
    const normalizedScenario = scenario === 'random'
        ? (Math.random() > 0.5 ? 'bad-path' : 'good-path')
        : scenario;
    const routePair = findDemoRoutePair(stations, lines, weatherByStation);

    if (!routePair) {
        throw new Error('A demo bad-path mission requires at least one origin/destination pair with an alternate route in the current DB.');
    }

    const route = normalizedScenario === 'bad-path'
        ? routePair.alternateRoute
        : routePair.bestRoute;
    const priority = normalizedScenario === 'bad-path' ? 'Urgent' : 'Routine';
    const payload = normalizedScenario === 'bad-path'
        ? 'Demo urgent blood products'
        : 'Demo vaccine restock';
    const reasoning = normalizedScenario === 'bad-path'
        ? `Demo scenario: the mission is intentionally staged on a longer valid corridor from ${routePair.origin} to ${routePair.destination} so manual reroute can move it onto the preferred path.`
        : `Demo scenario: the mission is already using the preferred corridor from ${routePair.origin} to ${routePair.destination}.`;

    return {
        scenario: normalizedScenario,
        payload,
        origin: routePair.origin,
        destination: routePair.destination,
        priority,
        status: 'READY_TO_LAUNCH',
        currentLeg: 0,
        lastStation: routePair.origin,
        route,
        reasoning,
        solanaTx: `demo_${Math.random().toString(36).slice(2, 10)}`,
    };
}

async function seedData() {
    const droneOps = SEED_DRONES.map((drone) => ({
        updateOne: {
            filter: { id: drone.id },
            update: { $set: drone },
            upsert: true,
        },
    }));
    await Drone.bulkWrite(droneOps);
    console.log('Drones synced.');

    const stationOps = SEED_STATIONS.map((station) => ({
        updateOne: {
            filter: { id: station.id },
            update: { $set: station },
            upsert: true,
        },
    }));
    await Station.bulkWrite(stationOps);
    console.log('Stations synced.');

    const lineOps = SEED_LINES.map((line) => ({
        updateOne: {
            filter: { id: line.id },
            update: { $set: line },
            upsert: true,
        },
    }));
    await Line.bulkWrite(lineOps);
    console.log('Lines synced.');

    const deliveryOps = SEED_DELIVERIES.map((delivery) => ({
        updateOne: {
            filter: { id: delivery.id },
            update: {
                $set: {
                    id: delivery.id,
                    ...buildDeliveryPayload(delivery),
                    createdAt: delivery.createdAt,
                },
            },
            upsert: true,
        },
    }));
    await Delivery.bulkWrite(deliveryOps);
    console.log('Deliveries synced.');
}

function shouldAutoSeed() {
    return String(process.env.AUTO_SEED_DEMO_DATA || '').trim().toLowerCase() === 'true';
}

app.get('/api/lines', async (req, res) => {
    try {
        const lines = await Line.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(lines);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/lines', async (req, res) => {
    try {
        const line = new Line(req.body);
        await line.save();
        res.status(201).json(serializeDoc(line));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/lines/:id', async (req, res) => {
    try {
        const line = await Line.findOne({ id: req.params.id });
        if (!line) return res.status(404).json({ error: 'Line not found.' });
        const { name, color, stations } = req.body;
        if (name !== undefined) line.name = name;
        if (color !== undefined) line.color = color;
        if (stations !== undefined) line.stations = stations;
        await line.save();
        res.json(serializeDoc(line));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/lines/:id/stations', async (req, res) => {
    try {
        const line = await Line.findOne({ id: req.params.id });
        if (!line) {
            return res.status(404).json({ error: 'Line not found.' });
        }

        line.stations = req.body.stations;
        await line.save();
        res.json(serializeDoc(line));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.delete('/api/lines/:id', async (req, res) => {
    try {
        const line = await Line.findOneAndDelete({ id: req.params.id });
        if (!line) {
            return res.status(404).json({ error: 'Line not found.' });
        }

        res.json({ success: true, id: req.params.id });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/stations', async (req, res) => {
    try {
        const stations = await Station.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(stations);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/stations', async (req, res) => {
    try {
        const station = new Station(req.body);
        await station.save();
        res.status(201).json(serializeDoc(station));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/stations/:id', async (req, res) => {
    try {
        const station = await Station.findOne({ id: req.params.id });
        if (!station) return res.status(404).json({ error: 'Station not found.' });
        const fields = ['type', 'status', 'battery', 'temp', 'lat', 'lng', 'max_drone_capacity'];
        fields.forEach(f => { if (req.body[f] !== undefined) station[f] = req.body[f]; });
        await station.save();
        res.json(serializeDoc(station));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.delete('/api/stations/:id', async (req, res) => {
    try {
        const stationId = req.params.id;
        const station = await Station.findOneAndDelete({ id: stationId });
        if (!station) {
            return res.status(404).json({ error: 'Station not found.' });
        }

        await Line.updateMany(
            { stations: stationId },
            { $pull: { stations: stationId } }
        );

        const affectedDrones = await Drone.find({
            $or: [
                { location: stationId },
                { target_location: stationId },
                { origin_location: stationId },
            ],
        });

        const updatedDrones = [];
        for (const drone of affectedDrones) {
            if (drone.location === stationId) {
                drone.location = 'Unassigned';
            }

            if (drone.target_location === stationId) {
                drone.target_location = null;
                drone.time_of_arrival = null;
                drone.speed = 0;
                drone.assignment = null;
                drone.relocationRoute = [];
                drone.recommendedRelocationRoute = [];
                drone.relocationDistanceKm = null;
                drone.relocationRemainingDistanceKm = null;
                drone.relocationRouteState = 'CLEAR';
                drone.relocationWeatherState = 'CLEAR';
                drone.relocationWarnings = [];
                drone.relocationRecommendedAction = '';
                drone.relocationRerouteCount = 0;
                drone.lastRelocationReroutedAt = null;
                if (['on_route', 'relocating'].includes(drone.status)) {
                    drone.status = 'ready';
                }
            }

            if (drone.origin_location === stationId) {
                drone.origin_location = null;
            }

            if (Array.isArray(drone.relocationRoute) && drone.relocationRoute.includes(stationId)) {
                drone.relocationRoute = drone.relocationRoute.filter((routeStationId) => routeStationId !== stationId);
            }

            if (Array.isArray(drone.recommendedRelocationRoute) && drone.recommendedRelocationRoute.includes(stationId)) {
                drone.recommendedRelocationRoute = drone.recommendedRelocationRoute.filter((routeStationId) => routeStationId !== stationId);
            }

            await drone.save();
            updatedDrones.push(serializeDoc(drone));
        }

        const lines = await Line.find({}, '-_id -__v -createdAt -updatedAt');

        res.json({
            success: true,
            id: stationId,
            lines,
            updatedDrones,
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/drones', async (req, res) => {
    try {
        const drones = await Drone.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(drones);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/drones', async (req, res) => {
    try {
        const existingIds = (await Drone.find({}, 'droneId')).map((drone) => drone.droneId);
        let droneId;
        do {
            droneId = Math.floor(1000 + Math.random() * 9000);
        } while (existingIds.includes(droneId));

        const drone = new Drone({
            ...req.body,
            id: `DRN-${droneId}`,
            droneId,
            assignment: null,
            speed: 0,
        });

        await drone.save();
        res.status(201).json(serializeDoc(drone));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/drones/:id', async (req, res) => {
    try {
        const drone = await Drone.findOne({ id: req.params.id });
        if (!drone) return res.status(404).json({ error: 'Drone not found.' });
        const fields = [
            'name',
            'model',
            'location',
            'battery',
            'batteryHealth',
            'status',
            'target_location',
            'origin_location',
            'time_of_arrival',
            'speed',
            'assignment',
            'relocationRoute',
            'recommendedRelocationRoute',
            'relocationDistanceKm',
            'relocationRemainingDistanceKm',
            'relocationRouteState',
            'relocationWeatherState',
            'relocationWarnings',
            'relocationRecommendedAction',
            'relocationRerouteCount',
            'lastRelocationReroutedAt',
        ];
        fields.forEach(f => { if (req.body[f] !== undefined) drone[f] = req.body[f]; });
        if (req.body.status && req.body.status !== 'relocating') {
            const cleared = clearDroneRelocationState(serializeDoc(drone));
            [
                'relocationRoute',
                'recommendedRelocationRoute',
                'relocationDistanceKm',
                'relocationRemainingDistanceKm',
                'relocationRouteState',
                'relocationWeatherState',
                'relocationWarnings',
                'relocationRecommendedAction',
                'relocationRerouteCount',
                'lastRelocationReroutedAt',
            ].forEach((field) => {
                drone[field] = cleared[field];
            });
        }
        if (req.body.status && !['on_route', 'relocating'].includes(req.body.status)) {
            drone.target_location = null;
            drone.origin_location = null;
            drone.time_of_arrival = null;
            drone.speed = 0;
        }
        await drone.save();
        res.json(serializeDoc(drone));
    } catch (err) {
        sendApiError(res, err);
    }
});

async function handleDroneRelocate(req, res) {
    try {
        const drone = await Drone.findOne({ id: req.params.id });
        if (!drone) return res.status(404).json({ error: 'Drone not found.' });

        const targetLocation = String(req.body?.targetLocation || req.body?.target_location || '').trim();
        if (!targetLocation) {
            return res.status(400).json({ error: 'A relocation target is required.' });
        }

        const currentDrone = serializeDoc(drone);
        const { stations, lines, weather, weatherByStation } = await getRoutingContext();
        const currentLocationStation = stations.find((station) => station.id === currentDrone.location);
        const fallbackOrigin = currentLocationStation?.id
            || currentDrone.target_location
            || currentDrone.origin_location
            || currentDrone.location;
        const planned = planDroneRelocation({
            droneInput: {
                ...currentDrone,
                origin_location: fallbackOrigin,
                target_location: targetLocation,
                speed: req.body?.speed ?? currentDrone.speed ?? 80,
            },
            stations,
            lines,
            weatherByStation,
            mode: 'automatic',
        });

        [
            'location',
            'status',
            'target_location',
            'origin_location',
            'time_of_arrival',
            'relocationRoute',
            'recommendedRelocationRoute',
            'relocationDistanceKm',
            'relocationRemainingDistanceKm',
            'relocationRouteState',
            'relocationWeatherState',
            'relocationWarnings',
            'relocationRecommendedAction',
            'relocationRerouteCount',
            'lastRelocationReroutedAt',
            'assignment',
            'speed',
        ].forEach((field) => {
            drone.set(field, planned[field]);
        });

        await drone.save();
        const serializedDrone = serializeDoc(drone);
        res.json({
            drone: serializedDrone,
            relocationReport: buildDroneRelocationReport(serializedDrone, weatherByStation),
            decision: {
                status: 'planned',
                summary: 'Relocation dispatched',
                detail: `Drone ${serializedDrone.id} is now following ${planned.relocationRoute.length}-stop corridor to ${serializedDrone.target_location}.`,
            },
            weather: {
                updatedAt: weather.updatedAt,
                source: weather.source,
                stations: weather.stations,
            },
        });
    } catch (err) {
        sendApiError(res, err);
    }
}

async function handleDroneReroute(req, res) {
    try {
        const drone = await Drone.findOne({ id: req.params.id });
        if (!drone) return res.status(404).json({ error: 'Drone not found.' });

        const currentDrone = serializeDoc(drone);
        if (currentDrone.status !== 'relocating' || !currentDrone.target_location) {
            return res.status(400).json({
                error: 'Only relocating drones can be rerouted.',
                decision: {
                    status: 'rejected',
                    summary: 'Drone reroute rejected',
                    detail: 'The selected drone is not currently relocating on a corridor.',
                },
            });
        }

        const { stations, lines, weather, weatherByStation } = await getRoutingContext();
        const planned = planDroneRelocation({
            droneInput: currentDrone,
            stations,
            lines,
            weatherByStation,
            mode: 'manual',
            avoidStationIds: Array.isArray(req.body?.avoidStationIds) ? req.body.avoidStationIds : [],
        });

        const currentRoute = Array.isArray(currentDrone.relocationRoute) ? currentDrone.relocationRoute : [];
        const routeChanged = JSON.stringify(planned.relocationRoute) !== JSON.stringify(currentRoute);
        if (!routeChanged) {
            return res.json({
                drone: currentDrone,
                relocationReport: buildDroneRelocationReport(currentDrone, weatherByStation),
                decision: {
                    status: planned.decisionStatus || 'rejected',
                    summary: planned.decisionSummary || 'Drone reroute rejected',
                    detail: planned.decisionDetail || 'No relocation route change was applied.',
                    bestAvailableRoute: planned.recommendedRelocationRoute || currentRoute,
                },
                weather: {
                    updatedAt: weather.updatedAt,
                    source: weather.source,
                    stations: weather.stations,
                },
            });
        }

        [
            'location',
            'status',
            'target_location',
            'origin_location',
            'time_of_arrival',
            'relocationRoute',
            'recommendedRelocationRoute',
            'relocationDistanceKm',
            'relocationRemainingDistanceKm',
            'relocationRouteState',
            'relocationWeatherState',
            'relocationWarnings',
            'relocationRecommendedAction',
            'relocationRerouteCount',
            'lastRelocationReroutedAt',
            'assignment',
            'speed',
        ].forEach((field) => {
            drone.set(field, planned[field]);
        });

        await drone.save();

        const serializedDrone = serializeDoc(drone);
        res.json({
            drone: serializedDrone,
            relocationReport: buildDroneRelocationReport(serializedDrone, weatherByStation),
            decision: {
                status: planned.decisionStatus || 'rerouted',
                summary: planned.decisionSummary || 'Drone reroute approved',
                detail: planned.decisionDetail || `Relocation updated to ${planned.relocationRoute.join(' → ')}.`,
                bestAvailableRoute: planned.recommendedRelocationRoute || planned.relocationRoute,
            },
            weather: {
                updatedAt: weather.updatedAt,
                source: weather.source,
                stations: weather.stations,
            },
        });
    } catch (err) {
        sendApiError(res, err);
    }
}

app.post('/api/drones/:id/relocate', handleDroneRelocate);

app.post('/api/drones/:id/reroute', handleDroneReroute);

app.delete('/api/drones/:id', async (req, res) => {
    try {
        const drone = await Drone.findOneAndDelete({ id: req.params.id });
        if (!drone) {
            return res.status(404).json({ error: 'Drone not found.' });
        }

        res.json({ success: true, id: req.params.id });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/deliveries', async (req, res) => {
    try {
        const overview = await buildOperationalOverview();
        res.json(overview.deliveries);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/dispatch/plan', async (req, res) => {
    try {
        const prompt = String(req.body?.prompt || '').trim();
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }

        const { stations, weather } = await getRoutingContext();
        try {
            const geminiResult = await callGeminiJson(
                buildDispatchPlanningPrompt(prompt, stations, weather.stations),
                GEMINI_DISPATCH_SCHEMA,
                {
                    maxOutputTokens: 600,
                    thinkingLevel: 'minimal',
                }
            );

            return res.json({
                ...geminiResult.data,
                model: geminiResult.model,
            });
        } catch (geminiError) {
            console.warn('Gemini dispatch planning fallback:', geminiError.message);
            return res.json(buildFallbackDispatchPlan(prompt, stations));
        }
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/deliveries', async (req, res) => {
    try {
        const { stations, lines, weather, weatherByStation } = await getRoutingContext();
        const planned = planDeliveryOperation({
            deliveryInput: req.body,
            stations,
            lines,
            weatherByStation,
            mode: 'automatic',
        });

        if (!planned.route.length && !['AWAITING_REVIEW', 'REJECTED'].includes(planned.status)) {
            return res.status(400).json({ error: 'No viable route could be planned for this delivery.' });
        }

        const delivery = new Delivery({
            ...buildDeliveryPayload({
                ...req.body,
                ...planned,
                eta: generateETA(planned.estimatedMinutes),
            }),
            id: await generateUniqueId(Delivery, 'RLY'),
        });

        await delivery.save();
        res.status(201).json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/demo/deliveries', async (req, res) => {
    try {
        const scenario = String(req.body?.scenario || 'random').trim().toLowerCase();
        const { stations, lines, weatherByStation } = await getRoutingContext();
        const demoInput = buildDemoDeliveryScenario({
            scenario,
            stations,
            lines,
            weatherByStation,
        });
        const planned = planDeliveryOperation({
            deliveryInput: demoInput,
            stations,
            lines,
            weatherByStation,
            mode: 'automatic',
        });

        const delivery = new Delivery({
            ...buildDeliveryPayload({
                ...demoInput,
                ...planned,
                eta: generateETA(planned.estimatedMinutes),
            }),
            id: await generateUniqueId(Delivery, 'RLY'),
        });

        await delivery.save();
        res.status(201).json({
            scenario: demoInput.scenario,
            delivery: serializeDoc(delivery),
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.delete('/api/deliveries/:id', async (req, res) => {
    try {
        const delivery = await Delivery.findOneAndDelete({ id: req.params.id });
        if (!delivery) {
            return res.status(404).json({ error: 'Delivery not found.' });
        }

        res.json({
            deleted: true,
            deliveryId: req.params.id,
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/deliveries/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!DELIVERY_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid delivery status.' });
        }

        const delivery = await Delivery.findOne({ id: req.params.id });
        if (!delivery) {
            return res.status(404).json({ error: 'Delivery not found.' });
        }

        delivery.status = status;
        if (status === 'DELIVERED') {
            delivery.currentLeg = delivery.totalLegs;
            delivery.lastStation = delivery.destination;
            delivery.routeState = 'CLEAR';
            delivery.weatherState = 'CLEAR';
            delivery.routeWarnings = [];
            delivery.manualAttentionRequired = false;
            delivery.events = [
                ...(delivery.events || []),
                {
                    type: 'DELIVERED',
                    title: 'Payload received',
                    detail: `Delivery confirmed at ${delivery.destination}.`,
                    timestamp: new Date(),
                    stationId: delivery.destination,
                },
            ];
        }

        await delivery.save();
        res.json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/deliveries/:id/reroute', async (req, res) => {
    try {
        const delivery = await Delivery.findOne({ id: req.params.id });
        if (!delivery) {
            return res.status(404).json({ error: 'Delivery not found.' });
        }

        const currentDelivery = serializeDoc(delivery);
        const { stations, lines, weather, weatherByStation } = await getRoutingContext();
        const planned = planDeliveryOperation({
            deliveryInput: currentDelivery,
            stations,
            lines,
            weatherByStation,
            mode: 'manual',
            avoidStationIds: Array.isArray(req.body.avoidStationIds) ? req.body.avoidStationIds : [],
        });

        const currentRoute = Array.isArray(currentDelivery.route) ? currentDelivery.route : [];
        const routeChanged = JSON.stringify(planned.route) !== JSON.stringify(currentRoute);
        if (!routeChanged) {
            return res.json({
                delivery: currentDelivery,
                decision: {
                    status: planned.decisionStatus || 'rejected',
                    summary: planned.decisionSummary || 'Manual reroute rejected',
                    detail: planned.decisionDetail || 'No route change was applied.',
                    bestAvailableRoute: planned.bestAvailableRoute || currentRoute,
                },
            });
        }

        const next = buildDeliveryUpdate(currentDelivery, planned);
        [
            'payload',
            'origin',
            'destination',
            'priority',
            'status',
            'currentLeg',
            'totalLegs',
            'lastStation',
            'eta',
            'route',
            'reasoning',
            'estimatedTime',
            'estimatedMinutes',
            'routeDistanceKm',
            'remainingDistanceKm',
            'routeState',
            'weatherState',
            'routeWarnings',
            'recommendedAction',
            'recommendedRoute',
            'manualAttentionRequired',
            'rerouteCount',
            'lastReroutedAt',
            'events',
        ].forEach((key) => {
            delivery.set(key, next[key]);
        });

        await delivery.save();

        res.json({
            delivery: serializeDoc(delivery),
            decision: {
                status: planned.decisionStatus || 'rerouted',
                summary: planned.decisionSummary || 'Manual reroute approved',
                detail: planned.decisionDetail || `Route updated to ${planned.route.join(' → ')}.`,
                bestAvailableRoute: planned.bestAvailableRoute || planned.route,
            },
            weather: {
                updatedAt: weather.updatedAt,
                source: weather.source,
                stations: weather.stations,
            },
            notification: buildAdminNotifications([serializeDoc(delivery)])[0] || null,
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/ops/overview', async (req, res) => {
    try {
        const overview = await buildOperationalOverview();
        res.json(overview);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/ops/path-insight/:id', async (req, res) => {
    try {
        const payload = await buildPathInsightPayload(req.params.id);
        if (!payload) {
            return res.status(404).json({ error: 'Delivery not found.' });
        }

        res.json({
            ...payload,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/ops/insight', async (req, res) => {
    try {
        const overview = await buildOperationalOverview();
        const insight = await getOperationalInsights({
            recommendation: overview.recommendation,
            metrics: overview.metrics,
            notifications: overview.notifications,
            weatherStations: overview.weather.stations,
        });

        res.json({
            ...insight,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/cortex/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message required.' });
    }

    try {
        const overview = await buildOperationalOverview();
        const messages = [
            {
                role: 'system',
                content: buildAnalyticsPrompt({
                    deliveries: overview.deliveries.slice(0, 50),
                    stations: overview.stations,
                    drones: overview.drones,
                    weatherStations: overview.weather.stations,
                }),
            },
            ...history.map((entry) => ({ role: entry.role, content: entry.content })),
            { role: 'user', content: message },
        ];

        const cortexResult = await callSnowflakeCortex(messages, {
            temperature: 0.3,
            maxCompletionTokens: 1024,
        });

        if (!cortexResult.available) {
            return res.status(500).json({ error: cortexResult.content });
        }

        res.json({
            reply: cortexResult.content,
            model: cortexResult.model,
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB Atlas.');
        if (shouldAutoSeed()) {
            await seedData();
        } else {
            console.log('Skipping demo data seed. Set AUTO_SEED_DEMO_DATA=true to reseed on startup.');
        }
        await buildOperationalOverview();
        app.listen(3001, () => console.log('API server running on http://localhost:3001'));
    })
    .catch((err) => {
        console.error('MongoDB connection failed:', err.message);
        process.exit(1);
    });
