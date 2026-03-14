import mongoose from 'mongoose';

const StationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    type: { type: String, enum: ['distribution', 'transit', 'pick_up'], required: true },
    status: { type: String, enum: ['online', 'maintenance', 'offline'], required: true },
    battery: { type: Number, required: true },
    temp: { type: Number, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    max_drone_capacity: { type: Number, required: true, default: 4 },
}, { timestamps: true, id: false });

export default mongoose.model('Station', StationSchema);
