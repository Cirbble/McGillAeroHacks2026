import { useEffect, useRef, useState } from 'react';

function findStationMatch(label, stations) {
    if (!label) return null;
    const normalized = String(label).toLowerCase();
    return stations.find((station) => (
        station.id.toLowerCase() === normalized || normalized.includes(station.id.toLowerCase())
    )) || null;
}

function buildFlightDronePositions(drones, stations, lines) {
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));

    return drones
        .filter((drone) => (drone.status === 'on_route' || drone.status === 'relocating') && drone.target_location)
        .map((drone) => {
            const target = findStationMatch(drone.target_location, stations);
            if (!target) return null;

            let origin = findStationMatch(drone.origin_location || drone.location, stations);
            if (!origin) {
                for (const line of lines) {
                    const targetIndex = line.stations.indexOf(target.id);
                    if (targetIndex > 0) {
                        origin = stationsById[line.stations[targetIndex - 1]] || null;
                        if (origin) break;
                    }
                }
            }

            return {
                lat: origin ? (origin.lat + target.lat) / 2 : target.lat + 0.18,
                lng: origin ? (origin.lng + target.lng) / 2 : target.lng + 0.18,
                drone,
            };
        })
        .filter(Boolean);
}

function buildStationaryDronePositions(drones, stations) {
    const grouped = new Map();

    drones
        .filter((drone) => drone.status === 'ready' || drone.status === 'charging')
        .forEach((drone) => {
            const station = findStationMatch(drone.location, stations);
            if (!station) return;

            const key = station.id;
            if (!grouped.has(key)) {
                grouped.set(key, { station, drones: [] });
            }
            grouped.get(key).drones.push(drone);
        });

    const markers = [];
    grouped.forEach(({ station, drones: stationDrones }) => {
        const count = stationDrones.length;
        stationDrones.forEach((drone, index) => {
            if (count === 1) {
                markers.push({ lat: station.lat, lng: station.lng, drone, station });
                return;
            }

            const angle = (Math.PI * 2 * index) / count;
            const latOffset = Math.sin(angle) * 0.055;
            const lngOffset = Math.cos(angle) * 0.075;
            markers.push({
                lat: station.lat + latOffset,
                lng: station.lng + lngOffset,
                drone,
                station,
            });
        });
    });

    return markers;
}

function makeDroneSvg(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><line x1="14" y1="14" x2="5" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="5" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="14" x2="23" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="23" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="5" cy="23" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="23" cy="23" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="14" cy="14" r="4.5" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
}

function getDroneMarkerStyle(drone, isSelected) {
    if (isSelected) {
        return {
            color: '#ef4444',
            scale: 1.22,
            label: 'Selected',
        };
    }

    if (drone.status === 'charging') {
        return {
            color: '#ef4444',
            scale: 1,
            label: 'Charging',
        };
    }

    if (drone.status === 'ready') {
        return {
            color: '#22c55e',
            scale: 1,
            label: 'Ready',
        };
    }

    if (drone.status === 'relocating') {
        return {
            color: '#3b82f6',
            scale: 1.08,
            label: 'Relocating',
        };
    }

    return {
        color: '#f59e0b',
        scale: 1.08,
        label: 'On route',
    };
}

function buildWeatherOverlaySignature(weatherOverlay) {
    if (!weatherOverlay?.url || !weatherOverlay?.layers) return '';
    return [
        weatherOverlay.url,
        weatherOverlay.layers,
        weatherOverlay.styles || '',
        weatherOverlay.opacity ?? '',
        weatherOverlay.version || '1.3.0',
    ].join('|');
}

export default function CorridorMapShared({
    stations = [],
    drones = [],
    deliveries = [],
    lines = [],
    height = 420,
    showLines = false,
    darkMode = false,
    selectedDroneId = null,
    onDroneClick = null,
    showStationaryDrones = true,
    weatherOverlay = null,
    highlightedDeliveryId = null,
}) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const leafletRef = useRef(null);
    const resizeObserverRef = useRef(null);
    const onDroneClickRef = useRef(onDroneClick);
    const weatherOverlaySignatureRef = useRef('');
    const layersRef = useRef({
        lines: null,
        routes: null,
        stations: null,
        drones: null,
        weather: null,
    });
    const [mapReady, setMapReady] = useState(false);

    onDroneClickRef.current = onDroneClick;

    useEffect(() => {
        let cancelled = false;

        async function initMap() {
            const L = (await import('leaflet')).default;
            await import('leaflet/dist/leaflet.css');

            if (cancelled || !mapRef.current || mapInstanceRef.current) return;

            leafletRef.current = L;
            const lats = stations.map((station) => station.lat);
            const lngs = stations.map((station) => station.lng);
            const centerLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 52.0;
            const centerLng = lngs.length ? (Math.min(...lngs) + Math.max(...lngs)) / 2 : -72.0;
            const zoom = stations.length > 12 ? 5 : 6;

            const map = L.map(mapRef.current, {
                center: [centerLat, centerLng],
                zoom,
                zoomControl: false,
                attributionControl: false,
                zoomAnimation: false,
                fadeAnimation: false,
                markerZoomAnimation: false,
            });

            const tileUrl = darkMode
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
            L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
            L.control.zoom({ position: 'topright' }).addTo(map);

            layersRef.current.lines = L.layerGroup().addTo(map);
            layersRef.current.routes = L.layerGroup().addTo(map);
            layersRef.current.stations = L.layerGroup().addTo(map);
            layersRef.current.drones = L.layerGroup().addTo(map);

            if (typeof ResizeObserver !== 'undefined') {
                resizeObserverRef.current = new ResizeObserver(() => {
                    map.invalidateSize(false);
                });
                resizeObserverRef.current.observe(mapRef.current);
            }

            mapInstanceRef.current = map;
            setMapReady(true);
            window.setTimeout(() => {
                if (mapInstanceRef.current === map) {
                    map.invalidateSize(false);
                }
            }, 60);
        }

        initMap();

        return () => {
            cancelled = true;
            resizeObserverRef.current?.disconnect();
            resizeObserverRef.current = null;
            weatherOverlaySignatureRef.current = '';
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
            leafletRef.current = null;
            layersRef.current = {
                lines: null,
                routes: null,
                stations: null,
                drones: null,
                weather: null,
            };
        };
    }, []);

    useEffect(() => {
        const L = leafletRef.current;
        const map = mapInstanceRef.current;
        if (!mapReady || !L || !map) return;

        const layers = layersRef.current;
        const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
        const weatherSignature = buildWeatherOverlaySignature(weatherOverlay);

        if (weatherSignature) {
            const pane = map.getPane('corridorWeatherPane') || map.createPane('corridorWeatherPane');
            pane.style.zIndex = 340;

            if (weatherOverlaySignatureRef.current !== weatherSignature && layers.weather && map.hasLayer(layers.weather)) {
                map.removeLayer(layers.weather);
                layers.weather = null;
            }

            if (!layers.weather) {
                layers.weather = L.tileLayer.wms(weatherOverlay.url, {
                    pane: 'corridorWeatherPane',
                    layers: weatherOverlay.layers,
                    styles: weatherOverlay.styles || '',
                    format: 'image/png',
                    transparent: true,
                    version: weatherOverlay.version || '1.3.0',
                    opacity: weatherOverlay.opacity ?? 0.58,
                    crossOrigin: true,
                });
            }

            if (!map.hasLayer(layers.weather)) {
                layers.weather.addTo(map);
            }
            weatherOverlaySignatureRef.current = weatherSignature;
        } else if (layers.weather && map.hasLayer(layers.weather)) {
            map.removeLayer(layers.weather);
            layers.weather = null;
            weatherOverlaySignatureRef.current = '';
        }

        layers.lines?.clearLayers();
        layers.routes?.clearLayers();
        layers.stations?.clearLayers();
        layers.drones?.clearLayers();

        if (showLines && lines.length > 0) {
            lines.forEach((line) => {
                const coords = line.stations
                    .map((stationId) => stationsById[stationId])
                    .filter(Boolean)
                    .map((station) => [station.lat, station.lng]);

                if (coords.length > 1) {
                    L.polyline(coords, {
                        color: line.color,
                        weight: 3,
                        opacity: 0.68,
                    }).addTo(layers.lines);
                }
            });
        }

        const displayedDeliveries = highlightedDeliveryId
            ? deliveries.filter((delivery) => delivery.id === highlightedDeliveryId)
            : deliveries;

        displayedDeliveries
            .filter((delivery) => (
                delivery.route?.length > 1
                && ['IN_TRANSIT', 'HANDOFF', 'PENDING_DISPATCH', 'READY_TO_LAUNCH', 'REROUTED', 'WEATHER_HOLD'].includes(delivery.status)
            ))
            .forEach((delivery) => {
                const coords = delivery.route
                    .map((stationId) => stationsById[stationId])
                    .filter(Boolean)
                    .map((station) => [station.lat, station.lng]);

                if (coords.length > 1) {
                    L.polyline(coords, {
                        color: '#f59e0b',
                        weight: 3,
                        opacity: 0.74,
                        dashArray: '8 5',
                    }).addTo(layers.routes);
                }
            });

        stations.forEach((station) => {
            const isActive = station.status === 'online';
            const isHub = station.type === 'distribution';
            const size = isHub ? 14 : 10;
            const stationLines = lines.filter((line) => line.stations.includes(station.id));
            const markerColor = stationLines[0]?.color || (isActive ? '#3b82f6' : '#475569');
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${isActive ? markerColor : '#475569'};border:2px solid ${darkMode ? 'rgba(255,255,255,0.45)' : 'white'};box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2],
            });

            L.marker([station.lat, station.lng], { icon })
                .addTo(layers.stations)
                .bindTooltip(
                    `<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${station.id}</strong><br/><span style="color:#64748b">${station.type}</span></div>`,
                    { direction: 'top', offset: [0, -8] }
                );
        });

        const droneMarkers = [
            ...buildFlightDronePositions(drones, stations, lines),
            ...(showStationaryDrones ? buildStationaryDronePositions(drones, stations) : []),
        ];

        droneMarkers.forEach(({ lat, lng, drone, station }) => {
            const isSelected = drone.id === selectedDroneId;
            const markerStyle = getDroneMarkerStyle(drone, isSelected);
            const destination = drone.target_location || station?.id || drone.location || '-';
            const droneIcon = L.divIcon({
                className: '',
                html: `<div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));transform:scale(${markerStyle.scale});transition:transform 0.2s;">${makeDroneSvg(markerStyle.color)}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            });

            const marker = L.marker([lat, lng], { icon: droneIcon })
                .addTo(layers.drones)
                .bindTooltip(
                    `<div style="font-family:Inter,sans-serif;font-size:11px;"><strong>${drone.id}</strong><br/><span style="color:#64748b">${markerStyle.label}</span><br/><span style="color:#94a3b8">${drone.speed || 0} km/h → ${destination}</span></div>`,
                    { direction: 'top', offset: [0, -16] }
                );

            marker.on('click', () => {
                if (onDroneClickRef.current) {
                    onDroneClickRef.current(drone.id);
                }
            });
        });

        map.invalidateSize(false);
    }, [
        darkMode,
        deliveries,
        drones,
        lines,
        mapReady,
        selectedDroneId,
        showLines,
        showStationaryDrones,
        stations,
        highlightedDeliveryId,
        weatherOverlay,
    ]);

    return <div ref={mapRef} style={{ width: '100%', height, minHeight: height, borderRadius: 8 }} />;
}
