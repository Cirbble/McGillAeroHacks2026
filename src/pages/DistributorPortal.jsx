import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { dispatchWithGemini } from '../services/gemini';
import { speakText, generateDispatchConfirmation } from '../services/elevenlabs';
import { Send, Cpu, Link as LinkIcon, Lock, CheckCircle2, Loader2, Volume2, Route } from 'lucide-react';

export default function DistributorPortal() {
    const { deliveries, stations, addDelivery } = useStore();
    const location = useLocation();
    const hash = location.hash || '';

    const [useAI, setUseAI] = useState(true);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [geminiResult, setGeminiResult] = useState(null);
    const [error, setError] = useState(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [payload, setPayload] = useState('');
    const distributionStations = stations.filter((station) => station.type === 'distribution');
    const destinationStations = stations.filter((station) => station.id !== 'Chibougamau Hub');
    const [origin, setOrigin] = useState(distributionStations[0]?.id || 'Chibougamau Hub');
    const [destination, setDestination] = useState('Chisasibi');
    const [priority, setPriority] = useState('Routine');

    const handleAIDispatch = async (e) => {
        e.preventDefault();
        if (!aiPrompt) return;
        setIsProcessing(true);
        setGeminiResult(null);
        setError(null);

        try {
            const result = await dispatchWithGemini(aiPrompt);
            const createdDelivery = await addDelivery(result);
            setGeminiResult(createdDelivery);
            setAiPrompt('');

            // Voice confirmation via ElevenLabs
            try {
                setIsSpeaking(true);
                const msg = generateDispatchConfirmation({
                    id: createdDelivery.id,
                    payload: createdDelivery.payload,
                    destination: createdDelivery.destination,
                    estimatedTime: createdDelivery.estimatedMinutes ? `${Math.floor(createdDelivery.estimatedMinutes / 60)} hours, ${createdDelivery.estimatedMinutes % 60} minutes` : '2 hours',
                    legs: createdDelivery.totalLegs,
                });
                await speakText(msg);
            } catch (voiceErr) {
                console.warn('Voice confirmation failed:', voiceErr);
            } finally {
                setIsSpeaking(false);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleManualDispatch = async (e) => {
        e.preventDefault();
        if (!payload) return;
        setError(null);
        setGeminiResult(null);

        try {
            const createdDelivery = await addDelivery({ payload, origin, destination, priority });
            setGeminiResult(createdDelivery);
            setPayload('');
        } catch (err) {
            setError(err.message);
        }
    };

    const allDeliveries = [...deliveries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const completed = deliveries.filter(d => d.status === 'DELIVERED').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    /* ── Dispatch Console ── */
    if (hash === '') {
        return (
            <div>
                <div className="page-header">
                    <h1>Dispatch Console</h1>
                    <p>Create shipping manifests using the Gemini AI routing engine or manual entry.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: geminiResult ? '1fr 380px' : '1fr', gap: 16, maxWidth: geminiResult ? 1100 : 680 }}>
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
                                    <div className="info-box info-box-blue" style={{ marginBottom: 20 }}>
                                        <strong>Gemini Routing Engine</strong> — Describe your delivery in plain language. The backend Gemini planner will structure the manifest, then Aero'ed will validate it against live corridor weather and suggest a manual reroute when the current path is risky.
                                    </div>
                                    <div style={{ marginBottom: 20 }}>
                                        <textarea
                                            className="form-input"
                                            rows={5}
                                            placeholder="E.g., We need to send 2 boxes of urgent EpiPens from Chibougamau to Chisasibi immediately. Also include some antibiotics for the nursing station."
                                            value={aiPrompt}
                                            onChange={(e) => setAiPrompt(e.target.value)}
                                            style={{ resize: 'none' }}
                                        />
                                    </div>

                                    {error && (
                                        <div className="info-box" style={{ marginBottom: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>
                                            {error}
                                        </div>
                                    )}

                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={isProcessing || !aiPrompt}>
                                        {isProcessing ? (
                                            <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processing with Gemini…</>
                                        ) : (
                                            'Generate Route & Queue Launch'
                                        )}
                                    </button>
                                </form>
                            ) : (
                                <form onSubmit={handleManualDispatch}>
                                    <div style={{ marginBottom: 16 }}>
                                        <label className="form-label">Payload Description</label>
                                        <input type="text" className="form-input" value={payload} onChange={e => setPayload(e.target.value)} placeholder="E.g., Insulin (2kg)" required />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                        <div>
                                            <label className="form-label">Origin Hub</label>
                                            <select className="form-input" value={origin} onChange={e => setOrigin(e.target.value)}>
                                                {distributionStations.length > 0 ? distributionStations.map((station) => (
                                                    <option key={station.id}>{station.id}</option>
                                                )) : (
                                                    <option>Chibougamau Hub</option>
                                                )}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label">Destination</label>
                                            <select className="form-input" value={destination} onChange={e => setDestination(e.target.value)}>
                                                {destinationStations.length > 0 ? destinationStations.map((station) => (
                                                    <option key={station.id}>{station.id}</option>
                                                )) : (
                                                    <>
                                                        <option>Mistissini</option>
                                                        <option>Nemaska</option>
                                                        <option>Waskaganish</option>
                                                        <option>Eastmain</option>
                                                        <option>Wemindji</option>
                                                        <option>Chisasibi</option>
                                                        <option>Whapmagoostui</option>
                                                    </>
                                                )}
                                            </select>
                                        </div>
                                    </div>
                                    <div style={{ marginBottom: 24 }}>
                                        <label className="form-label">Routing Priority</label>
                                        <select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}>
                                            <option>Routine</option><option>Urgent</option><option>Emergency</option>
                                        </select>
                                    </div>
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={!payload}>
                                        Secure Cartridge & Dispatch
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>

                    {/* Dispatch Assessment Panel */}
                    {geminiResult && (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div className="card-header" style={{ background: 'var(--accent-light)' }}>
                                <span className="card-header-title" style={{ color: 'var(--accent)' }}><Cpu size={15} /> Dispatch Route Assessment</span>
                            </div>
                            <div className="card-body" style={{ fontSize: 13 }}>
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Parsed Payload</div>
                                    <div style={{ fontWeight: 600 }}>{geminiResult.payload}</div>
                                    {(geminiResult.weightKg || geminiResult.weight_kg) && <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{geminiResult.weightKg || geminiResult.weight_kg} kg</div>}
                                </div>

                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 6 }}>Calculated Route</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {(geminiResult.route || []).map((stop, i) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--accent)' : i === (geminiResult.route.length - 1) ? 'var(--accent)' : 'var(--border-strong)', border: '2px solid white', boxShadow: '0 0 0 1px var(--border)' }} />
                                                <span style={{ fontWeight: i === 0 || i === (geminiResult.route.length - 1) ? 600 : 400 }}>{stop}</span>
                                                {i < geminiResult.route.length - 1 && <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10 }}>→ leg {i + 1}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>ETA</div>
                                        <div className="mono" style={{ fontWeight: 600 }}>{geminiResult.estimatedMinutes ? `${Math.floor(geminiResult.estimatedMinutes / 60)}h ${geminiResult.estimatedMinutes % 60}m` : geminiResult.estimatedTime || '—'}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 4 }}>Dispatch State</div>
                                        <span className={`badge ${
                                            geminiResult.status === 'WEATHER_HOLD' || geminiResult.status === 'REJECTED'
                                                ? 'badge-red'
                                                : geminiResult.status === 'REROUTED' || geminiResult.status === 'HANDOFF'
                                                    ? 'badge-yellow'
                                                    : geminiResult.status === 'IN_TRANSIT' || geminiResult.status === 'READY_TO_LAUNCH'
                                                        ? 'badge-green'
                                                        : 'badge-neutral'
                                        }`}>
                                            {geminiResult.status?.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                </div>

                                {geminiResult.reasoning && (
                                    <div style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                        <Route size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                                        {geminiResult.reasoning}
                                    </div>
                                )}

                                {geminiResult.routeWarnings?.length > 0 && (
                                    <div style={{ marginTop: 16, padding: '10px 12px', background: '#fff7ed', borderRadius: 6, border: '1px solid #fed7aa', fontSize: 12, lineHeight: 1.6, color: '#9a3412' }}>
                                        <strong>Weather / corridor warnings</strong>
                                        <div style={{ marginTop: 6 }}>
                                            {geminiResult.routeWarnings.map((warning) => (
                                                <div key={`${warning.stationId}-${warning.title}`} style={{ marginBottom: 6 }}>
                                                    <strong>{warning.stationId}</strong>: {warning.detail}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {geminiResult.recommendedAction && (
                                    <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                                        <strong>Recommended operator action</strong><br />
                                        {geminiResult.recommendedAction}
                                    </div>
                                )}

                                {isSpeaking && (
                                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--accent)' }}>
                                        <Volume2 size={14} /> Speaking confirmation via ElevenLabs…
                                    </div>
                                )}

                                <div className={`info-box ${geminiResult.status === 'WEATHER_HOLD' || geminiResult.status === 'REJECTED' ? '' : 'info-box-green'}`} style={{
                                    marginTop: 16,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    ...(geminiResult.status === 'WEATHER_HOLD' || geminiResult.status === 'REJECTED'
                                        ? { background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }
                                        : {}),
                                }}>
                                    <CheckCircle2 size={18} />
                                    <div>
                                        <strong>{geminiResult.status === 'WEATHER_HOLD' ? 'Manifest queued on hold.' : geminiResult.status === 'REJECTED' ? 'Manifest blocked by policy.' : 'Manifest secured and queued.'}</strong><br />
                                        <span style={{ fontSize: 11 }}>
                                            {geminiResult.status === 'WEATHER_HOLD'
                                                ? 'Dispatch is waiting for an operator reroute or better weather.'
                                                : geminiResult.status === 'REJECTED'
                                                    ? 'The request needs revision before it can enter the relay network.'
                                                    : 'Custody transaction signed. View in Ledger tab.'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    /* ── Custody Ledger ── */
    if (hash === '#ledger') {
        return (
            <div>
                <div className="page-header">
                    <h1>Custody Ledger</h1>
                    <p>Immutable chain-of-custody records for every relay hand-off (Solana Devnet).</p>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr><th>Timestamp</th><th>Delivery ID</th><th>Payload</th><th>Route</th><th>Transaction Signature</th></tr>
                        </thead>
                        <tbody>
                            {allDeliveries.map(d => (
                                <tr key={d.id}>
                                    <td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td>
                                    <td className="mono bold">{d.id}</td>
                                    <td className="bold">{d.payload}</td>
                                    <td className="muted">{d.origin} → {d.destination}</td>
                                    <td>
                                        <span className="tx-pill">
                                            <LinkIcon size={11} /> {d.solanaTx}
                                            <span className="tx-verified"><Lock size={10} /> Verified</span>
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {allDeliveries.length === 0 && (
                                <tr><td colSpan={5} className="empty-row">No records.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    /* ── Routing History ── */
    if (hash === '#history') {
        return (
            <div>
                <div className="page-header">
                    <h1>Routing History</h1>
                    <p>Completed deliveries and final disposition.</p>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Completed</th><th>Manifest ID</th><th>Payload</th><th>Origin</th><th>Destination</th></tr></thead>
                        <tbody>
                            {completed.map(d => (
                                <tr key={d.id}>
                                    <td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td>
                                    <td className="mono bold">{d.id}</td>
                                    <td className="bold">{d.payload}</td>
                                    <td className="muted">{d.origin}</td>
                                    <td>{d.destination}</td>
                                </tr>
                            ))}
                            {completed.length === 0 && (
                                <tr><td colSpan={5} className="empty-row">No completed deliveries yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}
