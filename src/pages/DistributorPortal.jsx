import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { dispatchWithGemini } from '../services/gemini';
import { speakText, generateDispatchConfirmation } from '../services/elevenlabs';
import CorridorMapShared from '../components/CorridorMap';
import { Send, Link as LinkIcon, Lock, CheckCircle2, Loader2, Volume2, Route, X, Clock, Package, MapPin, Radio, Camera, Battery, Gauge } from 'lucide-react';

export default function DistributorPortal() {
    const { deliveries, stations, drones, lines, addDelivery } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

    // Auto-refresh data every 10s for live updates
    useEffect(() => {
        const interval = setInterval(() => useStore.getState().initializeData(true), 10000);
        return () => clearInterval(interval);
    }, []);

    const [useAI, setUseAI] = useState(true);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [geminiResult, setGeminiResult] = useState(null);
    const [error, setError] = useState(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [payload, setPayload] = useState('');
    const [confirmAction, setConfirmAction] = useState(null);
    const [selectedDroneId, setSelectedDroneId] = useState(null);
    const [showAllDrones, setShowAllDrones] = useState(true);
    const distributionStations = stations.filter((station) => station.type === 'distribution');
    const destinationStations = stations.filter((station) => station.id !== 'Chibougamau Hub');
    const [origin, setOrigin] = useState(distributionStations[0]?.id || 'Chibougamau Hub');
    const [destination, setDestination] = useState('Chisasibi');
    const [priority, setPriority] = useState('Routine');

    // Status helpers
    const isRequested = (s) => ['REQUESTED', 'AWAITING_REVIEW'].includes(s);
    const isActive = (s) => ['PENDING_DISPATCH', 'READY_TO_LAUNCH', 'IN_TRANSIT', 'REROUTED', 'HANDOFF'].includes(s);
    const isFinished = (s) => ['DELIVERED', 'REJECTED'].includes(s);

    const requests = deliveries.filter(d => isRequested(d.status)).sort((a, b) => (b.severityScore || 0) - (a.severityScore || 0));
    const activeDeliveries = deliveries.filter(d => isActive(d.status)).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    const allApproved = deliveries.filter(d => !isRequested(d.status) && d.status !== 'REJECTED').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const completed = deliveries.filter(d => d.status === 'DELIVERED').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const allHistory = deliveries.filter(d => isFinished(d.status)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const selectedDrone = drones.find(d => d.id === selectedDroneId);

    const severityColor = (s) => {
        if (s >= 5) return '#dc2626'; if (s >= 4) return '#ea580c';
        if (s >= 3) return '#d97706'; if (s >= 2) return '#2563eb'; return '#64748b';
    };
    const statusBadge = (status) => {
        const map = { 'REQUESTED': 'badge-amber', 'AWAITING_REVIEW': 'badge-amber', 'PENDING_DISPATCH': 'badge-neutral', 'READY_TO_LAUNCH': 'badge-neutral', 'IN_TRANSIT': 'badge-blue', 'REROUTED': 'badge-blue', 'HANDOFF': 'badge-blue', 'DELIVERED': 'badge-green', 'REJECTED': 'badge-red' };
        return map[status] || 'badge-neutral';
    };

    const handleAIDispatch = async (e) => {
        e.preventDefault(); if (!aiPrompt) return;
        setError(null); setIsProcessing(true); setGeminiResult(null);
        try {
            const result = await dispatchWithGemini(aiPrompt);
            setGeminiResult(result); await addDelivery(result);
            try { setIsSpeaking(true); await speakText(generateDispatchConfirmation(result), 'en'); } catch { } finally { setIsSpeaking(false); }
            setAiPrompt('');
        } catch (err) { setError(err.message); } finally { setIsProcessing(false); }
    };
    const handleManualDispatch = async (e) => {
        e.preventDefault(); if (!payload) return; setError(null);
        try { await addDelivery({ payload, origin, destination, priority }); setPayload(''); } catch (err) { setError(err.message); }
    };
    const handleLaunch = async (id) => {
        try {
            const res = await fetch(`/api/deliveries/${id}/launch`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Launch failed');
            alert(`🚀 ${data.message}`);
            useStore.getState().initializeData(true);
        } catch (err) { alert('Launch error: ' + err.message); }
    };
    const handleAction = async (id, action) => {
        try {
            const res = await fetch(`/api/deliveries/${id}/approve`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
            if (!res.ok) throw new Error('Failed to ' + action);
            setConfirmAction(null); useStore.getState().initializeData(true);
        } catch (err) { alert('Error: ' + err.message); }
    };

    /* ΓöÇΓöÇ Confirmation Modal ΓöÇΓöÇ */
    const ConfirmModal = () => {
        if (!confirmAction) return null;
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmAction(null)}>
                <div style={{ background: 'white', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{confirmAction.action === 'approve' ? 'Γ£ô Approve Delivery?' : 'Γ£ò Reject Request?'}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                        {confirmAction.action === 'approve' ? `Move ${confirmAction.id} to dispatch queue.` : `Reject ${confirmAction.id}. The clinic will be notified.`}
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                        <button className={`btn ${confirmAction.action === 'approve' ? 'btn-primary' : ''}`}
                            style={confirmAction.action === 'reject' ? { background: '#ef4444', color: 'white', border: 'none' } : {}}
                            onClick={() => handleAction(confirmAction.id, confirmAction.action)}>
                            {confirmAction.action === 'approve' ? 'Γ£ô Approve' : 'Γ£ò Reject'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    /* ΓöÇΓöÇ Overview with Map + Drone Panel ΓöÇΓöÇ */
    if (hash === '') {
        return (
            <div>
                <ConfirmModal />
                <div className="page-header">
                    <h1>Operator Overview</h1>
                    <p>Live drone positions and corridor activity.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
                    <div className="stat-card"><div className="stat-label">PENDING REQUESTS</div><div className="stat-value" style={{ color: requests.length > 0 ? '#ea580c' : 'inherit' }}>{requests.length}</div></div>
                    <div className="stat-card"><div className="stat-label">ACTIVE DELIVERIES</div><div className="stat-value">{activeDeliveries.length}</div></div>
                    <div className="stat-card"><div className="stat-label">COMPLETED</div><div className="stat-value">{completed.length}</div></div>
                    <div className="stat-card"><div className="stat-label">FLEET ONLINE</div><div className="stat-value">{drones.filter(d => d.status !== 'maintenance').length}/{drones.length}</div></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: selectedDrone ? '1fr 320px' : '1fr', gap: 16 }}>
                    {/* Map */}
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
                            <span className="card-header-title"><MapPin size={14} /> Live Corridor Map</span>
                            <div className="toggle-group">
                                <button className={`toggle-btn ${showAllDrones ? 'active' : ''}`} onClick={() => setShowAllDrones(true)}>All Drones</button>
                                <button className={`toggle-btn ${!showAllDrones ? 'active' : ''}`} onClick={() => setShowAllDrones(false)}>My Dispatches</button>
                            </div>
                        </div>
                        <CorridorMapShared
                            stations={stations}
                            drones={showAllDrones ? drones : drones.filter(d => d.status === 'on_route')}
                            deliveries={activeDeliveries}
                            lines={lines}
                            height={440}
                            showLines={false}
                            selectedDroneId={selectedDroneId}
                            onDroneClick={(id) => setSelectedDroneId(id === selectedDroneId ? null : id)}
                        />
                    </div>

                    {/* Drone side panel */}
                    {selectedDrone && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                {/* Simulated feed */}
                                <div style={{ position: 'relative', height: 180, background: '#0f172a', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div style={{ color: '#334155', fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'center' }}>
                                            <Camera size={24} style={{ opacity: 0.3, marginBottom: 6 }} /><br />
                                            LIVE FEED ΓÇö {selectedDrone.id}
                                        </div>
                                    </div>
                                    <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.6)', animation: 'pulse 1.5s infinite' }} />
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#ef4444', fontWeight: 600 }}>REC</span>
                                    </div>
                                    <div style={{ position: 'absolute', top: 8, right: 10, fontFamily: 'var(--mono)', fontSize: 9, color: '#475569' }}>{selectedDrone.id}</div>
                                </div>
                                <div style={{ padding: 16 }}>
                                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{selectedDrone.id}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                        <div><Battery size={11} style={{ verticalAlign: 'middle' }} /> Battery: <strong>{selectedDrone.battery}%</strong></div>
                                        <div><Gauge size={11} style={{ verticalAlign: 'middle' }} /> Speed: <strong>{selectedDrone.speed || 0} km/h</strong></div>
                                        <div>Status: <span className={`badge ${selectedDrone.status === 'on_route' ? 'badge-blue' : 'badge-green'}`}>{selectedDrone.status}</span></div>
                                        <div>Location: <strong>{selectedDrone.target_location || selectedDrone.location || 'ΓÇö'}</strong></div>
                                    </div>
                                </div>
                            </div>
                            <button className="btn btn-secondary" style={{ width: '100%', fontSize: 12 }} onClick={() => setSelectedDroneId(null)}>
                                <X size={12} /> Close Panel
                            </button>
                        </div>
                    )}
                </div>

                {/* Drone list below map */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
                    <div className="card-header"><span className="card-header-title"><Radio size={14} /> Fleet Status</span></div>
                    <table className="data-table">
                        <thead><tr><th>Drone</th><th>Model</th><th>Location</th><th>Battery</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            {drones.map(d => (
                                <tr key={d.id} style={{ cursor: 'pointer', background: d.id === selectedDroneId ? 'var(--accent-light)' : undefined }}
                                    onClick={() => setSelectedDroneId(d.id === selectedDroneId ? null : d.id)}>
                                    <td className="mono bold">{d.id}</td>
                                    <td className="muted">{d.model}</td>
                                    <td>{d.target_location || d.location || 'ΓÇö'}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                                                <div style={{ width: `${d.battery}%`, height: '100%', background: d.battery > 50 ? '#22c55e' : d.battery > 20 ? '#f59e0b' : '#ef4444', borderRadius: 2 }} />
                                            </div>
                                            <span className="mono" style={{ fontSize: 11 }}>{d.battery}%</span>
                                        </div>
                                    </td>
                                    <td><span className={`badge ${d.status === 'on_route' ? 'badge-blue' : d.status === 'ready' ? 'badge-green' : 'badge-amber'}`}>{d.status}</span></td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }}>View</button>
                                    </td>
                                </tr>
                            ))}
                            {drones.length === 0 && <tr><td colSpan={6} className="empty-row">No drones registered.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    /* ΓöÇΓöÇ Incoming Requests ΓöÇΓöÇ */
    if (hash === '#requests') {
        return (
            <div>
                <ConfirmModal />
                <div className="page-header"><h1>Incoming Requests</h1><p>Clinic supply requests awaiting approval. Sorted by severity.</p></div>
                {requests.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                        <CheckCircle2 size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><div style={{ fontSize: 14, fontWeight: 600 }}>All clear</div><div style={{ fontSize: 13 }}>No pending requests.</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {requests.map(r => (
                            <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', gap: 16, padding: 20 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 10, background: severityColor(r.severityScore), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, flexShrink: 0 }}>{r.severityScore || '?'}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                            <span className="mono bold" style={{ fontSize: 14 }}>{r.id}</span>
                                            <span className={`badge ${r.priority === 'Emergency' ? 'badge-red' : r.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{r.priority}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{r.payload}</div>
                                        {r.geminiSummary && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.5 }}>{r.geminiSummary}</div>}
                                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', gap: 16 }}>
                                            {r.requestedBy && <span><MapPin size={11} style={{ verticalAlign: 'middle' }} /> From: <strong>{r.requestedBy}</strong></span>}
                                            <span>Route: {r.origin} ΓåÆ {r.destination}</span>
                                        </div>
                                        {r.clinicNotes && <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>"{r.clinicNotes}"</div>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                                        <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }} onClick={() => setConfirmAction({ id: r.id, action: 'approve' })}>Γ£ô Approve</button>
                                        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '8px 16px' }} onClick={() => setConfirmAction({ id: r.id, action: 'reject' })}>Γ£ò Reject</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    /* ΓöÇΓöÇ Active Deliveries ΓöÇΓöÇ */
    if (hash === '#active') {
        return (
            <div>
                <div className="page-header"><h1>Active Deliveries</h1><p>Track in-progress deliveries across the corridor.</p></div>
                {activeDeliveries.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                        <Package size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><div style={{ fontSize: 14, fontWeight: 600 }}>No active deliveries</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {activeDeliveries.map(d => {
                            const progress = d.totalLegs > 0 ? Math.round((d.currentLeg / d.totalLegs) * 100) : 0;
                            return (
                                <div key={d.id} className="card" style={{ padding: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                        <span className="mono bold" style={{ fontSize: 15 }}>{d.id}</span>
                                        <span className={`badge ${statusBadge(d.status)}`}>{d.status.replace(/_/g, ' ')}</span>
                                        <span className={`badge ${d.priority === 'Emergency' ? 'badge-red' : d.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{d.priority}</span>
                                        {['READY_TO_LAUNCH', 'PENDING_DISPATCH'].includes(d.status) && (
                                            <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 16px' }} onClick={() => handleLaunch(d.id)}>🚀 Launch</button>
                                        )}
                                        {!['READY_TO_LAUNCH', 'PENDING_DISPATCH'].includes(d.status) && (
                                            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>ETA: {new Date(d.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{d.payload}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>{d.origin} ΓåÆ {d.destination} ┬╖ Last seen: {d.lastStation}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                                            <div style={{ width: `${progress}%`, height: '100%', background: d.priority === 'Emergency' ? '#ef4444' : 'var(--accent)', borderRadius: 3, transition: 'width 0.5s' }} />
                                        </div>
                                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{progress}%</span>
                                    </div>
                                    {d.route && d.route.length > 0 && (
                                        <div style={{ marginTop: 10, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                            {d.route.map((stop, i) => (
                                                <span key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: i < d.currentLeg ? 'var(--accent)' : i === d.currentLeg ? '#f59e0b' : 'var(--border)', border: '2px solid white', boxShadow: '0 0 0 1px var(--border)' }} />
                                                    <span style={{ fontWeight: i === d.currentLeg ? 700 : 400, color: i < d.currentLeg ? 'var(--accent)' : 'var(--text-secondary)' }}>{stop}</span>
                                                    {i < d.route.length - 1 && <span style={{ color: 'var(--text-tertiary)', margin: '0 2px' }}>ΓåÆ</span>}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    /* ΓöÇΓöÇ Dispatch Console ΓöÇΓöÇ */
    if (hash === '#dispatch') {
        return (
            <div>
                <div className="page-header"><h1>Dispatch Console</h1><p>Create deliveries using Gemini AI routing or manual entry.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: geminiResult ? '1fr 380px' : '1fr', gap: 16, maxWidth: geminiResult ? 1100 : 680, margin: '0 auto' }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header">
                            <span className="card-header-title"><Send size={15} /> Manifest Request</span>
                            <div className="toggle-group">
                                <button className={`toggle-btn ${useAI ? 'active' : ''}`} onClick={() => setUseAI(true)}>AI Assist</button>
                                <button className={`toggle-btn ${!useAI ? 'active' : ''}`} onClick={() => setUseAI(false)}>Manual</button>
                            </div>
                        </div>
                        <div className="card-body">
                            {useAI ? (
                                <form onSubmit={handleAIDispatch}>
                                    <div style={{ marginBottom: 20 }}>
                                        <textarea className="form-input" rows={5} placeholder="E.g., We need to send 2 boxes of urgent EpiPens from Chibougamau to Chisasibi immediately." value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} style={{ resize: 'none' }} />
                                    </div>
                                    {error && <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>{error}</div>}
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={isProcessing || !aiPrompt}>
                                        {isProcessing ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing with GeminiΓÇª</> : 'Generate Route & Queue Launch'}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={handleManualDispatch}>
                                    <div style={{ marginBottom: 16 }}><label className="form-label">Payload</label><input className="form-input" placeholder="e.g. Insulin (5kg)" value={payload} onChange={e => setPayload(e.target.value)} required /></div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        <div><label className="form-label">Origin</label><select className="form-input" value={origin} onChange={e => setOrigin(e.target.value)}>{distributionStations.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></div>
                                        <div><label className="form-label">Destination</label><select className="form-input" value={destination} onChange={e => setDestination(e.target.value)}>{destinationStations.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></div>
                                    </div>
                                    <div style={{ marginBottom: 16 }}><label className="form-label">Priority</label><select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}><option value="Routine">Routine</option><option value="Urgent">Urgent</option><option value="Emergency">Emergency</option></select></div>
                                    {error && <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>{error}</div>}
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={!payload}>Queue Delivery</button>
                                </form>
                            )}
                        </div>
                    </div>
                    {geminiResult && (
                        <div className="card" style={{ padding: 20 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase' }}>AI Route Result</div>
                            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{geminiResult.payload}</div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{geminiResult.origin} ΓåÆ {geminiResult.destination}</div>
                            {geminiResult.route && geminiResult.route.map((stop, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 || i === geminiResult.route.length - 1 ? 'var(--accent)' : 'var(--border-strong)', border: '2px solid white', boxShadow: '0 0 0 1px var(--border)' }} />
                                    <span style={{ fontWeight: i === 0 || i === geminiResult.route.length - 1 ? 600 : 400 }}>{stop}</span>
                                </div>
                            ))}
                            {geminiResult.reasoning && <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}><Route size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />{geminiResult.reasoning}</div>}
                            <div className="info-box info-box-green" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}><CheckCircle2 size={18} /><div><strong>Queued</strong> ΓÇö delivery added to dispatch queue.</div></div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    /* ΓöÇΓöÇ Custody Ledger ΓöÇΓöÇ */
    if (hash === '#ledger') {
        return (
            <div>
                <div className="page-header"><h1>Custody Ledger</h1><p>Immutable chain-of-custody records (Solana Devnet).</p></div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Timestamp</th><th>ID</th><th>Payload</th><th>Route</th><th>Transaction</th></tr></thead>
                        <tbody>
                            {allApproved.map(d => (
                                <tr key={d.id}><td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td><td className="mono bold">{d.id}</td><td className="bold">{d.payload}</td><td className="muted">{d.origin} ΓåÆ {d.destination}</td>
                                    <td><span className="tx-pill"><LinkIcon size={11} /> {d.solanaTx}<span className="tx-verified"><Lock size={10} /> Verified</span></span></td></tr>
                            ))}
                            {allApproved.length === 0 && <tr><td colSpan={5} className="empty-row">No records.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    /* ΓöÇΓöÇ History ΓöÇΓöÇ */
    if (hash === '#history') {
        return (
            <div>
                <div className="page-header"><h1>Delivery History</h1><p>Completed and rejected deliveries.</p></div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Date</th><th>ID</th><th>Payload</th><th>Route</th><th>Status</th></tr></thead>
                        <tbody>
                            {allHistory.map(d => (<tr key={d.id}><td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td><td className="mono bold">{d.id}</td><td className="bold">{d.payload}</td><td className="muted">{d.origin} ΓåÆ {d.destination}</td><td><span className={`badge ${statusBadge(d.status)}`}>{d.status}</span></td></tr>))}
                            {allHistory.length === 0 && <tr><td colSpan={5} className="empty-row">No history yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}
