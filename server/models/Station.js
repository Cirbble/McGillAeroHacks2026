import mongoose from 'mongoose';

const StationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    type: { type: String, enum: ['hub', 'relay', 'destination'], required: true },
    status: { type: String, enum: ['online', 'maintenance', 'offline'], required: true },
    battery: { type: Number, required: true },
    temp: { type: Number, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
}, { timestamps: true });

export default mongoose.model('Station', StationSchema);
