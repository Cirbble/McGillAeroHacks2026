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

function buildOverviewState(overview) {
    return {
        deliveries: overview.deliveries || [],
        stations: overview.stations || [],
        drones: overview.drones || [],
        lines: overview.lines || [],
        opsOverview: overview,
    };
}

let operationalStateRequest = null;

function fetchOperationalState(set, reuseInFlight = false) {
    if (reuseInFlight && operationalStateRequest) {
        return operationalStateRequest;
    }

    const request = requestJson('/api/ops/overview')
        .then((overview) => {
            set(buildOverviewState(overview));
            return overview;
        })
        .finally(() => {
            if (operationalStateRequest === request) {
                operationalStateRequest = null;
            }
        });

    if (reuseInFlight) {
        operationalStateRequest = request;
    }

    return request;
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
            await get().refreshOperationalState(true);
            set({ hasInitialized: true, isLoading: false, error: null });
        } catch (err) {
            set({ isLoading: false, error: err.message });
            throw err;
        }
    },

    refreshOperationalState: async (reuseInFlight = false) => {
        return fetchOperationalState(set, reuseInFlight);
    },

    fetchDeliveries: async () => {
        const overview = await get().refreshOperationalState(true);
        return overview.deliveries;
    },

    addDelivery: async (deliveryReq) => {
        const delivery = await requestJson('/api/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deliveryReq),
        });

        await get().initializeData(true);
        return delivery;
    },

    createSupplyRequest: async (requestBody) => {
        const delivery = await requestJson('/api/deliveries/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        await get().initializeData(true);
        return delivery;
    },

    previewSupplyRequest: async (requestBody) => {
        return requestJson('/api/deliveries/request/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
    },

    approveDelivery: async (id, action) => {
        const delivery = await requestJson(`/api/deliveries/${id}/approve`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
        });

        await get().initializeData(true);
        return delivery;
    },

    cancelDelivery: async (id) => {
        const delivery = await requestJson(`/api/deliveries/${id}/cancel`, {
            method: 'PATCH',
        });

        await get().initializeData(true);
        return delivery;
    },

    createDemoDelivery: async (scenario = 'random') => {
        const result = await requestJson('/api/demo/deliveries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario }),
        });

        await get().initializeData(true);
        return result;
    },

    fetchOpsOverview: async () => {
        set({ opsLoading: true });

        try {
            const overview = await get().refreshOperationalState(true);
            set({ opsLoading: false });
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
            set((state) => ({
                pathInsight: insight,
                pathInsightLoading: false,
                deliveries: state.deliveries.map((delivery) => (
                    delivery.id === insight.delivery?.id ? { ...delivery, ...insight.delivery } : delivery
                )),
                opsOverview: state.opsOverview ? {
                    ...state.opsOverview,
                    deliveries: state.opsOverview.deliveries.map((delivery) => (
                        delivery.id === insight.delivery?.id ? { ...delivery, ...insight.delivery } : delivery
                    )),
                } : state.opsOverview,
            }));
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

        await get().initializeData(true);
        return result;
    },

    updateDeliveryStatus: async (id, status) => {
        const delivery = await requestJson(`/api/deliveries/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });

        await get().initializeData(true);
        return delivery;
    },

    fetchStations: async () => {
        const overview = await get().refreshOperationalState();
        return overview.stations;
    },

    addStation: async (stationData) => {
        const station = await requestJson('/api/stations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stationData),
        });

        await get().refreshOperationalState();
        return station;
    },

    deleteStation: async (id) => {
        const result = await requestJson(`/api/stations/${id}`, {
            method: 'DELETE',
        });

        await get().refreshOperationalState();

        return result;
    },

    fetchDrones: async () => {
        const overview = await get().refreshOperationalState();
        return overview.drones;
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

        await get().refreshOperationalState();
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

        await get().refreshOperationalState();
        return result;
    },

    addDrone: async (droneData) => {
        const drone = await requestJson('/api/drones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(droneData),
        });

        await get().refreshOperationalState();
        return drone;
    },

    deleteDrone: async (id) => {
        const result = await requestJson(`/api/drones/${id}`, {
            method: 'DELETE',
        });

        await get().refreshOperationalState();

        return result;
    },

    updateStation: async (id, updates) => {
        const station = await requestJson(`/api/stations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        await get().refreshOperationalState();
        return station;
    },

    updateDrone: async (id, updates) => {
        const drone = await requestJson(`/api/drones/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        await get().refreshOperationalState();
        return drone;
    },

    addLine: async (lineData) => {
        const line = await requestJson('/api/lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lineData),
        });

        await get().refreshOperationalState();
        return line;
    },

    deleteLine: async (id) => {
        const result = await requestJson(`/api/lines/${id}`, {
            method: 'DELETE',
        });

        await get().refreshOperationalState();

        return result;
    },

    updateLine: async (id, updates) => {
        const line = await requestJson(`/api/lines/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });

        await get().refreshOperationalState();
        return line;
    },
}));
