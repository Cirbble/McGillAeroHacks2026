import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
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
import { createSolanaAttestation, deriveDeliveryPda, getSolanaAuthorityStatus } from './services/solana.js';
import { buildWeatherIndex, getWeatherSnapshots } from './services/weather.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env'), override: true });

const app = express();
app.use(cors());
app.use(express.json());

const REQUEST_LANGUAGE_LABELS = {
    en: 'English',
    fr: 'French',
    iu: 'Inuktitut',
};
const REQUEST_SPEECH_LOCALES = {
    en: 'en-US',
    fr: 'fr-CA',
    iu: 'iu-Cans-CA',
};
const SOLANA_BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SOLANA_BASE58_LOOKUP = Object.fromEntries([...SOLANA_BASE58_ALPHABET].map((character, index) => [character, index]));
const MISSION_LEG_INTERVAL_MS = 15000;
const OPERATIONS_RECONCILE_INTERVAL_MS = 5000;
const DELIVERY_SYNC_FIELDS = [
    'payload',
    'origin',
    'destination',
    'priority',
    'assignedDrone',
    'requestedBy',
    'requestedByEmail',
    'clinic',
    'clinicNotes',
    'sourceText',
    'geminiSummary',
    'severityScore',
    'status',
    'currentLeg',
    'totalLegs',
    'lastStation',
    'eta',
    'solanaTx',
    'solanaNetwork',
    'solanaSlot',
    'solanaProgram',
    'solanaMemo',
    'solanaAccountPda',
    'solanaExplorerUrl',
    'solanaOnChain',
    'solanaAttestedAt',
    'solanaAttestationError',
    'route',
    'reasoning',
    'estimatedTime',
    'estimatedMinutes',
    'routeDistanceKm',
    'remainingDistanceKm',
    'cruiseSpeedKph',
    'speedSource',
    'baseFlightMinutes',
    'weatherDelayMinutes',
    'handoffDelayMinutes',
    'weightKg',
    'routeState',
    'weatherState',
    'routeWarnings',
    'recommendedAction',
    'recommendedRoute',
    'manualAttentionRequired',
    'rerouteCount',
    'lastReroutedAt',
    'events',
];
const DRONE_LAUNCH_SPEEDS = {
    'DDC Sparrow': 72,
    'DDC Robin XL': 68,
    'DJI FlyCart 30': 58,
};

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

function makeDeliveryEvent(type, title, detail, stationId = null) {
    return {
        type,
        title,
        detail,
        timestamp: new Date(),
        stationId,
    };
}

function mergeDeliveryEvents(events = [], additions = []) {
    const existing = normalizeEvents(events);
    const seen = new Set(existing.map((event) => (
        `${event.type}:${event.title}:${event.detail}:${event.stationId || ''}`
    )));

    additions.forEach((event) => {
        if (!event?.type || !event?.title) return;
        const normalized = {
            ...event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        };
        const key = `${normalized.type}:${normalized.title}:${normalized.detail}:${normalized.stationId || ''}`;
        if (!seen.has(key)) {
            existing.push(normalized);
            seen.add(key);
        }
    });

    return existing.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function normalizeRequestLanguage(value = 'en') {
    return Object.prototype.hasOwnProperty.call(REQUEST_LANGUAGE_LABELS, value) ? value : 'en';
}

function getRequestLanguageLabel(value = 'en') {
    return REQUEST_LANGUAGE_LABELS[normalizeRequestLanguage(value)];
}

function getRequestSpeechLocale(value = 'en') {
    return REQUEST_SPEECH_LOCALES[normalizeRequestLanguage(value)] || REQUEST_SPEECH_LOCALES.en;
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

function hashString(value = '') {
    return [...String(value)].reduce((total, character, index) => (
        (total + (character.charCodeAt(0) * (index + 17))) % 2147483647
    ), 0);
}

function hashSeedToBytes(seed, byteLength = 32) {
    const chunks = [];
    let remaining = byteLength;
    let counter = 0;

    while (remaining > 0) {
        const digest = createHash('sha256')
            .update(`${seed}:${counter}`)
            .digest();
        const sliceLength = Math.min(remaining, digest.length);
        chunks.push(digest.subarray(0, sliceLength));
        remaining -= sliceLength;
        counter += 1;
    }

    return Buffer.concat(chunks, byteLength);
}

function encodeBase58(bytes) {
    if (!bytes || bytes.length === 0) return '';

    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            const value = (digits[index] * 256) + carry;
            digits[index] = value % 58;
            carry = Math.floor(value / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }

    let encoded = '';
    for (const byte of bytes) {
        if (byte !== 0) break;
        encoded += '1';
    }
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        encoded += SOLANA_BASE58_ALPHABET[digits[index]];
    }

    return encoded;
}

function decodeBase58(value = '') {
    if (!value) return Buffer.alloc(0);

    const bytes = [0];
    for (const character of String(value).trim()) {
        const carryValue = SOLANA_BASE58_LOOKUP[character];
        if (carryValue === undefined) {
            throw new Error(`Invalid base58 character: ${character}`);
        }

        let carry = carryValue;
        for (let index = 0; index < bytes.length; index += 1) {
            const nextValue = (bytes[index] * 58) + carry;
            bytes[index] = nextValue & 0xff;
            carry = nextValue >> 8;
        }

        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    let leadingZeroes = 0;
    for (const character of String(value).trim()) {
        if (character !== '1') break;
        leadingZeroes += 1;
    }

    const output = Buffer.alloc(leadingZeroes + bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
        output[output.length - 1 - index] = bytes[index];
    }
    return output;
}

function buildBase58Token(seed, byteLength = 32) {
    return encodeBase58(hashSeedToBytes(seed, byteLength));
}

function isValidBase58Token(value, byteLength) {
    try {
        return decodeBase58(value).length === byteLength;
    } catch {
        return false;
    }
}

function buildSolanaLedgerMetadata(payload = {}) {
    const seed = [
        payload.id,
        payload.payload,
        payload.origin,
        payload.destination,
        payload.requestedByEmail || payload.requestedBy || payload.clinic,
    ].filter(Boolean).join(':');
    const network = payload.solanaNetwork || 'devnet';
    const memo = payload.solanaMemo || `Aeroed custody ${payload.id || 'pending'} ${payload.origin || 'hub'}>${payload.destination || 'clinic'}`;
    const onChain = Boolean(payload.solanaOnChain);
    const tx = onChain && isValidBase58Token(String(payload.solanaTx || '').trim(), 64)
        ? String(payload.solanaTx || '').trim()
        : '';
    const slot = onChain && Number.isFinite(Number(payload.solanaSlot))
        ? Number(payload.solanaSlot)
        : null;
    const program = isValidBase58Token(String(payload.solanaProgram || '').trim(), 32)
        ? String(payload.solanaProgram || '').trim()
        : 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
    const accountPda = isValidBase58Token(String(payload.solanaAccountPda || '').trim(), 32)
        ? String(payload.solanaAccountPda || '').trim()
        : deriveDeliveryPda(payload);

    return {
        solanaTx: tx,
        solanaNetwork: network,
        solanaSlot: slot,
        solanaProgram: program,
        solanaMemo: memo,
        solanaAccountPda: accountPda,
        solanaExplorerUrl: onChain && tx ? `https://explorer.solana.com/tx/${tx}?cluster=${network}` : '',
        solanaOnChain: onChain,
        solanaAttestedAt: payload.solanaAttestedAt ? new Date(payload.solanaAttestedAt) : null,
        solanaAttestationError: payload.solanaAttestationError || '',
    };
}

function computeSeverityScore(payload = {}) {
    const numericScore = Number(payload.severityScore);
    if (Number.isFinite(numericScore) && numericScore > 0) {
        return Math.max(1, Math.min(5, Math.round(numericScore)));
    }

    const baseScore = payload.priority === 'Emergency'
        ? 5
        : payload.priority === 'Urgent'
            ? 4
            : 2;

    if (payload.routeState === 'BLOCKED' || payload.weatherState === 'SEVERE') {
        return Math.min(5, baseScore + 1);
    }
    if (payload.manualAttentionRequired || payload.weatherState === 'UNSTABLE') {
        return Math.min(5, baseScore + 1);
    }

    return baseScore;
}

function buildDeliveryPayload(payload) {
    const estimatedMinutes = Number(payload.estimated_time_minutes || payload.estimatedMinutes || 120);
    const route = Array.isArray(payload.route) ? payload.route.filter(Boolean) : [];
    const totalLegs = Number(payload.estimated_legs || payload.totalLegs || Math.max(route.length - 1, 1));
    const currentLeg = Number(payload.currentLeg ?? 0);
    const inferredOrigin = payload.origin || route[0] || '';
    const inferredDestination = payload.destination || route[route.length - 1] || '';
    const solanaLedger = buildSolanaLedgerMetadata(payload);
    const createdAt = payload.createdAt
        || payload.events?.[0]?.timestamp
        || payload.lastReroutedAt
        || new Date();

    return {
        id: payload.id,
        payload: payload.payload,
        origin: inferredOrigin,
        destination: inferredDestination,
        priority: payload.priority || 'Routine',
        assignedDrone: payload.assignedDrone || payload.assignment || null,
        requestedBy: payload.requestedBy || '',
        requestedByEmail: payload.requestedByEmail || '',
        clinic: payload.clinic || '',
        clinicNotes: payload.clinicNotes || '',
        sourceText: payload.sourceText || '',
        geminiSummary: payload.geminiSummary || '',
        severityScore: computeSeverityScore(payload),
        status: DELIVERY_STATUSES.includes(payload.status) ? payload.status : 'PENDING_DISPATCH',
        currentLeg,
        totalLegs,
        lastStation: payload.lastStation || inferredOrigin || route[Math.min(currentLeg, Math.max(route.length - 1, 0))] || '',
        eta: payload.eta ? new Date(payload.eta) : generateETA(estimatedMinutes),
        ...solanaLedger,
        route,
        reasoning: payload.reasoning || '',
        estimatedTime: payload.estimatedTime || formatEstimatedTime(estimatedMinutes),
        estimatedMinutes,
        routeDistanceKm: payload.routeDistanceKm ?? null,
        remainingDistanceKm: payload.remainingDistanceKm ?? payload.routeDistanceKm ?? null,
        cruiseSpeedKph: payload.cruiseSpeedKph ?? null,
        speedSource: payload.speedSource || '',
        baseFlightMinutes: payload.baseFlightMinutes ?? null,
        weatherDelayMinutes: Number(payload.weatherDelayMinutes || 0),
        handoffDelayMinutes: Number(payload.handoffDelayMinutes || 0),
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
        createdAt: new Date(createdAt),
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
        status: ['ARRIVED', 'DELIVERED'].includes(current.status) ? current.status : planned.status,
        currentLeg: ['ARRIVED', 'DELIVERED'].includes(current.status)
            ? Math.max(current.totalLegs || 0, planned.totalLegs || 0)
            : Number(current.currentLeg || planned.currentLeg || 0),
        totalLegs: planned.totalLegs || current.totalLegs,
        lastStation: ['ARRIVED', 'DELIVERED'].includes(current.status)
            ? current.destination
            : current.currentLeg > 0
                ? current.lastStation || current.origin
                : current.origin || planned.origin,
        eta: ['ARRIVED', 'DELIVERED'].includes(current.status)
            ? current.eta
            : generateETA(planned.estimatedMinutes || current.estimatedMinutes || 120),
        solanaTx: current.solanaTx,
        createdAt: current.createdAt,
    };

    return buildDeliveryPayload(merged);
}

const solanaAttestationJobs = new Map();

function isFundingBlockedAttestation(payload = {}) {
    return String(payload.solanaAttestationError || '').toLowerCase().includes('funding required');
}

function shouldAttestOnChain(delivery = {}) {
    return delivery.status === 'DELIVERED' && !delivery.solanaOnChain && !isFundingBlockedAttestation(delivery);
}

async function queueDeliveryAttestation(deliveryDoc, options = {}) {
    const currentState = deliveryDoc ? serializeDoc(deliveryDoc) : null;
    if (!deliveryDoc || (!options.force && !shouldAttestOnChain(currentState))) {
        return null;
    }

    if (solanaAttestationJobs.has(deliveryDoc.id)) {
        return solanaAttestationJobs.get(deliveryDoc.id);
    }

    const job = (async () => {
        try {
            const current = serializeDoc(deliveryDoc);
            deliveryDoc.solanaAttestationError = '';
            await deliveryDoc.save();
            const attestation = await createSolanaAttestation(current);
            const next = buildDeliveryPayload({
                ...current,
                ...attestation,
            });
            applyDeliverySnapshot(deliveryDoc, next);
            await deliveryDoc.save();
            return attestation;
        } catch (err) {
            deliveryDoc.solanaOnChain = false;
            deliveryDoc.solanaAttestationError = err.message;
            await deliveryDoc.save();
            return null;
        } finally {
            solanaAttestationJobs.delete(deliveryDoc.id);
        }
    })();

    solanaAttestationJobs.set(deliveryDoc.id, job);
    return job;
}

async function syncOperationalDeliveries(deliveryDocs, stations, lines, weatherByStation, drones = []) {
    const serialized = [];

    for (const deliveryDoc of deliveryDocs) {
        const current = serializeDoc(deliveryDoc);
        const planned = planDeliveryOperation({
            deliveryInput: current,
            stations,
            lines,
            drones,
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
    await reconcileOperationalState();
    const [deliveryDocs, stations, droneDocs, lines] = await Promise.all([
        Delivery.find({}).sort({ createdAt: -1 }),
        Station.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Drone.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Line.find({}, '-_id -__v -createdAt -updatedAt').lean(),
    ]);

    const weather = await getWeatherSnapshots(stations);
    const weatherStations = [...weather.stations].sort((left, right) => right.riskScore - left.riskScore);
    const weatherByStation = buildWeatherIndex(weatherStations);
    const rawDrones = droneDocs.map((droneDoc) => buildDronePayload(droneDoc));
    const deliveries = await syncOperationalDeliveries(deliveryDocs, stations, lines, weatherByStation, rawDrones);
    const drones = await syncOperationalDrones(droneDocs, stations, lines, weatherByStation);
    const metrics = buildOverviewMetrics({ deliveries, stations, weatherStations });
    const notifications = buildAdminNotifications(deliveries);
    const recommendation = buildDefaultRecommendation({ notifications, metrics, weatherStations });
    const highlightPriority = ['REROUTED', 'WEATHER_HOLD', 'IN_TRANSIT', 'HANDOFF', 'READY_TO_LAUNCH', 'PENDING_DISPATCH', 'REQUESTED', 'AWAITING_REVIEW'];
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

const GEMINI_REQUEST_PREVIEW_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['payload', 'priority', 'destination', 'summary', 'clinicNotes'],
    properties: {
        payload: { type: 'string' },
        priority: { type: 'string', enum: ['Routine', 'Urgent', 'Emergency'] },
        destination: { type: 'string' },
        origin: { type: 'string' },
        summary: { type: 'string' },
        clinicNotes: { type: 'string' },
        weight_kg: { type: 'number' },
    },
};

async function getRoutingContext() {
    const [stations, lines, drones] = await Promise.all([
        Station.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Line.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        Drone.find({}, '-_id -__v -createdAt -updatedAt').lean(),
    ]);
    const weather = await getWeatherSnapshots(stations);

    return {
        stations,
        lines,
        drones: drones.map((drone) => buildDronePayload(drone)),
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

    const origins = stations
        .filter((station) => station.type === 'distribution')
        .map((station) => station.id)
        .join(', ');
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

AVAILABLE ORIGINS:
${origins}

Return only JSON that matches the required schema.

USER REQUEST:
${userPrompt}`;
}

function getRoutingDefaults(stations = []) {
    const validStations = stations.filter((station) => station?.id);
    const distributionStations = validStations.filter((station) => station.type === 'distribution');
    const nonDistributionStations = validStations.filter((station) => station.type !== 'distribution');
    const defaultOrigin = distributionStations[0]?.id || validStations[0]?.id || '';
    const defaultDestination = nonDistributionStations.find((station) => station.id !== defaultOrigin)?.id
        || validStations.find((station) => station.id !== defaultOrigin)?.id
        || defaultOrigin;

    return {
        defaultOrigin,
        defaultDestination,
        distributionStations,
        nonDistributionStations,
    };
}

function buildFallbackDispatchPlan(prompt, stations, lines = [], weatherByStation = {}) {
    const normalizedPrompt = String(prompt || '').trim();
    const lowerPrompt = normalizedPrompt.toLowerCase();
    const {
        defaultOrigin,
        defaultDestination,
        distributionStations,
        nonDistributionStations,
    } = getRoutingDefaults(stations);
    const requestedOrigin = distributionStations.find((station) => lowerPrompt.includes(station.id.toLowerCase()))?.id || defaultOrigin;
    const destinations = nonDistributionStations.map((station) => station.id);
    const destination = destinations.find((stationId) => lowerPrompt.includes(stationId.toLowerCase())) || defaultDestination;
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
    const origin = resolveOperationalOrigin({
        requestedOrigin,
        destination,
        stations,
        lines,
        weatherByStation,
    });

    return {
        payload,
        weight_kg: weightKg,
        origin,
        destination,
        priority,
        route: [origin, destination].filter(Boolean),
        estimated_legs: 1,
        estimated_time_minutes: priority === 'Emergency' ? 70 : 95,
        reasoning: 'Gemini structured output was unavailable, so the backend generated a fallback manifest from the request text.',
        model: 'fallback-parser',
    };
}

function buildSupplyRequestPreviewPrompt({
    prompt,
    clinicName,
    requestedBy,
    defaultDestination,
    stations,
    weatherStations,
    language = 'en',
}) {
    const destinations = stations
        .filter((station) => station.type !== 'distribution')
        .map((station) => station.id);
    const stationSummary = stations
        .filter((station) => ['distribution', 'pick_up'].includes(station.type))
        .map((station) => {
            const weather = weatherStations.find((entry) => entry.stationId === station.id);
            const weatherNote = weather && weather.condition !== 'CLEAR'
                ? `, weather=${weather.condition}, issue=${weather.issues?.[0] || weather.summary}`
                : '';
            return `- ${station.id}: type=${station.type}, status=${station.status}${weatherNote}`;
        })
        .join('\n');

    return `You are the Aero'ed clinic intake assistant for a medical drone relay corridor in Northern Quebec.

Rewrite the clinic's natural-language request into a clean dispatcher-ready preview.
- Keep the destination inside the available corridor destinations. Default to ${defaultDestination} unless the request clearly names another clinic.
- Infer a medical payload name and urgency when the user is vague.
- Do not invent policy rejections for legitimate medical cargo such as medication, blood, vaccines, or diagnostic specimens.
- Put any timing constraints, patient-safety context, cold-chain notes, or handling instructions into clinicNotes.
- summary should be one sentence explaining what dispatch should understand immediately.
- Write payload, summary, and clinicNotes in ${getRequestLanguageLabel(language)}. Keep corridor station IDs exactly as listed.
- Return only JSON that matches the required schema.

CLINIC:
- Clinic: ${clinicName}
- Requester: ${requestedBy}

AVAILABLE DESTINATIONS:
${destinations.join(', ')}

NETWORK SNAPSHOT:
${stationSummary}

USER REQUEST:
${prompt}`;
}

function isLikelyMedicalRequest(text = '') {
    return /(insulin|medication|medicine|meds|heart|cardiac|cardio|blood|vaccine|vaccin|antibiotic|dialysis|epinephrine|specimen|tissue|iv fluids?|analgesic|pharmacy|prescription|insuline|medicament|m[ée]dicament|m[ée]dicaments|sang|coeur|cardiaque|antibiotique|pharmacie|ordonnance|vaccins?)/i.test(text);
}

function isClearlyUnauthorizedCargo(text = '') {
    return /(live animals?|pets?|cats?|dogs?|fireworks?|weapons?|ammunition|alcohol|beer|wine|personal shopping|groceries)/i.test(text);
}

function extractMedicalPayloadFromPrompt(prompt = '') {
    const normalizedPrompt = String(prompt || '').trim();
    const compact = normalizedPrompt.replace(/\s+/g, ' ');
    const lowerPrompt = compact.toLowerCase();

    const payloadMatchers = [
        { pattern: /(insulin(?:\s+vials?)?)/i, value: (match) => match[1] },
        { pattern: /(heart medication|cardiac medication|cardiovascular medication)/i, value: (match) => match[1] },
        { pattern: /(blood (?:products?|units?|bags?))/i, value: (match) => match[1] },
        { pattern: /(vaccines?)/i, value: (match) => match[1] },
        { pattern: /(antibiotics?)/i, value: (match) => match[1] },
        { pattern: /(epinephrine|epipen(?:s)?)/i, value: () => 'Emergency epinephrine auto-injectors' },
        { pattern: /(dialysis(?:\s+support)?\s+kits?)/i, value: (match) => match[1] },
        { pattern: /(iv fluids?)/i, value: (match) => match[1] },
        { pattern: /(cold-?chain (?:medication|supplies|cargo))/i, value: (match) => match[1] },
    ];

    for (const matcher of payloadMatchers) {
        const match = compact.match(matcher.pattern);
        if (match) {
            const value = typeof matcher.value === 'function' ? matcher.value(match) : matcher.value;
            return String(value).replace(/\b\w/g, (character) => character.toUpperCase());
        }
    }

    if (isLikelyMedicalRequest(compact)) {
        return compact
            .replace(/^((we|nous)\s+need|besoin de|please send|envoyez|send)\s+/i, '')
            .replace(/\s+(asap|please|svp|tonight|ce soir|imm[ée]diatement)\b/gi, '')
            .trim()
            .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Medical supplies';
    }

    return 'Medical supplies';
}

function buildLocalizedClinicSummary(clinicName, priority, language = 'en') {
    if (language === 'fr') {
        const label = priority === 'Emergency' ? 'urgence' : priority === 'Urgent' ? 'prioritaire' : 'standard';
        return `${clinicName} a soumis une demande ${label} qui doit etre verifiee par la repartition avant l'envoi.`;
    }
    if (language === 'iu') {
        return `${clinicName} request is ready for dispatcher review before launch approval.`;
    }
    return `${clinicName} submitted a ${priority.toLowerCase()} request that should be reviewed by dispatch before launch approval.`;
}

function buildFallbackSupplyRequestPreview({
    prompt,
    clinicName,
    defaultOrigin,
    defaultDestination,
    language = 'en',
}) {
    const normalizedPrompt = String(prompt || '').trim();
    const priority = /(emergency|critical|stat|immediately|severe bleeding|anaphyl|stroke|cardiac|urgence|urgent|imm[ée]diat)/i.test(normalizedPrompt)
        ? 'Emergency'
        : /(urgent|asap|tonight|same day|time-sensitive|fast|ce soir|prioritaire|rapidement)/i.test(normalizedPrompt)
            ? 'Urgent'
            : 'Routine';
    const payload = extractMedicalPayloadFromPrompt(normalizedPrompt);

    return {
        payload: payload.charAt(0).toUpperCase() + payload.slice(1),
        priority,
        destination: defaultDestination,
        origin: defaultOrigin,
        clinicNotes: normalizedPrompt,
        summary: buildLocalizedClinicSummary(clinicName, priority, language),
        model: 'fallback-clinic-intake',
        language,
    };
}

function normalizeSupplyRequestPreview(result, {
    prompt,
    requestedBy,
    requestedByEmail,
    clinicName,
    defaultOrigin,
    defaultDestination,
    language = 'en',
}) {
    const normalizedLanguage = normalizeRequestLanguage(language);
    const combinedSource = [
        result?.payload,
        result?.summary,
        result?.clinicNotes,
        prompt,
    ].filter(Boolean).join(' ');
    const likelyMedical = isLikelyMedicalRequest(combinedSource);
    const unauthorizedResponse = /unauthorized cargo|non-medical cargo|policy rejection|rejected by policy/i.test(combinedSource);
    const repairedPayload = unauthorizedResponse && likelyMedical
        ? extractMedicalPayloadFromPrompt(prompt)
        : String(result?.payload || '').trim();

    return {
        payload: repairedPayload || extractMedicalPayloadFromPrompt(prompt) || 'Medical supplies requiring dispatcher review',
        priority: ['Routine', 'Urgent', 'Emergency'].includes(result?.priority) ? result.priority : 'Routine',
        origin: String(result?.origin || defaultOrigin).trim() || defaultOrigin,
        destination: String(result?.destination || defaultDestination).trim() || defaultDestination,
        clinicNotes: String(result?.clinicNotes || '').trim(),
        geminiSummary: unauthorizedResponse && likelyMedical
            ? buildLocalizedClinicSummary(clinicName, ['Routine', 'Urgent', 'Emergency'].includes(result?.priority) ? result.priority : 'Routine', normalizedLanguage)
            : String(result?.summary || '').trim(),
        weight_kg: Number.isFinite(Number(result?.weight_kg)) ? Number(result.weight_kg) : null,
        sourceText: String(prompt || '').trim(),
        requestedBy: String(requestedBy || clinicName || '').trim(),
        requestedByEmail: String(requestedByEmail || '').trim(),
        clinic: String(clinicName || '').trim(),
        status: 'REQUESTED',
        language: normalizedLanguage,
    };
}

function resolveOperationalOrigin({
    requestedOrigin,
    destination,
    stations = [],
    lines = [],
    weatherByStation = {},
}) {
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    if (requestedOrigin && stationsById[requestedOrigin]) {
        return requestedOrigin;
    }

    const distributionStations = stations.filter((station) => (
        station.type === 'distribution' && station.status !== 'offline'
    ));
    if (!destination || !stationsById[destination]) {
        return distributionStations[0]?.id || stations[0]?.id || requestedOrigin || '';
    }

    const ranked = distributionStations
        .map((station) => ({
            stationId: station.id,
            route: findBestRoute({
                origin: station.id,
                destination,
                lines,
                stationsById,
                weatherByStation,
                mode: 'automatic',
            }),
        }))
        .filter((entry) => entry.route.length > 0)
        .sort((left, right) => left.route.length - right.route.length);

    return ranked[0]?.stationId || distributionStations[0]?.id || stations[0]?.id || requestedOrigin || '';
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
    const routeWeatherIndex = Object.keys(weatherByStation || {}).length > 0 ? weatherByStation : {};

    let bestPair = null;

    candidateOrigins.forEach((origin) => {
        candidateDestinations.forEach((destination) => {
            if (!origin?.id || !destination?.id || origin.id === destination.id) return;

            const bestRoute = findBestRoute({
                origin: origin.id,
                destination: destination.id,
                lines,
                stationsById,
                weatherByStation: routeWeatherIndex,
                mode: 'automatic',
            });

            const graphBestRoute = bestRoute.length > 0
                ? bestRoute
                : findBestRoute({
                    origin: origin.id,
                    destination: destination.id,
                    lines,
                    stationsById,
                    weatherByStation: {},
                    mode: 'automatic',
                });

            if (graphBestRoute.length < 3) return;

            let alternateRoute = [];
            buildAvoidCombinations(graphBestRoute).forEach((avoidStations) => {
                const candidateRoute = findBestRoute({
                    origin: origin.id,
                    destination: destination.id,
                    lines,
                    stationsById,
                    weatherByStation: {},
                    avoidStations,
                    mode: 'automatic',
                });

                if (
                    candidateRoute.length > graphBestRoute.length
                    && JSON.stringify(candidateRoute) !== JSON.stringify(graphBestRoute)
                    && candidateRoute[0] === origin.id
                    && candidateRoute[candidateRoute.length - 1] === destination.id
                    && (alternateRoute.length === 0 || candidateRoute.length > alternateRoute.length)
                ) {
                    alternateRoute = candidateRoute;
                }
            });

            if (!alternateRoute.length) return;

            const score = alternateRoute.length - graphBestRoute.length;
            if (!bestPair || score > bestPair.score) {
                bestPair = {
                    origin: origin.id,
                    destination: destination.id,
                    bestRoute: graphBestRoute,
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
        solanaTx: '',
    };
}

function applyDeliverySnapshot(delivery, snapshot) {
    DELIVERY_SYNC_FIELDS.forEach((field) => {
        if (snapshot[field] !== undefined) {
            delivery.set(field, snapshot[field]);
        }
    });
}

function clearDroneMissionState(drone, fallbackLocation = null) {
    drone.status = drone.status === 'charging' ? 'charging' : 'ready';
    drone.assignment = null;
    drone.target_location = null;
    drone.origin_location = null;
    drone.time_of_arrival = null;
    drone.speed = 0;
    if (fallbackLocation) {
        drone.location = fallbackLocation;
    }
}

function getDroneLaunchSpeed(drone) {
    const modelSpeed = DRONE_LAUNCH_SPEEDS[drone.model];
    if (Number.isFinite(Number(modelSpeed)) && Number(modelSpeed) > 0) {
        return Number(modelSpeed);
    }
    return 62 + (hashString(drone.id || drone.name || 'drone') % 14);
}

function getNextRouteTarget(delivery, completedLegs = Number(delivery.currentLeg || 0)) {
    const route = Array.isArray(delivery.route) ? delivery.route.filter(Boolean) : [];
    if (route.length <= 1) {
        return delivery.destination || route[route.length - 1] || null;
    }
    return route[Math.min(completedLegs + 1, route.length - 1)] || delivery.destination;
}

function chooseBestAvailableDrone(delivery, droneDocs, stations, lines, weatherByStation) {
    const readyDrones = droneDocs.filter((drone) => (
        drone.status === 'ready'
        && !drone.assignment
        && Number(drone.battery || 0) >= 25
    ));
    if (readyDrones.length === 0) return null;

    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    return [...readyDrones]
        .map((drone) => {
            const positionedAtOrigin = drone.location === delivery.origin ? 0 : 1;
            const relocationRoute = positionedAtOrigin === 0 || !stationsById[drone.location] || !stationsById[delivery.origin]
                ? []
                : findBestRoute({
                    origin: drone.location,
                    destination: delivery.origin,
                    lines,
                    stationsById,
                    weatherByStation,
                    mode: 'automatic',
                });

            return {
                drone,
                score: positionedAtOrigin * 1000
                    + (relocationRoute.length > 0 ? relocationRoute.length : 50)
                    - (Number(drone.battery || 0) / 10),
            };
        })
        .sort((left, right) => {
            if (left.score !== right.score) return left.score - right.score;
            const batteryDelta = Number(right.drone.battery || 0) - Number(left.drone.battery || 0);
            if (batteryDelta !== 0) return batteryDelta;
            return String(left.drone.id || '').localeCompare(String(right.drone.id || ''));
        })[0]?.drone || null;
}

async function repairQueuedDelivery(delivery, { stations, lines, drones, weatherByStation }) {
    const current = serializeDoc(delivery);
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    const originMissing = !stationsById[current.origin];
    const hasValidRoute = Array.isArray(current.route) && current.route.length > 1;

    if (!originMissing && hasValidRoute) {
        return false;
    }

    const resolvedOrigin = resolveOperationalOrigin({
        requestedOrigin: current.origin,
        destination: current.destination,
        stations,
        lines,
        weatherByStation,
    });
    const planned = planDeliveryOperation({
        deliveryInput: {
            ...current,
            origin: resolvedOrigin,
        },
        stations,
        lines,
        drones,
        weatherByStation,
        mode: 'automatic',
    });
    const next = buildDeliveryUpdate({
        ...current,
        origin: resolvedOrigin,
    }, planned);

    if (
        next.origin === current.origin
        && JSON.stringify(next.route || []) === JSON.stringify(current.route || [])
        && next.recommendedAction === current.recommendedAction
        && next.status === current.status
    ) {
        return false;
    }

    applyDeliverySnapshot(delivery, next);
    await delivery.save();
    return true;
}

async function launchReadyDelivery(delivery, drone) {
    const nextTarget = getNextRouteTarget(delivery, 0);
    const origin = Array.isArray(delivery.route) && delivery.route.length > 0
        ? delivery.route[0]
        : delivery.origin;

    delivery.status = 'IN_TRANSIT';
    delivery.currentLeg = 0;
    delivery.lastStation = origin || delivery.origin;
    delivery.assignedDrone = drone.id;
    delivery.manualAttentionRequired = false;
    delivery.events = mergeDeliveryEvents(delivery.events, [
        makeDeliveryEvent(
            'MISSION_LAUNCHED',
            'Mission launched',
            `Drone ${drone.id} launched toward ${nextTarget || delivery.destination}.`,
            origin || delivery.origin || null
        ),
    ]);

    drone.status = 'on_route';
    drone.assignment = delivery.id;
    drone.location = origin || drone.location;
    drone.origin_location = origin || delivery.origin || drone.location;
    drone.target_location = nextTarget;
    drone.time_of_arrival = delivery.estimatedTime || formatEstimatedTime(delivery.estimatedMinutes || 22);
    drone.speed = getDroneLaunchSpeed(drone);

    await Promise.all([delivery.save(), drone.save()]);
}

async function advanceMissionProgress(delivery, drone) {
    if (!drone) return false;

    const updatedAtMs = new Date(delivery.updatedAt || delivery.createdAt || Date.now()).getTime();
    const elapsedMs = Date.now() - updatedAtMs;
    const legsToAdvance = Math.floor(elapsedMs / MISSION_LEG_INTERVAL_MS);
    if (legsToAdvance <= 0) return false;

    let changed = false;
    const totalLegs = Number(delivery.totalLegs || 0);
    const route = Array.isArray(delivery.route) ? delivery.route.filter(Boolean) : [];

    for (let step = 0; step < legsToAdvance; step += 1) {
        const nextLeg = Number(delivery.currentLeg || 0) + 1;

        if (nextLeg >= totalLegs) {
            delivery.status = 'ARRIVED';
            delivery.currentLeg = totalLegs;
            delivery.lastStation = delivery.destination || route[route.length - 1] || delivery.lastStation;
            delivery.assignedDrone = null;
            delivery.manualAttentionRequired = false;
            delivery.events = mergeDeliveryEvents(delivery.events, [
                makeDeliveryEvent(
                    'ARRIVED',
                    'Payload arrived at destination',
                    `Delivery arrived at ${delivery.destination}. Awaiting clinic confirmation.`,
                    delivery.destination || null
                ),
            ]);

            clearDroneMissionState(drone, delivery.destination || delivery.lastStation || drone.location);
            changed = true;
            break;
        }

        delivery.currentLeg = nextLeg;
        delivery.lastStation = route[nextLeg] || delivery.destination || delivery.lastStation;
        delivery.status = 'HANDOFF';
        delivery.events = mergeDeliveryEvents(delivery.events, [
            makeDeliveryEvent(
                'RELAY_PROGRESS',
                'Relay handoff completed',
                `${delivery.id} cleared ${delivery.lastStation} and is continuing on the next leg.`,
                delivery.lastStation || null
            ),
        ]);

        drone.location = delivery.lastStation || drone.location;
        drone.origin_location = delivery.lastStation || drone.origin_location || drone.location;
        drone.target_location = getNextRouteTarget(delivery, nextLeg);
        drone.time_of_arrival = formatEstimatedTime(Math.max(
            12,
            Math.round((Number(delivery.estimatedMinutes || 22) / Math.max(totalLegs, 1)) * Math.max(totalLegs - nextLeg, 1))
        ));
        drone.speed = getDroneLaunchSpeed(drone);
        changed = true;
    }

    if (!changed) return false;

    await Promise.all([delivery.save(), drone.save()]);
    if (delivery.status === 'DELIVERED') {
        void queueDeliveryAttestation(delivery);
    }
    return true;
}

let reconcileOperationalStatePromise = null;

async function reconcileOperationalState() {
    if (reconcileOperationalStatePromise) {
        return reconcileOperationalStatePromise;
    }

    reconcileOperationalStatePromise = (async () => {
        const [deliveryDocs, droneDocs, stations, lines] = await Promise.all([
            Delivery.find({}).sort({ createdAt: -1 }),
            Drone.find({}),
            Station.find({}, '-_id -__v -createdAt -updatedAt').lean(),
            Line.find({}, '-_id -__v -createdAt -updatedAt').lean(),
        ]);
        const weather = await getWeatherSnapshots(stations);
        const weatherByStation = buildWeatherIndex(weather.stations);
        const deliveryById = new Map(deliveryDocs.map((delivery) => [delivery.id, delivery]));

        for (const drone of droneDocs) {
            const assignedDelivery = drone.assignment ? deliveryById.get(drone.assignment) : null;
            if (!assignedDelivery || ['ARRIVED', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(assignedDelivery.status)) {
                if (drone.assignment || (drone.status === 'on_route' && !assignedDelivery)) {
                    clearDroneMissionState(drone, assignedDelivery?.destination || drone.location);
                    await drone.save();
                }
            }
        }

        const refreshedDrones = await Drone.find({});
        const serializedDrones = refreshedDrones.map((drone) => buildDronePayload(serializeDoc(drone)));

        for (const delivery of deliveryDocs) {
            if (['ARRIVED', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(delivery.status)) {
                continue;
            }
            await repairQueuedDelivery(delivery, {
                stations,
                lines,
                drones: serializedDrones,
                weatherByStation,
            });
        }

        const launchDeliveries = await Delivery.find({
            status: { $in: ['PENDING_DISPATCH', 'READY_TO_LAUNCH'] },
        }).sort({ createdAt: 1 });
        const launchDrones = await Drone.find({});

        for (const delivery of launchDeliveries.sort((left, right) => {
            const priorityRank = { Emergency: 0, Urgent: 1, Routine: 2 };
            const priorityDelta = (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3);
            if (priorityDelta !== 0) return priorityDelta;
            return new Date(left.createdAt) - new Date(right.createdAt);
        })) {
            if (!Array.isArray(delivery.route) || delivery.route.length <= 1) {
                continue;
            }

            const existingDrone = launchDrones.find((drone) => drone.id === delivery.assignedDrone || drone.assignment === delivery.id);
            if (existingDrone) {
                if (delivery.assignedDrone !== existingDrone.id) {
                    delivery.assignedDrone = existingDrone.id;
                    await delivery.save();
                }
                continue;
            }

            const selectedDrone = chooseBestAvailableDrone(
                serializeDoc(delivery),
                launchDrones.map((drone) => serializeDoc(drone)),
                stations,
                lines,
                weatherByStation,
            );
            if (!selectedDrone) {
                continue;
            }

            const launchDeliveryDoc = launchDeliveries.find((entry) => entry.id === delivery.id);
            const launchDroneDoc = launchDrones.find((entry) => entry.id === selectedDrone.id);
            if (launchDeliveryDoc && launchDroneDoc) {
                await launchReadyDelivery(launchDeliveryDoc, launchDroneDoc);
            }
        }

        const activeDeliveries = await Delivery.find({
            status: { $in: ['IN_TRANSIT', 'HANDOFF', 'REROUTED'] },
        }).sort({ createdAt: -1 });
        const activeDrones = await Drone.find({});
        for (const delivery of activeDeliveries) {
            const activeDrone = activeDrones.find((drone) => drone.id === delivery.assignedDrone || drone.assignment === delivery.id);
            if (!activeDrone) continue;
            if (delivery.assignedDrone !== activeDrone.id) {
                delivery.assignedDrone = activeDrone.id;
                await delivery.save();
            }
            await advanceMissionProgress(delivery, activeDrone);
        }

        for (const delivery of deliveryDocs) {
            if (shouldAttestOnChain(serializeDoc(delivery))) {
                void queueDeliveryAttestation(delivery);
            }
        }
    })()
        .finally(() => {
            reconcileOperationalStatePromise = null;
        });

    return reconcileOperationalStatePromise;
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
            const projectedDrone = {
                ...currentDrone,
                ...planned,
            };
            return res.json({
                drone: projectedDrone,
                relocationReport: buildDroneRelocationReport(projectedDrone, weatherByStation),
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

        const { stations, lines, weather, weatherByStation } = await getRoutingContext();
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
            return res.json(buildFallbackDispatchPlan(prompt, stations, lines, weatherByStation));
        }
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/deliveries/request/preview', async (req, res) => {
    try {
        const prompt = String(req.body?.prompt || '').trim();
        if (!prompt) {
            return res.status(400).json({ error: 'Request details are required.' });
        }

        const requestedBy = String(req.body?.requestedBy || req.body?.clinic || 'Clinic operator').trim();
        const requestedByEmail = String(req.body?.requestedByEmail || '').trim();
        const clinicName = String(req.body?.clinic || 'Clinic').trim();
        const language = normalizeRequestLanguage(req.body?.language || 'en');
        const { stations, lines, drones, weather, weatherByStation } = await getRoutingContext();
        const routingDefaults = getRoutingDefaults(stations);
        const defaultDestination = String(req.body?.destination || routingDefaults.defaultDestination).trim() || routingDefaults.defaultDestination;

        let interpreted;
        try {
            const geminiResult = await callGeminiJson(
                buildSupplyRequestPreviewPrompt({
                    prompt,
                    clinicName,
                    requestedBy,
                    defaultDestination,
                    stations,
                    weatherStations: weather.stations,
                    language,
                }),
                GEMINI_REQUEST_PREVIEW_SCHEMA,
                {
                    maxOutputTokens: 500,
                    thinkingLevel: 'minimal',
                }
            );
            interpreted = {
                ...geminiResult.data,
                model: geminiResult.model,
            };
        } catch (geminiError) {
            console.warn('Gemini clinic intake fallback:', geminiError.message);
            interpreted = buildFallbackSupplyRequestPreview({
                prompt,
                clinicName,
                defaultOrigin: routingDefaults.defaultOrigin,
                defaultDestination,
                language,
            });
        }

        const normalizedPreview = normalizeSupplyRequestPreview(interpreted, {
            prompt,
            requestedBy,
            requestedByEmail,
            clinicName,
            defaultOrigin: routingDefaults.defaultOrigin,
            defaultDestination,
            language,
        });
        const validStationIds = new Set(stations.map((station) => station.id));
        if (!validStationIds.has(normalizedPreview.destination)) {
            normalizedPreview.destination = defaultDestination;
        }
        normalizedPreview.origin = resolveOperationalOrigin({
            requestedOrigin: normalizedPreview.origin,
            destination: normalizedPreview.destination,
            stations,
            lines,
            weatherByStation,
        });

        const planned = planDeliveryOperation({
            deliveryInput: normalizedPreview,
            stations,
            lines,
            drones,
            weatherByStation,
            mode: 'automatic',
        });
        const preview = buildDeliveryPayload({
            ...normalizedPreview,
            ...planned,
            status: 'REQUESTED',
            eta: generateETA(planned.estimatedMinutes),
        });

        res.json({
            ...preview,
            model: interpreted.model || 'fallback-clinic-intake',
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/deliveries/request', async (req, res) => {
    try {
        const prompt = String(req.body?.sourceText || req.body?.prompt || req.body?.payload || '').trim();
        const requestedBy = String(req.body?.requestedBy || req.body?.clinic || 'Clinic operator').trim();
        const requestedByEmail = String(req.body?.requestedByEmail || '').trim();
        const clinicName = String(req.body?.clinic || 'Clinic').trim();
        const language = normalizeRequestLanguage(req.body?.language || 'en');
        const { stations, lines, drones, weatherByStation } = await getRoutingContext();
        const routingDefaults = getRoutingDefaults(stations);
        const defaultDestination = String(req.body?.destination || routingDefaults.defaultDestination).trim() || routingDefaults.defaultDestination;

        const validStationIds = new Set(stations.map((station) => station.id));
        const normalizedRequest = normalizeSupplyRequestPreview({
            ...req.body,
            summary: req.body?.geminiSummary || req.body?.summary,
        }, {
            prompt,
            requestedBy,
            requestedByEmail,
            clinicName,
            defaultOrigin: routingDefaults.defaultOrigin,
            defaultDestination,
            language,
        });

        if (!normalizedRequest.payload) {
            return res.status(400).json({ error: 'A request payload is required.' });
        }
        if (!validStationIds.has(normalizedRequest.destination)) {
            normalizedRequest.destination = defaultDestination;
        }
        normalizedRequest.origin = resolveOperationalOrigin({
            requestedOrigin: normalizedRequest.origin,
            destination: normalizedRequest.destination,
            stations,
            lines,
            weatherByStation,
        });

        const planned = planDeliveryOperation({
            deliveryInput: normalizedRequest,
            stations,
            lines,
            drones,
            weatherByStation,
            mode: 'automatic',
        });

        const delivery = new Delivery({
            ...buildDeliveryPayload({
                ...normalizedRequest,
                ...planned,
                status: 'REQUESTED',
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

app.post('/api/deliveries', async (req, res) => {
    try {
        const { stations, lines, drones, weather, weatherByStation } = await getRoutingContext();
        const planned = planDeliveryOperation({
            deliveryInput: req.body,
            stations,
            lines,
            drones,
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
        const { stations, lines, drones, weatherByStation } = await getRoutingContext();
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
            drones,
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
        if (status === 'DELIVERED') {
            await queueDeliveryAttestation(delivery);
        }
        res.json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/solana/status', async (req, res) => {
    try {
        const status = await getSolanaAuthorityStatus();
        res.json(status);
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/solana/attestations/retry', async (req, res) => {
    try {
        const deliveryId = String(req.body?.deliveryId || '').trim();
        const status = await getSolanaAuthorityStatus();
        if (!status.canSubmitTransactions) {
            return res.status(409).json({
                error: `Fund the devnet signer ${status.authorityAddress} before retrying attestations.`,
                solana: status,
            });
        }

        const deliveries = deliveryId
            ? await Delivery.find({ id: deliveryId, status: 'DELIVERED' })
            : await Delivery.find({ status: 'DELIVERED', solanaOnChain: false }).sort({ createdAt: -1 });

        if (deliveryId && deliveries.length === 0) {
            return res.status(404).json({ error: 'Delivered manifest not found for retry.' });
        }

        for (const delivery of deliveries) {
            await queueDeliveryAttestation(delivery, { force: true });
        }

        const overview = await buildOperationalOverview();
        const refreshedStatus = await getSolanaAuthorityStatus();
        res.json({
            retried: deliveries.length,
            deliveryId: deliveryId || null,
            solana: refreshedStatus,
            deliveries: overview.deliveries.filter((delivery) => (
                delivery.status === 'DELIVERED' && (!deliveryId || delivery.id === deliveryId)
            )),
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.patch('/api/deliveries/:id/cancel', async (req, res) => {
    try {
        const delivery = await Delivery.findOne({ id: req.params.id });
        if (!delivery) {
            return res.status(404).json({ error: 'Delivery not found.' });
        }
        if (['ARRIVED', 'DELIVERED', 'REJECTED', 'CANCELLED'].includes(delivery.status)) {
            return res.status(400).json({ error: `Cannot cancel delivery with status ${delivery.status}.` });
        }

        const assignedDroneId = delivery.assignedDrone || null;
        const assignedDrone = assignedDroneId
            ? await Drone.findOne({ id: assignedDroneId })
            : await Drone.findOne({ assignment: delivery.id });

        delivery.status = 'CANCELLED';
        delivery.manualAttentionRequired = false;
        delivery.events = [
            ...(delivery.events || []),
            {
                type: 'MISSION_CANCELLED',
                title: 'Mission cancelled',
                detail: `Delivery ${delivery.id} was cancelled before completion.`,
                timestamp: new Date(),
                stationId: delivery.lastStation || delivery.origin || null,
            },
        ];
        await delivery.save();

        if (assignedDrone) {
            assignedDrone.status = 'ready';
            assignedDrone.assignment = null;
            assignedDrone.target_location = null;
            assignedDrone.origin_location = null;
            assignedDrone.speed = 0;
            assignedDrone.location = delivery.lastStation || delivery.origin || assignedDrone.location;
            await assignedDrone.save();
        }

        res.json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

// ── Launch a delivery (assign drone, start simulation) ──
app.post('/api/deliveries/:id/launch', async (req, res) => {
    try {
        const delivery = await Delivery.findOne({ id: req.params.id });
        if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });
        if (!['READY_TO_LAUNCH', 'PENDING_DISPATCH'].includes(delivery.status)) {
            return res.status(400).json({ error: `Cannot launch delivery with status ${delivery.status}.` });
        }

        const { stations, lines, weatherByStation } = await getRoutingContext();
        const availableDrone = chooseBestAvailableDrone(
            serializeDoc(delivery),
            (await Drone.find({})).map((droneDoc) => serializeDoc(droneDoc)),
            stations,
            lines,
            weatherByStation,
        );
        if (!availableDrone) {
            return res.status(400).json({ error: 'No available drones. All are currently assigned.' });
        }

        const launchDroneDoc = await Drone.findOne({ id: availableDrone.id });
        if (!launchDroneDoc) {
            return res.status(404).json({ error: 'Selected launch drone could not be loaded.' });
        }

        await launchReadyDelivery(delivery, launchDroneDoc);
        await reconcileOperationalState();

        res.json({
            delivery: serializeDoc(delivery),
            drone: serializeDoc(launchDroneDoc),
            message: `Delivery ${delivery.id} launched. Drone ${launchDroneDoc.id} assigned.`,
        });
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
        const { stations, lines, drones, weather, weatherByStation } = await getRoutingContext();
        const planned = planDeliveryOperation({
            deliveryInput: currentDelivery,
            stations,
            lines,
            drones,
            weatherByStation,
            mode: 'manual',
            avoidStationIds: Array.isArray(req.body.avoidStationIds) ? req.body.avoidStationIds : [],
        });

        const currentRoute = Array.isArray(currentDelivery.route) ? currentDelivery.route : [];
        const routeChanged = JSON.stringify(planned.route) !== JSON.stringify(currentRoute);
        if (!routeChanged) {
            const projectedDelivery = buildDeliveryUpdate(currentDelivery, planned);
            return res.json({
                delivery: projectedDelivery,
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
            'cruiseSpeedKph',
            'speedSource',
            'baseFlightMinutes',
            'weatherDelayMinutes',
            'handoffDelayMinutes',
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

// ── Approve / Reject a clinic request ──
app.patch('/api/deliveries/:id/approve', async (req, res) => {
    try {
        const { action } = req.body;
        const delivery = await Delivery.findOne({ id: req.params.id });
        if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });
        const reviewable = ['REQUESTED', 'AWAITING_REVIEW'];
        if (!reviewable.includes(delivery.status)) return res.status(400).json({ error: 'Only pending requests can be approved/rejected.' });
        delivery.status = action === 'approve' ? 'PENDING_DISPATCH' : 'REJECTED';
        await delivery.save();
        res.json(serializeDoc(delivery));
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
        setInterval(() => {
            reconcileOperationalState().catch((err) => {
                console.error('Operational reconcile failed:', err.message);
            });
        }, OPERATIONS_RECONCILE_INTERVAL_MS);
        app.listen(3001, () => console.log('API server running on http://localhost:3001'));
    })
    .catch((err) => {
        console.error('MongoDB connection failed:', err.message);
        process.exit(1);
    });
