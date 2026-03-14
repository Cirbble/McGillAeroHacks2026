import mongoose from 'mongoose';

const DeliverySchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    payload: { type: String, required: true },
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    priority: { type: String, enum: ['Routine', 'Urgent', 'Emergency'], required: true },
    status: { type: String, enum: ['PENDING_DISPATCH', 'IN_TRANSIT', 'HANDOFF', 'DELIVERED'], required: true },
    currentLeg: { type: Number, required: true, default: 0 },
    totalLegs: { type: Number, required: true, default: 1 },
    lastStation: { type: String, required: true },
    eta: { type: Date, required: true },
    solanaTx: { type: String, required: true },
    route: { type: [String], default: [] },
    reasoning: { type: String, default: '' },
    estimatedTime: { type: String, default: '2h 10m' },
    weightKg: { type: Number, default: null },
}, { timestamps: true, id: false });

export default mongoose.model('Delivery', DeliverySchema);
