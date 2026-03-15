import { useEffect, useRef } from 'react';

function findStationMatch(label, stations) {
    if (!label) return null;
    const normalized = label.toLowerCase();
    return stations.find((s) =>
        s.id.toLowerCase() === normalized || normalized.includes(s.id.toLowerCase())
    ) || null;
}

function getDronePositions(drones, stations, lines) {
    const stationsById = Object.fromEntries(stations.map(s => [s.id, s]));
    return drones
        .filter(d => (d.status === 'on_route' || d.status === 'relocating') && d.target_location)
        .map(drone => {
            const target = findStationMatch(drone.target_location, stations);
            if (!target) return null;

            let origin = null;
            for (const line of lines) {
                const idx = line.stations.indexOf(target.id);
                if (idx > 0) {
                    origin = stationsById[line.stations[idx - 1]] || null;
                    if (origin) break;
                }
            }

            const lat = origin ? (origin.lat + target.lat) / 2 : target.lat + 0.18;
            const lng = origin ? (origin.lng + target.lng) / 2 : target.lng + 0.18;

            return { lat, lng, drone };
        })
        .filter(Boolean);
}

const makeDroneSvg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><line x1="14" y1="14" x2="5" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="5" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="23" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="5" cy="23" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="23" cy="23" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="14" cy="14" r="4.5" fill="${color}" stroke="white" stroke-width="2"/></svg>`;

/**
 * Shared Corridor Map.
 * Props:
 *   stations, drones, deliveries, lines, height,
 *   showLines     — render corridor lines + legend (admin only)
 *   selectedDroneId — highlight a specific drone
 *   onDroneClick  — callback(droneId)
 *   darkMode      — use dark tiles (default false)
 */
export default function CorridorMapShared({
    stations = [], drones = [], deliveries = [], lines = [],
    height = 420, showLines = false, darkMode = false,
    selectedDroneId = null, onDroneClick = null,
}) {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        async function init() {
            const L = (await import('leaflet')).default;
            await import('leaflet/dist/leaflet.css');
            if (!mapRef.current) return;
            if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }

            const stationsById = Object.fromEntries(stations.map(s => [s.id, s]));
            const dronePositions = getDronePositions(drones, stations, lines);

            // Center
            const lats = stations.map(s => s.lat);
            const lngs = stations.map(s => s.lng);
            const centerLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 52.0;
            const centerLng = lngs.length ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : -72.0;
            const zoom = stations.length > 12 ? 5 : 6;

            const map = L.map(mapRef.current, {
                center: [centerLat, centerLng], zoom,
                zoomControl: false, attributionControl: false,
            });

            const tileUrl = darkMode
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            // Corridor lines (admin/showLines only)
            if (showLines && lines.length > 0) {
                lines.forEach(line => {
                    const coords = line.stations.map(id => stationsById[id]).filter(Boolean).map(s => [s.lat, s.lng]);
                    if (coords.length > 1) L.polyline(coords, { color: line.color, weight: 3, opacity: 0.6 }).addTo(map);
                });
            }

            // Delivery route overlays (amber dashed)
            deliveries
                .filter(d => d.route?.length > 1 && ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH', 'READY_TO_LAUNCH', 'REROUTED'].includes(d.status))
                .forEach(d => {
                    const coords = d.route.map(s => stationsById[s]).filter(Boolean).map(s => [s.lat, s.lng]);
                    if (coords.length > 1) L.polyline(coords, { color: '#f59e0b', weight: 3, opacity: 0.7, dashArray: '8 5' }).addTo(map);
                });

            // Station markers
            stations.forEach(station => {
                const isActive = station.status === 'online';
                const isHub = station.type === 'distribution';
                const size = isHub ? 14 : 10;
                const stationLines = lines.filter(l => l.stations.includes(station.id));
                const color = stationLines.length > 0 ? stationLines[0].color : (isActive ? '#3b82f6' : '#475569');
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${isActive ? color : '#475569'};border:2px solid ${darkMode ? 'rgba(255,255,255,0.4)' : 'white'};box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
                    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
                });
                L.marker([station.lat, station.lng], { icon })
                    .addTo(map)
                    .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${station.id}</strong></div>`, { direction: 'top', offset: [0, -8] });
            });

            // Drone markers (SVG drone icons, positioned between stations)
            dronePositions.forEach(({ lat, lng, drone }) => {
                const isSelected = drone.id === selectedDroneId;
                const isRelocating = drone.status === 'relocating';
                const color = isSelected ? '#ef4444' : isRelocating ? '#3b82f6' : '#f59e0b';
                const scale = isSelected ? 1.3 : 1;

                const droneIcon = L.divIcon({
                    className: '',
                    html: `<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));transform:scale(${scale});transition:transform 0.2s;">${makeDroneSvg(color)}</div>`,
                    iconSize: [28, 28], iconAnchor: [14, 14],
                });

                const marker = L.marker([lat, lng], { icon: droneIcon })
                    .addTo(map)
                    .bindTooltip(
                        `<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${drone.id}</strong> · ${drone.name || ''}<br/><span style="color:#94a3b8">${drone.speed || 0} km/h → ${drone.target_location}</span>${isRelocating ? '<br/><span style="color:#3b82f6;font-weight:600">Relocating</span>' : ''}</div>`,
                        { direction: 'top', offset: [0, -16] }
                    );

                if (onDroneClick) marker.on('click', () => onDroneClick(drone.id));
            });

            mapInstance.current = map;
        }
        init();
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, [deliveries, drones, stations, lines, selectedDroneId, showLines, darkMode]);

    return <div ref={mapRef} style={{ width: '100%', height, borderRadius: 8 }} />;
}
