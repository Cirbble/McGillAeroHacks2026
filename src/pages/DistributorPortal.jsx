import { Fragment, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { dispatchWithGemini } from '../services/gemini';
import { speakText, generateDispatchConfirmation } from '../services/elevenlabs';
import CorridorMapShared from '../components/CorridorMap';
import {
    AlertTriangle,
    Battery,
    Camera,
    CheckCircle2,
    ExternalLink,
    Gauge,
    Link as LinkIcon,
    Loader2,
    Lock,
    MapPin,
    Package,
    Radio,
    Route,
    Send,
    X,
} from 'lucide-react';

const ACTIVE_STATUSES = ['PENDING_DISPATCH', 'READY_TO_LAUNCH', 'IN_TRANSIT', 'HANDOFF', 'WEATHER_HOLD', 'REROUTED'];
const SOLANA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function statusBadge(status) {
    return {
        REQUESTED: 'badge-amber',
        AWAITING_REVIEW: 'badge-amber',
        PENDING_DISPATCH: 'badge-neutral',
        READY_TO_LAUNCH: 'badge-neutral',
        IN_TRANSIT: 'badge-blue',
        HANDOFF: 'badge-blue',
        WEATHER_HOLD: 'badge-red',
        REROUTED: 'badge-blue',
        ARRIVED: 'badge-green',
        DELIVERED: 'badge-green',
        REJECTED: 'badge-red',
        CANCELLED: 'badge-neutral',
    }[status] || 'badge-neutral';
}

function priorityBadge(priority) {
    return priority === 'Emergency' ? 'badge-red' : priority === 'Urgent' ? 'badge-amber' : 'badge-neutral';
}

function droneStatusBadge(status) {
    if (status === 'ready') return 'badge-green';
    if (status === 'on_route' || status === 'relocating') return 'badge-blue';
    if (status === 'charging') return 'badge-amber';
    return 'badge-neutral';
}

function toValidDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toTimestamp(value, fallback = 0) {
    const parsed = toValidDate(value);
    return parsed ? parsed.getTime() : fallback;
}

function formatDateTime(value, fallback = 'Pending sync') {
    const parsed = toValidDate(value);
    return parsed ? parsed.toLocaleString() : fallback;
}

function severityColor(score) {
    const numericScore = Number(score || 0);
    if (numericScore >= 5) return '#dc2626';
    if (numericScore >= 4) return '#ea580c';
    if (numericScore >= 3) return '#f59e0b';
    return '#2563eb';
}

function droneDestinationLabel(drone) {
    if (drone.target_location) return drone.target_location;
    if (drone.status === 'ready') return 'Standby';
    if (drone.status === 'charging') return 'Charging';
    return drone.location || '-';
}

function droneStatusLabel(status) {
    return {
        ready: 'Ready',
        on_route: 'On route',
        relocating: 'Relocating',
        charging: 'Charging',
    }[status] || status;
}

function formatSolanaSignature(signature) {
    if (!signature) return 'Pending';
    if (signature.length <= 18) return signature;
    return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

function truncateMiddle(value, start = 10, end = 8) {
    if (!value) return '-';
    if (value.length <= start + end + 3) return value;
    return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function truncateText(value, maxLength = 56) {
    if (!value) return '-';
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function formatLedgerRoute(delivery) {
    return [delivery.origin, delivery.destination].filter(Boolean).join(' -> ') || '-';
}

function formatSolanaBalance(balanceSol) {
    if (!Number.isFinite(Number(balanceSol))) return 'Unknown';
    return `${Number(balanceSol).toFixed(4)} SOL`;
}

function isFundingBlocked(delivery) {
    const message = String(delivery?.solanaAttestationError || '').toLowerCase();
    return !delivery?.solanaOnChain && (
        message.includes('funding required')
        || message.includes('faucet')
        || message.includes('airdrop')
        || message.includes('429')
    );
}

function ledgerAttestationState(delivery) {
    if (delivery.solanaOnChain) {
        return {
            label: 'Confirmed',
            detail: 'Confirmed on Solana devnet',
            slotLabel: delivery.solanaSlot || '-',
        };
    }

    if (isFundingBlocked(delivery)) {
        return {
            label: 'Funding required',
            detail: 'Fee payer needs devnet SOL before submission.',
            slotLabel: 'Funding needed',
        };
    }

    if (delivery.solanaAttestationError) {
        return {
            label: 'Retry needed',
            detail: 'Last devnet submission failed. Retry after fixing funding/RPC.',
            slotLabel: 'Retry needed',
        };
    }

    return {
        label: 'Queued',
        detail: 'Waiting to submit to Solana devnet.',
        slotLabel: 'Queued',
    };
}

function getPreferredStationId(stations = [], selectors = []) {
    for (const selector of selectors) {
        const match = stations.find(selector);
        if (match?.id) return match.id;
    }

    return stations[0]?.id || '';
}

function RouteStops({ route = [], currentLeg = 0 }) {
    if (!Array.isArray(route) || route.length === 0) return null;

    const activeStopIndex = Math.min(
        Math.max(Number(currentLeg) || 0, 0),
        Math.max(route.length - 1, 0)
    );

    return (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {route.map((stop, index) => (
                <Fragment key={`${stop}-${index}`}>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            background: index < activeStopIndex
                                ? 'rgba(37,99,235,0.10)'
                                : index === activeStopIndex
                                    ? 'rgba(37,99,235,0.16)'
                                    : 'var(--bg)',
                            color: index <= activeStopIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontSize: 11,
                            lineHeight: 1.2,
                            fontWeight: index === activeStopIndex ? 700 : 500,
                        }}
                    >
                        <span
                            aria-hidden
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: index < activeStopIndex
                                    ? '#2563eb'
                                    : index === activeStopIndex
                                        ? '#1d4ed8'
                                        : 'var(--border)',
                                flexShrink: 0,
                            }}
                        />
                        {stop}
                    </span>
                    {index < route.length - 1 && (
                        <span
                            aria-hidden
                            style={{
                                width: 10,
                                height: 1,
                                background: 'var(--border)',
                                flexShrink: 0,
                            }}
                        />
                    )}
                </Fragment>
            ))}
        </div>
    );
}

export default function DistributorPortal() {
    const {
        deliveries,
        stations,
        drones,
        lines,
        addDelivery,
        approveDelivery,
        cancelDelivery,
        initializeData,
    } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

    useEffect(() => {
        const interval = setInterval(() => useStore.getState().initializeData(true), 10000);
        return () => clearInterval(interval);
    }, []);

    const [useAI, setUseAI] = useState(true);
    const [aiPrompt, setAiPrompt] = useState('');
    const [payload, setPayload] = useState('');
    const [priority, setPriority] = useState('Routine');
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    const [selectedDroneId, setSelectedDroneId] = useState(null);
    const [showAllDrones, setShowAllDrones] = useState(true);
    const [confirmAction, setConfirmAction] = useState(null);
    const [error, setError] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [resultCard, setResultCard] = useState(null);
    const [ledgerStatus, setLedgerStatus] = useState(null);
    const [ledgerStatusError, setLedgerStatusError] = useState(null);
    const [isRetryingLedger, setIsRetryingLedger] = useState(false);

    const requests = deliveries.filter((delivery) => ['REQUESTED', 'AWAITING_REVIEW'].includes(delivery.status)).sort((a, b) => (b.severityScore || 0) - (a.severityScore || 0));
    const activeDeliveries = deliveries.filter((delivery) => ACTIVE_STATUSES.includes(delivery.status)).sort((a, b) => toTimestamp(a.eta, Number.POSITIVE_INFINITY) - toTimestamp(b.eta, Number.POSITIVE_INFINITY));
    const completedDeliveries = deliveries.filter((delivery) => delivery.status === 'DELIVERED').sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    const history = [...deliveries].sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    const selectedDrone = drones.find((drone) => drone.id === selectedDroneId) || null;
    const ledgerProgram = completedDeliveries[0]?.solanaProgram || SOLANA_MEMO_PROGRAM;
    const onChainCompletedDeliveries = completedDeliveries.filter((delivery) => delivery.solanaOnChain);
    const sortedStations = [...stations].sort((left, right) => left.id.localeCompare(right.id));
    const distributionStations = sortedStations.filter((station) => station.type === 'distribution');
    const originStations = sortedStations;
    const destinationStations = sortedStations.filter((station) => station.id !== origin);
    const defaultOriginId = getPreferredStationId(originStations, [
        (station) => station.id === 'Montreal',
        (station) => station.type === 'distribution',
    ]);
    const defaultDestinationId = getPreferredStationId(destinationStations, [
        (station) => station.id === 'Chisasibi',
        (station) => station.type === 'pick_up',
    ]);
    const myDispatchDroneIds = new Set(activeDeliveries.map((delivery) => delivery.assignedDrone).filter(Boolean));
    const mapDrones = showAllDrones ? drones : drones.filter((drone) => myDispatchDroneIds.has(drone.id) || myDispatchDroneIds.has(drone.assignment));

    useEffect(() => {
        if (hash !== '#ledger') return undefined;

        let cancelled = false;

        async function loadLedgerStatus() {
            try {
                const response = await fetch('/api/solana/status');
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to load Solana status.');
                }

                if (!cancelled) {
                    setLedgerStatus(data);
                    setLedgerStatusError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setLedgerStatusError(err.message);
                }
            }
        }

        loadLedgerStatus();
        const intervalId = window.setInterval(loadLedgerStatus, 15000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [hash, completedDeliveries.length, onChainCompletedDeliveries.length]);

    useEffect(() => {
        if (!originStations.length) {
            if (origin !== '') setOrigin('');
            return;
        }

        if (!originStations.some((station) => station.id === origin)) {
            setOrigin(defaultOriginId);
        }
    }, [defaultOriginId, origin, originStations]);

    useEffect(() => {
        if (!destinationStations.length) {
            if (destination !== '') setDestination('');
            return;
        }

        if (!destinationStations.some((station) => station.id === destination)) {
            setDestination(defaultDestinationId);
        }
    }, [defaultDestinationId, destination, destinationStations]);

    const runAction = async () => {
        if (!confirmAction) return;
        try {
            if (confirmAction.type === 'approve' || confirmAction.type === 'reject') {
                await approveDelivery(confirmAction.id, confirmAction.type);
            } else {
                await cancelDelivery(confirmAction.id);
            }
            setConfirmAction(null);
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    };

    const retryLedgerAttestations = async (deliveryId = null) => {
        setIsRetryingLedger(true);
        try {
            const response = await fetch('/api/solana/attestations/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(deliveryId ? { deliveryId } : {}),
            });
            const data = await response.json();
            if (!response.ok) {
                if (data?.solana) {
                    setLedgerStatus(data.solana);
                }
                throw new Error(data?.error || 'Failed to retry Solana attestations.');
            }

            setLedgerStatus(data.solana || null);
            setLedgerStatusError(null);
            await initializeData(true);
        } catch (err) {
            setLedgerStatusError(err.message);
        } finally {
            setIsRetryingLedger(false);
        }
    };

    const submitAIDispatch = async (event) => {
        event.preventDefault();
        if (!aiPrompt.trim()) return;
        setError(null);
        setIsProcessing(true);
        try {
            const planned = await dispatchWithGemini(aiPrompt);
            const created = await addDelivery(planned);
            setResultCard(created);
            setAiPrompt('');
            try {
                setIsSpeaking(true);
                await speakText(generateDispatchConfirmation(created), 'en');
            } catch {
                // Optional audio.
            } finally {
                setIsSpeaking(false);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const submitManualDispatch = async (event) => {
        event.preventDefault();
        if (!payload.trim()) return;
        setError(null);
        try {
            const created = await addDelivery({ payload: payload.trim(), origin, destination, priority });
            setResultCard(created);
            setPayload('');
        } catch (err) {
            setError(err.message);
        }
    };

    const ConfirmModal = () => {
        if (!confirmAction) return null;
        const copy = confirmAction.type === 'approve'
            ? ['Approve delivery request?', 'Approval moves this clinic request into the dispatch queue for launch readiness and fleet assignment.', 'Approve Request']
            : confirmAction.type === 'reject'
                ? ['Reject request?', 'This closes the clinic request before dispatch.', 'Reject Request']
                : ['Cancel active delivery?', 'This stops the mission and frees the assigned drone.', 'Cancel Delivery'];
        const destructive = confirmAction.type !== 'approve';
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmAction(null)}>
                <div className="card" style={{ width: 420, padding: 24 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{copy[0]}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>{copy[1]}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Keep Current State</button>
                        <button className={destructive ? 'btn' : 'btn btn-primary'} style={destructive ? { background: '#ef4444', color: 'white', border: 'none' } : undefined} onClick={runAction}>{copy[2]}</button>
                    </div>
                </div>
            </div>
        );
    };

    if (hash === '') {
        return (
            <div>
                <ConfirmModal />
                <div className="page-header"><h1>Operator Overview</h1><p>Live fleet activity, route telemetry, and dispatch workload across the corridor.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
                    <div className="stat-card"><div className="stat-label">PENDING REQUESTS</div><div className="stat-value" style={{ color: requests.length ? '#ea580c' : 'inherit' }}>{requests.length}</div></div>
                    <div className="stat-card"><div className="stat-label">ACTIVE DELIVERIES</div><div className="stat-value">{activeDeliveries.length}</div></div>
                    <div className="stat-card"><div className="stat-label">COMPLETED</div><div className="stat-value">{completedDeliveries.length}</div></div>
                    <div className="stat-card"><div className="stat-label">FLEET ONLINE</div><div className="stat-value">{drones.filter((drone) => drone.status !== 'charging').length}/{drones.length}</div></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: selectedDrone ? '1fr 320px' : '1fr', gap: 16 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
                            <span className="card-header-title"><MapPin size={14} /> Live Corridor Map</span>
                            <div className="toggle-group">
                                <button className={`toggle-btn ${showAllDrones ? 'active' : ''}`} onClick={() => setShowAllDrones(true)}>All Drones</button>
                                <button className={`toggle-btn ${!showAllDrones ? 'active' : ''}`} onClick={() => setShowAllDrones(false)}>My Dispatches</button>
                            </div>
                        </div>
                        <CorridorMapShared stations={stations} drones={mapDrones} deliveries={activeDeliveries} lines={lines} height={440} showLines={false} selectedDroneId={selectedDroneId} onDroneClick={(id) => setSelectedDroneId(id === selectedDroneId ? null : id)} />
                    </div>
                    {selectedDrone && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                <div style={{ position: 'relative', height: 180, background: '#0f172a' }}>
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'center' }}>
                                        <Camera size={24} style={{ opacity: 0.3, marginBottom: 6 }} /><br />LIVE FEED | {selectedDrone.id}
                                    </div>
                                </div>
                                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                    <div><Battery size={11} style={{ verticalAlign: 'middle' }} /> Battery: <strong>{selectedDrone.battery}%</strong></div>
                                    <div><Gauge size={11} style={{ verticalAlign: 'middle' }} /> Speed: <strong>{selectedDrone.speed || 0} km/h</strong></div>
                                    <div>Status: <span className={`badge ${droneStatusBadge(selectedDrone.status)}`}>{droneStatusLabel(selectedDrone.status)}</span></div>
                                    <div>Heading To: <strong>{droneDestinationLabel(selectedDrone)}</strong></div>
                                </div>
                            </div>
                            <button className="btn btn-secondary" onClick={() => setSelectedDroneId(null)}><X size={12} /> Close Panel</button>
                        </div>
                    )}
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
                    <div className="card-header"><span className="card-header-title"><Radio size={14} /> Fleet Status</span></div>
                    <table className="data-table">
                        <thead><tr><th>Drone</th><th>Model</th><th>Heading To</th><th>Battery</th><th>Status</th></tr></thead>
                        <tbody>
                            {drones.map((drone) => (
                                <tr key={drone.id} onClick={() => setSelectedDroneId(drone.id === selectedDroneId ? null : drone.id)} style={{ cursor: 'pointer', background: drone.id === selectedDroneId ? 'var(--accent-light)' : undefined }}>
                                    <td className="mono bold">{drone.id}</td>
                                    <td className="muted">{drone.model}</td>
                                    <td>{droneDestinationLabel(drone)}</td>
                                    <td className="mono">{drone.battery}%</td>
                                    <td><span className={`badge ${droneStatusBadge(drone.status)}`}>{droneStatusLabel(drone.status)}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (hash === '#requests') {
        return (
            <div>
                <ConfirmModal />
                <div className="page-header"><h1>Incoming Requests</h1><p>Clinic supply requests awaiting review, sorted by severity.</p></div>
                {requests.length === 0 ? <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)' }}><CheckCircle2 size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><div>No pending requests.</div></div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {requests.map((request) => (
                            <div key={request.id} className="card" style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 16, alignItems: 'start' }}>
                                <div style={{ width: 48, height: 48, borderRadius: 10, background: severityColor(request.severityScore), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>{request.severityScore || '?'}</div>
                                <div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                                        <span className="mono bold">{request.id}</span>
                                        <span className={`badge ${priorityBadge(request.priority)}`}>{request.priority}</span>
                                        <span className={`badge ${statusBadge(request.status)}`}>{request.status.replace(/_/g, ' ')}</span>
                                    </div>
                                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{request.payload}</div>
                                    {request.geminiSummary && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{request.geminiSummary}</div>}
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{request.requestedBy || request.clinic} | {request.origin} to {request.destination}</div>
                                    {request.clinicNotes && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>"{request.clinicNotes}"</div>}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <button className="btn btn-primary" onClick={() => setConfirmAction({ id: request.id, type: 'approve' })}>Approve</button>
                                    <button className="btn btn-secondary" onClick={() => setConfirmAction({ id: request.id, type: 'reject' })}>Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (hash === '#active') {
        return (
            <div>
                <ConfirmModal />
                <div className="page-header"><h1>Active Deliveries</h1><p>Track live missions, queued launches, and weather holds across the corridor.</p></div>
                {activeDeliveries.length === 0 ? <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)' }}><Package size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><div>No active deliveries.</div></div> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {activeDeliveries.map((delivery) => {
                            const progress = delivery.totalLegs > 0 ? Math.round((delivery.currentLeg / delivery.totalLegs) * 100) : 0;
                            const nextStop = Array.isArray(delivery.route) && delivery.route.length > 1
                                ? delivery.route[Math.min((delivery.currentLeg || 0) + 1, delivery.route.length - 1)]
                                : delivery.destination;
                            const statusDetail = delivery.status === 'PENDING_DISPATCH'
                                ? 'Route review in progress'
                                : delivery.status === 'READY_TO_LAUNCH'
                                    ? (Array.isArray(delivery.route) && delivery.route.length > 1
                                        ? `Queued for launch to ${nextStop || delivery.destination}`
                                        : 'Awaiting route recovery')
                                    : delivery.status === 'WEATHER_HOLD'
                                        ? 'Mission paused for corridor conditions'
                                        : `Heading to ${nextStop || delivery.destination}`;
                            return (
                                <div key={delivery.id} className="card" style={{ padding: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                                        <span className="mono bold">{delivery.id}</span>
                                        <span className={`badge ${statusBadge(delivery.status)}`}>{delivery.status.replace(/_/g, ' ')}</span>
                                        <span className={`badge ${priorityBadge(delivery.priority)}`}>{delivery.priority}</span>
                                        {delivery.assignedDrone && <span className="badge badge-neutral">Drone {delivery.assignedDrone}</span>}
                                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>{delivery.status === 'PENDING_DISPATCH' || delivery.status === 'READY_TO_LAUNCH' ? delivery.recommendedAction : `ETA ${delivery.estimatedTime || '-'}`}</span>
                                        <button className="btn btn-secondary" style={{ color: '#ef4444' }} onClick={() => setConfirmAction({ id: delivery.id, type: 'cancel' })}><X size={12} /> Cancel</button>
                                    </div>
                                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 17 }}>{delivery.payload}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>{statusDetail}</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
                                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Origin</div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{delivery.origin}</div>
                                        </div>
                                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Destination</div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{delivery.destination}</div>
                                        </div>
                                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Last Relay</div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{delivery.lastStation || delivery.origin}</div>
                                        </div>
                                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Progress</div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{delivery.totalLegs > 0 ? `${delivery.currentLeg}/${delivery.totalLegs} legs` : 'Queued'}</div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 999 }}>
                                            <div style={{ width: `${progress}%`, height: '100%', background: delivery.priority === 'Emergency' ? '#ef4444' : 'var(--accent)', borderRadius: 999 }} />
                                        </div>
                                        <span className="mono" style={{ fontSize: 12, minWidth: 36, textAlign: 'right' }}>{progress}%</span>
                                    </div>
                                    <RouteStops route={delivery.route} currentLeg={delivery.currentLeg} />
                                    {delivery.status === 'WEATHER_HOLD' && <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b', display: 'flex', gap: 8 }}><AlertTriangle size={14} style={{ flexShrink: 0 }} /><span>{delivery.recommendedAction || 'Weather hold is active on this mission.'}</span></div>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    if (hash === '#dispatch') {
        return (
            <div>
                <div className="page-header"><h1>Dispatch Console</h1><p>Create deliveries with AI assist or manual entry. New missions enter the operational queue after route planning and fleet checks.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: resultCard ? '1fr 360px' : '1fr', gap: 16, maxWidth: resultCard ? 1080 : 680, margin: '0 auto' }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header">
                            <span className="card-header-title"><Send size={15} /> Dispatch Manifest</span>
                            <div className="toggle-group">
                                <button className={`toggle-btn ${useAI ? 'active' : ''}`} onClick={() => setUseAI(true)}>AI Assist</button>
                                <button className={`toggle-btn ${!useAI ? 'active' : ''}`} onClick={() => setUseAI(false)}>Manual</button>
                            </div>
                        </div>
                        <div className="card-body">
                            {useAI ? (
                                <form onSubmit={submitAIDispatch}>
                                    <textarea className="form-input" rows={5} style={{ resize: 'none', marginBottom: 16 }} placeholder="Example: Send urgent insulin and antibiotics from Montreal to Chisasibi tonight." value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} />
                                    {error && <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>{error}</div>}
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isProcessing || !aiPrompt.trim()}>{isProcessing ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Planning Dispatch...</> : 'Generate Route and Dispatch'}</button>
                                </form>
                            ) : (
                                <form onSubmit={submitManualDispatch}>
                                    <label className="form-label">Payload</label>
                                    <input className="form-input" style={{ marginBottom: 16 }} value={payload} onChange={(event) => setPayload(event.target.value)} placeholder="Example: Insulin (5kg)" required />
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        <div>
                                            <label className="form-label">Origin</label>
                                            <select className="form-input" value={origin} onChange={(event) => setOrigin(event.target.value)}>
                                                {originStations.map((station) => <option key={station.id} value={station.id}>{station.id}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label">Destination</label>
                                            <select className="form-input" value={destination} onChange={(event) => setDestination(event.target.value)}>
                                                {destinationStations.map((station) => <option key={station.id} value={station.id}>{station.id}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <label className="form-label">Priority</label>
                                    <select className="form-input" style={{ marginBottom: 16 }} value={priority} onChange={(event) => setPriority(event.target.value)}><option value="Routine">Routine</option><option value="Urgent">Urgent</option><option value="Emergency">Emergency</option></select>
                                    {error && <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>{error}</div>}
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={!payload.trim()}>Dispatch Delivery</button>
                                </form>
                            )}
                        </div>
                    </div>
                    {resultCard && (
                        <div className="card">
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase' }}>Dispatch Result</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span className="mono bold">{resultCard.id}</span>
                                <span className={`badge ${statusBadge(resultCard.status)}`}>{resultCard.status.replace(/_/g, ' ')}</span>
                            </div>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{resultCard.payload}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{resultCard.origin} to {resultCard.destination}</div>
                            <RouteStops route={resultCard.route} />
                            {resultCard.reasoning && <div style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}><Route size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />{resultCard.reasoning}</div>}
                            <div className="info-box info-box-green" style={{ marginTop: 16 }}><strong>Created</strong> | {resultCard.status === 'READY_TO_LAUNCH' ? 'Mission is queued for launch.' : resultCard.status === 'PENDING_DISPATCH' ? 'Dispatch review is still underway.' : resultCard.status === 'WEATHER_HOLD' ? 'Weather hold applied.' : resultCard.status === 'IN_TRANSIT' ? 'Dispatch is active.' : 'Mission is synced to the operations queue.'}</div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (hash === '#ledger') {
        return (
            <div>
                <div className="page-header"><h1>Custody Ledger</h1><p>Delivered manifests with real Solana devnet custody attestations, signer status, and explorer traces once confirmation lands.</p></div>
                {ledgerStatusError && (
                    <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>
                        {ledgerStatusError}
                    </div>
                )}
                {ledgerStatus && (
                    <div className="card" style={{ marginBottom: 16, padding: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Devnet Signer</div>
                                <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{truncateMiddle(ledgerStatus.authorityAddress, 18, 14)}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    Balance {formatSolanaBalance(ledgerStatus.balanceSol)} / {formatSolanaBalance(ledgerStatus.minimumBalanceSol)} required
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <a
                                    className="btn btn-secondary"
                                    href={ledgerStatus.authorityExplorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ padding: '8px 12px' }}
                                >
                                    Signer Explorer
                                </a>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '8px 12px' }}
                                    onClick={() => retryLedgerAttestations()}
                                    disabled={isRetryingLedger}
                                >
                                    {isRetryingLedger ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Retrying</> : 'Retry Pending Attestations'}
                                </button>
                            </div>
                        </div>
                        {!ledgerStatus.canSubmitTransactions && (
                            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--warning)', lineHeight: 1.6 }}>
                                Fund this signer with devnet SOL or set `SOLANA_DEVNET_SECRET_KEY` to a funded devnet wallet. Until then, rows cannot mint real transaction signatures.
                            </div>
                        )}
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                    <div className="stat-card"><div className="stat-label">ATTESTED DELIVERIES</div><div className="stat-value">{completedDeliveries.length}</div><div className="stat-sub stat-sub-muted">Each manifest gets a Solana-format custody record.</div></div>
                    <div className="stat-card"><div className="stat-label">SOLANA NETWORK</div><div className="stat-value">{completedDeliveries[0]?.solanaNetwork || 'devnet'}</div><div className="stat-sub stat-sub-muted">{onChainCompletedDeliveries.length > 0 ? `${onChainCompletedDeliveries.length} live devnet attestations confirmed.` : ledgerStatus?.canSubmitTransactions ? 'New deliveries are ready for devnet submission.' : 'Funding is blocking new devnet submissions.'}</div></div>
                    <div className="stat-card">
                        <div className="stat-label">PROGRAM</div>
                        <div className="stat-value" style={{ fontSize: 22, lineHeight: 1.1 }}>Memo Program</div>
                        <div
                            className="stat-sub stat-sub-muted"
                            title={ledgerProgram}
                            style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 11,
                                overflowWrap: 'anywhere',
                                lineHeight: 1.4,
                            }}
                        >
                            {truncateMiddle(ledgerProgram, 14, 12)}
                        </div>
                        <div className="stat-sub stat-sub-muted">Memo + PDA attestations keep custody records tamper-evident.</div>
                    </div>
                </div>
                <div className="card" style={{ marginBottom: 16, padding: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 8 }}>Why Solana helps</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                        Each completed mission is recorded with a real Solana devnet Memo transaction, slot, and derived PDA reference. That gives dispatch a public audit trail for who moved the shipment and exactly which manifest reached the clinic once the signer has enough devnet SOL to publish.
                    </div>
                </div>
                <div className="card" style={{ padding: 0, overflowX: 'auto', overflowY: 'hidden' }}>
                    <table className="data-table" style={{ tableLayout: 'fixed', minWidth: 1120 }}>
                        <thead><tr><th style={{ width: 150 }}>Delivered</th><th style={{ width: 100 }}>ID</th><th style={{ width: 260 }}>Payload</th><th style={{ width: 220 }}>Program</th><th style={{ width: 140 }}>Slot</th><th style={{ width: 320 }}>Attestation</th></tr></thead>
                        <tbody>
                            {completedDeliveries.map((delivery) => {
                                const fundingRequired = !delivery.solanaOnChain && ledgerStatus && !ledgerStatus.canSubmitTransactions;
                                const attestation = fundingRequired
                                    ? {
                                        label: 'Funding required',
                                        detail: 'Fee payer needs devnet SOL before submission.',
                                        slotLabel: 'Funding needed',
                                    }
                                    : ledgerAttestationState(delivery);
                                return (
                                <tr key={delivery.id}>
                                    <td className="mono muted">{formatDateTime(delivery.createdAt)}</td>
                                    <td className="mono bold">{delivery.id}</td>
                                    <td title={`${delivery.payload || ''}\n${formatLedgerRoute(delivery)}`}>
                                        <div className="bold" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{truncateText(delivery.payload, 34)}</div>
                                    </td>
                                    <td title={delivery.solanaProgram || SOLANA_MEMO_PROGRAM}>
                                        <div className="bold" style={{ fontSize: 12, marginBottom: 3 }}>Memo Program</div>
                                        <div className="muted mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {truncateMiddle(delivery.solanaProgram || SOLANA_MEMO_PROGRAM, 14, 12)}
                                        </div>
                                    </td>
                                    <td className="mono muted">{attestation.slotLabel}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span className="tx-pill" title={delivery.solanaTx || attestation.label}>
                                                <LinkIcon size={11} /> {delivery.solanaOnChain ? formatSolanaSignature(delivery.solanaTx) : attestation.label}
                                                <span className="tx-verified"><Lock size={10} /> {attestation.label}</span>
                                            </span>
                                            {delivery.solanaOnChain && delivery.solanaExplorerUrl && (
                                                <a href={delivery.solanaExplorerUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent)' }}>
                                                    Explorer <ExternalLink size={12} />
                                                </a>
                                            )}
                                            {!delivery.solanaOnChain && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    style={{ padding: '5px 10px', fontSize: 11 }}
                                                    onClick={() => retryLedgerAttestations(delivery.id)}
                                                    disabled={isRetryingLedger}
                                                >
                                                    Retry
                                                </button>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                                            {delivery.solanaOnChain
                                                ? attestation.detail
                                                : (fundingRequired || isFundingBlocked(delivery)) && ledgerStatus?.authorityAddress
                                                    ? `Fund ${truncateMiddle(ledgerStatus.authorityAddress, 12, 10)} on devnet, then retry.`
                                                    : attestation.detail}
                                        </div>
                                        {delivery.solanaAccountPda && (
                                            <div
                                                style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                title={delivery.solanaAccountPda}
                                            >
                                                PDA {truncateMiddle(delivery.solanaAccountPda)}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                            {completedDeliveries.length === 0 && <tr><td colSpan={6} className="empty-row">No delivered manifests are ready for custody attestation yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (hash === '#history') {
        return (
            <div>
                <div className="page-header"><h1>Delivery History</h1><p>All delivery requests and missions sorted by most recent activity.</p></div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Date</th><th>ID</th><th>Payload</th><th>Route</th><th>Status</th></tr></thead>
                        <tbody>
                            {history.map((delivery) => (
                                <tr key={delivery.id}>
                                    <td className="mono muted">{formatDateTime(delivery.createdAt)}</td>
                                    <td className="mono bold">{delivery.id}</td>
                                    <td className="bold">{delivery.payload}</td>
                                    <td className="muted">{delivery.origin} to {delivery.destination}</td>
                                    <td><span className={`badge ${statusBadge(delivery.status)}`}>{delivery.status.replace(/_/g, ' ')}</span></td>
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
