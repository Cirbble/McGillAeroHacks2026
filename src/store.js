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

    stations: [],

    drones: [],

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

    fetchStations: async () => {
        try {
            const res = await fetch('/api/stations');
            const stations = await res.json();
            set({ stations });
        } catch (err) {
            console.error('Failed to fetch stations:', err);
        }
    },

    fetchDrones: async () => {
        try {
            const res = await fetch('/api/drones');
            const drones = await res.json();
            set({ drones });
        } catch (err) {
            console.error('Failed to fetch drones:', err);
        }
    },

    addDrone: async (droneData) => {
        try {
            const res = await fetch('/api/drones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(droneData),
            });
            const newDrone = await res.json();
            set(state => ({ drones: [...state.drones, newDrone] }));
        } catch (err) {
            console.error('Failed to add drone:', err);
        }
    },
}));
