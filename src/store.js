import { create } from 'zustand';

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
        throw new Error(data?.error || `Request failed with status ${response.status}`);
    }

    return data;
}

export const useStore = create((set, get) => ({
    deliveries: [],
    stations: [],
    drones: [],
    lines: [],
    isLoading: false,
    hasInitialized: false,
    error: null,

    initializeData: async (force = false) => {
        if (get().isLoading || (!force && get().hasInitialized)) return;

        set({ isLoading: true, error: null });

        try {
            const [deliveries, stations, drones, lines] = await Promise.all([
                requestJson('/api/deliveries'),
                requestJson('/api/stations'),
                requestJson('/api/drones'),
                requestJson('/api/lines'),
            ]);

            set({
                deliveries,
                stations,
                drones,
                lines,
                hasInitialized: true,
                isLoading: false,
                error: null,
            });
        } catch (err) {
            set({ isLoading: false, error: err.message });
            throw err;
        }
    },

    fetchDeliveries: async () => {
        const deliveries = await requestJson('/api/deliveries');
        set({ deliveries });
        return deliveries;
    },

    addDelivery: async (deliveryReq) => {
        const delivery = await requestJson('/api/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deliveryReq),
        });

        set((state) => ({ deliveries: [delivery, ...state.deliveries] }));
        return delivery;
    },

    updateDeliveryStatus: async (id, status) => {
        const delivery = await requestJson(`/api/deliveries/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });

        set((state) => ({
            deliveries: state.deliveries.map((entry) => (
                entry.id === id ? delivery : entry
            )),
        }));

        return delivery;
    },

    fetchStations: async () => {
        const stations = await requestJson('/api/stations');
        set({ stations });
        return stations;
    },

    addStation: async (stationData) => {
        const station = await requestJson('/api/stations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stationData),
        });

        set((state) => ({ stations: [...state.stations, station] }));
        return station;
    },

    fetchDrones: async () => {
        const drones = await requestJson('/api/drones');
        set({ drones });
        return drones;
    },

    addDrone: async (droneData) => {
        const drone = await requestJson('/api/drones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(droneData),
        });

        set((state) => ({ drones: [...state.drones, drone] }));
        return drone;
    },

    updateStation: async (id, updates) => {
        const station = await requestJson(`/api/stations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        set((state) => ({ stations: state.stations.map((s) => (s.id === id ? station : s)) }));
        return station;
    },

    updateDrone: async (id, updates) => {
        const drone = await requestJson(`/api/drones/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        set((state) => ({ drones: state.drones.map((d) => (d.id === id ? drone : d)) }));
        return drone;
    },

    addLine: async (lineData) => {
        const line = await requestJson('/api/lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lineData),
        });

        set((state) => ({ lines: [...state.lines, line] }));
        return line;
    },

    updateLine: async (id, updates) => {
        const line = await requestJson(`/api/lines/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });

        set((state) => ({ lines: state.lines.map((l) => (l.id === id ? line : l)) }));
        return line;
    },
}));
