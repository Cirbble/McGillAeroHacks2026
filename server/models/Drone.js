import mongoose from 'mongoose';

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
    time_of_arrival: { type: String, default: null },
    assignment: { type: String, default: null },
    speed: { type: Number, default: 0 },
}, { timestamps: true, id: false });

export default mongoose.model('Drone', DroneSchema);
