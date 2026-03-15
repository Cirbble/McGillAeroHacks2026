import { create } from 'zustand';

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const error = new Error(data?.error || `Request failed with status ${response.status}`);
        error.data = data;
        throw error;
    }

    return data;
}

export const useStore = create((set, get) => ({
    deliveries: [],
    stations: [],
    drones: [],
    lines: [],
    opsOverview: null,
    opsInsight: null,
    pathInsight: null,
    isLoading: false,
    opsLoading: false,
    opsInsightLoading: false,
    pathInsightLoading: false,
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

    createDemoDelivery: async (scenario = 'random') => {
        const result = await requestJson('/api/demo/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario }),
        });

        set((state) => ({
            deliveries: [result.delivery, ...state.deliveries],
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                deliveries: [result.delivery, ...state.opsOverview.deliveries],
            } : state.opsOverview,
        }));

        return result;
    },

    fetchOpsOverview: async () => {
        set({ opsLoading: true });

        try {
            const overview = await requestJson('/api/ops/overview');
            set({
                deliveries: overview.deliveries,
                stations: overview.stations,
                drones: overview.drones,
                lines: overview.lines,
                opsOverview: overview,
                opsLoading: false,
            });
            return overview;
        } catch (err) {
            set({ opsLoading: false });
            throw err;
        }
    },

    fetchOpsInsight: async () => {
        set({ opsInsightLoading: true });

        try {
            const insight = await requestJson('/api/ops/insight');
            set({ opsInsight: insight, opsInsightLoading: false });
            return insight;
        } catch (err) {
            set({ opsInsightLoading: false });
            throw err;
        }
    },

    fetchPathInsight: async (id) => {
        if (!id) {
            set({ pathInsight: null, pathInsightLoading: false });
            return null;
        }

        set({ pathInsightLoading: true });

        try {
            const insight = await requestJson(`/api/ops/path-insight/${id}`);
            set({ pathInsight: insight, pathInsightLoading: false });
            return insight;
        } catch (err) {
            set({ pathInsightLoading: false });
            throw err;
        }
    },

    rerouteDelivery: async (id, payload = {}) => {
        const result = await requestJson(`/api/deliveries/${id}/reroute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        set((state) => ({
            deliveries: state.deliveries.map((entry) => (
                entry.id === id ? result.delivery : entry
            )),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                deliveries: state.opsOverview.deliveries.map((entry) => (
                    entry.id === id ? result.delivery : entry
                )),
            } : state.opsOverview,
            pathInsight: state.pathInsight?.delivery?.id === id
                ? { ...state.pathInsight, delivery: result.delivery }
                : state.pathInsight,
        }));

        return result;
    },

    deleteDelivery: async (id) => {
        const result = await requestJson(`/api/deliveries/${id}`, {
            method: 'DELETE',
        });

        set((state) => ({
            deliveries: state.deliveries.filter((entry) => entry.id !== id),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                deliveries: state.opsOverview.deliveries.filter((entry) => entry.id !== id),
            } : state.opsOverview,
            pathInsight: state.pathInsight?.delivery?.id === id ? null : state.pathInsight,
        }));

        return result;
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

    deleteStation: async (id) => {
        const result = await requestJson(`/api/stations/${id}`, {
            method: 'DELETE',
        });

        set((state) => ({
            stations: state.stations.filter((station) => station.id !== id),
            lines: Array.isArray(result.lines)
                ? result.lines
                : state.lines.map((line) => ({
                    ...line,
                    stations: line.stations.filter((stationId) => stationId !== id),
                })),
            drones: state.drones.map((drone) => {
                const updated = result.updatedDrones?.find((entry) => entry.id === drone.id);
                return updated || drone;
            }),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                stations: state.opsOverview.stations.filter((station) => station.id !== id),
                lines: Array.isArray(result.lines)
                    ? result.lines
                    : state.opsOverview.lines.map((line) => ({
                        ...line,
                        stations: line.stations.filter((stationId) => stationId !== id),
                    })),
                drones: state.opsOverview.drones.map((drone) => {
                    const updated = result.updatedDrones?.find((entry) => entry.id === drone.id);
                    return updated || drone;
                }),
            } : state.opsOverview,
        }));

        return result;
    },

    fetchDrones: async () => {
        const drones = await requestJson('/api/drones');
        set({ drones });
        return drones;
    },

    relocateDrone: async (id, payload = {}) => {
        const result = await requestJson(`/api/drones/${id}/relocate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        set((state) => ({
            drones: state.drones.map((drone) => (
                drone.id === id ? { ...drone, ...result.drone, relocationReport: result.relocationReport } : drone
            )),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                drones: state.opsOverview.drones.map((drone) => (
                    drone.id === id ? { ...drone, ...result.drone, relocationReport: result.relocationReport } : drone
                )),
            } : state.opsOverview,
        }));

        return result;
    },

    rerouteDrone: async (id, payload = {}) => {
        const result = await requestJson(`/api/drones/${id}/reroute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        set((state) => ({
            drones: state.drones.map((drone) => (
                drone.id === id ? { ...drone, ...result.drone, relocationReport: result.relocationReport } : drone
            )),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                drones: state.opsOverview.drones.map((drone) => (
                    drone.id === id ? { ...drone, ...result.drone, relocationReport: result.relocationReport } : drone
                )),
            } : state.opsOverview,
        }));

        return result;
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

    deleteDrone: async (id) => {
        const result = await requestJson(`/api/drones/${id}`, {
            method: 'DELETE',
        });

        set((state) => ({
            drones: state.drones.filter((drone) => drone.id !== id),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                drones: state.opsOverview.drones.filter((drone) => drone.id !== id),
            } : state.opsOverview,
        }));

        return result;
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

    deleteLine: async (id) => {
        const result = await requestJson(`/api/lines/${id}`, {
            method: 'DELETE',
        });

        set((state) => ({
            lines: state.lines.filter((line) => line.id !== id),
            opsOverview: state.opsOverview ? {
                ...state.opsOverview,
                lines: state.opsOverview.lines.filter((line) => line.id !== id),
            } : state.opsOverview,
        }));

        return result;
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
