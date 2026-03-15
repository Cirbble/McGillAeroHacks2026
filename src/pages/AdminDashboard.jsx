import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Database, Camera, Maximize2, Signal, Thermometer, Battery, Gauge, MessageSquare, Send, Loader2, RefreshCcw, BrainCircuit } from 'lucide-react';

// Main south-to-north delivery corridor. Stations not listed here still appear
// as map markers but are not connected by the corridor polyline.
const CORRIDOR_ORDER = [
    'Montreal', 'Trois-Rivières', 'Shawinigan', 'Quebec City', 'La Tuque',
    'Saguenay', 'Roberval', 'Chibougamau Hub', 'Mistissini', 'Nemaska',
    'Waskaganish', 'Eastmain', 'Wemindji', 'Chisasibi', 'Whapmagoostui',
];

function renderMarkdown(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<div style="font-weight:700;font-size:13px;margin:8px 0 4px">$1</div>')
        .replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:10px 0 4px">$1</div>')
        .replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px">• $1</div>')
        .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:12px">$1. $2</div>')
        .replace(/\n/g, '<br/>');
}

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

function getDroneMapPositions(drones, stations, lines) {
    const stationsById = Object.fromEntries(stations.map(s => [s.id, s]));
    return drones
        .filter(d => (d.status === 'on_route' || d.status === 'relocating') && d.target_location)
        .map(drone => {
            const target = findStationMatch(drone.target_location, stations);
            if (!target) return null;

            // Find the preceding station on whichever line contains the target
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

            return {
                lat, lng, drone,
                tooltip: `<strong>${drone.id}</strong> · ${drone.name}<br/><span style="color:#64748b">${drone.speed} km/h &rarr; ${drone.target_location}</span>`,
            };
        })
        .filter(Boolean);
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

function formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function buildRouteCoordinates(delivery, stations) {
    if (!delivery?.route?.length) return [];

    return delivery.route
        .map((stop) => stations.find((station) => station.id === stop))
        .filter(Boolean)
        .map((station) => [station.lat, station.lng]);
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

function getStatusPresentation(delivery) {
    const mapping = {
        AWAITING_REVIEW: { label: 'Awaiting Review', badge: 'badge-neutral' },
        READY_TO_LAUNCH: { label: 'Ready to Launch', badge: 'badge-blue' },
        IN_TRANSIT: { label: 'In Flight', badge: 'badge-green' },
        HANDOFF: { label: 'Relay Handoff', badge: 'badge-yellow' },
        WEATHER_HOLD: { label: 'Weather Hold', badge: 'badge-red' },
        REROUTED: { label: 'Rerouted', badge: 'badge-yellow' },
        REJECTED: { label: 'Rejected', badge: 'badge-red' },
        DELIVERED: { label: 'Delivered', badge: 'badge-green' },
        PENDING_DISPATCH: { label: 'Pending Dispatch', badge: 'badge-neutral' },
    };

    return mapping[delivery?.status] || { label: delivery?.status?.replace(/_/g, ' ') || 'Unknown', badge: 'badge-neutral' };
}

function getWeatherTone(condition) {
    return {
        CLEAR: '#2563eb',
        WATCH: '#f59e0b',
        UNSTABLE: '#ea580c',
        SEVERE: '#dc2626',
    }[condition] || '#94a3b8';
}

function getPathTone(statusTone) {
    if (statusTone === 'danger') return { background: '#fef2f2', border: '#fecaca', color: '#991b1b' };
    if (statusTone === 'warning' || statusTone === 'watch') return { background: '#fff7ed', border: '#fed7aa', color: '#9a3412' };
    return { background: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' };
}

function formatWeatherSourceLabel(source) {
    if (source === 'open-meteo') return 'Live Open-Meteo route weather';
    if (source === 'open-meteo-live+stale') return 'Live route weather with stale fallback';
    if (source === 'open-meteo-live+unavailable') return 'Live route weather with unavailable nodes';
    return source ? `Route weather: ${source}` : 'Route weather source unavailable';
}

function formatWeatherUpdate(value) {
    if (!value) return '';

    try {
        return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
        return '';
    }
}

const RADAR_WMS_URL = 'https://geo.weather.gc.ca/geomet';
const RADAR_WMS_LAYER = 'RADAR_1KM_RRAI';
const RADAR_WMS_STYLE = 'RADARURPPRECIPR14-LINEAR';

/* ── Leaflet Map Component ── */
function CorridorMap({ stations = [], drones = [], deliveries = [], lines = [], height = 380, focusDrone = null }) {
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

            const stationsById = Object.fromEntries(stations.map(s => [s.id, s]));
            const makeDroneSvg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><line x1="14" y1="14" x2="5" y2="5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="5" y2="23" stroke="${c}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="23" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="5" r="3.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="23" cy="5" r="3.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="5" cy="23" r="3.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="23" cy="23" r="3.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="14" cy="14" r="4.5" fill="${c}" stroke="white" stroke-width="2"/></svg>`;

            // When a drone is focused, scope everything to that drone only
            const focusedDrone = focusDrone ? drones.find(d => d.id === focusDrone) : null;
            const flyingFocus = focusedDrone && ['on_route', 'relocating'].includes(focusedDrone.status);
            const dronesForMap = focusedDrone ? [focusedDrone] : drones;

            // Resolve the path for the focused flying drone
            const activeDelivery = focusedDrone
                ? (focusedDrone.assignment ? deliveries.find(d => d.id === focusedDrone.assignment) : null)
                : deliveries.find(d => ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH'].includes(d.status));
            const routeCoords = buildRouteCoordinates(activeDelivery, stations);

            // For flying-focused drones, compute the path and which stations to show
            let focusPathCoords = [];
            let focusStationIds = null; // null = show all
            if (flyingFocus) {
                const origin = focusedDrone.status === 'relocating'
                    ? findStationMatch(focusedDrone.origin_location, stations)
                    : findStationMatch(focusedDrone.location, stations);
                const target = findStationMatch(focusedDrone.target_location, stations);
                if (focusedDrone.status === 'relocating') {
                    if (origin && target) {
                        focusPathCoords = [[origin.lat, origin.lng], [target.lat, target.lng]];
                        focusStationIds = new Set([origin.id, target.id]);
                    }
                } else {
                    // on_route: prefer delivery route, fall back to direct line
                    if (routeCoords.length > 1 && activeDelivery?.route) {
                        focusPathCoords = routeCoords;
                        focusStationIds = new Set(activeDelivery.route);
                    } else if (origin && target) {
                        focusPathCoords = [[origin.lat, origin.lng], [target.lat, target.lng]];
                        focusStationIds = new Set([origin.id, target.id]);
                    }
                }
            }

            const dronePositions = getDroneMapPositions(dronesForMap, stations, lines);

            // Center: fit to path when flying-focused, otherwise bounding box of all stations
            const lats = stations.map(s => s.lat);
            const lngs = stations.map(s => s.lng);
            const centerLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 52.0;
            const centerLng = lngs.length ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : -72.0;
            const zoom = stations.length > 12 ? 5 : 6;

            const map = L.map(mapRef.current, {
                center: [centerLat, centerLng], zoom,
                zoomControl: false, attributionControl: false,
            });

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            if (flyingFocus) {
                // Flying focus: only draw the drone's path, then fit view to it
                const pathColor = focusedDrone.status === 'relocating' ? '#3b82f6' : '#f59e0b';
                if (focusPathCoords.length > 1) {
                    const pathLine = L.polyline(focusPathCoords, { color: pathColor, weight: 4, opacity: 0.9, dashArray: '10 6' }).addTo(map);
                    map.fitBounds(pathLine.getBounds(), { padding: [60, 60] });
                }
            } else {
                // Normal view: draw all corridor lines + active delivery route
                lines.forEach(line => {
                    const coords = line.stations.map(id => stationsById[id]).filter(Boolean).map(s => [s.lat, s.lng]);
                    if (coords.length > 1) L.polyline(coords, { color: line.color, weight: 3, opacity: 0.75 }).addTo(map);
                });
                if (routeCoords.length > 1) {
                    L.polyline(routeCoords, { color: '#f59e0b', weight: 4, opacity: 0.9, dashArray: '10 6' }).addTo(map);
                }
            }

            // Focused stationary drone (ready / charging) — show on its station
            if (focusedDrone && ['ready', 'charging'].includes(focusedDrone.status)) {
                const station = findStationMatch(focusedDrone.location, stations);
                if (station) {
                    const color = focusedDrone.status === 'ready' ? '#22c55e' : '#ef4444';
                    const icon = L.divIcon({
                        className: '',
                        html: `<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${makeDroneSvg(color)}</div>`,
                        iconSize: [28, 28], iconAnchor: [14, 14],
                    });
                    L.marker([station.lat, station.lng], { icon })
                        .addTo(map)
                        .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${focusedDrone.id}</strong> · ${focusedDrone.name}<br/><span style="color:#64748b;">${focusedDrone.status} @ ${station.id}</span></div>`, { direction: 'top', offset: [0, -16] });
                }
            }

            // Station markers — filtered to path stations when flying-focused
            const stationsToRender = focusStationIds
                ? stations.filter(s => focusStationIds.has(s.id))
                : stations;
            stationsToRender.forEach(station => {
                const isActive = station.status === 'online';
                const size = station.type === 'distribution' ? 16 : 12;
                const anchor = size / 2;
                const stationLines = lines.filter(l => l.stations.includes(station.id));
                const markerColor = stationLines.length > 0 ? stationLines[0].color : (isActive ? '#2563eb' : '#94a3b8');
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${isActive ? markerColor : '#94a3b8'};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2);"></div>`,
                    iconSize: [size, size],
                    iconAnchor: [anchor, anchor],
                });
                const lineNames = stationLines.map(l => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${l.color};margin-right:3px;"></span>${l.name}`).join(' · ');
                L.marker([station.lat, station.lng], { icon })
                    .addTo(map)
                    .bindTooltip(
                        `<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${station.id}</strong><br/><span style="color:#64748b">${getStationLabel(station)}</span>${lineNames ? `<br/><span style="color:#64748b;font-size:10px;">${lineNames}</span>` : ''}</div>`,
                        { direction: 'top', offset: [0, -10] }
                    );
            });

            // In-transit drone markers
            dronePositions.forEach(({ lat, lng, drone, tooltip }) => {
                const isRelocating = drone.status === 'relocating';
                const color = isRelocating ? '#3b82f6' : '#f59e0b';
                const droneIcon = L.divIcon({
                    className: '',
                    html: `<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${makeDroneSvg(color)}</div>`,
                    iconSize: [28, 28], iconAnchor: [14, 14],
                });
                L.marker([lat, lng], { icon: droneIcon })
                    .addTo(map)
                    .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;">${tooltip}${isRelocating ? '<br/><span style="color:#3b82f6;font-weight:600;">Relocating (empty)</span>' : ''}</div>`, { direction: 'top', offset: [0, -16] });
            });

            // Lines legend
            if (lines.length > 0 || dronePositions.length > 0) {
                const hasCarrying = dronePositions.some(p => p.drone.status === 'on_route');
                const hasRelocating = dronePositions.some(p => p.drone.status === 'relocating');
                const legend = L.control({ position: 'bottomleft' });
                legend.onAdd = () => {
                    const div = L.DomUtil.create('div');
                    div.style.cssText = 'background:white;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-family:Inter,sans-serif;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,0.08);min-width:130px;';
                    div.innerHTML =
                        (lines.length > 0 ? `<div style="font-weight:700;margin-bottom:8px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Lines</div>` +
                        lines.map(l => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><div style="width:22px;height:3px;background:${l.color};border-radius:2px;flex-shrink:0;"></div><span style="color:#0f172a;">${l.name}</span></div>`).join('') : '') +
                        (routeCoords.length > 1 ? `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;"><div style="width:22px;height:3px;background:#f59e0b;border-radius:2px;flex-shrink:0;"></div><span style="color:#0f172a;">Active Route</span></div>` : '') +
                        (hasCarrying || hasRelocating ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;font-weight:700;margin-bottom:6px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Drones</div>` : '') +
                        (hasCarrying ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></div><span style="color:#0f172a;">Carrying delivery</span></div>` : '') +
                        (hasRelocating ? `<div style="display:flex;align-items:center;gap:8px;"><div style="width:10px;height:10px;border-radius:50%;background:#3b82f6;flex-shrink:0;"></div><span style="color:#0f172a;">Relocating (empty)</span></div>` : '');
                    return div;
                };
                legend.addTo(map);
            }

            mapInstance.current = map;
        }
        init();
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, [deliveries, drones, stations, lines, focusDrone]);

    return <div ref={mapRef} style={{ width: '100%', height }} />;
}

function OverviewWeatherMap({
    stations = [],
    drones = [],
    deliveries = [],
    lines = [],
    weatherStations = [],
    highlightedDelivery = null,
    height = 380,
    showWeatherOverlay = true,
}) {
    const mapRef = useRef(null);
    const leafletRef = useRef(null);
    const mapInstance = useRef(null);
    const overlayGroupRef = useRef(null);
    const radarLayerRef = useRef(null);
    const legendControlRef = useRef(null);
    const resizeHandleRef = useRef(null);

    useEffect(() => {
        let resizeObserver = null;
        let cancelled = false;

        async function init() {
            const L = (await import('leaflet')).default;
            await import('leaflet/dist/leaflet.css');
            if (cancelled || !mapRef.current || mapInstance.current) return;

            leafletRef.current = L;
            const map = L.map(mapRef.current, {
                center: [52.0, -72.0],
                zoom: 5,
                zoomControl: false,
                attributionControl: false,
            });

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            overlayGroupRef.current = L.layerGroup().addTo(map);
            mapInstance.current = map;

            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => {
                    map.invalidateSize(false);
                });
                resizeObserver.observe(mapRef.current);
            }
        }

        init();
        return () => {
            cancelled = true;
            if (resizeHandleRef.current) {
                window.clearTimeout(resizeHandleRef.current);
                resizeHandleRef.current = null;
            }
            if (legendControlRef.current) {
                legendControlRef.current.remove();
                legendControlRef.current = null;
            }
            if (radarLayerRef.current && mapInstance.current?.hasLayer(radarLayerRef.current)) {
                mapInstance.current.removeLayer(radarLayerRef.current);
            }
            resizeObserver?.disconnect();
            if (mapInstance.current) {
                mapInstance.current.remove();
                mapInstance.current = null;
            }
            overlayGroupRef.current = null;
            leafletRef.current = null;
            radarLayerRef.current = null;
        };
    }, []);

    useEffect(() => {
        const L = leafletRef.current;
        const map = mapInstance.current;
        const overlayGroup = overlayGroupRef.current;

        if (!L || !map || !overlayGroup) return;

        overlayGroup.clearLayers();
        if (legendControlRef.current) {
            legendControlRef.current.remove();
            legendControlRef.current = null;
        }

        const radarPane = map.getPane('radarPane') || map.createPane('radarPane');
        radarPane.style.zIndex = 340;

        if (showWeatherOverlay) {
            if (!radarLayerRef.current) {
                radarLayerRef.current = L.tileLayer.wms(RADAR_WMS_URL, {
                    pane: 'radarPane',
                    layers: RADAR_WMS_LAYER,
                    styles: RADAR_WMS_STYLE,
                    format: 'image/png',
                    transparent: true,
                    version: '1.3.0',
                    opacity: 0.58,
                    crossOrigin: true,
                });
            }

            if (!map.hasLayer(radarLayerRef.current)) {
                radarLayerRef.current.addTo(map);
            }
        } else if (radarLayerRef.current && map.hasLayer(radarLayerRef.current)) {
            map.removeLayer(radarLayerRef.current);
        }

        const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
        const weatherByStation = Object.fromEntries(weatherStations.map((station) => [station.stationId, station]));
        const activeDelivery = highlightedDelivery || deliveries.find((delivery) => !['DELIVERED', 'REJECTED'].includes(delivery.status));
        const routeCoords = buildRouteCoordinates(activeDelivery, stations);
        const routeStationIds = new Set(activeDelivery?.route || []);
        const activeDronePosition = getActiveDronePosition(
            drones.find((drone) => drone.status === 'on_route') || drones[0],
            stations,
        );
        const visibleStations = showWeatherOverlay && routeStationIds.size > 0
            ? stations.filter((station) => routeStationIds.has(station.id))
            : stations;
        const focusPoints = routeCoords.length > 0
            ? [...routeCoords]
            : stations.map((station) => [station.lat, station.lng]);

        if (activeDronePosition) {
            focusPoints.push([activeDronePosition.lat, activeDronePosition.lng]);
        }

        if (!showWeatherOverlay) {
            lines.forEach((line) => {
                const coords = line.stations
                    .map((id) => stationsById[id])
                    .filter(Boolean)
                    .map((station) => [station.lat, station.lng]);

                if (coords.length > 1) {
                    L.polyline(coords, { color: line.color, weight: 3, opacity: 0.75 }).addTo(overlayGroup);
                }
            });
        }

        if (routeCoords.length > 1) {
            if (showWeatherOverlay) {
                L.polyline(routeCoords, {
                    color: 'rgba(255,255,255,0.82)',
                    weight: 9,
                    opacity: 0.9,
                }).addTo(overlayGroup);
            }

            L.polyline(routeCoords, {
                color: activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED' ? '#10b981' : '#f59e0b',
                weight: showWeatherOverlay ? 5 : 4,
                opacity: 0.95,
                dashArray: activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED' ? '12 5' : undefined,
            }).addTo(overlayGroup);
        }

        visibleStations.forEach((station) => {
            const isActive = station.status === 'online';
            const weatherState = weatherByStation[station.id]?.condition || 'CLEAR';
            const severityColor = getWeatherTone(weatherState);
            const size = showWeatherOverlay
                ? (routeStationIds.has(station.id) ? 14 : 10)
                : station.type === 'distribution'
                    ? 16
                    : 12;
            const anchor = size / 2;
            const stationLines = lines.filter((line) => line.stations.includes(station.id));
            const markerColor = routeStationIds.has(station.id) && (activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED')
                ? '#10b981'
                : stationLines.length > 0
                    ? stationLines[0].color
                    : (isActive ? '#2563eb' : '#94a3b8');
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${isActive ? markerColor : '#94a3b8'};border:3px solid white;box-shadow:${showWeatherOverlay ? `0 0 0 2px ${severityColor}` : '0 1px 4px rgba(0,0,0,0.2)'};"></div>`,
                iconSize: [size, size],
                iconAnchor: [anchor, anchor],
            });
            const lineNames = stationLines.map((line) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${line.color};margin-right:3px;"></span>${line.name}`).join(' · ');
            const weatherSummary = showWeatherOverlay && weatherState !== 'CLEAR'
                ? `<br/><span style="color:${severityColor};font-size:10px;">${weatherState.toLowerCase()} weather on route</span>`
                : '';

            L.marker([station.lat, station.lng], { icon })
                .addTo(overlayGroup)
                .bindTooltip(
                    `<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${station.id}</strong><br/><span style="color:#64748b">${getStationLabel(station)}</span>${lineNames && !showWeatherOverlay ? `<br/><span style="color:#64748b;font-size:10px;">${lineNames}</span>` : ''}${weatherSummary}</div>`,
                    { direction: 'top', offset: [0, -10] },
                );
        });

        if (activeDronePosition) {
            const droneIcon = L.divIcon({
                className: '',
                html: '<div style="width:18px;height:18px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 0 0 4px rgba(245,158,11,0.2), 0 2px 6px rgba(0,0,0,0.2);"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            });

            L.marker([activeDronePosition.lat, activeDronePosition.lng], { icon: droneIcon })
                .addTo(overlayGroup)
                .bindTooltip(`<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${activeDronePosition.tooltip}</strong></div>`, { direction: 'top', offset: [0, -12] });
        }

        const legend = L.control({ position: 'bottomleft' });
        legend.onAdd = () => {
            const div = L.DomUtil.create('div');

            if (!showWeatherOverlay && lines.length > 0) {
                div.style.cssText = 'background:white;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-family:Inter,sans-serif;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,0.08);min-width:150px;';
                div.innerHTML =
                    `<div style="font-weight:700;margin-bottom:8px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Lines</div>` +
                    lines.map((line) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;"><div style="width:22px;height:3px;background:${line.color};border-radius:2px;flex-shrink:0;"></div><span style="color:#0f172a;">${line.name}</span></div>`).join('') +
                    (routeCoords.length > 1 ? `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;"><div style="width:22px;height:3px;background:${activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED' ? '#10b981' : '#f59e0b'};border-radius:2px;flex-shrink:0;"></div><span style="color:#0f172a;">Selected Route</span></div>` : '');
            } else {
                div.style.cssText = 'background:rgba(255,255,255,0.92);border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-family:Inter,sans-serif;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,0.08);min-width:180px;';
                div.innerHTML =
                    '<div style="font-weight:700;margin-bottom:6px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Radar Overlay</div>' +
                    '<div style="color:#0f172a;line-height:1.5;">MSC GeoMet radar composite over the selected mission corridor.</div>' +
                    `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;"><div style="width:22px;height:3px;background:${activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED' ? '#10b981' : '#f59e0b'};border-radius:2px;flex-shrink:0;"></div><span style="color:#0f172a;">${activeDelivery?.routeState === 'REROUTED' || activeDelivery?.status === 'REROUTED' ? 'Manual reroute active' : 'Current mission path'}</span></div>`;
            }

            return div;
        };

        legend.addTo(map);
        legendControlRef.current = legend;

        const focusBounds = L.latLngBounds(focusPoints);
        if (resizeHandleRef.current) {
            window.clearTimeout(resizeHandleRef.current);
        }

        resizeHandleRef.current = window.setTimeout(() => {
            if (mapInstance.current !== map || !map.getContainer()) return;

            map.invalidateSize(false);

            if (focusPoints.length > 1 && focusBounds.isValid()) {
                map.fitBounds(focusBounds.pad(routeCoords.length > 1 ? 0.28 : 0.16), {
                    animate: false,
                });
            } else if (focusPoints.length === 1) {
                map.setView(focusPoints[0], 7, { animate: false });
            }
        }, 80);
    }, [
        deliveries,
        drones,
        highlightedDelivery,
        lines,
        showWeatherOverlay,
        stations,
        weatherStations,
    ]);

    return <div ref={mapRef} style={{ width: '100%', height, minHeight: height, background: '#e2e8f0' }} />;
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
    const {
        deliveries,
        stations,
        drones,
        lines,
        opsOverview,
        opsLoading,
        pathInsight,
        pathInsightLoading,
        addStation,
        addDrone,
        updateStation,
        updateDrone,
        deleteStation,
        deleteDrone,
        addLine,
        updateLine,
        deleteLine,
        fetchOpsOverview,
        fetchPathInsight,
        rerouteDelivery,
        createDemoDelivery,
        deleteDelivery,
    } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

    const emptyDroneForm = { name: '', model: '', location: '', battery: 100, batteryHealth: 100, status: 'ready', target_location: '', time_of_arrival: '' };
    const [showAddDrone, setShowAddDrone] = useState(false);
    const [droneForm, setDroneForm] = useState(emptyDroneForm);
    const [editingDroneId, setEditingDroneId] = useState(null);
    const [relocatingDrone, setRelocatingDrone] = useState(null);
    const [relocateTarget, setRelocateTarget] = useState('');

    const emptyNodeForm = { id: '', type: 'transit', status: 'online', battery: 100, temp: 0, lat: '', lng: '', max_drone_capacity: 4 };
    const [showAddNode, setShowAddNode] = useState(false);
    const [nodeForm, setNodeForm] = useState(emptyNodeForm);
    const [editingNodeId, setEditingNodeId] = useState(null);
    const [infraOpen, setInfraOpen] = useState({ nodes: false, drones: false, lines: false, cameras: false });
    const toggleInfra = (key) => setInfraOpen(s => ({ ...s, [key]: !s[key] }));

    const emptyLineForm = { id: '', name: '', color: '#3b82f6', stations: [] };
    const [showLineModal, setShowLineModal] = useState(false);
    const [lineForm, setLineForm] = useState(emptyLineForm);
    const [editingLineId, setEditingLineId] = useState(null);

    const [selectedDroneId, setSelectedDroneId] = useState(null);
    const [selectedDeliveryId, setSelectedDeliveryId] = useState(null);
    const [reroutingDeliveryId, setReroutingDeliveryId] = useState(null);
    const [rerouteDecision, setRerouteDecision] = useState(null);
    const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
    const [cortexMessages, setCortexMessages] = useState([]);
    const [cortexInput, setCortexInput] = useState('');
    const [cortexLoading, setCortexLoading] = useState(false);
    const orderedStations = orderStations(stations);
    const activeDrone = drones.find((drone) => drone.status === 'on_route') || drones[0] || null;
    const weatherStations = opsOverview?.weather?.stations || [];
    const active = deliveries.filter((delivery) => !['DELIVERED', 'REJECTED'].includes(delivery.status));
    const activeDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId)
        || active[0]
        || null;
    const selectedDelivery = activeDelivery;
    const selectedPathInsight = pathInsight?.delivery?.id === selectedDelivery?.id ? pathInsight : null;
    const surveillanceFeeds = [
        { src: '/feeds/cam1.png', label: activeDrone ? `${activeDrone.id} Forward Camera` : 'Primary Drone Feed', id: 'CAM-01' },
        { src: '/feeds/cam2.png', label: orderedStations[1] ? `${orderedStations[1].id} Landing Pad` : 'Relay Pad', id: 'CAM-02' },
        { src: '/feeds/cam3.png', label: orderedStations.at(-2) ? `${orderedStations.at(-2).id} Approach` : 'Destination Approach', id: 'CAM-03' },
    ];

    useEffect(() => {
        if (!['', '#operations', '#analytics'].includes(hash)) return;

        fetchOpsOverview().catch((err) => {
            console.error('Failed to load ops overview:', err);
        });

        if (hash === '') {
            const intervalId = window.setInterval(() => {
                fetchOpsOverview().catch((err) => {
                    console.error('Failed to refresh ops overview:', err);
                });
            }, 60000);

            return () => window.clearInterval(intervalId);
        }
    }, [fetchOpsOverview, hash]);

    useEffect(() => {
        const highlighted = opsOverview?.highlightedDeliveryId || active[0]?.id || null;
        if (highlighted && !active.some((delivery) => delivery.id === selectedDeliveryId)) {
            setSelectedDeliveryId(highlighted);
        } else if (!selectedDeliveryId && highlighted) {
            setSelectedDeliveryId(highlighted);
        }
    }, [active, opsOverview?.highlightedDeliveryId, selectedDeliveryId]);

    useEffect(() => {
        if (hash !== '') return;
        if (!selectedDelivery?.id) {
            fetchPathInsight(null).catch(() => {});
            return;
        }

        fetchPathInsight(selectedDelivery.id).catch((err) => {
            console.error('Failed to load path insight:', err);
        });
    }, [
        fetchPathInsight,
        hash,
        selectedDelivery?.id,
    ]);

    useEffect(() => {
        setRerouteDecision(null);
    }, [selectedDelivery?.id]);

    async function handleRelocate(e) {
        e.preventDefault();
        if (!relocateTarget) return;
        const RELOCATION_SPEED_KMH = 80;
        const origin = findStationMatch(relocatingDrone.location, stations);
        const target = stations.find(s => s.id === relocateTarget);
        let time_of_arrival = 'In transit';
        if (origin && target) {
            const dist = haversineKm(origin.lat, origin.lng, target.lat, target.lng);
            time_of_arrival = formatMinutes(Math.round(dist / RELOCATION_SPEED_KMH * 60));
        }
        try {
            await updateDrone(relocatingDrone.id, {
                status: 'relocating',
                target_location: relocateTarget,
                origin_location: relocatingDrone.location,
                location: `En route to ${relocateTarget}`,
                time_of_arrival,
                speed: RELOCATION_SPEED_KMH,
                assignment: null,
            });
            setRelocatingDrone(null);
            setRelocateTarget('');
        } catch (err) {
            alert('Failed to relocate drone: ' + err.message);
        }
    }

    function openEditDrone(drone) {
        setEditingDroneId(drone.id);
        setDroneForm({ name: drone.name, model: drone.model, location: drone.location, battery: drone.battery, batteryHealth: drone.batteryHealth, status: drone.status, target_location: drone.target_location || '', time_of_arrival: drone.time_of_arrival || '' });
        setShowAddDrone(true);
    }

    async function handleAddDrone(e) {
        e.preventDefault();
        const payload = {
            name: droneForm.name,
            model: droneForm.model,
            location: droneForm.location,
            battery: Number(droneForm.battery),
            batteryHealth: Number(droneForm.batteryHealth),
            status: droneForm.status,
            ...(droneForm.status === 'on_route' ? { target_location: droneForm.target_location, time_of_arrival: droneForm.time_of_arrival } : {}),
        };
        try {
            if (editingDroneId) {
                await updateDrone(editingDroneId, payload);
            } else {
                await addDrone(payload);
            }
            setDroneForm(emptyDroneForm);
            setEditingDroneId(null);
            setShowAddDrone(false);
        } catch (err) {
            alert('Failed to save drone: ' + err.message);
        }
    }

    function openEditNode(station) {
        setEditingNodeId(station.id);
        setNodeForm({ id: station.id, type: station.type, status: station.status, battery: station.battery, temp: station.temp, lat: station.lat, lng: station.lng, max_drone_capacity: station.max_drone_capacity });
        setShowAddNode(true);
    }

    async function handleAddNode(e) {
        e.preventDefault();
        const payload = {
            type: nodeForm.type,
            status: nodeForm.status,
            battery: Number(nodeForm.battery),
            temp: Number(nodeForm.temp),
            lat: Number(nodeForm.lat),
            lng: Number(nodeForm.lng),
            max_drone_capacity: Number(nodeForm.max_drone_capacity),
        };
        try {
            if (editingNodeId) {
                await updateStation(editingNodeId, payload);
            } else {
                await addStation({ id: nodeForm.id, ...payload });
            }
            setNodeForm(emptyNodeForm);
            setEditingNodeId(null);
            setShowAddNode(false);
        } catch (err) {
            alert('Failed to save node: ' + err.message);
        }
    }

    function openAddLine() {
        setEditingLineId(null);
        setLineForm(emptyLineForm);
        setShowLineModal(true);
    }

    function openEditLine(line) {
        setEditingLineId(line.id);
        setLineForm({ id: line.id, name: line.name, color: line.color, stations: [...line.stations] });
        setShowLineModal(true);
    }

    async function handleSaveLine(e) {
        e.preventDefault();
        try {
            if (editingLineId) {
                await updateLine(editingLineId, { name: lineForm.name, color: lineForm.color, stations: lineForm.stations });
            } else {
                await addLine({ id: lineForm.id, name: lineForm.name, color: lineForm.color, stations: lineForm.stations });
            }
            setShowLineModal(false);
            setLineForm(emptyLineForm);
            setEditingLineId(null);
        } catch (err) {
            alert('Failed to save line: ' + err.message);
        }
    }

    async function handleDeleteNode(station) {
        if (!window.confirm(`Delete node "${station.id}"?`)) return;

        try {
            await deleteStation(station.id);
        } catch (err) {
            alert('Failed to delete node: ' + err.message);
        }
    }

    async function handleDeleteDrone(drone) {
        if (!window.confirm(`Delete drone "${drone.id}"?`)) return;

        try {
            await deleteDrone(drone.id);
        } catch (err) {
            alert('Failed to delete drone: ' + err.message);
        }
    }

    async function handleDeleteLine(line) {
        if (!window.confirm(`Delete line "${line.name}"?`)) return;

        try {
            await deleteLine(line.id);
        } catch (err) {
            alert('Failed to delete line: ' + err.message);
        }
    }

    const onlineStations = stations.filter(s => s.status === 'online').length;
    const metrics = opsOverview?.metrics || {
        activeFlights: active.length,
        watchStations: weatherStations.filter((station) => station.condition !== 'CLEAR').length,
        severeStations: weatherStations.filter((station) => ['UNSTABLE', 'SEVERE'].includes(station.condition)).length,
        reroutedFlights: deliveries.filter((delivery) => delivery.status === 'REROUTED').length,
        weatherHolds: deliveries.filter((delivery) => delivery.status === 'WEATHER_HOLD').length,
        avgDeliveryMinutes: 74,
        onlineStations,
        totalStations: stations.length,
    };
    const selectedStatus = getStatusPresentation(selectedDelivery);
    const compactQueue = active.slice(0, 4);
    const pathReport = selectedPathInsight?.pathReport || null;
    const pathTone = getPathTone(pathReport?.statusTone);
    const weatherSourceLabel = formatWeatherSourceLabel(opsOverview?.weather?.source);
    const weatherUpdatedAt = formatWeatherUpdate(opsOverview?.weather?.updatedAt);

    async function handleManualReroute(deliveryId) {
        setReroutingDeliveryId(deliveryId);
        setRerouteDecision(null);

        try {
            const result = await rerouteDelivery(deliveryId);
            await Promise.all([
                fetchOpsOverview(),
                fetchPathInsight(deliveryId),
            ]);

            if (result.decision?.status !== 'rerouted') {
                setRerouteDecision({
                    deliveryId,
                    tone: 'warning',
                    title: result.decision?.summary || 'Manual reroute rejected',
                    detail: result.decision?.detail || 'No route change was applied.',
                });
                return;
            }

            setRerouteDecision({
                deliveryId,
                tone: 'success',
                title: result.decision?.summary || 'Manual reroute approved',
                detail: result.decision?.detail || result.delivery?.recommendedAction || 'The route was updated.',
            });
        } catch (err) {
            setRerouteDecision({
                deliveryId,
                tone: 'warning',
                title: err.data?.decision?.summary || 'Manual reroute rejected',
                detail: err.data?.decision?.detail || err.message,
            });
        } finally {
            setReroutingDeliveryId(null);
        }
    }

    async function handleCreateDemoMission(scenario) {
        try {
            const result = await createDemoDelivery(scenario);
            await Promise.all([
                fetchOpsOverview(),
                fetchPathInsight(result.delivery.id),
            ]);
            setSelectedDeliveryId(result.delivery.id);
            setRerouteDecision({
                deliveryId: result.delivery.id,
                tone: result.scenario === 'bad-path' ? 'warning' : 'success',
                title: result.scenario === 'bad-path' ? 'Bad-path demo created' : 'Demo mission created',
                detail: result.scenario === 'bad-path'
                    ? 'This mission was created on a weather-affected corridor so Gemini, Snowflake, and manual reroute can react to it.'
                    : 'This mission was created on a stable corridor for comparison against the bad-path scenario.',
            });
        } catch (err) {
            setRerouteDecision({
                deliveryId: selectedDelivery?.id || 'demo-create',
                tone: 'warning',
                title: 'Demo mission failed',
                detail: err.message,
            });
        }
    }

    async function handleDeleteSelectedMission() {
        if (!selectedDelivery?.id) return;

        try {
            const deletedId = selectedDelivery.id;
            await deleteDelivery(deletedId);
            await fetchOpsOverview();
            setSelectedDeliveryId(null);
            setRerouteDecision({
                deliveryId: deletedId,
                tone: 'success',
                title: 'Mission deleted',
                detail: `${deletedId} was removed from the database.`,
            });
        } catch (err) {
            setRerouteDecision({
                deliveryId: selectedDelivery.id,
                tone: 'warning',
                title: 'Delete failed',
                detail: err.message,
            });
        }
    }

    /* ── Platform Overview ── */
    if (hash === '') {
        return (
            <div>
                <div className="page-header">
                    <h1>Platform Overview</h1>
                    <p>Selected-mission weather overlay, manual reroute control, and route-specific AI guidance.</p>
                </div>

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
                    <div className="card stat-card">
                        <div className="stat-label">Open Missions</div>
                        <div className="stat-value">{metrics.activeFlights}</div>
                        <div className="stat-sub stat-sub-muted">{compactQueue.length} shown in queue</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Path Weather</div>
                        <div className="stat-value">{pathReport?.routeState || selectedDelivery?.routeState || 'CLEAR'}</div>
                        <div className="stat-sub stat-sub-muted">{pathReport ? `${pathReport.impactedStops} impacted stop${pathReport.impactedStops === 1 ? '' : 's'}` : 'Select a mission'}</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Route Response</div>
                        <div className="stat-value">{selectedDelivery?.routeState === 'REROUTED' || selectedDelivery?.status === 'REROUTED' ? 'MANUAL' : selectedDelivery?.status === 'WEATHER_HOLD' ? 'HOLD' : 'LIVE'}</div>
                        <div className="stat-sub stat-sub-muted">{selectedDelivery?.estimatedTime || 'No mission selected'}</div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header">
                            <span className="card-header-title"><Signal size={14} /> Selected Route Weather + Routing</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                    {showWeatherOverlay ? 'Live MSC GeoMet radar' : 'Base corridor map'}
                                </span>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 10px', fontSize: 11 }}
                                    onClick={() => setShowWeatherOverlay((current) => !current)}
                                >
                                    {showWeatherOverlay ? 'Hide weather overlay' : 'Show weather overlay'}
                                </button>
                            </div>
                        </div>
                        <OverviewWeatherMap
                            height={480}
                            stations={orderedStations}
                            drones={drones}
                            deliveries={deliveries}
                            lines={lines}
                            weatherStations={weatherStations}
                            highlightedDelivery={selectedDelivery}
                            showWeatherOverlay={showWeatherOverlay}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div
                                className="card-header"
                                style={{
                                    display: 'grid',
                                    gap: 4,
                                    alignItems: 'start',
                                }}
                            >
                                <span className="card-header-title"><BrainCircuit size={14} /> Path Weather Report</span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                                    <span style={{ minWidth: 0 }}>
                                        {weatherSourceLabel}{weatherUpdatedAt ? ` · ${weatherUpdatedAt}` : ''}
                                    </span>
                                    {opsLoading && <span>Refreshing…</span>}
                                </div>
                            </div>
                            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>Selected mission</div>
                                        <div style={{ fontWeight: 700 }}>{selectedDelivery?.id || 'No mission selected'}</div>
                                    </div>
                                    {selectedDelivery && <span className={`badge ${selectedStatus.badge}`}>{selectedStatus.label}</span>}
                                </div>

                                <div
                                    style={{
                                        padding: '12px 14px',
                                        borderRadius: 8,
                                        border: `1px solid ${pathTone.border}`,
                                        background: pathTone.background,
                                        color: pathTone.color,
                                    }}
                                >
                                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Path headline</div>
                                    <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                                        {pathReport?.headline || (pathInsightLoading ? 'Loading route weather report…' : 'Select a mission to inspect path weather.')}
                                    </div>
                                </div>

                                {pathReport && (
                                    <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                        <div style={{ display: 'grid', gap: 8 }}>
                                            <div>
                                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>Operational effect</div>
                                                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{pathReport.operationalEffect}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>Weather summary</div>
                                                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>{pathReport.summary}</div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>Signals on this path</div>
                                                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                                    {pathReport.weatherSignals?.length > 0 ? pathReport.weatherSignals.join(' • ') : 'No significant weather signals on the selected route.'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Demo controls</div>
                                    <div style={{ display: 'grid', gap: 8 }}>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleCreateDemoMission('bad-path')}
                                        >
                                            Add bad-path mission
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleCreateDemoMission('random')}
                                        >
                                            Add random mission
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={handleDeleteSelectedMission}
                                            disabled={!selectedDelivery}
                                        >
                                            Delete selected mission
                                        </button>
                                    </div>
                                </div>

                                {selectedDelivery && ['WEATHER_HOLD', 'REROUTED', 'IN_TRANSIT', 'HANDOFF', 'READY_TO_LAUNCH'].includes(selectedDelivery.status) && (
                                    <>
                                        {pathReport && (
                                            <div
                                                style={{
                                                    padding: '10px 12px',
                                                    borderRadius: 8,
                                                    border: pathReport.manualRerouteSuggested
                                                        ? '1px solid rgba(245,158,11,0.28)'
                                                        : '1px solid rgba(148,163,184,0.2)',
                                                    background: pathReport.manualRerouteSuggested
                                                        ? 'rgba(245,158,11,0.08)'
                                                        : 'rgba(148,163,184,0.08)',
                                                }}
                                            >
                                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                    Manual reroute check
                                                </div>
                                                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                                    {pathReport.manualRerouteHint}
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{ justifyContent: 'center' }}
                                            onClick={() => handleManualReroute(selectedDelivery.id)}
                                            disabled={reroutingDeliveryId === selectedDelivery.id}
                                        >
                                            {reroutingDeliveryId === selectedDelivery.id ? (
                                                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Recomputing route…</>
                                            ) : (
                                                <><RefreshCcw size={14} /> Manual reroute from current weather</>
                                            )}
                                        </button>

                                        {rerouteDecision?.deliveryId === selectedDelivery.id && (
                                            <div
                                                style={{
                                                    padding: '12px 14px',
                                                    borderRadius: 8,
                                                    border: rerouteDecision.tone === 'success'
                                                        ? '1px solid rgba(16,185,129,0.24)'
                                                        : '1px solid rgba(245,158,11,0.28)',
                                                    background: rerouteDecision.tone === 'success'
                                                        ? 'rgba(16,185,129,0.08)'
                                                        : 'rgba(245,158,11,0.1)',
                                                }}
                                            >
                                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                    {rerouteDecision.title}
                                                </div>
                                                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                                    {rerouteDecision.detail}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                <div style={{ display: 'grid', gap: 10 }}>
                                    <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Gemini</div>
                                        <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                            {pathInsightLoading && !selectedPathInsight ? 'Generating path-specific Gemini guidance…' : selectedPathInsight?.gemini?.content || 'Gemini insight unavailable.'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Snowflake</div>
                                        <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                            {pathInsightLoading && !selectedPathInsight ? 'Generating path-specific Snowflake guidance…' : selectedPathInsight?.snowflake?.content || 'Snowflake insight unavailable.'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="card-header">
                                <span className="card-header-title"><Activity size={14} /> Mission Queue</span>
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{active.length} open</span>
                            </div>
                            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {compactQueue.map((delivery) => {
                                    const status = getStatusPresentation(delivery);
                                    return (
                                        <button
                                            key={delivery.id}
                                            type="button"
                                            onClick={() => setSelectedDeliveryId(delivery.id)}
                                            style={{
                                                width: '100%',
                                                textAlign: 'left',
                                                padding: '12px 14px',
                                                borderRadius: 8,
                                                border: selectedDelivery?.id === delivery.id ? '1px solid rgba(37,99,235,0.28)' : '1px solid var(--border)',
                                                background: selectedDelivery?.id === delivery.id ? 'var(--accent-light)' : 'var(--bg)',
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                                                <span style={{ fontSize: 13, fontWeight: 600 }}>{delivery.payload}</span>
                                                <span className={`badge ${status.badge}`} style={{ fontSize: 10 }}>{status.label}</span>
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                                {delivery.origin} → {delivery.destination}
                                            </div>
                                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {selectedDelivery?.id === delivery.id ? 'Currently selected' : 'Tap to inspect route weather'}
                                            </div>
                                        </button>
                                    );
                                })}
                                {compactQueue.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 13 }}>No open missions.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    /* ── Live Operations ── */
    if (hash === '#operations') {
        const selectedDrone = drones.find(d => d.id === selectedDroneId) || drones[0] || null;
        const droneDelivery = selectedDrone?.assignment
            ? deliveries.find(d => d.id === selectedDrone.assignment)
            : activeDelivery;

        return (
            <div>
                <div className="page-header">
                    <h1>Live Operations</h1>
                    <p>Full corridor monitoring with telemetry and fleet positioning.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, marginBottom: 24 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
                        <CorridorMap height={560} stations={orderedStations} drones={drones} deliveries={deliveries} lines={lines} focusDrone={selectedDroneId} />

                        {/* Floating Telemetry */}
                        {selectedDrone && (
                            <div style={{ position: 'absolute', top: 16, left: 16, background: 'white', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 220, boxShadow: 'var(--shadow-md)', zIndex: 1000 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>Telemetry</span>
                                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>{selectedDrone.id}</span>
                                </div>
                                {[
                                    { icon: Gauge, label: 'Speed', value: `${selectedDrone.speed} km/h` },
                                    { icon: Signal, label: 'Status', value: selectedDrone.status.replace(/_/g, ' ') },
                                    { icon: Battery, label: 'Battery', value: `${selectedDrone.battery}%` },
                                    { icon: Thermometer, label: 'Location', value: selectedDrone.target_location || selectedDrone.location || '—' },
                                ].map(({ icon: Icon, label, value }) => (
                                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, marginBottom: 8 }}>
                                        <Icon size={14} color="var(--text-secondary)" />
                                        <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
                                        <span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{value}</span>
                                    </div>
                                ))}
                                {selectedDrone.name && (
                                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                                        <strong style={{ color: 'var(--text)' }}>{selectedDrone.name}</strong> &middot; {selectedDrone.model}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Fleet Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Fleet ({drones.length})</div>
                        {drones.map(d => (
                            <button
                                key={d.id}
                                onClick={() => setSelectedDroneId(d.id)}
                                className="card"
                                style={{
                                    padding: '14px 16px',
                                    cursor: 'pointer',
                                    border: selectedDrone?.id === d.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                                    background: selectedDrone?.id === d.id ? 'var(--accent-light)' : 'var(--surface)',
                                    textAlign: 'left',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{d.id}</span>
                                    <span className={`badge ${d.status === 'on_route' ? 'badge-green' : d.status === 'relocating' ? 'badge-blue' : d.status === 'charging' ? 'badge-yellow' : 'badge-neutral'}`} style={{ fontSize: 10 }}>
                                        {d.status.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.location}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                    <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${d.battery}%`, background: d.battery > 30 ? 'var(--accent)' : 'var(--warning)', borderRadius: 2 }} />
                                    </div>
                                    <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)' }}>{d.battery}%</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Drone Camera Feed */}
                <div style={{ marginBottom: 24 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {selectedDrone ? `${selectedDrone.id} Camera Feed` : 'Camera Feeds'}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                        <DroneFeed src="/feeds/cam1.png" label={selectedDrone ? `${selectedDrone.id} Forward` : 'Forward'} id="CAM-01" />
                        <DroneFeed src="/feeds/cam2.png" label={selectedDrone ? `${selectedDrone.id} Downward` : 'Downward'} id="CAM-02" />
                        <DroneFeed src="/feeds/cam3.png" label={selectedDrone ? `${selectedDrone.location} Pad` : 'Station Pad'} id="CAM-03" />
                    </div>
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
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleInfra('nodes')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{infraOpen.nodes ? '▾' : '▸'}</span>
                            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Nodes</h2>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>({stations.length})</span>
                        </div>
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={e => { e.stopPropagation(); setShowAddNode(true); }}>+ Add Node</button>
                    </div>
                    {infraOpen.nodes && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                            {stations.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 13 }}>No nodes for now.</div>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Node Name</th><th>Type</th><th>Status</th><th>Battery Array</th><th>Pad Temp</th><th>Drones</th><th>Coords</th><th></th></tr>
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
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => openEditNode(s)}>Edit</button>
                                                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.25)' }} onClick={() => handleDeleteNode(s)}>Delete</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>

                {/* Drones Table */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleInfra('drones')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{infraOpen.drones ? '▾' : '▸'}</span>
                            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Drones</h2>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>({drones.length})</span>
                        </div>
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={e => { e.stopPropagation(); setShowAddDrone(true); }}>+ Add Drone</button>
                    </div>
                    {infraOpen.drones && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                            {drones.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 13 }}>No drones for now.</div>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Drone ID</th><th>Name</th><th>Model</th><th>Location</th><th>Battery</th><th>Batt. Health</th><th>Status</th><th>Target</th><th>Arrival</th><th></th></tr>
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
                                                    <span style={{ fontSize: 12, fontWeight: 600, color: d.status === 'ready' ? '#22c55e' : d.status === 'on_route' ? '#3b82f6' : d.status === 'relocating' ? '#f97316' : d.status === 'charging' ? '#ef4444' : 'var(--text-secondary)' }}>
                                                        {d.status === 'on_route' ? 'on route' : d.status}
                                                    </span>
                                                </td>
                                                <td className="muted">{['on_route', 'relocating'].includes(d.status) ? d.target_location : '—'}</td>
                                                <td className="mono">{['on_route', 'relocating'].includes(d.status) ? d.time_of_arrival : '—'}</td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => { setRelocatingDrone(d); setRelocateTarget(''); }}>Relocate</button>
                                                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => openEditDrone(d)}>Edit</button>
                                                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.25)' }} onClick={() => handleDeleteDrone(d)}>Delete</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>

                {/* Lines Table */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleInfra('lines')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{infraOpen.lines ? '▾' : '▸'}</span>
                            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Lines</h2>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>({lines.length})</span>
                        </div>
                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 14px' }} onClick={e => { e.stopPropagation(); openAddLine(); }}>+ Add Line</button>
                    </div>
                    {infraOpen.lines && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                            {lines.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)', fontSize: 13 }}>No lines defined yet.</div>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr><th>ID</th><th>Name</th><th>Color</th><th>Stations</th><th></th></tr>
                                    </thead>
                                    <tbody>
                                        {lines.map(l => (
                                            <tr key={l.id}>
                                                <td className="mono" style={{ fontWeight: 600 }}>{l.id}</td>
                                                <td className="bold">{l.name}</td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <div style={{ width: 16, height: 16, borderRadius: 3, background: l.color, border: '1px solid var(--border)', flexShrink: 0 }} />
                                                        <span className="mono" style={{ fontSize: 12 }}>{l.color}</span>
                                                    </div>
                                                </td>
                                                <td className="muted" style={{ fontSize: 12 }}>{l.stations.length > 0 ? l.stations.join(', ') : '—'}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => openEditLine(l)}>Edit</button>
                                                        <button className="btn btn-secondary" style={{ fontSize: 11, padding: '5px 10px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.25)' }} onClick={() => handleDeleteLine(l)}>Delete</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                </div>

                {/* Station Cameras */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleInfra('cameras')}>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{infraOpen.cameras ? '▾' : '▸'}</span>
                        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Station Cameras</h2>
                    </div>
                    {infraOpen.cameras && (
                        <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                                {surveillanceFeeds.map((feed) => (
                                    <DroneFeed key={`${feed.id}-infra`} src={feed.src} label={feed.label} id={feed.id} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Add Node Modal */}
                {showAddNode && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 520, padding: '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>{editingNodeId ? `Edit Node — ${editingNodeId}` : 'Add New Node'}</h2>
                            <form onSubmit={handleAddNode}>
                                {!editingNodeId && (
                                    <div style={{ marginBottom: 16 }}>
                                        <label className="form-label">Node Name</label>
                                        <input className="form-input" required value={nodeForm.id} onChange={e => setNodeForm(f => ({ ...f, id: e.target.value }))} placeholder="e.g. Oujé-Bougoumou" />
                                    </div>
                                )}
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
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowAddNode(false); setNodeForm(emptyNodeForm); setEditingNodeId(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">{editingNodeId ? 'Save Changes' : 'Add Node'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Relocate Drone Modal */}
                {relocatingDrone && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 400, padding: '32px 36px' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Relocate {relocatingDrone.id}</h2>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
                                {relocatingDrone.name} · currently at <strong>{relocatingDrone.location}</strong>
                                {relocatingDrone.assignment && <span style={{ color: 'var(--warning)', marginLeft: 6 }}>⚠ Has active assignment — relocation will clear it</span>}
                            </p>
                            <form onSubmit={handleRelocate}>
                                <div style={{ marginBottom: 24 }}>
                                    <label className="form-label">Target Node</label>
                                    <select className="form-input" required value={relocateTarget} onChange={e => setRelocateTarget(e.target.value)}>
                                        <option value="">Select destination node…</option>
                                        {stations.map(s => (
                                            <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setRelocatingDrone(null); setRelocateTarget(''); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Dispatch</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Add Drone Modal */}
                {showAddDrone && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 480, padding: '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>{editingDroneId ? `Edit Drone — ${editingDroneId}` : 'Add New Drone'}</h2>
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
                                        <option value="relocating">Relocating</option>
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
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowAddDrone(false); setDroneForm(emptyDroneForm); setEditingDroneId(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">{editingDroneId ? 'Save Changes' : 'Add Drone'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Add / Edit Line Modal */}
                {showLineModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 520, padding: '32px 36px', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>{editingLineId ? 'Edit Line' : 'Add New Line'}</h2>
                            <form onSubmit={handleSaveLine}>
                                {!editingLineId && (
                                    <div style={{ marginBottom: 16 }}>
                                        <label className="form-label">Line ID</label>
                                        <input className="form-input" required value={lineForm.id} onChange={e => setLineForm(f => ({ ...f, id: e.target.value }))} placeholder="e.g. line-north" />
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 16, alignItems: 'end' }}>
                                    <div>
                                        <label className="form-label">Name</label>
                                        <input className="form-input" required value={lineForm.name} onChange={e => setLineForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Northern Express" />
                                    </div>
                                    <div>
                                        <label className="form-label">Color</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input type="color" value={lineForm.color} onChange={e => setLineForm(f => ({ ...f, color: e.target.value }))} style={{ width: 40, height: 38, padding: 2, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'var(--surface)' }} />
                                            <input className="form-input" value={lineForm.color} onChange={e => setLineForm(f => ({ ...f, color: e.target.value }))} style={{ width: 110 }} placeholder="#3b82f6" />
                                        </div>
                                    </div>
                                </div>
                                <div style={{ marginBottom: 16 }}>
                                    <label className="form-label">Station Order</label>
                                    {/* Ordered selected stations */}
                                    {lineForm.stations.length > 0 && (
                                        <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
                                            {lineForm.stations.map((sid, i) => (
                                                <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: i < lineForm.stations.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--surface)', fontSize: 13 }}>
                                                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 18, flexShrink: 0 }}>{i + 1}</span>
                                                    <span style={{ flex: 1 }}>{sid}</span>
                                                    <button type="button" disabled={i === 0} onClick={() => setLineForm(f => { const s = [...f.stations]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; return { ...f, stations: s }; })} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--text-tertiary)' : 'var(--text)', padding: '2px 4px', fontSize: 12 }}>↑</button>
                                                    <button type="button" disabled={i === lineForm.stations.length - 1} onClick={() => setLineForm(f => { const s = [...f.stations]; [s[i], s[i + 1]] = [s[i + 1], s[i]]; return { ...f, stations: s }; })} style={{ background: 'none', border: 'none', cursor: i === lineForm.stations.length - 1 ? 'default' : 'pointer', color: i === lineForm.stations.length - 1 ? 'var(--text-tertiary)' : 'var(--text)', padding: '2px 4px', fontSize: 12 }}>↓</button>
                                                    <button type="button" onClick={() => setLineForm(f => ({ ...f, stations: f.stations.filter(s => s !== sid) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px 4px', fontSize: 14, lineHeight: 1 }}>×</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Add station dropdown */}
                                    {stations.filter(s => !lineForm.stations.includes(s.id)).length > 0 ? (
                                        <select className="form-input" value="" onChange={e => { if (e.target.value) setLineForm(f => ({ ...f, stations: [...f.stations, e.target.value] })); }}>
                                            <option value="">+ Add station…</option>
                                            {stations.filter(s => !lineForm.stations.includes(s.id)).map(s => (
                                                <option key={s.id} value={s.id}>{s.id} ({s.type})</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>All stations added.</div>
                                    )}
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>{lineForm.stations.length} station{lineForm.stations.length !== 1 ? 's' : ''} — order defines the route</div>
                                </div>
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowLineModal(false); setLineForm(emptyLineForm); setEditingLineId(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">{editingLineId ? 'Save Changes' : 'Add Line'}</button>
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
        const handleCortexSend = async (e) => {
            e.preventDefault();
            if (!cortexInput.trim() || cortexLoading) return;
            const userMsg = cortexInput.trim();
            setCortexInput('');
            setCortexMessages(prev => [...prev, { role: 'user', content: userMsg }]);
            setCortexLoading(true);
            try {
                const res = await fetch('/api/cortex/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: userMsg, history: cortexMessages }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Cortex request failed');
                setCortexMessages(prev => [...prev, { role: 'assistant', content: data.reply, model: data.model }]);
            } catch (err) {
                setCortexMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]);
            } finally {
                setCortexLoading(false);
            }
        };

        const delivered = deliveries.filter(d => d.status === 'DELIVERED');
        const avgTime = delivered.length > 0
            ? Math.round(delivered.reduce((sum, d) => sum + Math.max(0, (new Date(d.createdAt).getTime() - Date.now()) / -60000), 0) / delivered.length)
            : 0;

        return (
            <div>
                <div className="page-header">
                    <h1>Corridor Analytics</h1>
                    <p>Operational intelligence powered by Snowflake Cortex.</p>
                </div>

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="card stat-card">
                        <div className="stat-label">Total Deliveries</div>
                        <div className="stat-value">{deliveries.length}</div>
                        <div className="stat-sub stat-sub-muted">{delivered.length} completed</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Active Stations</div>
                        <div className="stat-value">{stations.filter(s => s.status === 'online').length}<span className="stat-value-unit">/ {stations.length}</span></div>
                        <div className="stat-sub stat-sub-muted">Corridor nodes</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Fleet Size</div>
                        <div className="stat-value">{drones.length}</div>
                        <div className="stat-sub stat-sub-muted">{drones.filter(d => d.status === 'on_route').length} active</div>
                    </div>
                    <div className="card stat-card">
                        <div className="stat-label">Est. Savings vs Helicopter</div>
                        <div className="stat-value">${(delivered.length * 7500).toLocaleString()}</div>
                        <div className="stat-sub" style={{ color: 'var(--accent)' }}>{delivered.length} flights × $7,500 avg</div>
                    </div>
                </div>

                {/* Cortex Chat */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 16, marginTop: 8 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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

                    <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 520 }}>
                        <div className="card-header">
                            <span className="card-header-title"><MessageSquare size={14} /> Corridor Intelligence</span>
                            <span style={{ fontSize: 10, padding: '2px 8px', background: '#dbeafe', color: '#2563eb', borderRadius: 4, fontWeight: 600 }}>Snowflake Cortex</span>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {cortexMessages.length === 0 && (
                                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12, padding: '40px 20px' }}>
                                    <MessageSquare size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Ask about your corridor</div>
                                    <div>"Which station needs maintenance?"</div>
                                    <div>"How many deliveries today?"</div>
                                    <div>"What's our fleet utilization?"</div>
                                </div>
                            )}
                            {cortexMessages.map((msg, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                    <div style={{
                                        maxWidth: '85%',
                                        padding: '10px 14px',
                                        borderRadius: 10,
                                        fontSize: 13,
                                        lineHeight: 1.6,
                                        background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg)',
                                        color: msg.role === 'user' ? 'white' : 'var(--text)',
                                        border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                                    }}>
                                        {msg.role === 'user' ? msg.content : (
                                            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                                        )}
                                        {msg.model && <div style={{ fontSize: 10, marginTop: 6, opacity: 0.5 }}>{msg.model}</div>}
                                    </div>
                                </div>
                            ))}
                            {cortexLoading && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Querying Snowflake Cortex…
                                </div>
                            )}
                        </div>
                        <form onSubmit={handleCortexSend} style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                            <input
                                className="form-input"
                                style={{ flex: 1, margin: 0 }}
                                placeholder="Ask about corridor operations…"
                                value={cortexInput}
                                onChange={e => setCortexInput(e.target.value)}
                                disabled={cortexLoading}
                            />
                            <button type="submit" className="btn btn-primary" style={{ padding: '8px 14px' }} disabled={cortexLoading || !cortexInput.trim()}>
                                <Send size={14} />
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
