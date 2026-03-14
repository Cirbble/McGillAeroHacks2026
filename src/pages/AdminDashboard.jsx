import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Database, Camera, Maximize2, Signal, Thermometer, Battery, Gauge } from 'lucide-react';

const CORRIDOR_ORDER = ['Chibougamau Hub', 'Mistissini', 'Nemaska', 'Waskaganish', 'Eastmain', 'Wemindji', 'Chisasibi', 'Whapmagoostui'];

function orderStations(stations) {
    return [...stations].sort((a, b) => {
        const aIndex = CORRIDOR_ORDER.indexOf(a.id);
        const bIndex = CORRIDOR_ORDER.indexOf(b.id);
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
}

function getStationLabel(station) {
    const baseLabel = {
        distribution: 'HUB',
        transit: 'RELAY',
        pick_up: 'DESTINATION',
    }[station.type] || station.type.toUpperCase();

    if (station.status === 'maintenance') return `${baseLabel} (Maint.)`;
    if (station.status === 'offline') return `${baseLabel} (Offline)`;
    return baseLabel;
}

function findStationMatch(label, stations) {
    if (!label) return null;

    const normalized = label.toLowerCase();
    return stations.find((station) => (
        station.id.toLowerCase() === normalized || normalized.includes(station.id.toLowerCase())
    )) || null;
}

function getActiveDronePosition(drone, stations) {
    if (!drone) return null;

    const station = findStationMatch(drone.target_location, stations) || findStationMatch(drone.location, stations);
    if (!station) return null;

    const offset = drone.status === 'on_route' ? 0.12 : 0;
    return {
        lat: station.lat + offset,
        lng: station.lng + offset,
        tooltip: `${drone.id}<br/><span style="color:#64748b">${drone.speed} km/h · ${drone.target_location || drone.location}</span>`,
    };
}

function buildRouteCoordinates(delivery, stations) {
    if (!delivery?.route?.length) return [];

    return delivery.route
        .map((stop) => stations.find((station) => station.id === stop))
        .filter(Boolean)
        .map((station) => [station.lat, station.lng]);
}

/* ── Leaflet Map Component ── */
function CorridorMap({ stations = [], drones = [], deliveries = [], height = 380 }) {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        async function init() {
            const L = (await import('leaflet')).default;
            await import('leaflet/dist/leaflet.css');
            if (!mapRef.current) return;
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
            }

            const orderedStations = orderStations(stations);
            const activeDelivery = deliveries.find((delivery) => ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH'].includes(delivery.status));
            const routeCoords = buildRouteCoordinates(activeDelivery, orderedStations);
            const activeDronePosition = getActiveDronePosition(
                drones.find((drone) => drone.status === 'on_route') || drones[0],
                orderedStations,
            );
            const center = orderedStations[Math.floor(orderedStations.length / 2)] || { lat: 52.0, lng: -77.0 };

            const map = L.map(mapRef.current, {
                center: [center.lat, center.lng], zoom: 6,
                zoomControl: false, attributionControl: false,
            });

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            const coords = orderedStations.map((station) => [station.lat, station.lng]);
            if (coords.length > 1) {
                L.polyline(coords, { color: '#94a3b8', weight: 2, opacity: 0.4, dashArray: '8 6' }).addTo(map);
            }
            if (routeCoords.length > 1) {
                L.polyline(routeCoords, { color: '#2563eb', weight: 3, opacity: 0.9 }).addTo(map);
            }

            orderedStations.forEach((station) => {
                const isActive = station.status === 'online';
                const label = getStationLabel(station);
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="width:${station.type === 'distribution' ? 16 : 12}px;height:${station.type === 'distribution' ? 16 : 12}px;border-radius:50%;background:${isActive ? '#2563eb' : '#94a3b8'};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2);"></div>`,
                    iconSize: [station.type === 'distribution' ? 16 : 12, station.type === 'distribution' ? 16 : 12],
                    iconAnchor: [station.type === 'distribution' ? 8 : 6, station.type === 'distribution' ? 8 : 6],
                });
                L.marker([station.lat, station.lng], { icon })
                    .addTo(map)
                    .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${station.id}</strong><br/><span style="color:#64748b">${label}</span></div>`, { direction: 'top', offset: [0, -10] });
            });

            if (activeDronePosition) {
                const droneIcon = L.divIcon({
                    className: '',
                    html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 4px rgba(37,99,235,0.2), 0 2px 6px rgba(0,0,0,0.2);"></div>`,
                    iconSize: [18, 18], iconAnchor: [9, 9],
                });
                L.marker([activeDronePosition.lat, activeDronePosition.lng], { icon: droneIcon })
                    .addTo(map)
                    .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${activeDronePosition.tooltip}</strong></div>`, { direction: 'top', offset: [0, -12] });
            }

            mapInstance.current = map;
        }
        init();
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, [deliveries, drones, stations]);

    return <div ref={mapRef} style={{ width: '100%', height }} />;
}

/* ── Drone Feed Component ── */
function DroneFeed({ src, label, id, isVideo }) {
    return (
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
            {isVideo ? (
                <video src={src} autoPlay muted loop playsInline style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
            ) : (
                <img src={src} alt={label} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
            )}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.5) 100%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.6)' }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>REC</span>
            </div>
            <div style={{ position: 'absolute', top: 10, right: 12 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{id}</span>
            </div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{label}</span>
                <Maximize2 size={13} color="rgba(255,255,255,0.5)" />
            </div>
        </div>
    );
}

export default function AdminDashboard() {
    const { deliveries, stations, drones, addStation, addDrone } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

    const emptyDroneForm = { name: '', model: '', location: '', battery: 100, batteryHealth: 100, status: 'ready', target_location: '', time_of_arrival: '' };
    const [showAddDrone, setShowAddDrone] = useState(false);
    const [droneForm, setDroneForm] = useState(emptyDroneForm);

    const emptyNodeForm = { id: '', type: 'transit', status: 'online', battery: 100, temp: 0, lat: '', lng: '', max_drone_capacity: 4 };
    const [showAddNode, setShowAddNode] = useState(false);
    const [nodeForm, setNodeForm] = useState(emptyNodeForm);
    const orderedStations = orderStations(stations);
    const activeDrone = drones.find((drone) => drone.status === 'on_route') || drones[0] || null;
    const activeDelivery = deliveries.find((delivery) => ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH'].includes(delivery.status)) || null;
    const surveillanceFeeds = [
        { src: '/feeds/cam1.png', label: activeDrone ? `${activeDrone.id} Forward Camera` : 'Primary Drone Feed', id: 'CAM-01' },
        { src: '/feeds/cam2.png', label: orderedStations[1] ? `${orderedStations[1].id} Landing Pad` : 'Relay Pad', id: 'CAM-02' },
        { src: '/feeds/cam3.png', label: orderedStations.at(-2) ? `${orderedStations.at(-2).id} Approach` : 'Destination Approach', id: 'CAM-03' },
    ];

    async function handleAddDrone(e) {
        e.preventDefault();

        try {
            await addDrone({
                name: droneForm.name,
                model: droneForm.model,
                location: droneForm.location,
                battery: Number(droneForm.battery),
                batteryHealth: Number(droneForm.batteryHealth),
                status: droneForm.status,
                ...(droneForm.status === 'on_route' ? { target_location: droneForm.target_location, time_of_arrival: droneForm.time_of_arrival } : {}),
            });
            setDroneForm(emptyDroneForm);
            setShowAddDrone(false);
        } catch (err) {
            alert('Failed to add drone: ' + err.message);
        }
    }

    async function handleAddNode(e) {
        e.preventDefault();

        try {
            await addStation({
                id: nodeForm.id,
                type: nodeForm.type,
                status: nodeForm.status,
                battery: Number(nodeForm.battery),
                temp: Number(nodeForm.temp),
                lat: Number(nodeForm.lat),
                lng: Number(nodeForm.lng),
                max_drone_capacity: Number(nodeForm.max_drone_capacity),
            });
            setNodeForm(emptyNodeForm);
            setShowAddNode(false);
        } catch (err) {
            alert('Failed to add node: ' + err.message);
        }
    }

    const active = deliveries.filter(d => ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH'].includes(d.status));
    const onlineStations = stations.filter(s => s.status === 'online').length;

    /* ── Platform Overview ── */
    if (hash === '') {
        return (
            <div>
                <div className="page-header">
                    <h1>Platform Overview</h1>
                    <p>Real-time corridor health and active logistics across the Northern Quebec corridor.</p>
                </div>

                <div className="stats-grid">
                    <div className="card stat-card">
                        <div className="stat-label">Network Uptime</div>
                        <div className="stat-value">99.9<span className="stat-value-unit">%</span></div>
                        <div className="stat-sub" style={{ color: 'var(--accent)' }}>↑ 0.2% from last week</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Active Flights</div>
                        <div className="stat-value">{active.length}<span className="stat-value-unit">/ 24</span></div>
                        <div className="stat-sub stat-sub-muted">{Math.round(active.length / 24 * 100)}% capacity</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Nodes Online</div>
                        <div className="stat-value">{onlineStations}<span className="stat-value-unit">/ {stations.length}</span></div>
                        <div className="stat-sub stat-sub-muted">All critical hubs operational</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Avg. Delivery Time</div>
                        <div className="stat-value">1h 14m</div>
                        <div className="stat-sub" style={{ color: 'var(--accent)' }}>↓ 18% from last month</div>
                    </div>
                </div>

                {/* Map + Queue */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 24 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header">
                            <span className="card-header-title"><Signal size={14} /> Northern Quebec Corridor – Live Tracking</span>
                        </div>
                        <CorridorMap height={400} stations={orderedStations} drones={drones} deliveries={deliveries} />
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div className="card-header">
                            <span className="card-header-title"><Activity size={14} /> Active Queue</span>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{active.length} flights</span>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                            {active.map(d => (
                                <div key={d.id} style={{ padding: '14px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>{d.payload}</span>
                                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>{d.status.replace(/_/g, ' ')}</span>
                                    </div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                        {d.id} · {d.origin} → {d.destination}
                                    </div>
                                    {d.status === 'IN_TRANSIT' && (
                                        <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                                                <span>Leg {d.currentLeg}/{d.totalLegs}</span>
                                                <span className="mono">ETA {new Date(d.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <div className="progress-track"><div className="progress-fill" style={{ width: `${(d.currentLeg / d.totalLegs) * 100}%` }} /></div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {active.length === 0 && (
                                <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)', fontSize: 13 }}>No active flights.</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Surveillance Feeds */}
                <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Surveillance Feeds</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                        {surveillanceFeeds.map((feed) => (
                            <DroneFeed key={feed.id} src={feed.src} label={feed.label} id={feed.id} />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    /* ── Live Operations ── */
    if (hash === '#operations') {
        return (
            <div>
                <div className="page-header">
                    <h1>Live Operations</h1>
                    <p>Full corridor monitoring with telemetry and fleet positioning.</p>
                </div>

                <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
                    <CorridorMap height={560} stations={orderedStations} drones={drones} deliveries={deliveries} />

                    {/* Floating Telemetry */}
                    <div style={{ position: 'absolute', top: 16, left: 16, background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 240, boxShadow: 'var(--shadow-md)', zIndex: 1000 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Active Drone</span>
                            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>{activeDrone?.id || '—'}</span>
                        </div>
                        {[
                            { icon: Gauge, label: 'Speed', value: activeDrone ? `${activeDrone.speed} km/h` : '—' },
                            { icon: Signal, label: 'Status', value: activeDrone ? activeDrone.status.replace(/_/g, ' ') : '—' },
                            { icon: Battery, label: 'Battery', value: activeDrone ? `${activeDrone.battery}%` : '—' },
                            { icon: Thermometer, label: 'Target', value: activeDrone?.target_location || activeDrone?.location || '—' },
                        ].map(({ icon: Icon, label, value }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 8 }}>
                                <Icon size={14} color="var(--text-secondary)" />
                                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
                                <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                            {activeDelivery ? (
                                <>Routing to <strong style={{ color: 'var(--text)' }}>{activeDelivery.destination}</strong> via live corridor state</>
                            ) : (
                                <>No live assignment in the corridor.</>
                            )}
                        </div>
                    </div>
                </div>

                {/* Fleet Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 24 }}>
                    {drones.map(d => (
                        <div key={d.id} className="card" style={{ padding: '20px 24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{d.id}</span>
                                <span className="badge badge-neutral">{d.status}</span>
                            </div>
                            {[
                                { label: 'Battery', value: `${d.battery}%`, bar: true },
                                { label: 'Assignment', value: d.assignment || '—' },
                                { label: 'Location', value: d.location },
                            ].map(item => (
                                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                    <span>{item.label}</span>
                                    {item.bar ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${d.battery}%`, background: 'var(--accent)', borderRadius: 3 }} />
                                            </div>
                                            <span className="mono" style={{ fontWeight: 600, color: 'var(--text)' }}>{item.value}</span>
                                        </div>
                                    ) : (
                                        <span className="mono" style={{ fontWeight: 500, color: 'var(--text)' }}>{item.value}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /* ── Infrastructure ── */
    if (hash === '#infrastructure') {
        return (
            <div>
                <div className="page-header">
                    <h1>Infrastructure</h1>
                    <p>Landing pads, charging arrays, and relay node health.</p>
                </div>

                {/* Stations Table */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Nodes</h2>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => setShowAddNode(true)}>+ Add Node</button>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {stations.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 13 }}>No nodes for now.</div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr><th>Node Name</th><th>Type</th><th>Status</th><th>Battery Array</th><th>Pad Temp</th><th>Drones</th><th>Coords</th></tr>
                            </thead>
                            <tbody>
                                {stations.map(s => {
                                    const current = drones.filter(d => d.location.toLowerCase().includes(s.id.toLowerCase().split(' ')[0])).length;
                                    const typeLabel = s.type === 'pick_up' ? 'pick up' : s.type;
                                    return (
                                        <tr key={s.id}>
                                            <td className="bold">{s.id}</td>
                                            <td className="capitalize muted">{typeLabel}</td>
                                            <td>
                                                <span className={`badge ${s.status === 'online' ? 'badge-green' : s.status === 'maintenance' ? 'badge-yellow' : 'badge-neutral'}`}>
                                                    {s.status}
                                                </span>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    <div style={{ width: 80, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', width: `${s.battery}%`, background: s.battery < 20 ? 'var(--danger)' : 'var(--accent)', borderRadius: 3 }} />
                                                    </div>
                                                    <span className="mono" style={{ fontSize: 12 }}>{s.battery}%</span>
                                                </div>
                                            </td>
                                            <td className="mono">{s.temp}°C</td>
                                            <td className="mono">{current} / {s.max_drone_capacity}</td>
                                            <td className="mono muted" style={{ fontSize: 11 }}>{s.lat?.toFixed(4)}, {s.lng?.toFixed(4)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Drones Table */}
                <div style={{ marginTop: 28 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Drones</h2>
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => setShowAddDrone(true)}>+ Add Drone</button>
                    </div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        {drones.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 13 }}>No drones for now.</div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr><th>Drone ID</th><th>Name</th><th>Model</th><th>Location</th><th>Battery</th><th>Batt. Health</th><th>Status</th><th>Target</th><th>Arrival</th></tr>
                                </thead>
                                <tbody>
                                    {drones.map(d => (
                                        <tr key={d.id}>
                                            <td className="mono" style={{ fontWeight: 600 }}>{d.droneId}</td>
                                            <td className="bold">{d.name}</td>
                                            <td className="muted">{d.model}</td>
                                            <td>{d.location}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                                        <div style={{ height: '100%', width: `${d.battery}%`, background: d.battery < 20 ? 'var(--danger)' : 'var(--accent)', borderRadius: 3 }} />
                                                    </div>
                                                    <span className="mono" style={{ fontSize: 12 }}>{d.battery}%</span>
                                                </div>
                                            </td>
                                            <td className="mono">{d.batteryHealth}%</td>
                                            <td>
                                                <span className={`badge ${d.status === 'ready' ? 'badge-green' : d.status === 'on_route' ? 'badge-blue' : 'badge-yellow'}`}>
                                                    {d.status === 'on_route' ? 'on route' : d.status}
                                                </span>
                                            </td>
                                            <td className="muted">{d.status === 'on_route' ? d.target_location : '—'}</td>
                                            <td className="mono">{d.status === 'on_route' ? d.time_of_arrival : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Station Cameras */}
                <div style={{ marginTop: 28 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Station Cameras</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                        {surveillanceFeeds.map((feed) => (
                            <DroneFeed key={`${feed.id}-infra`} src={feed.src} label={feed.label} id={feed.id} />
                        ))}
                    </div>
                </div>

                {/* Add Node Modal */}
                {showAddNode && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 520, padding: '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Add New Node</h2>
                            <form onSubmit={handleAddNode}>
                                <div style={{ marginBottom: 16 }}>
                                    <label className="form-label">Node Name</label>
                                    <input className="form-input" required value={nodeForm.id} onChange={e => setNodeForm(f => ({ ...f, id: e.target.value }))} placeholder="e.g. Oujé-Bougoumou" />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Type</label>
                                        <select className="form-input" value={nodeForm.type} onChange={e => setNodeForm(f => ({ ...f, type: e.target.value }))}>
                                            <option value="distribution">Distribution</option>
                                            <option value="transit">Transit</option>
                                            <option value="pick_up">Pick Up</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Status</label>
                                        <select className="form-input" value={nodeForm.status} onChange={e => setNodeForm(f => ({ ...f, status: e.target.value }))}>
                                            <option value="online">Online</option>
                                            <option value="maintenance">Maintenance</option>
                                            <option value="offline">Offline</option>
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Latitude</label>
                                        <input className="form-input" type="number" step="any" required value={nodeForm.lat} onChange={e => setNodeForm(f => ({ ...f, lat: e.target.value }))} placeholder="e.g. 49.9166" />
                                    </div>
                                    <div>
                                        <label className="form-label">Longitude</label>
                                        <input className="form-input" type="number" step="any" required value={nodeForm.lng} onChange={e => setNodeForm(f => ({ ...f, lng: e.target.value }))} placeholder="e.g. -74.3680" />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Max Drone Cap.</label>
                                        <input className="form-input" type="number" min="1" required value={nodeForm.max_drone_capacity} onChange={e => setNodeForm(f => ({ ...f, max_drone_capacity: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="form-label">Battery Array (%)</label>
                                        <input className="form-input" type="number" min="0" max="100" required value={nodeForm.battery} onChange={e => setNodeForm(f => ({ ...f, battery: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="form-label">Pad Temp (°C)</label>
                                        <input className="form-input" type="number" required value={nodeForm.temp} onChange={e => setNodeForm(f => ({ ...f, temp: e.target.value }))} placeholder="e.g. -15" />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowAddNode(false); setNodeForm(emptyNodeForm); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Add Node</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Add Drone Modal */}
                {showAddDrone && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 480, padding: '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Add New Drone</h2>
                            <form onSubmit={handleAddDrone}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Name</label>
                                        <input className="form-input" required value={droneForm.name} onChange={e => setDroneForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Relay Echo" />
                                    </div>
                                    <div>
                                        <label className="form-label">Model</label>
                                        <input className="form-input" required value={droneForm.model} onChange={e => setDroneForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g. DDC Sparrow" />
                                    </div>
                                </div>
                                <div style={{ marginBottom: 16 }}>
                                    <label className="form-label">Current Location</label>
                                    <select className="form-input" required value={droneForm.location} onChange={e => setDroneForm(f => ({ ...f, location: e.target.value }))}>
                                        <option value="">Select a distribution centre…</option>
                                        {stations.filter(s => s.type === 'distribution').map(s => (
                                            <option key={s.id} value={s.id}>{s.id}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Battery (%)</label>
                                        <input className="form-input" type="number" min="0" max="100" required value={droneForm.battery} onChange={e => setDroneForm(f => ({ ...f, battery: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="form-label">Battery Health (%)</label>
                                        <input className="form-input" type="number" min="0" max="100" required value={droneForm.batteryHealth} onChange={e => setDroneForm(f => ({ ...f, batteryHealth: e.target.value }))} />
                                    </div>
                                </div>
                                <div style={{ marginBottom: 16 }}>
                                    <label className="form-label">Status</label>
                                    <select className="form-input" value={droneForm.status} onChange={e => setDroneForm(f => ({ ...f, status: e.target.value }))}>
                                        <option value="ready">Ready</option>
                                        <option value="charging">Charging</option>
                                        <option value="on_route">On Route</option>
                                    </select>
                                </div>
                                {droneForm.status === 'on_route' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        <div>
                                            <label className="form-label">Target Location</label>
                                            <input className="form-input" required value={droneForm.target_location} onChange={e => setDroneForm(f => ({ ...f, target_location: e.target.value }))} placeholder="e.g. Nemaska" />
                                        </div>
                                        <div>
                                            <label className="form-label">Time of Arrival</label>
                                            <input className="form-input" required value={droneForm.time_of_arrival} onChange={e => setDroneForm(f => ({ ...f, time_of_arrival: e.target.value }))} placeholder="e.g. 35 min" />
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowAddDrone(false); setDroneForm(emptyDroneForm); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Add Drone</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ── Analytics ── */
    if (hash === '#analytics') {
        return (
            <div>
                <div className="page-header">
                    <h1>Corridor Analytics</h1>
                    <p>Operational economics and efficiency metrics.</p>
                </div>

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <div className="card stat-card">
                        <div className="stat-label">Avg. Block Time</div>
                        <div className="stat-value">1h 14m</div>
                        <div className="stat-sub" style={{ color: 'var(--accent)' }}>18% faster than winter average</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Helicopter Charter Savings</div>
                        <div className="stat-value">$421,500</div>
                        <div className="stat-sub stat-sub-muted">Year to date, 210 sorties replaced</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Payload Volume (30d)</div>
                        <div className="stat-value">842<span className="stat-value-unit">kg</span></div>
                        <div className="stat-sub stat-sub-muted">Across 210 successful sorties</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Renewable Energy Use</div>
                        <div className="stat-value">84<span className="stat-value-unit">%</span></div>
                        <div className="stat-sub" style={{ color: 'var(--accent)' }}>Solar arrays at Mistissini and Nemaska</div>
                    </div>
                </div>

                {/* Full Manifest Table */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
                    <div className="card-header">
                        <span className="card-header-title"><Activity size={14} /> Full Manifest Log</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{deliveries.length} records</span>
                    </div>
                    <table className="data-table">
                        <thead>
                            <tr><th>Trace ID</th><th>Payload</th><th>Route</th><th>Priority</th><th>Status</th><th>Created</th></tr>
                        </thead>
                        <tbody>
                            {[...deliveries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(d => (
                                <tr key={d.id}>
                                    <td className="mono">{d.id}</td>
                                    <td className="bold">{d.payload}</td>
                                    <td className="muted">{d.origin} → {d.destination}</td>
                                    <td><span className="badge badge-neutral">{d.priority}</span></td>
                                    <td><span className={`badge ${d.status === 'DELIVERED' ? 'badge-green' : 'badge-neutral'}`}>{d.status.replace(/_/g, ' ')}</span></td>
                                    <td className="mono muted">{new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}
