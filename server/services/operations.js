export const DELIVERY_STATUSES = [
    'REQUESTED',
    'CANCELLED',
    'PENDING_DISPATCH',
    'AWAITING_REVIEW',
    'READY_TO_LAUNCH',
    'IN_TRANSIT',
    'HANDOFF',
    'WEATHER_HOLD',
    'REROUTED',
    'REJECTED',
    'DELIVERED',
];

export const ACTIVE_DELIVERY_STATUSES = new Set([
    'PENDING_DISPATCH',
    'AWAITING_REVIEW',
    'READY_TO_LAUNCH',
    'IN_TRANSIT',
    'HANDOFF',
    'WEATHER_HOLD',
    'REROUTED',
]);

const HIGH_PRIORITY = new Set(['Urgent', 'Emergency']);
const DEFAULT_DELIVERY_CRUISE_SPEED_KPH = 78;
const DELIVERY_MODEL_CRUISE_SPEEDS = {
    'DDC Sparrow': 72,
    'DDC Robin XL': 68,
    'DJI FlyCart 30': 58,
};

function uniqueList(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function routesMatch(left = [], right = []) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function makeEvent(type, title, detail, extra = {}) {
    return {
        type,
        title,
        detail,
        timestamp: new Date(),
        ...extra,
    };
}

function mergeEvents(existing = [], additions = []) {
    const seen = new Set(existing.map((event) => (
        `${event.type}:${event.title}:${event.detail}:${event.stationId || ''}`
    )));

    const merged = [...existing];
    additions.forEach((event) => {
        const key = `${event.type}:${event.title}:${event.detail}:${event.stationId || ''}`;
        if (!seen.has(key)) {
            merged.push(event);
            seen.add(key);
        }
    });

    return merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function formatEstimatedTime(totalMinutes) {
    const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    if (hours === 0) return `${remainder}m`;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
}

function hasCoordinates(station) {
    return Number.isFinite(Number(station?.lat)) && Number.isFinite(Number(station?.lng));
}

function haversineKm(from, to) {
    const earthRadiusKm = 6371;
    const fromLat = Number(from.lat) * Math.PI / 180;
    const toLat = Number(to.lat) * Math.PI / 180;
    const deltaLat = (Number(to.lat) - Number(from.lat)) * Math.PI / 180;
    const deltaLng = (Number(to.lng) - Number(from.lng)) * Math.PI / 180;
    const a = Math.sin(deltaLat / 2) ** 2
        + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.asin(Math.sqrt(a));
}

function calculateRouteDistanceKm(route = [], stationsById = {}) {
    if (route.length <= 1) return 0;

    let distanceKm = 0;
    let measuredSegments = 0;

    for (let index = 0; index < route.length - 1; index += 1) {
        const from = stationsById[route[index]];
        const to = stationsById[route[index + 1]];

        if (!hasCoordinates(from) || !hasCoordinates(to)) continue;

        measuredSegments += 1;
        distanceKm += haversineKm(from, to);
    }

    if (measuredSegments === 0) return null;
    return Number(distanceKm.toFixed(1));
}

function getRemainingRoute(route = [], lastStation = null, currentLeg = 0) {
    if (route.length === 0) return [];
    if (Number(currentLeg || 0) <= 0 || !lastStation) return route;

    const lastStationIndex = route.indexOf(lastStation);
    if (lastStationIndex === -1) return route;
    return route.slice(lastStationIndex);
}

function summarizeRouteDistance({
    route = [],
    stationsById = {},
    lastStation = null,
    currentLeg = 0,
}) {
    const routeDistanceKm = calculateRouteDistanceKm(route, stationsById);
    const remainingDistanceKm = calculateRouteDistanceKm(
        getRemainingRoute(route, lastStation, currentLeg),
        stationsById
    );

    return {
        routeDistanceKm,
        remainingDistanceKm,
    };
}

function estimateWeatherDelayMinutes(warnings = []) {
    return warnings.reduce((total, warning) => (
        total + (warning.severity === 'SEVERE' ? 18 : warning.severity === 'UNSTABLE' ? 10 : 4)
    ), 0);
}

function getAssignedDeliveryDrone(deliveryInput = {}, drones = []) {
    return [...drones]
        .filter((drone) => drone.assignment && drone.assignment === deliveryInput.id)
        .sort((left, right) => {
            const speedDelta = Number(right.speed || 0) - Number(left.speed || 0);
            if (speedDelta !== 0) return speedDelta;
            if (left.status === 'on_route' && right.status !== 'on_route') return -1;
            if (right.status === 'on_route' && left.status !== 'on_route') return 1;
            return String(left.id || '').localeCompare(String(right.id || ''));
        })[0] || null;
}

function resolveDeliveryCruiseProfile(deliveryInput = {}, drones = []) {
    const assignedDrone = getAssignedDeliveryDrone(deliveryInput, drones);
    if (assignedDrone) {
        const liveSpeed = Number(assignedDrone.speed || 0);
        if (liveSpeed > 0) {
            return {
                cruiseSpeedKph: liveSpeed,
                speedSource: `${assignedDrone.id} live telemetry`,
            };
        }

        const modelSpeed = DELIVERY_MODEL_CRUISE_SPEEDS[assignedDrone.model];
        if (modelSpeed) {
            return {
                cruiseSpeedKph: modelSpeed,
                speedSource: `${assignedDrone.id} model cruise profile`,
            };
        }
    }

    return {
        cruiseSpeedKph: DEFAULT_DELIVERY_CRUISE_SPEED_KPH,
        speedSource: assignedDrone
            ? `${assignedDrone.id} default corridor cruise profile`
            : 'Corridor default cruise profile',
    };
}

function buildDeliveryEtaProfile({
    deliveryInput = {},
    route = [],
    stationsById = {},
    warnings = [],
    routeWasRerouted = false,
    drones = [],
}) {
    const remainingRoute = getRemainingRoute(
        route,
        deliveryInput.lastStation || deliveryInput.origin,
        deliveryInput.currentLeg
    );
    const remainingLegs = Math.max(1, remainingRoute.length - 1);
    const remainingDistanceKm = calculateRouteDistanceKm(remainingRoute, stationsById);
    const { cruiseSpeedKph, speedSource } = resolveDeliveryCruiseProfile(deliveryInput, drones);
    const baseFlightMinutes = Number.isFinite(Number(remainingDistanceKm)) && Number(cruiseSpeedKph) > 0
        ? Math.max(12, Math.round((Number(remainingDistanceKm) / Number(cruiseSpeedKph)) * 60))
        : Math.max(18, remainingLegs * 18);
    const handoffDelayMinutes = Math.max(0, remainingRoute.length - 2) * 4;
    const weatherDelayMinutes = estimateWeatherDelayMinutes(warnings);
    const rerouteCoordinationMinutes = routeWasRerouted ? 8 : 0;
    const priorityAdjustmentMinutes = HIGH_PRIORITY.has(deliveryInput.priority) ? -4 : 0;
    const estimatedMinutes = Math.max(
        22,
        baseFlightMinutes
            + handoffDelayMinutes
            + weatherDelayMinutes
            + rerouteCoordinationMinutes
            + priorityAdjustmentMinutes
    );

    return {
        estimatedMinutes,
        estimatedTime: formatEstimatedTime(estimatedMinutes),
        cruiseSpeedKph,
        speedSource,
        baseFlightMinutes,
        weatherDelayMinutes,
        handoffDelayMinutes,
    };
}

function getGraph(lines = []) {
    const graph = new Map();

    const addEdge = (from, to, line) => {
        if (!graph.has(from)) graph.set(from, []);
        graph.get(from).push({
            to,
            lineId: line.id,
            lineName: line.name,
            lineColor: line.color,
        });
    };

    lines.forEach((line) => {
        for (let index = 0; index < line.stations.length - 1; index += 1) {
            const from = line.stations[index];
            const to = line.stations[index + 1];
            addEdge(from, to, line);
            addEdge(to, from, line);
        }
    });

    return graph;
}

function isRouteSegmentValid(route = [], lines = []) {
    if (route.length <= 1) return true;
    const graph = getGraph(lines);

    for (let index = 0; index < route.length - 1; index += 1) {
        const from = route[index];
        const to = route[index + 1];
        const neighbors = graph.get(from) || [];
        if (!neighbors.some((neighbor) => neighbor.to === to)) {
            return false;
        }
    }

    return true;
}

function getSeverityWeight(condition) {
    if (condition === 'SEVERE') return 100;
    if (condition === 'UNSTABLE') return 16;
    if (condition === 'WATCH') return 5;
    return 0;
}

function getWeatherPenalty(snapshot, mode) {
    if (!snapshot) return 0;
    if (snapshot.condition === 'SEVERE') return 100;
    if (mode === 'strict' && snapshot.condition === 'UNSTABLE') return 100;
    if (snapshot.condition === 'UNSTABLE') return 6;
    if (snapshot.condition === 'WATCH') return 2;
    return 0;
}

function isStationBlocked(station, weatherSnapshot, mode = 'automatic') {
    if (!station) return true;
    if (station.status === 'offline') return true;
    if (station.status === 'maintenance') return true;
    if (weatherSnapshot?.condition === 'SEVERE') return true;
    if (mode === 'strict' && weatherSnapshot?.condition === 'UNSTABLE') return true;
    return false;
}

export function findBestRoute({
    origin,
    destination,
    lines = [],
    stationsById = {},
    weatherByStation = {},
    avoidStations = [],
    mode = 'automatic',
}) {
    if (!origin || !destination) return [];
    if (origin === destination) return [origin];

    const graph = getGraph(lines);
    const avoid = new Set(avoidStations.filter(Boolean));
    avoid.delete(origin);
    avoid.delete(destination);

    const queue = [{ node: origin, cost: 0, path: [origin] }];
    const bestCost = new Map([[origin, 0]]);

    while (queue.length > 0) {
        queue.sort((left, right) => left.cost - right.cost);
        const current = queue.shift();

        if (!current) break;
        if (current.node === destination) return current.path;

        const neighbors = graph.get(current.node) || [];
        neighbors.forEach((neighbor) => {
            if (avoid.has(neighbor.to)) return;

            const station = stationsById[neighbor.to];
            const snapshot = weatherByStation[neighbor.to];
            if (isStationBlocked(station, snapshot, mode)) return;

            const nextCost = current.cost + 1 + getWeatherPenalty(snapshot, mode);
            if (nextCost >= (bestCost.get(neighbor.to) ?? Number.POSITIVE_INFINITY)) return;

            bestCost.set(neighbor.to, nextCost);
            queue.push({
                node: neighbor.to,
                cost: nextCost,
                path: [...current.path, neighbor.to],
            });
        });
    }

    return [];
}

function describeStationIssue(station, snapshot) {
    if (!station) {
        return {
            title: 'Unknown node state',
            detail: 'The route references a station that is not configured in the corridor graph.',
        };
    }

    if (station.status === 'offline') {
        return {
            title: `${station.id} is offline`,
            detail: 'No launch, landing, or handoff operations can clear this node.',
        };
    }

    if (station.status === 'maintenance') {
        return {
            title: `${station.id} is under maintenance`,
            detail: 'Relay activity through this node should be bypassed or held.',
        };
    }

    if (!snapshot) {
        return {
            title: `${station.id} weather unavailable`,
            detail: 'Weather telemetry is unavailable, so the node should be watched manually.',
        };
    }

    return {
        title: `${station.id} weather ${snapshot.condition.toLowerCase()}`,
        detail: snapshot.issues[0] || snapshot.summary,
    };
}

function formatRoutePreview(route = []) {
    const stops = route.filter(Boolean);
    if (stops.length <= 4) {
        return stops.join(' → ');
    }

    return `${stops[0]} → ${stops[1]} → … → ${stops[stops.length - 1]}`;
}

function buildManualDecision({
    shouldUseReroute,
    currentRouteIsBest,
    primaryAssessment,
    primaryFullRoute,
    fullRoute,
    bestAvailableFullRoute,
}) {
    const currentWarning = primaryAssessment.warnings[0] || null;

    if (shouldUseReroute) {
        const reason = currentWarning
            ? `${currentWarning.stationId} is degrading the current corridor. ${currentWarning.detail}`
            : 'A safer corridor is available under current conditions.';

        return {
            decisionStatus: 'rerouted',
            decisionSummary: 'Manual reroute approved',
            decisionDetail: `${reason} New path: ${formatRoutePreview(fullRoute)}.`,
        };
    }

    if (currentRouteIsBest) {
        const detail = currentWarning
            ? `No change applied. The active corridor already matches the safest available route. Highest remaining risk: ${currentWarning.stationId}. ${currentWarning.detail}`
            : 'No change applied. The active corridor already matches the safest available route for current conditions.';

        return {
            decisionStatus: 'rejected',
            decisionSummary: 'Manual reroute rejected',
            decisionDetail: detail,
        };
    }

    const bestRouteLabel = bestAvailableFullRoute.length > 0
        ? formatRoutePreview(bestAvailableFullRoute)
        : formatRoutePreview(primaryFullRoute);
    const detail = currentWarning
        ? `No better corridor is available right now. ${currentWarning.stationId} is still the limiting factor, so the mission stays on ${formatRoutePreview(primaryFullRoute)}. Best available option remains ${bestRouteLabel}.`
        : `No better corridor is available right now, so the mission stays on ${formatRoutePreview(primaryFullRoute)}. Best available option remains ${bestRouteLabel}.`;

    return {
        decisionStatus: 'unavailable',
        decisionSummary: 'Manual reroute not available',
        decisionDetail: detail,
    };
}

export function assessRoute(route = [], stationsById = {}, weatherByStation = {}) {
    const warnings = [];
    let maxSeverity = 'CLEAR';
    let riskScore = 0;

    route.forEach((stationId, index) => {
        if (index === 0) return;

        const station = stationsById[stationId];
        const snapshot = weatherByStation[stationId];
        const severityWeight = getSeverityWeight(snapshot?.condition);
        riskScore += severityWeight;

        const isBlocked = isStationBlocked(station, snapshot);
        const hasWarning = isBlocked || ['WATCH', 'UNSTABLE'].includes(snapshot?.condition);
        if (!hasWarning) return;

        if (snapshot?.condition === 'SEVERE' || station?.status === 'offline' || station?.status === 'maintenance') {
            maxSeverity = 'SEVERE';
        } else if (snapshot?.condition === 'UNSTABLE' && maxSeverity !== 'SEVERE') {
            maxSeverity = 'UNSTABLE';
        } else if (snapshot?.condition === 'WATCH' && maxSeverity === 'CLEAR') {
            maxSeverity = 'WATCH';
        }

        const issue = describeStationIssue(station, snapshot);
        warnings.push({
            stationId,
            severity: station?.status === 'offline' || station?.status === 'maintenance'
                ? 'SEVERE'
                : snapshot?.condition || 'WATCH',
            title: issue.title,
            detail: issue.detail,
            issues: snapshot?.issues || [],
            summary: snapshot?.summary || issue.detail,
        });
    });

    const routeState = warnings.some((warning) => warning.severity === 'SEVERE')
        ? 'BLOCKED'
        : warnings.some((warning) => warning.severity === 'UNSTABLE')
            ? 'ADVISORY'
            : warnings.length > 0
                ? 'WATCH'
                : 'CLEAR';

    return {
        routeState,
        riskScore,
        warnings,
        weatherState: maxSeverity,
    };
}

function getExistingPrefix(route = [], lastStation) {
    if (!route.length || !lastStation) return [];
    const stationIndex = route.indexOf(lastStation);
    if (stationIndex === -1) return [];
    return route.slice(0, stationIndex + 1);
}

function sanitizeRequestedPayload(payload = {}) {
    const normalized = { ...payload };
    const rawPayload = String(payload.payload || '').trim();
    const lowered = rawPayload.toLowerCase();
    const sourceContext = [
        payload.payload,
        payload.sourceText,
        payload.clinicNotes,
        payload.geminiSummary,
    ].filter(Boolean).join(' ');
    const likelyMedical = /(insulin|medication|medicine|meds|heart|cardiac|cardio|blood|vaccine|vaccin|antibiotic|dialysis|epinephrine|specimen|tissue|iv fluids?|analgesic|pharmacy|prescription|insuline|medicament|m[ée]dicament|m[ée]dicaments|sang|coeur|cardiaque|antibiotique|pharmacie|ordonnance|vaccins?)/i.test(sourceContext);
    const clearlyUnauthorized = /(live animals?|pets?|cats?|dogs?|fireworks?|weapons?|ammunition|alcohol|beer|wine|personal shopping|groceries)/i.test(sourceContext);

    if (!rawPayload || lowered === 'awaiting input') {
        normalized.payload = 'Manifest details pending pharmacy confirmation';
        normalized.status = 'AWAITING_REVIEW';
        normalized.reasoning = 'Dispatch held until the pharmacy confirms payload details and quantity.';
        normalized.manualAttentionRequired = true;
    } else if (!likelyMedical && clearlyUnauthorized) {
        normalized.payload = 'Unauthorized cargo flagged by intake';
        normalized.status = 'REJECTED';
        normalized.reasoning = 'Rejected by policy: non-medical cargo cannot enter the medical relay corridor.';
        normalized.manualAttentionRequired = true;
    } else if (!likelyMedical && /^drugs!?$/i.test(rawPayload)) {
        normalized.payload = 'Controlled substances request awaiting pharmacist release';
        normalized.status = 'AWAITING_REVIEW';
        normalized.reasoning = 'Controlled substance manifests require pharmacist sign-off before route allocation.';
        normalized.manualAttentionRequired = true;
    } else if (lowered === 'epipens') {
        normalized.payload = 'Emergency epinephrine auto-injectors';
    }

    return normalized;
}

export function planDeliveryOperation({
    deliveryInput = {},
    stations = [],
    lines = [],
    drones = [],
    weatherByStation = {},
    mode = 'automatic',
    avoidStationIds = [],
}) {
    const sanitized = sanitizeRequestedPayload(deliveryInput);
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    const destination = sanitized.destination;
    const missionStart = sanitized.currentLeg > 0
        ? sanitized.lastStation || sanitized.origin
        : sanitized.origin;
    const existingPrefix = sanitized.currentLeg > 0
        ? getExistingPrefix(sanitized.route || [], sanitized.lastStation || missionStart)
        : [];
    const requestedRoute = Array.isArray(sanitized.route) ? sanitized.route.filter(Boolean) : [];
    const requestedPath = requestedRoute.length > 0
        ? (() => {
            const requestedIndex = requestedRoute.indexOf(missionStart);
            const requestedSegment = requestedIndex >= 0 ? requestedRoute.slice(requestedIndex) : requestedRoute;
            return isRouteSegmentValid(requestedSegment, lines) ? requestedSegment : [];
        })()
        : [];
    const generatedPrimaryPath = findBestRoute({
        origin: missionStart,
        destination,
        lines,
        stationsById,
        weatherByStation,
        mode: 'automatic',
    });
    const graphPrimaryPath = findBestRoute({
        origin: missionStart,
        destination,
        lines,
        stationsById,
        weatherByStation: {},
        mode: 'automatic',
    });
    const bestAvailablePath = generatedPrimaryPath.length > 0
        ? generatedPrimaryPath
        : graphPrimaryPath.length > 0
            ? graphPrimaryPath
            : requestedPath;
    const primaryPath = requestedPath.length > 0
        ? requestedPath
        : generatedPrimaryPath.length > 0
            ? generatedPrimaryPath
            : graphPrimaryPath;
    const primaryFullRoute = existingPrefix.length > 0
        ? [...existingPrefix, ...primaryPath.slice(1)]
        : primaryPath;
    const bestAvailableFullRoute = existingPrefix.length > 0
        ? [...existingPrefix, ...bestAvailablePath.slice(1)]
        : bestAvailablePath;
    const primaryAssessment = assessRoute(primaryFullRoute, stationsById, weatherByStation);
    const currentRouteIsBest = routesMatch(primaryPath, bestAvailablePath);

    const remainingRouteStations = primaryPath.slice(1, -1);
    const rerouteAvoidSets = [];
    const pushAvoidSet = (stationIds = []) => {
        const normalized = uniqueList(
            stationIds.filter((stationId) => (
                stationId
                && stationId !== missionStart
                && stationId !== destination
            ))
        );

        if (
            normalized.length > 0
            && !rerouteAvoidSets.some((existing) => routesMatch(existing, normalized))
        ) {
            rerouteAvoidSets.push(normalized);
        }
    };

    pushAvoidSet([
        ...avoidStationIds,
        ...primaryAssessment.warnings
            .filter((warning) => mode === 'manual'
                ? ['WATCH', 'UNSTABLE', 'SEVERE'].includes(warning.severity)
                : warning.severity === 'SEVERE')
            .map((warning) => warning.stationId),
    ]);

    let reroutePath = [];
    for (const avoidStations of rerouteAvoidSets) {
        const candidatePath = findBestRoute({
            origin: missionStart,
            destination,
            lines,
            stationsById,
            weatherByStation,
            avoidStations,
            mode: mode === 'manual' ? 'strict' : 'automatic',
        });

        if (candidatePath.length > 0 && !routesMatch(candidatePath, primaryPath)) {
            reroutePath = candidatePath;
            break;
        }
    }

    const alternatePath = avoidStationIds.length > 0 ? reroutePath : bestAvailablePath;
    const hasAlternateRoute = alternatePath.length > 0
        && !routesMatch(alternatePath, primaryPath);
    const shouldUseReroute = mode === 'manual'
        && hasAlternateRoute;

    const activePath = shouldUseReroute ? alternatePath : primaryPath;
    const fullRoute = existingPrefix.length > 0
        ? [...existingPrefix, ...activePath.slice(1)]
        : activePath;
    const alternateFullRoute = hasAlternateRoute
        ? (existingPrefix.length > 0 ? [...existingPrefix, ...alternatePath.slice(1)] : alternatePath)
        : [];
    const assessmentRoute = sanitized.currentLeg > 0 ? activePath : fullRoute;
    const routeAssessment = assessRoute(assessmentRoute, stationsById, weatherByStation);
    const rerouteActive = sanitized.routeState === 'REROUTED'
        || sanitized.status === 'REROUTED'
        || Number(sanitized.rerouteCount || 0) > 0
        || shouldUseReroute;

    let status = sanitized.status;
    if (!DELIVERY_STATUSES.includes(status)) {
        if (routeAssessment.routeState === 'BLOCKED') {
            status = 'WEATHER_HOLD';
        } else if (shouldUseReroute) {
            status = sanitized.currentLeg > 0 ? 'REROUTED' : 'READY_TO_LAUNCH';
        } else if (rerouteActive && sanitized.currentLeg > 0) {
            status = 'REROUTED';
        } else if (sanitized.currentLeg > 0) {
            status = sanitized.status === 'HANDOFF' ? 'HANDOFF' : 'IN_TRANSIT';
        } else {
            status = 'READY_TO_LAUNCH';
        }
    }

    if (status === 'PENDING_DISPATCH') {
        status = routeAssessment.routeState === 'BLOCKED' ? 'WEATHER_HOLD' : 'READY_TO_LAUNCH';
    }
    if (status === 'REQUESTED' || status === 'AWAITING_REVIEW' || status === 'REJECTED' || status === 'CANCELLED') {
        // Leave as-is.
    } else if (routeAssessment.routeState === 'BLOCKED') {
        status = 'WEATHER_HOLD';
    } else if (shouldUseReroute) {
        status = sanitized.currentLeg > 0 ? 'REROUTED' : 'READY_TO_LAUNCH';
    } else if (rerouteActive && sanitized.currentLeg > 0) {
        status = 'REROUTED';
    }

    const { routeDistanceKm, remainingDistanceKm } = summarizeRouteDistance({
        route: fullRoute,
        stationsById,
        lastStation: sanitized.lastStation || missionStart,
        currentLeg: sanitized.currentLeg,
    });
    const etaProfile = buildDeliveryEtaProfile({
        deliveryInput: sanitized,
        route: fullRoute,
        stationsById,
        warnings: routeAssessment.warnings,
        routeWasRerouted: shouldUseReroute,
        drones,
    });
    const recommendedAction = status === 'REJECTED'
        ? 'Remove this request from the dispatch queue and notify the sender of the policy rejection.'
        : status === 'CANCELLED'
            ? 'This mission was cancelled and should remain archived for audit only.'
        : status === 'REQUESTED'
            ? 'Keep this request in the intake queue until a dispatcher approves the manifest for launch planning.'
        : status === 'AWAITING_REVIEW'
            ? 'Keep the mission in review until pharmacy details and compliance checks are complete.'
        : status === 'WEATHER_HOLD'
                ? hasAlternateRoute
                    ? 'Pause launch on the current path and manually approve the suggested alternate corridor if the mission must continue.'
                    : 'Pause launch and wait for safer weather before continuing on the planned corridor.'
                : shouldUseReroute
                    ? 'Manual reroute approved. Notify downstream stations of the updated handoff chain.'
                    : hasAlternateRoute && primaryAssessment.routeState !== 'CLEAR'
                        ? 'The current path is weather-affected. Review the suggested alternate corridor and trigger a manual reroute if you want to switch.'
                    : routeAssessment.routeState === 'WATCH'
                        ? 'Launch is allowed, but keep the highlighted nodes under operator watch.'
                        : 'Maintain the planned corridor and monitor normally.';

    const detailReasoning = [
        sanitized.reasoning,
        shouldUseReroute
            ? 'Operator approved a manual corridor change for this mission.'
            : hasAlternateRoute && primaryAssessment.routeState !== 'CLEAR'
                ? 'A better corridor is available for manual approval if conditions worsen.'
                : null,
        routeAssessment.warnings[0]?.detail || null,
    ].filter(Boolean).join(' ');

    const manualDecision = mode === 'manual'
        ? buildManualDecision({
            shouldUseReroute,
            currentRouteIsBest,
            primaryAssessment,
            primaryFullRoute,
            fullRoute,
            bestAvailableFullRoute,
        })
        : { decisionStatus: null, decisionSummary: null, decisionDetail: null };

    const newEvents = [];
    if (!sanitized.events?.length) {
        newEvents.push(
            makeEvent('REQUEST_RECEIVED', 'Manifest received', `${sanitized.payload} queued for dispatch review.`),
            makeEvent('ROUTE_PLANNED', 'Route evaluated', `Primary corridor review completed for ${sanitized.destination}.`)
        );
    }
    if (status === 'REQUESTED') {
        newEvents.push(makeEvent('REQUEST_QUEUED', 'Awaiting dispatcher approval', recommendedAction));
    }
    if (status === 'AWAITING_REVIEW') {
        newEvents.push(makeEvent('REVIEW_REQUIRED', 'Dispatch review required', recommendedAction));
    }
    if (status === 'REJECTED') {
        newEvents.push(makeEvent('REQUEST_REJECTED', 'Cargo rejected', recommendedAction));
    }
    if (status === 'CANCELLED') {
        newEvents.push(makeEvent('MISSION_CANCELLED', 'Mission cancelled', recommendedAction));
    }
    if (shouldUseReroute) {
        newEvents.push(makeEvent(
            'MANUAL_REROUTE',
            'Manual reroute approved',
            `Mission now follows ${fullRoute.join(' → ')}.`,
            { stationId: routeAssessment.warnings[0]?.stationId || null }
        ));
    }
    if (status === 'WEATHER_HOLD') {
        newEvents.push(makeEvent(
            'WEATHER_HOLD',
            'Weather hold issued',
            routeAssessment.warnings[0]?.detail || 'Severe conditions are blocking the planned route.',
            { stationId: routeAssessment.warnings[0]?.stationId || null }
        ));
    }

    return {
        ...sanitized,
        status,
        route: fullRoute,
        routeState: rerouteActive ? 'REROUTED' : routeAssessment.routeState,
        weatherState: routeAssessment.weatherState,
        routeWarnings: routeAssessment.warnings,
        recommendedRoute: hasAlternateRoute && !shouldUseReroute ? alternateFullRoute : fullRoute,
        recommendedAction,
        bestAvailableRoute: bestAvailableFullRoute,
        decisionStatus: manualDecision.decisionStatus,
        decisionSummary: manualDecision.decisionSummary,
        decisionDetail: manualDecision.decisionDetail,
        routeDistanceKm,
        remainingDistanceKm,
        cruiseSpeedKph: etaProfile.cruiseSpeedKph,
        speedSource: etaProfile.speedSource,
        baseFlightMinutes: etaProfile.baseFlightMinutes,
        weatherDelayMinutes: etaProfile.weatherDelayMinutes,
        handoffDelayMinutes: etaProfile.handoffDelayMinutes,
        reasoning: detailReasoning,
        estimatedMinutes: etaProfile.estimatedMinutes,
        estimatedTime: etaProfile.estimatedTime,
        totalLegs: Math.max(1, fullRoute.length - 1),
        currentLeg: Number(sanitized.currentLeg || 0),
        manualAttentionRequired: Boolean(sanitized.manualAttentionRequired)
            || ['REQUESTED', 'AWAITING_REVIEW', 'WEATHER_HOLD'].includes(status)
            || (hasAlternateRoute && !shouldUseReroute && primaryAssessment.routeState !== 'CLEAR'),
        rerouteCount: Number(sanitized.rerouteCount || 0) + (shouldUseReroute ? 1 : 0),
        lastReroutedAt: shouldUseReroute ? new Date() : sanitized.lastReroutedAt || null,
        events: mergeEvents(sanitized.events || [], newEvents),
    };
}

export function buildOverviewMetrics({ deliveries = [], stations = [], weatherStations = [] }) {
    const delivered = deliveries.filter((delivery) => delivery.status === 'DELIVERED');
    const active = deliveries.filter((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status));
    const weatherWatch = weatherStations.filter((snapshot) => ['WATCH', 'UNSTABLE', 'SEVERE'].includes(snapshot.condition));
    const severeStations = weatherStations.filter((snapshot) => ['UNSTABLE', 'SEVERE'].includes(snapshot.condition));
    const rerouted = deliveries.filter((delivery) => delivery.status === 'REROUTED').length;
    const holds = deliveries.filter((delivery) => delivery.status === 'WEATHER_HOLD').length;
    const avgDeliveryMinutes = delivered.length > 0
        ? Math.round(delivered.reduce((total, delivery) => total + (delivery.estimatedMinutes || 74), 0) / delivered.length)
        : 74;

    return {
        activeFlights: active.length,
        watchStations: weatherWatch.length,
        severeStations: severeStations.length,
        reroutedFlights: rerouted,
        weatherHolds: holds,
        avgDeliveryMinutes,
        onlineStations: stations.filter((station) => station.status === 'online').length,
        totalStations: stations.length,
    };
}

export function buildAdminNotifications(deliveries = []) {
    return deliveries
        .filter((delivery) => ACTIVE_DELIVERY_STATUSES.has(delivery.status))
        .flatMap((delivery) => {
            if (delivery.status === 'REJECTED') return [];

            if (delivery.status === 'WEATHER_HOLD') {
                return [{
                    id: `${delivery.id}-weather-hold`,
                    level: 'danger',
                    deliveryId: delivery.id,
                    title: `${delivery.id} is on weather hold`,
                    detail: delivery.routeWarnings?.[0]?.detail || delivery.recommendedAction,
                    actionLabel: 'Manual reroute available',
                }];
            }

            if (delivery.status === 'REROUTED') {
                return [{
                    id: `${delivery.id}-rerouted`,
                    level: 'warning',
                    deliveryId: delivery.id,
                    title: `${delivery.id} manually rerouted around unstable weather`,
                    detail: delivery.recommendedAction,
                    actionLabel: 'Manual reroute active',
                }];
            }

            if (delivery.status === 'AWAITING_REVIEW') {
                return [{
                    id: `${delivery.id}-review`,
                    level: 'neutral',
                    deliveryId: delivery.id,
                    title: `${delivery.id} awaiting operator review`,
                    detail: delivery.recommendedAction,
                    actionLabel: 'Review before launch',
                }];
            }

            const warning = delivery.routeWarnings?.[0];
            if (warning) {
                return [{
                    id: `${delivery.id}-watch`,
                    level: warning.severity === 'UNSTABLE' ? 'warning' : 'neutral',
                    deliveryId: delivery.id,
                    title: `${delivery.id} requires weather watch`,
                    detail: warning.detail,
                    actionLabel: 'Manual reroute available',
                }];
            }

            return [];
        })
        .slice(0, 4);
}

export function buildDefaultRecommendation({ notifications = [], metrics = {}, weatherStations = [] }) {
    const severeNode = weatherStations.find((station) => station.condition === 'SEVERE');
    const unstableNode = weatherStations.find((station) => station.condition === 'UNSTABLE');
    const hold = notifications.find((notification) => notification.level === 'danger');
    const reroute = notifications.find((notification) => notification.title.includes('rerouted'));

    if (hold && severeNode) {
        return `Hold ${hold.deliveryId} until ${severeNode.stationId} clears or manually shift it onto the alternate corridor.`;
    }

    if (reroute) {
        return `${reroute.deliveryId} is already on a manually approved alternate corridor. Keep downstream pads aligned on the new handoff chain.`;
    }

    if (unstableNode) {
        return `Keep ${unstableNode.stationId} on weather watch and only reroute missions with urgent payloads if conditions worsen.`;
    }

    if ((metrics.watchStations || 0) > 0) {
        return 'Weather is manageable across the corridor. Launches can continue with operator watch on flagged nodes.';
    }

    return 'No route changes are recommended right now. Maintain the planned corridor and monitor normally.';
}

export function buildPathWeatherReport(delivery = null, weatherByStation = {}) {
    if (!delivery) {
        return null;
    }

    const route = Array.isArray(delivery.route) ? delivery.route.filter(Boolean) : [];
    const pathSnapshots = route
        .map((stationId) => ({
            stationId,
            snapshot: weatherByStation[stationId] || null,
        }))
        .filter((entry) => entry.snapshot);
    const warnings = Array.isArray(delivery.routeWarnings) ? delivery.routeWarnings : [];
    const severeCount = warnings.filter((warning) => warning.severity === 'SEVERE').length;
    const unstableCount = warnings.filter((warning) => warning.severity === 'UNSTABLE').length;
    const watchCount = warnings.filter((warning) => warning.severity === 'WATCH').length;
    const maxGustKph = pathSnapshots.reduce((max, entry) => Math.max(max, Number(entry.snapshot.windGustKph || 0)), 0);
    const lowestVisibilityKm = pathSnapshots.reduce((min, entry) => (
        Math.min(min, Number(entry.snapshot.visibilityKm ?? Number.POSITIVE_INFINITY))
    ), Number.POSITIVE_INFINITY);
    const coldestTempC = pathSnapshots.reduce((min, entry) => (
        Math.min(min, Number(entry.snapshot.tempC ?? Number.POSITIVE_INFINITY))
    ), Number.POSITIVE_INFINITY);
    const topWarning = warnings[0] || null;
    const affectedSegments = warnings.map((warning) => warning.stationId);
    const routeState = delivery.routeState || 'CLEAR';
    const statusTone = routeState === 'BLOCKED' || delivery.status === 'WEATHER_HOLD'
        ? 'danger'
        : routeState === 'REROUTED' || delivery.status === 'REROUTED'
            ? 'warning'
            : routeState === 'ADVISORY' || routeState === 'WATCH'
                ? 'watch'
                : 'clear';

    const alternateSuggested = Array.isArray(delivery.recommendedRoute)
        && delivery.recommendedRoute.length > 0
        && !routesMatch(delivery.recommendedRoute, route);
    const rerouteActive = delivery.routeState === 'REROUTED' || delivery.status === 'REROUTED';
    const manualRerouteSuggested = alternateSuggested && !rerouteActive;

    const headline = rerouteActive
        ? `Manual reroute active around ${topWarning?.stationId || 'weather risk'}`
        : manualRerouteSuggested
            ? `Manual reroute available around ${topWarning?.stationId || 'current weather risk'}`
        : delivery.status === 'WEATHER_HOLD'
            ? alternateSuggested
                ? `Manual reroute recommended around ${topWarning?.stationId || 'severe weather'}`
                : `Route held by ${topWarning?.stationId || 'severe weather'}`
            : warnings.length > 0
                ? `Weather is active along the ${delivery.id} path`
                : `Route is clear for ${delivery.id}`;

    const operationalEffect = rerouteActive
        ? `The operator moved this mission onto a ${route.length}-stop alternate corridor.`
        : manualRerouteSuggested
            ? `A safer ${delivery.recommendedRoute.length}-stop corridor is available if you approve a manual reroute.`
        : delivery.status === 'WEATHER_HOLD'
            ? alternateSuggested
                ? 'The planned route is paused until an operator approves the suggested alternate corridor.'
                : 'Launch or onward handoff should pause until a safer corridor is available.'
            : warnings.length > 0
                ? `${warnings.length} route segment${warnings.length === 1 ? '' : 's'} need extra operator attention.`
                : 'No weather-driven path changes are currently required.';

    return {
        deliveryId: delivery.id,
        routeState,
        statusTone,
        headline,
        summary: warnings.length > 0
            ? topWarning.detail
            : 'No meaningful weather or maintenance risk is active on the current route.',
        operationalEffect,
        affectedSegments,
        severeCount,
        unstableCount,
        watchCount,
        impactedStops: warnings.length,
        maxGustKph: Math.round(maxGustKph),
        lowestVisibilityKm: Number.isFinite(lowestVisibilityKm) ? Number(lowestVisibilityKm.toFixed(1)) : null,
        coldestTempC: Number.isFinite(coldestTempC) ? Number(coldestTempC.toFixed(1)) : null,
        routeDistanceKm: delivery.routeDistanceKm ?? null,
        remainingDistanceKm: delivery.remainingDistanceKm ?? delivery.routeDistanceKm ?? null,
        etaMinutes: delivery.estimatedMinutes ?? null,
        etaDisplay: delivery.estimatedTime || null,
        cruiseSpeedKph: delivery.cruiseSpeedKph ?? null,
        speedSource: delivery.speedSource || 'Corridor default cruise profile',
        baseFlightMinutes: delivery.baseFlightMinutes ?? null,
        weatherDelayMinutes: Number(delivery.weatherDelayMinutes || 0),
        handoffDelayMinutes: Number(delivery.handoffDelayMinutes || 0),
        weatherClear: warnings.length === 0,
        routePreview: route.length > 0 ? `${route[0]} → ${route[route.length - 1]}` : `${delivery.origin} → ${delivery.destination}`,
        routeStops: route.length,
        rerouteActive,
        manualRerouteSuggested,
        manualRerouteHint: manualRerouteSuggested
            ? `Safer alternate available: ${formatRoutePreview(delivery.recommendedRoute)}`
            : 'Current corridor already matches the best available route.',
        recommendedAction: delivery.recommendedAction,
        topWarning,
        weatherSignals: [
            maxGustKph > 0 ? `Peak gusts ${Math.round(maxGustKph)} km/h` : null,
            Number.isFinite(lowestVisibilityKm) ? `Visibility low of ${Number(lowestVisibilityKm.toFixed(1))} km` : null,
            Number.isFinite(coldestTempC) ? `Coldest point ${Number(coldestTempC.toFixed(1))}°C` : null,
        ].filter(Boolean),
    };
}

function buildDroneManualDecision({
    shouldUseReroute,
    currentRouteIsBest,
    primaryAssessment,
    currentRoute,
    bestAvailableRoute,
    nextRoute,
}) {
    const currentWarning = primaryAssessment.warnings[0] || null;

    if (shouldUseReroute) {
        const reason = currentWarning
            ? `${currentWarning.stationId} is degrading the active relocation corridor. ${currentWarning.detail}`
            : 'A safer relocation corridor is available under current conditions.';

        return {
            decisionStatus: 'rerouted',
            decisionSummary: 'Drone reroute approved',
            decisionDetail: `${reason} New relocation path: ${formatRoutePreview(nextRoute)}.`,
        };
    }

    if (currentRouteIsBest) {
        const detail = currentWarning
            ? `No relocation change applied. The drone already matches the safest available corridor. Highest remaining risk: ${currentWarning.stationId}. ${currentWarning.detail}`
            : 'No relocation change applied. The drone already matches the safest available corridor.';

        return {
            decisionStatus: 'rejected',
            decisionSummary: 'Drone reroute rejected',
            decisionDetail: detail,
        };
    }

    return {
        decisionStatus: 'unavailable',
        decisionSummary: 'Drone reroute unavailable',
        decisionDetail: `No better relocation corridor is available right now. The drone remains on ${formatRoutePreview(currentRoute)}. Best available option remains ${formatRoutePreview(bestAvailableRoute)}.`,
    };
}

function buildRelocationEtaProfile({
    routeDistanceKm,
    speedKph = 80,
    routeStops = 0,
    warnings = [],
}) {
    const numericSpeed = Number(speedKph) > 0 ? Number(speedKph) : 80;
    const baseFlightMinutes = Number.isFinite(Number(routeDistanceKm)) && Number(routeDistanceKm) > 0
        ? Math.max(12, Math.round((Number(routeDistanceKm) / numericSpeed) * 60))
        : Math.max(14, Math.max(1, routeStops - 1) * 22);
    const handoffDelayMinutes = Math.max(0, routeStops - 2) * 3;
    const weatherDelayMinutes = estimateWeatherDelayMinutes(warnings);
    const etaMinutes = Math.max(12, baseFlightMinutes + handoffDelayMinutes + weatherDelayMinutes);

    return {
        etaMinutes,
        etaDisplay: formatEstimatedTime(etaMinutes),
        baseFlightMinutes,
        weatherDelayMinutes,
        handoffDelayMinutes,
    };
}

export function planDroneRelocation({
    droneInput = {},
    stations = [],
    lines = [],
    weatherByStation = {},
    mode = 'automatic',
    avoidStationIds = [],
}) {
    const stationsById = Object.fromEntries(stations.map((station) => [station.id, station]));
    const origin = droneInput.origin_location || droneInput.location;
    const destination = droneInput.target_location;

    if (!origin || !destination) {
        throw new Error('Drone relocation requires both an origin node and a target node.');
    }

    if (!stationsById[origin]) {
        throw new Error(`Origin node ${origin} is not configured in the corridor.`);
    }

    if (!stationsById[destination]) {
        throw new Error(`Target node ${destination} is not configured in the corridor.`);
    }

    const requestedRoute = Array.isArray(droneInput.relocationRoute)
        ? droneInput.relocationRoute.filter(Boolean)
        : [];
    const validRequestedRoute = requestedRoute.length > 1
        && requestedRoute[0] === origin
        && requestedRoute[requestedRoute.length - 1] === destination
        && isRouteSegmentValid(requestedRoute, lines)
            ? requestedRoute
            : [];

    const generatedPrimaryPath = findBestRoute({
        origin,
        destination,
        lines,
        stationsById,
        weatherByStation,
        mode: 'automatic',
    });

    const primaryPath = validRequestedRoute.length > 0 ? validRequestedRoute : generatedPrimaryPath;
    if (primaryPath.length === 0) {
        throw new Error(`No connected corridor route is available from ${origin} to ${destination}.`);
    }

    const bestAvailablePath = generatedPrimaryPath.length > 0 ? generatedPrimaryPath : primaryPath;
    const primaryAssessment = assessRoute(primaryPath, stationsById, weatherByStation);
    const currentRouteIsBest = routesMatch(primaryPath, bestAvailablePath);

    const rerouteAvoidSets = [];
    const pushAvoidSet = (stationIds = []) => {
        const normalized = uniqueList(
            stationIds.filter((stationId) => (
                stationId
                && stationId !== origin
                && stationId !== destination
            ))
        );

        if (
            normalized.length > 0
            && !rerouteAvoidSets.some((existing) => routesMatch(existing, normalized))
        ) {
            rerouteAvoidSets.push(normalized);
        }
    };

    pushAvoidSet([
        ...avoidStationIds,
        ...primaryAssessment.warnings
            .filter((warning) => ['WATCH', 'UNSTABLE', 'SEVERE'].includes(warning.severity))
            .map((warning) => warning.stationId),
    ]);

    let reroutePath = [];
    for (const avoidStations of rerouteAvoidSets) {
        const candidatePath = findBestRoute({
            origin,
            destination,
            lines,
            stationsById,
            weatherByStation,
            avoidStations,
            mode: mode === 'manual' ? 'strict' : 'automatic',
        });

        if (candidatePath.length > 0 && !routesMatch(candidatePath, primaryPath)) {
            reroutePath = candidatePath;
            break;
        }
    }

    const alternatePath = reroutePath.length > 0
        ? reroutePath
        : (!currentRouteIsBest ? bestAvailablePath : []);
    const hasAlternateRoute = alternatePath.length > 0 && !routesMatch(alternatePath, primaryPath);
    const shouldUseReroute = mode === 'manual' && hasAlternateRoute;
    const activePath = shouldUseReroute ? alternatePath : primaryPath;
    const routeAssessment = assessRoute(activePath, stationsById, weatherByStation);
    const routeDistance = summarizeRouteDistance({
        route: activePath,
        stationsById,
        lastStation: origin,
        currentLeg: 0,
    });
    const speed = Number(droneInput.speed || 80) || 80;
    const etaProfile = buildRelocationEtaProfile({
        routeDistanceKm: routeDistance.routeDistanceKm,
        speedKph: speed,
        routeStops: activePath.length,
        warnings: routeAssessment.warnings,
    });

    const relocationRecommendedAction = routeAssessment.routeState === 'BLOCKED'
        ? hasAlternateRoute
            ? 'Pause the current relocation and approve the alternate corridor if the repositioning must continue.'
            : 'Pause the relocation until weather improves on the connected corridor.'
        : shouldUseReroute
            ? 'Manual reroute approved. Continue repositioning on the updated corridor.'
            : hasAlternateRoute && primaryAssessment.routeState !== 'CLEAR'
                ? 'The current relocation corridor is weather-affected. Review the alternate path and reroute the drone if repositioning must continue.'
                : routeAssessment.routeState === 'WATCH'
                    ? 'Relocation can continue, but keep the flagged nodes under operator watch.'
                    : 'Relocation corridor is clear to proceed.';

    const manualDecision = mode === 'manual'
        ? buildDroneManualDecision({
            shouldUseReroute,
            currentRouteIsBest,
            primaryAssessment,
            currentRoute: primaryPath,
            bestAvailableRoute: bestAvailablePath,
            nextRoute: activePath,
        })
        : { decisionStatus: null, decisionSummary: null, decisionDetail: null };

    return {
        ...droneInput,
        status: 'relocating',
        location: `En route to ${destination}`,
        origin_location: origin,
        target_location: destination,
        speed,
        time_of_arrival: etaProfile.etaDisplay,
        assignment: null,
        relocationRoute: activePath,
        recommendedRelocationRoute: hasAlternateRoute && !shouldUseReroute ? alternatePath : activePath,
        relocationDistanceKm: routeDistance.routeDistanceKm,
        relocationRemainingDistanceKm: routeDistance.remainingDistanceKm,
        relocationRouteState: shouldUseReroute ? 'REROUTED' : routeAssessment.routeState,
        relocationWeatherState: routeAssessment.weatherState,
        relocationWarnings: routeAssessment.warnings,
        relocationRecommendedAction,
        relocationRerouteCount: Number(droneInput.relocationRerouteCount || 0) + (shouldUseReroute ? 1 : 0),
        lastRelocationReroutedAt: shouldUseReroute ? new Date() : droneInput.lastRelocationReroutedAt || null,
        decisionStatus: manualDecision.decisionStatus,
        decisionSummary: manualDecision.decisionSummary,
        decisionDetail: manualDecision.decisionDetail,
    };
}

export function buildDroneRelocationReport(drone = null, weatherByStation = {}) {
    if (!drone || drone.status !== 'relocating' || !Array.isArray(drone.relocationRoute) || drone.relocationRoute.length === 0) {
        return null;
    }

    const route = drone.relocationRoute.filter(Boolean);
    const pathSnapshots = route
        .map((stationId) => ({
            stationId,
            snapshot: weatherByStation[stationId] || null,
        }))
        .filter((entry) => entry.snapshot);
    const warnings = Array.isArray(drone.relocationWarnings) ? drone.relocationWarnings : [];
    const severeCount = warnings.filter((warning) => warning.severity === 'SEVERE').length;
    const unstableCount = warnings.filter((warning) => warning.severity === 'UNSTABLE').length;
    const watchCount = warnings.filter((warning) => warning.severity === 'WATCH').length;
    const maxGustKph = pathSnapshots.reduce((max, entry) => Math.max(max, Number(entry.snapshot.windGustKph || 0)), 0);
    const lowestVisibilityKm = pathSnapshots.reduce((min, entry) => (
        Math.min(min, Number(entry.snapshot.visibilityKm ?? Number.POSITIVE_INFINITY))
    ), Number.POSITIVE_INFINITY);
    const coldestTempC = pathSnapshots.reduce((min, entry) => (
        Math.min(min, Number(entry.snapshot.tempC ?? Number.POSITIVE_INFINITY))
    ), Number.POSITIVE_INFINITY);
    const etaProfile = buildRelocationEtaProfile({
        routeDistanceKm: drone.relocationDistanceKm,
        speedKph: drone.speed || 80,
        routeStops: route.length,
        warnings,
    });
    const topWarning = warnings[0] || null;
    const routeState = drone.relocationRouteState || 'CLEAR';
    const statusTone = routeState === 'BLOCKED'
        ? 'danger'
        : routeState === 'REROUTED' || routeState === 'ADVISORY' || routeState === 'WATCH'
            ? 'warning'
            : 'clear';
    const rerouteActive = routeState === 'REROUTED';
    const manualRerouteSuggested = Array.isArray(drone.recommendedRelocationRoute)
        && drone.recommendedRelocationRoute.length > 0
        && !routesMatch(drone.recommendedRelocationRoute, route)
        && !rerouteActive;

    const headline = rerouteActive
        ? `Relocation rerouted around ${topWarning?.stationId || 'weather risk'}`
        : manualRerouteSuggested
            ? `Relocation reroute available around ${topWarning?.stationId || 'current weather risk'}`
            : warnings.length > 0
                ? `Relocation weather watch for ${drone.id}`
                : `Relocation corridor is clear for ${drone.id}`;

    const operationalEffect = rerouteActive
        ? `The drone is currently repositioning on a manually approved ${route.length}-stop alternate corridor.`
        : manualRerouteSuggested
            ? `A safer ${drone.recommendedRelocationRoute.length}-stop relocation corridor is available if you approve a reroute.`
            : warnings.length > 0
                ? `${warnings.length} relocation stop${warnings.length === 1 ? '' : 's'} require operator attention.`
                : 'The relocation corridor is operating normally.';

    return {
        droneId: drone.id,
        routeState,
        statusTone,
        headline,
        summary: warnings.length > 0
            ? topWarning.detail
            : 'No meaningful weather or maintenance risk is active on the relocation corridor.',
        operationalEffect,
        severeCount,
        unstableCount,
        watchCount,
        impactedStops: warnings.length,
        routeDistanceKm: drone.relocationDistanceKm ?? null,
        remainingDistanceKm: drone.relocationRemainingDistanceKm ?? drone.relocationDistanceKm ?? null,
        etaMinutes: etaProfile.etaMinutes,
        etaDisplay: drone.time_of_arrival || etaProfile.etaDisplay,
        cruiseSpeedKph: Number(drone.speed || 80) || 80,
        baseFlightMinutes: etaProfile.baseFlightMinutes,
        weatherDelayMinutes: etaProfile.weatherDelayMinutes,
        handoffDelayMinutes: etaProfile.handoffDelayMinutes,
        weatherClear: warnings.length === 0,
        routePreview: route.length > 0 ? `${route[0]} → ${route[route.length - 1]}` : `${drone.origin_location} → ${drone.target_location}`,
        routeStops: route.length,
        rerouteActive,
        manualRerouteSuggested,
        manualRerouteHint: manualRerouteSuggested
            ? `Safer alternate available: ${formatRoutePreview(drone.recommendedRelocationRoute)}`
            : 'Current relocation corridor already matches the best available route.',
        recommendedAction: drone.relocationRecommendedAction,
        topWarning,
        weatherSignals: [
            maxGustKph > 0 ? `Peak gusts ${Math.round(maxGustKph)} km/h` : null,
            Number.isFinite(lowestVisibilityKm) ? `Visibility low of ${Number(lowestVisibilityKm.toFixed(1))} km` : null,
            Number.isFinite(coldestTempC) ? `Coldest point ${Number(coldestTempC.toFixed(1))}°C` : null,
        ].filter(Boolean),
    };
}
