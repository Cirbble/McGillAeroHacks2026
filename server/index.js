import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Drone from './models/Drone.js';
import Station from './models/Station.js';
import Delivery from './models/Delivery.js';

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
    { id: 'Chibougamau Hub', type: 'distribution', status: 'online', battery: 100, temp: -8, lat: 49.9166, lng: -74.3680, max_drone_capacity: 8 },
    { id: 'Mistissini', type: 'transit', status: 'online', battery: 94, temp: -14, lat: 50.4221, lng: -73.8683, max_drone_capacity: 4 },
    { id: 'Nemaska', type: 'transit', status: 'online', battery: 88, temp: -16, lat: 51.6911, lng: -76.2356, max_drone_capacity: 4 },
    { id: 'Waskaganish', type: 'transit', status: 'maintenance', battery: 12, temp: -19, lat: 51.4833, lng: -78.7500, max_drone_capacity: 4 },
    { id: 'Eastmain', type: 'transit', status: 'online', battery: 91, temp: -18, lat: 52.2333, lng: -78.5167, max_drone_capacity: 4 },
    { id: 'Wemindji', type: 'transit', status: 'online', battery: 85, temp: -20, lat: 53.0103, lng: -78.8311, max_drone_capacity: 4 },
    { id: 'Chisasibi', type: 'pick_up', status: 'online', battery: 100, temp: -22, lat: 53.7940, lng: -78.9069, max_drone_capacity: 6 },
    { id: 'Whapmagoostui', type: 'pick_up', status: 'online', battery: 100, temp: -25, lat: 55.2530, lng: -77.7652, max_drone_capacity: 6 },
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

    const deliveryCount = await Delivery.countDocuments();
    if (deliveryCount === 0) {
        await Delivery.insertMany(SEED_DELIVERIES);
        console.log('Seeded deliveries collection.');
    }
}

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
