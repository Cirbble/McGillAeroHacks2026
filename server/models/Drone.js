import mongoose from 'mongoose';

const DroneWarningSchema = new mongoose.Schema({
    stationId: { type: String, default: null },
    severity: { type: String, default: 'WATCH' },
    title: { type: String, default: '' },
    detail: { type: String, default: '' },
    issues: { type: [String], default: [] },
    summary: { type: String, default: '' },
}, { _id: false });

const DroneSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    droneId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    model: { type: String, required: true },
    location: { type: String, required: true },
    battery: { type: Number, required: true },
    batteryHealth: { type: Number, required: true },
    status: { type: String, enum: ['charging', 'ready', 'on_route', 'relocating'], required: true },
    target_location: { type: String, default: null },
    origin_location: { type: String, default: null },
    time_of_arrival: { type: String, default: null },
    relocationRoute: { type: [String], default: [] },
    recommendedRelocationRoute: { type: [String], default: [] },
    relocationDistanceKm: { type: Number, default: null },
    relocationRemainingDistanceKm: { type: Number, default: null },
    relocationRouteState: { type: String, enum: ['CLEAR', 'WATCH', 'ADVISORY', 'BLOCKED', 'REROUTED'], default: 'CLEAR' },
    relocationWeatherState: { type: String, enum: ['CLEAR', 'WATCH', 'UNSTABLE', 'SEVERE'], default: 'CLEAR' },
    relocationWarnings: { type: [DroneWarningSchema], default: [] },
    relocationRecommendedAction: { type: String, default: '' },
    relocationRerouteCount: { type: Number, default: 0 },
    lastRelocationReroutedAt: { type: Date, default: null },
    assignment: { type: String, default: null },
    speed: { type: Number, default: 0 },
}, { timestamps: true, id: false });

export default mongoose.model('Drone', DroneSchema);
