import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

const generateETA = (minutes) => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date.toISOString();
};

export const useStore = create((set, get) => ({
    deliveries: [
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
            createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
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
            createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
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
            eta: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            solanaTx: '9aBz21...3qW55y',
            route: ['Chibougamau Hub', 'Mistissini'],
            reasoning: 'Short-range direct delivery to nearest community.',
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        }
    ],

    // Northern Quebec stations — real coordinates
    stations: [
        { id: 'Chibougamau Hub', type: 'hub', status: 'online', battery: 100, temp: -8, lat: 49.9166, lng: -74.3680 },
        { id: 'Mistissini', type: 'relay', status: 'online', battery: 94, temp: -14, lat: 50.4221, lng: -73.8683 },
        { id: 'Nemaska', type: 'relay', status: 'online', battery: 88, temp: -16, lat: 51.6911, lng: -76.2356 },
        { id: 'Waskaganish', type: 'relay', status: 'maintenance', battery: 12, temp: -19, lat: 51.4833, lng: -78.7500 },
        { id: 'Eastmain', type: 'relay', status: 'online', battery: 91, temp: -18, lat: 52.2333, lng: -78.5167 },
        { id: 'Wemindji', type: 'relay', status: 'online', battery: 85, temp: -20, lat: 53.0103, lng: -78.8311 },
        { id: 'Chisasibi', type: 'destination', status: 'online', battery: 100, temp: -22, lat: 53.7940, lng: -78.9069 },
        { id: 'Whapmagoostui', type: 'destination', status: 'online', battery: 100, temp: -25, lat: 55.2530, lng: -77.7652 },
    ],

    drones: [
        { id: 'DRN-409', status: 'active', assignment: 'RLY-9082', battery: 68, speed: 72, location: 'En route to Waskaganish' },
        { id: 'DRN-102', status: 'docked', assignment: 'RLY-9083', battery: 100, speed: 0, location: 'Mistissini' },
        { id: 'DRN-311', status: 'charging', assignment: null, battery: 45, speed: 0, location: 'Nemaska' },
        { id: 'DRN-205', status: 'docked', assignment: null, battery: 100, speed: 0, location: 'Chisasibi' },
    ],

    addDelivery: (deliveryReq) => set((state) => {
        const newDelivery = {
            id: `RLY-${Math.floor(1000 + Math.random() * 9000)}`,
            status: 'PENDING_DISPATCH',
            currentLeg: 0,
            totalLegs: deliveryReq.estimated_legs || Math.floor(Math.random() * 3) + 2,
            lastStation: deliveryReq.origin || 'Chibougamau Hub',
            eta: generateETA(deliveryReq.estimated_time_minutes || 120),
            solanaTx: `tx_${uuidv4().substring(0, 8)}...`,
            createdAt: new Date().toISOString(),
            origin: deliveryReq.origin || 'Chibougamau Hub',
            destination: deliveryReq.destination,
            payload: deliveryReq.payload,
            priority: deliveryReq.priority || 'Routine',
            route: deliveryReq.route || [],
            reasoning: deliveryReq.reasoning || '',
            estimatedTime: deliveryReq.estimated_time_minutes ? `${Math.floor(deliveryReq.estimated_time_minutes / 60)}h ${deliveryReq.estimated_time_minutes % 60}m` : '2h 10m',
        };
        return { deliveries: [newDelivery, ...state.deliveries] };
    }),

    updateDeliveryStatus: (id, status) => set((state) => ({
        deliveries: state.deliveries.map((d) =>
            d.id === id ? { ...d, status } : d
        )
    })),
}));
