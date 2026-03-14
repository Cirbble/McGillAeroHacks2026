import mongoose from 'mongoose';

const LineSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
    stations: [{ type: String }],
}, { timestamps: true, id: false });

export default mongoose.model('Line', LineSchema);
