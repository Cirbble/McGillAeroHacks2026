import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useEffect, useRef } from 'react';
import { Activity, AlertTriangle, Database, Camera, Maximize2, Signal, Thermometer, Battery, Gauge } from 'lucide-react';

/* ── Leaflet Map Component ── */
function CorridorMap({ height = 380 }) {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        async function init() {
            const L = (await import('leaflet')).default;
            await import('leaflet/dist/leaflet.css');
            if (mapInstance.current) return;

            const map = L.map(mapRef.current, {
                center: [52.0, -77.0], zoom: 6,
                zoomControl: false, attributionControl: false,
            });

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            const stations = [
                { name: 'Chibougamau Hub', lat: 49.9166, lng: -74.3680, type: 'HUB' },
                { name: 'Mistissini', lat: 50.4221, lng: -73.8683, type: 'RELAY' },
                { name: 'Nemaska', lat: 51.6911, lng: -76.2356, type: 'RELAY' },
                { name: 'Waskaganish', lat: 51.4833, lng: -78.7500, type: 'RELAY (Maint.)' },
                { name: 'Eastmain', lat: 52.2333, lng: -78.5167, type: 'RELAY' },
                { name: 'Wemindji', lat: 53.0103, lng: -78.8311, type: 'RELAY' },
                { name: 'Chisasibi', lat: 53.7940, lng: -78.9069, type: 'DESTINATION' },
                { name: 'Whapmagoostui', lat: 55.2530, lng: -77.7652, type: 'DESTINATION' },
            ];

            const coords = stations.map(s => [s.lat, s.lng]);
            // Full corridor polyline (dashed)
            L.polyline(coords, { color: '#94a3b8', weight: 2, opacity: 0.4, dashArray: '8 6' }).addTo(map);
            // Active/traversed segment (solid)
            L.polyline(coords.slice(0, 4), { color: '#2563eb', weight: 3, opacity: 0.9 }).addTo(map);

            stations.forEach(s => {
                const isActive = s.type !== 'RELAY (Maint.)';
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="width:${s.type === 'HUB' ? 16 : 12}px;height:${s.type === 'HUB' ? 16 : 12}px;border-radius:50%;background:${isActive ? '#2563eb' : '#94a3b8'};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2);"></div>`,
                    iconSize: [s.type === 'HUB' ? 16 : 12, s.type === 'HUB' ? 16 : 12],
                    iconAnchor: [s.type === 'HUB' ? 8 : 6, s.type === 'HUB' ? 8 : 6],
                });
                L.marker([s.lat, s.lng], { icon })
                    .addTo(map)
                    .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${s.name}</strong><br/><span style="color:#64748b">${s.type}</span></div>`, { direction: 'top', offset: [0, -10] });
            });

            // Drone marker
            const droneIcon = L.divIcon({
                className: '',
                html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 4px rgba(37,99,235,0.2), 0 2px 6px rgba(0,0,0,0.2);"></div>`,
                iconSize: [18, 18], iconAnchor: [9, 9],
            });
            L.marker([51.2, -77.5], { icon: droneIcon })
                .addTo(map)
                .bindTooltip('<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>DRN-409</strong><br/><span style="color:#64748b">72 km/h · 120m</span></div>', { direction: 'top', offset: [0, -12] });

            mapInstance.current = map;
        }
        init();
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, []);

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
    const { deliveries, stations, drones } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

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
                        <CorridorMap height={400} />
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
                        <DroneFeed src="/feeds/cam1.png" label="DRN-409 Forward Camera" id="CAM-01" />
                        <DroneFeed src="/feeds/cam2.png" label="Mistissini Landing Pad" id="CAM-02" />
                        <DroneFeed src="/feeds/cam3.png" label="Chisasibi Approach" id="CAM-03" />
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
                    <CorridorMap height={560} />

                    {/* Floating Telemetry */}
                    <div style={{ position: 'absolute', top: 16, left: 16, background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 240, boxShadow: 'var(--shadow-md)', zIndex: 1000 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Active Drone</span>
                            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>DRN-409</span>
                        </div>
                        {[
                            { icon: Gauge, label: 'Speed', value: '72 km/h' },
                            { icon: Signal, label: 'Altitude', value: '120 m' },
                            { icon: Battery, label: 'Battery', value: '68%' },
                            { icon: Thermometer, label: 'Ambient', value: '-12°C' },
                        ].map(({ icon: Icon, label, value }) => (
                            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 8 }}>
                                <Icon size={14} color="var(--text-secondary)" />
                                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
                                <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                            Routing to <strong style={{ color: 'var(--text)' }}>Chisasibi</strong> via James Bay corridor
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

                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr><th>Node Name</th><th>Type</th><th>Status</th><th>Battery Array</th><th>Pad Temp</th><th>Drones</th></tr>
                        </thead>
                        <tbody>
                            {stations.map(s => {
                                const docked = drones.filter(d => d.location.toLowerCase().includes(s.id.toLowerCase().split(' ')[0])).length;
                                return (
                                    <tr key={s.id}>
                                        <td className="bold">{s.id}</td>
                                        <td className="capitalize muted">{s.type}</td>
                                        <td><span className={`badge ${s.status === 'online' ? 'badge-green' : 'badge-neutral'}`}>{s.status}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ width: 80, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${s.battery}%`, background: 'var(--accent)', borderRadius: 3 }} />
                                                </div>
                                                <span className="mono" style={{ fontSize: 12 }}>{s.battery}%</span>
                                            </div>
                                        </td>
                                        <td className="mono">{s.temp}°C</td>
                                        <td className="mono">{docked}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Station Cameras */}
                <div style={{ marginTop: 24 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Station Cameras</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                        <DroneFeed src="/feeds/cam1.png" label="DRN-409 Forward" id="CAM-01" />
                        <DroneFeed src="/feeds/cam2.png" label="Mistissini Pad" id="CAM-02" />
                        <DroneFeed src="/feeds/cam3.png" label="Chisasibi Approach" id="CAM-03" />
                    </div>
                </div>
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
