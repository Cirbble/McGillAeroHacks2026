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

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const DELIVERY_STATUSES = ['PENDING_DISPATCH', 'IN_TRANSIT', 'HANDOFF', 'DELIVERED'];

const SEED_DRONES = [
    { id: 'DRN-409', droneId: 8341, name: 'Relay Alpha', model: 'DDC Sparrow', status: 'on_route', assignment: 'RLY-9082', battery: 68, batteryHealth: 92, speed: 72, location: 'En route to Waskaganish', target_location: 'Waskaganish', time_of_arrival: '42 min' },
    { id: 'DRN-102', droneId: 2719, name: 'Relay Beta', model: 'DDC Robin XL', status: 'ready', assignment: 'RLY-9083', battery: 100, batteryHealth: 98, speed: 0, location: 'Mistissini' },
    { id: 'DRN-311', droneId: 5082, name: 'Relay Gamma', model: 'DDC Sparrow', status: 'charging', assignment: null, battery: 45, batteryHealth: 87, speed: 0, location: 'Nemaska' },
    { id: 'DRN-205', droneId: 6647, name: 'Relay Delta', model: 'DJI FlyCart 30', status: 'ready', assignment: null, battery: 100, batteryHealth: 95, speed: 0, location: 'Chisasibi' },
];

const SEED_STATIONS = [
    // ── Southern distribution hubs ──
    { id: 'Montreal', type: 'distribution', status: 'online', battery: 100, temp: 2, lat: 45.5017, lng: -73.5673, max_drone_capacity: 12 },
    { id: 'Quebec City', type: 'distribution', status: 'online', battery: 98, temp: -1, lat: 46.8139, lng: -71.2082, max_drone_capacity: 10 },
    { id: 'Trois-Rivières', type: 'distribution', status: 'online', battery: 97, temp: 0, lat: 46.3432, lng: -72.5418, max_drone_capacity: 8 },
    { id: 'Sept-Îles', type: 'distribution', status: 'online', battery: 93, temp: -8, lat: 50.2030, lng: -66.3801, max_drone_capacity: 8 },
    { id: 'Gaspé', type: 'distribution', status: 'online', battery: 91, temp: -4, lat: 48.8282, lng: -64.4782, max_drone_capacity: 6 },
    { id: 'Saguenay', type: 'distribution', status: 'online', battery: 96, temp: -6, lat: 48.4284, lng: -71.0537, max_drone_capacity: 8 },

    // ── Main north corridor (south → north) ──
    { id: 'Chibougamau Hub', type: 'distribution', status: 'online', battery: 100, temp: -8, lat: 49.9166, lng: -74.3680, max_drone_capacity: 8 },
    { id: 'Mistissini', type: 'transit', status: 'online', battery: 94, temp: -14, lat: 50.4221, lng: -73.8683, max_drone_capacity: 4 },
    { id: 'Nemaska', type: 'transit', status: 'online', battery: 88, temp: -16, lat: 51.6911, lng: -76.2356, max_drone_capacity: 4 },
    { id: 'Waskaganish', type: 'transit', status: 'maintenance', battery: 12, temp: -19, lat: 51.4833, lng: -78.7500, max_drone_capacity: 4 },
    { id: 'Eastmain', type: 'transit', status: 'online', battery: 91, temp: -18, lat: 52.2333, lng: -78.5167, max_drone_capacity: 4 },
    { id: 'Wemindji', type: 'transit', status: 'online', battery: 85, temp: -20, lat: 53.0103, lng: -78.8311, max_drone_capacity: 4 },
    { id: 'Chisasibi', type: 'pick_up', status: 'online', battery: 100, temp: -22, lat: 53.7940, lng: -78.9069, max_drone_capacity: 6 },
    { id: 'Whapmagoostui', type: 'pick_up', status: 'online', battery: 100, temp: -25, lat: 55.2530, lng: -77.7652, max_drone_capacity: 6 },

    // ── Connecting transit nodes (main south–north spine) ──
    { id: 'Shawinigan', type: 'transit', status: 'online', battery: 95, temp: -1, lat: 46.5709, lng: -72.7468, max_drone_capacity: 4 },
    { id: 'La Tuque', type: 'transit', status: 'online', battery: 90, temp: -4, lat: 47.4457, lng: -72.7895, max_drone_capacity: 4 },
    { id: 'Roberval', type: 'transit', status: 'online', battery: 88, temp: -7, lat: 48.5199, lng: -72.2333, max_drone_capacity: 4 },

    // ── North Shore corridor (Saguenay → Rimouski → Gaspé) ──
    { id: 'Rivière-du-Loup', type: 'transit', status: 'online', battery: 89, temp: -4, lat: 47.8337, lng: -69.5407, max_drone_capacity: 4 },
    { id: 'Rimouski', type: 'transit', status: 'online', battery: 90, temp: -5, lat: 48.4474, lng: -68.5304, max_drone_capacity: 4 },
    { id: 'Baie-Comeau', type: 'transit', status: 'online', battery: 87, temp: -8, lat: 49.2167, lng: -68.1500, max_drone_capacity: 6 },
    { id: 'Matane', type: 'transit', status: 'online', battery: 86, temp: -6, lat: 48.8520, lng: -67.5270, max_drone_capacity: 4 },

    // ── Sept-Îles → Whapmagoostui corridor ──
    // Follows the Sept-Îles–Schefferville railway north, then cuts west through
    // the LaGrande hydroelectric complex to reach James Bay.
    { id: 'Fermont', type: 'transit', status: 'online', battery: 83, temp: -14, lat: 52.7891, lng: -67.0849, max_drone_capacity: 4 },
    { id: 'Schefferville', type: 'transit', status: 'online', battery: 79, temp: -17, lat: 54.8029, lng: -66.8165, max_drone_capacity: 4 },
    { id: 'LaGrande Relay', type: 'transit', status: 'online', battery: 76, temp: -20, lat: 53.7500, lng: -73.6700, max_drone_capacity: 4 },
    { id: 'Radisson', type: 'transit', status: 'online', battery: 81, temp: -22, lat: 53.7833, lng: -77.6167, max_drone_capacity: 4 },

    // ── Remote pick-up points ──
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
];

const SEED_DELIVERIES = [
    {
        id: 'RLY-9082',
        payload: 'Insulin (5kg)',
        origin: 'Chibougamau Hub',
        destination: 'Chisasibi',
        priority: 'Routine',
        status: 'IN_TRANSIT',
        currentLeg: 3,
        totalLegs: 5,
        lastStation: 'Station Beta (Nemaska)',
        eta: generateETA(42),
        solanaTx: '8xGhf9...4jK12v',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Chisasibi'],
        reasoning: 'Standard northern corridor via all active relay stations.',
        estimatedTime: '42m',
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
        eta: generateETA(74),
        solanaTx: '2zLpq9...9mN41x',
        route: ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Chisasibi', 'Whapmagoostui'],
        reasoning: 'Urgent priority. Full corridor length to northernmost community.',
        estimatedTime: '1h 14m',
        createdAt: new Date(Date.now() - 1000 * 60 * 20),
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
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
    },
];

function generateETA(minutes) {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
}

function formatEstimatedTime(totalMinutes) {
    const minutes = Math.max(0, Number(totalMinutes) || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    if (hours === 0) return `${remainder}m`;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
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

function buildDeliveryPayload(payload) {
    const estimatedMinutes = Number(payload.estimated_time_minutes || payload.estimatedMinutes || 120);
    const route = Array.isArray(payload.route) ? payload.route.filter(Boolean) : [];
    const totalLegs = Number(payload.estimated_legs || payload.totalLegs || Math.max(route.length - 1, 1));
    const currentLeg = Number(payload.currentLeg ?? 0);

    return {
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
        weightKg: payload.weightKg ?? payload.weight_kg ?? null,
    };
}

async function seedData() {
    // Drones: insert only if collection is empty
    const droneCount = await Drone.countDocuments();
    if (droneCount === 0) {
        await Drone.insertMany(SEED_DRONES);
        console.log('Seeded drones collection.');
    }

    // Stations: upsert each seed record so type + max_drone_capacity stay current
    const ops = SEED_STATIONS.map(s => ({
        updateOne: {
            filter: { id: s.id },
            update: { $set: s },
            upsert: true,
        },
    }));
    await Station.bulkWrite(ops);
    console.log('Stations synced.');

    // Lines: upsert so edits to seed are reflected on restart
    const lineOps = SEED_LINES.map(l => ({
        updateOne: {
            filter: { id: l.id },
            update: { $set: l },
            upsert: true,
        },
    }));
    await Line.bulkWrite(lineOps);
    console.log('Lines synced.');

    const deliveryCount = await Delivery.countDocuments();
    if (deliveryCount === 0) {
        await Delivery.insertMany(SEED_DELIVERIES);
        console.log('Seeded deliveries collection.');
    }
}

// GET all lines
app.get('/api/lines', async (req, res) => {
    try {
        const lines = await Line.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(lines);
    } catch (err) {
        sendApiError(res, err);
    }
});

// POST add a new line
app.post('/api/lines', async (req, res) => {
    try {
        const line = new Line(req.body);
        await line.save();
        res.status(201).json(serializeDoc(line));
    } catch (err) {
        sendApiError(res, err);
    }
});

// PATCH update a line (name, color, stations)
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

// PATCH update a line's stations list
app.patch('/api/lines/:id/stations', async (req, res) => {
    try {
        const line = await Line.findOne({ id: req.params.id });
        if (!line) return res.status(404).json({ error: 'Line not found.' });
        line.stations = req.body.stations;
        await line.save();
        res.json(serializeDoc(line));
    } catch (err) {
        sendApiError(res, err);
    }
});

// GET all stations
app.get('/api/stations', async (req, res) => {
    try {
        const stations = await Station.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(stations);
    } catch (err) {
        sendApiError(res, err);
    }
});

// POST add a new station
app.post('/api/stations', async (req, res) => {
    try {
        const station = new Station(req.body);
        await station.save();
        res.status(201).json(serializeDoc(station));
    } catch (err) {
        sendApiError(res, err);
    }
});

// PATCH update a station
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

// GET all drones
app.get('/api/drones', async (req, res) => {
    try {
        const drones = await Drone.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(drones);
    } catch (err) {
        sendApiError(res, err);
    }
});

// POST add a new drone
app.post('/api/drones', async (req, res) => {
    try {
        const existingIds = (await Drone.find({}, 'droneId')).map(d => d.droneId);
        let droneId;
        do { droneId = Math.floor(1000 + Math.random() * 9000); } while (existingIds.includes(droneId));

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

// PATCH update a drone
app.patch('/api/drones/:id', async (req, res) => {
    try {
        const drone = await Drone.findOne({ id: req.params.id });
        if (!drone) return res.status(404).json({ error: 'Drone not found.' });
        const fields = ['name', 'model', 'location', 'battery', 'batteryHealth', 'status', 'target_location', 'time_of_arrival', 'speed'];
        fields.forEach(f => { if (req.body[f] !== undefined) drone[f] = req.body[f]; });
        if (req.body.status !== 'on_route') { drone.target_location = null; drone.time_of_arrival = null; }
        await drone.save();
        res.json(serializeDoc(drone));
    } catch (err) {
        sendApiError(res, err);
    }
});

// GET all deliveries
app.get('/api/deliveries', async (req, res) => {
    try {
        const deliveries = await Delivery.find({}, '-_id -__v -updatedAt').sort({ createdAt: -1 });
        res.json(deliveries);
    } catch (err) {
        sendApiError(res, err);
    }
});

// POST add a new delivery
app.post('/api/deliveries', async (req, res) => {
    try {
        const delivery = new Delivery({
            id: await generateUniqueId(Delivery, 'RLY'),
            ...buildDeliveryPayload(req.body),
        });

        await delivery.save();
        res.status(201).json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

// PATCH update delivery status
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
        }

        await delivery.save();
        res.json(serializeDoc(delivery));
    } catch (err) {
        sendApiError(res, err);
    }
});

// ── Snowflake Cortex Analytics Chat ──
app.post('/api/cortex/chat', async (req, res) => {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });

    const SNOWFLAKE_URL = process.env.SNOWFLAKE_ACCOUNT_URL;
    const SNOWFLAKE_PAT = process.env.SNOWFLAKE_PAT;
    if (!SNOWFLAKE_URL || !SNOWFLAKE_PAT) {
        return res.status(500).json({ error: 'Snowflake credentials not configured.' });
    }

    try {
        // Pull live operational data for context
        const [deliveries, stations, drones] = await Promise.all([
            Delivery.find({}).sort({ createdAt: -1 }).limit(50).lean(),
            Station.find({}).lean(),
            Drone.find({}).lean(),
        ]);

        const deliverySummary = deliveries.map(d => `${d.id}: ${d.payload} from ${d.origin} to ${d.destination}, status=${d.status}, priority=${d.priority}, created=${d.createdAt}`).join('\n');
        const stationSummary = stations.map(s => `${s.id}: type=${s.type}, status=${s.status}, battery=${s.battery}%, temp=${s.temp}°C, capacity=${s.max_drone_capacity}`).join('\n');
        const droneSummary = drones.map(d => `${d.id} (${d.name}): model=${d.model}, status=${d.status}, battery=${d.battery}%, location=${d.location}`).join('\n');

        const systemPrompt = `You are the Aero'ed Corridor Intelligence Engine — an analytics assistant for a drone relay medicine delivery corridor in Northern Quebec, Canada.

You have access to LIVE operational data from the platform database. Use it to answer questions about deliveries, corridor performance, station health, fleet status, and operational analytics.

LIVE DATA:

DELIVERIES (${deliveries.length} records):
${deliverySummary || 'No deliveries yet.'}

STATIONS (${stations.length} nodes):
${stationSummary || 'No stations configured.'}

DRONES (${drones.length} units):
${droneSummary || 'No drones registered.'}

CONTEXT:
- The corridor runs from Chibougamau Hub (regional hospital) through relay stations to remote Cree communities along James Bay in Northern Quebec.
- Each drone carries sealed medicine cartridges ~20km per leg, swapping at each station. No manual handling — standardized sealed cartridge slots from one drone to the next.
- A helicopter alternative costs $5,000-$15,000+ per trip. Aero'ed replaces those with ~$150 drone relay deliveries.
- Station types: distribution (hub), transit (relay), pick_up (destination).

DOMAIN KNOWLEDGE:

THE PROBLEM:
- 18% of Canadians live in rural/remote areas, but only 8% of physicians practice there.
- In Ontario, 99.4% of urban residents live within 5km of a pharmacy — only 40.9% of rural residents do.
- 72% of Northern Ontario communities have no local pharmacist access.
- Rural Canadians face higher death rates, increased infant mortality, and shorter life expectancy.
- Some communities are only accessible by air for months at a time (ice roads are seasonal and unreliable).

RELAY CONCEPT:
Hospital/Pharmacy -> Station A -> Station B -> Station C -> Rural Community. At each station the medicine travels in a standardized sealed cartridge that swaps between drones. Spent drone docks, fresh drone launches. Each leg is ~20km, ~20 minutes (17min flight + 3min swap).

DRONE FLEET SPECS:
- DDC Sparrow: 20-30km range, 4.5kg payload, Canadian-made, healthcare-proven.
- DDC Robin XL: 60km range, 11.3kg payload, temperature-controlled, harsh climate rated.
- DJI FlyCart 30: 16-26km range, 30kg payload, heavy-lift reference.
- Flight speed: ~70 km/h. Station spacing: 15-20km.

PLATFORM INTEGRATIONS:
- Gemini API: AI dispatch, route optimization, natural language delivery requests.
- ElevenLabs: Multilingual voice alerts (English, French, Inuktitut) for delivery arrivals.
- MongoDB Atlas: Real-time operational database for drone states, deliveries, stations.
- Snowflake Cortex: Analytics warehouse, corridor intelligence (this chatbot).
- Solana: Immutable chain-of-custody ledger for controlled substances.
- Leaflet.js: Interactive corridor map with live tracking.

BUSINESS MODEL:
- Per-delivery fee: $75-$200/delivery (distance + priority based).
- Corridor operating contract: $500K-$2M/year per corridor from provincial health authorities.
- Beachhead customer: Ontario Health North — ~20 remote First Nations communities along James Bay.
- A single government corridor contract covers costs in Year 1.
- Charter flight replacement savings for health authority: $1.5M-$5M/year per corridor.
- Canadian drone services market projected at $5.9B by 2030.
- ~1,200 remote/isolated communities in Canada with limited healthcare access.

COMPETITIVE ADVANTAGE:
- DDC does direct point-to-point (20-60km). Aero'ed orchestrates multi-station relay corridors.
- Zipline uses fixed-wing (no Canadian presence). Amazon/Wing are urban last-mile only.
- Our moat: relay corridor orchestration software — dispatch, routing, handoff tracking, chain-of-custody, analytics.

Answer concisely and reference actual data from the records above. If asked about trends or statistics, compute them from the delivery records. You know everything about Aero'ed — the problem, the solution, the business model, the tech stack, and the live operational data.

IMPORTANT: You may use light markdown formatting (bold, bullet points) to make answers readable. Keep answers concise — aim for 2-6 sentences.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: message },
        ];

        const cortexRes = await fetch(`${SNOWFLAKE_URL}/api/v2/cortex/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SNOWFLAKE_PAT}`,
            },
            body: JSON.stringify({
                model: 'mistral-large2',
                messages,
                temperature: 0.3,
                max_completion_tokens: 1024,
            }),
        });

        if (!cortexRes.ok) {
            const errText = await cortexRes.text();
            console.error('Snowflake Cortex error:', cortexRes.status, errText);
            return res.status(cortexRes.status).json({ error: `Snowflake Cortex error: ${cortexRes.status}` });
        }

        const data = await cortexRes.json();
        const reply = data.choices?.[0]?.message?.content || 'No response from Cortex.';
        res.json({ reply, model: data.model || 'mistral-large2' });
    } catch (err) {
        sendApiError(res, err);
    }
});

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB Atlas.');
        await seedData();
        app.listen(3001, () => console.log('API server running on http://localhost:3001'));
    })
    .catch(err => {
        console.error('MongoDB connection failed:', err.message);
        process.exit(1);
    });
