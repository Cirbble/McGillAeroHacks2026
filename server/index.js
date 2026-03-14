import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Drone from './models/Drone.js';
import Station from './models/Station.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

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
}

// GET all stations
app.get('/api/stations', async (req, res) => {
    try {
        const stations = await Station.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(stations);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST add a new station
app.post('/api/stations', async (req, res) => {
    try {
        const station = new Station(req.body);
        await station.save();
        const saved = station.toObject();
        delete saved._id;
        delete saved.__v;
        delete saved.createdAt;
        delete saved.updatedAt;
        res.status(201).json(saved);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET all drones
app.get('/api/drones', async (req, res) => {
    try {
        const drones = await Drone.find({}, '-_id -__v -createdAt -updatedAt');
        res.json(drones);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        const saved = drone.toObject();
        delete saved._id;
        delete saved.__v;
        delete saved.createdAt;
        delete saved.updatedAt;
        res.status(201).json(saved);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
