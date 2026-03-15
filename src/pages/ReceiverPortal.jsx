import { useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { speakText, generateArrivalAlert } from '../services/elevenlabs';
import CorridorMapShared from '../components/CorridorMap';
import { Package, Volume2, CheckCircle2, ShieldCheck, Loader2, Mic, Send, Clock, X, MapPin, AlertTriangle } from 'lucide-react';

export default function ReceiverPortal() {
    const { deliveries, stations, drones, lines, updateDeliveryStatus } = useStore();
    const location = useLocation();
    const hash = location.hash || '';
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [lang, setLang] = useState('en');
    const [requestText, setRequestText] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestResult, setRequestResult] = useState(null);
    const [cancelConfirm, setCancelConfirm] = useState(null);

    const inbound = deliveries.filter(d => ['IN_TRANSIT', 'HANDOFF'].includes(d.status) && d.currentLeg > 0).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    const myRequests = deliveries.filter(d => d.requestedBy).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const pendingRequests = myRequests.filter(d => d.status === 'REQUESTED');
    const completed = deliveries.filter(d => d.status === 'DELIVERED').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const next = inbound[0];
    const minutesToArrival = next ? Math.max(0, Math.ceil((new Date(next.eta) - Date.now()) / 60000)) : 0;
    const countdownHours = String(Math.floor(minutesToArrival / 60)).padStart(2, '0');
    const countdownMinutes = String(minutesToArrival % 60).padStart(2, '0');

    const statusBadge = (status) => {
        const map = {
            'REQUESTED': 'badge-amber',
            'PENDING_DISPATCH': 'badge-blue',
            'IN_TRANSIT': 'badge-blue',
            'HANDOFF': 'badge-blue',
            'DELIVERED': 'badge-green',
            'REJECTED': 'badge-red',
        };
        return map[status] || 'badge-neutral';
    };

    const statusLabel = (status) => {
        const map = {
            'REQUESTED': 'Awaiting Review',
            'PENDING_DISPATCH': 'Approved',
            'IN_TRANSIT': 'In Transit',
            'HANDOFF': 'Arriving',
            'DELIVERED': 'Delivered',
            'REJECTED': 'Rejected',
        };
        return map[status] || status;
    };

    const handleVoiceAlert = async () => {
        if (!next) return;
        setIsSpeaking(true);
        try {
            const msg = generateArrivalAlert(next, lang);
            await speakText(msg, lang);
        } catch (err) {
            console.error('ElevenLabs error:', err);
        } finally {
            setIsSpeaking(false);
        }
    };

    const handleCancelRequest = async (id) => {
        try {
            const res = await fetch(`/api/deliveries/${id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject' }),
            });
            if (!res.ok) throw new Error('Failed to cancel');
            setCancelConfirm(null);
            useStore.getState().initializeData(true);
        } catch (err) {
            alert('Error: ' + err.message);
        }
    };

    /* ΓöÇΓöÇ Cancel Confirmation Modal ΓöÇΓöÇ */
    const CancelModal = () => {
        if (!cancelConfirm) return null;
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setCancelConfirm(null)}>
                <div style={{ background: 'white', borderRadius: 12, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cancel Request?</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                        This will cancel request <strong>{cancelConfirm}</strong>. This action cannot be undone.
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" onClick={() => setCancelConfirm(null)}>Keep Request</button>
                        <button className="btn" style={{ background: '#ef4444', color: 'white', border: 'none' }}
                            onClick={() => handleCancelRequest(cancelConfirm)}>
                            Cancel Request
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    /* ΓöÇΓöÇ Dashboard ΓöÇΓöÇ */
    if (hash === '') {
        return (
            <div>
                <CancelModal />
                <div className="page-header">
                    <h1>Clinic Dashboard</h1>
                    <p>Delivery status and incoming shipments for your station.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
                    <div className="stat-card">
                        <div className="stat-label">PENDING REQUESTS</div>
                        <div className="stat-value" style={{ color: pendingRequests.length > 0 ? '#ea580c' : 'inherit' }}>{pendingRequests.length}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">INBOUND SHIPMENTS</div>
                        <div className="stat-value">{inbound.length}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">RECEIVED TODAY</div>
                        <div className="stat-value">{completed.filter(d => new Date(d.createdAt).toDateString() === new Date().toDateString()).length}</div>
                    </div>
                </div>

                {/* Live map ΓÇö only inbound drones */}
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
                    <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
                        <span className="card-header-title"><MapPin size={14} /> Inbound Drone Tracker</span>
                    </div>
                    <CorridorMapShared
                        stations={stations}
                        drones={drones.filter(d => d.status === 'on_route')}
                        deliveries={inbound}
                        lines={lines}
                        height={300}
                        showLines={false}
                    />
                </div>

                {/* Next arrival */}
                {next ? (
                    <div className="card" style={{ marginBottom: 24, padding: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>NEXT ARRIVAL</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: 36, fontWeight: 700 }}>
                                    {countdownHours}<span style={{ color: 'var(--text-tertiary)' }}>:</span>{countdownMinutes}
                                </div>
                            </div>
                            <div style={{ flex: 1, padding: '0 20px', borderLeft: '1px solid var(--border)' }}>
                                <div style={{ fontWeight: 600, fontSize: 15 }}>{next.id} ΓÇö {next.payload}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                                    From {next.origin} ┬╖ Priority: <span className={`badge ${next.priority === 'Emergency' ? 'badge-red' : next.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{next.priority}</span>
                                </div>
                                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, maxWidth: 200, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                                        <div style={{ width: `${next.totalLegs > 0 ? (next.currentLeg / next.totalLegs) * 100 : 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                                    </div>
                                    <span className="mono" style={{ fontSize: 11 }}>Leg {next.currentLeg}/{next.totalLegs}</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <select className="form-input" style={{ width: 80, fontSize: 11, padding: '6px' }} value={lang} onChange={e => setLang(e.target.value)}>
                                    <option value="en">EN</option><option value="fr">FR</option><option value="cr">CR</option>
                                </select>
                                <button className="btn btn-primary" onClick={handleVoiceAlert} disabled={isSpeaking} style={{ fontSize: 12, padding: '6px 12px' }}>
                                    {isSpeaking ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Volume2 size={14} />}
                                </button>
                                <button className="btn btn-primary" onClick={() => updateDeliveryStatus(next.id, 'DELIVERED')} style={{ fontSize: 12, padding: '6px 12px' }}>
                                    <CheckCircle2 size={14} /> Confirm Receipt
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="card" style={{ marginBottom: 24, textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                        <Package size={28} style={{ marginBottom: 8, opacity: 0.3 }} />
                        <div style={{ fontSize: 14, fontWeight: 600 }}>No incoming deliveries</div>
                        <div style={{ fontSize: 13 }}>Landing pad clear. Awaiting dispatch.</div>
                    </div>
                )}

                {/* Recent activity */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="card-header">
                        <span className="card-header-title"><Clock size={14} /> Recent Activity</span>
                    </div>
                    <table className="data-table">
                        <thead><tr><th>Time</th><th>ID</th><th>Payload</th><th>Status</th></tr></thead>
                        <tbody>
                            {myRequests.slice(0, 8).map(d => (
                                <tr key={d.id}>
                                    <td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td>
                                    <td className="mono bold">{d.id}</td>
                                    <td className="bold">{d.payload}</td>
                                    <td><span className={`badge ${statusBadge(d.status)}`}>{statusLabel(d.status)}</span></td>
                                </tr>
                            ))}
                            {myRequests.length === 0 && <tr><td colSpan={4} className="empty-row">No activity yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    /* ΓöÇΓöÇ Request Supplies ΓöÇΓöÇ */
    if (hash === '#request') {
        const handleSubmitRequest = async (e) => {
            e.preventDefault();
            if (!requestText.trim() || isSubmitting) return;
            setIsSubmitting(true);
            setRequestResult(null);
            try {
                const res = await fetch('/api/deliveries/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: requestText.trim(),
                        clinic: 'Chisasibi Health Centre',
                        destination: 'Chisasibi',
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Request failed');
                setRequestResult(data);
                setRequestText('');
                useStore.getState().initializeData(true);
            } catch (err) {
                alert('Error: ' + err.message);
            } finally {
                setIsSubmitting(false);
            }
        };

        return (
            <div>
                <div className="page-header">
                    <h1>Request Supplies</h1>
                    <p>Describe what your clinic needs. Speak or type your request.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
                    <div className="card" style={{ padding: 24 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>DESCRIBE YOUR NEEDS</div>
                        <form onSubmit={handleSubmitRequest}>
                            <div style={{ position: 'relative' }}>
                                <textarea
                                    className="form-input"
                                    style={{ minHeight: 120, resize: 'vertical', paddingRight: 50, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6 }}
                                    placeholder="e.g. We are running low on insulin and need antibiotics for 3 patients. One elder needs blood pressure medication urgently."
                                    value={requestText}
                                    onChange={e => setRequestText(e.target.value)}
                                    disabled={isSubmitting}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (isRecording) {
                                            if (window._sttRecognition) { window._sttRecognition.stop(); window._sttRecognition = null; }
                                            setIsRecording(false);
                                        } else {
                                            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                                            if (!SR) { alert('Speech recognition not supported in this browser.'); return; }
                                            const recognition = new SR();
                                            recognition.continuous = true;
                                            recognition.interimResults = true;
                                            recognition.lang = 'en-US';
                                            let finalTranscript = '';
                                            recognition.onresult = (e) => {
                                                let interim = '';
                                                for (let i = e.resultIndex; i < e.results.length; i++) {
                                                    if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ' ';
                                                    else interim += e.results[i][0].transcript;
                                                }
                                                setRequestText(prev => {
                                                    const base = prev.replace(/\u200b.*$/, '').trim();
                                                    const combined = (base ? base + ' ' : '') + finalTranscript;
                                                    return interim ? combined + '\u200b' + interim : combined.trim();
                                                });
                                            };
                                            recognition.onerror = () => setIsRecording(false);
                                            recognition.onend = () => {
                                                setIsRecording(false);
                                                setRequestText(prev => prev.replace(/\u200b.*$/, '').trim());
                                                window._sttRecognition = null;
                                            };
                                            recognition.start();
                                            window._sttRecognition = recognition;
                                            setIsRecording(true);
                                        }
                                    }}
                                    style={{
                                        position: 'absolute', right: 10, top: 10,
                                        width: 36, height: 36, borderRadius: '50%',
                                        border: 'none', cursor: 'pointer',
                                        background: isRecording ? '#ef4444' : 'var(--accent)',
                                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: isRecording ? '0 0 0 4px rgba(239,68,68,0.25)' : 'none',
                                        transition: 'all 0.2s',
                                    }}
                                    title={isRecording ? 'Stop recording' : 'Start voice input'}
                                >
                                    <Mic size={16} style={{ animation: isRecording ? 'pulse 1s infinite' : 'none' }} />
                                </button>
                            </div>
                            {isRecording && (
                                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                                    Listening... speak now
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                                <button type="submit" className="btn btn-primary" disabled={!requestText.trim() || isSubmitting}>
                                    {isSubmitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Processing...</> : <><Send size={14} /> Submit Request</>}
                                </button>
                            </div>
                        </form>

                        {requestResult && (
                            <div style={{ marginTop: 20, padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>Γ£ô Request Submitted</div>
                                <div style={{ fontSize: 13 }}><strong>{requestResult.id}</strong> ΓÇö {requestResult.payload}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{requestResult.geminiSummary || requestResult.reasoning}</div>
                                <div style={{ fontSize: 12, marginTop: 4 }}>
                                    Priority: <span className={`badge ${requestResult.priority === 'Emergency' ? 'badge-red' : requestResult.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{requestResult.priority}</span>
                                    {' '}Severity: <strong>{requestResult.severityScore}/5</strong>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header">
                            <span className="card-header-title">Pending Requests</span>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pendingRequests.length}</span>
                        </div>
                        <div style={{ padding: 12 }}>
                            {pendingRequests.length === 0 && (
                                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '30px 0', fontSize: 13 }}>No pending requests.</div>
                            )}
                            {pendingRequests.map(r => (
                                <div key={r.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontWeight: 600 }}>{r.id}</span>
                                        <span className={`badge ${r.severityScore >= 4 ? 'badge-red' : 'badge-neutral'}`} style={{ fontSize: 10 }}>Sev {r.severityScore}/5</span>
                                        <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }}
                                            title="Cancel request" onClick={() => setCancelConfirm(r.id)}>
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{r.payload}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <CancelModal />
            </div>
        );
    }

    /* ΓöÇΓöÇ My Requests / Tracking ΓöÇΓöÇ */
    if (hash === '#tracking') {
        return (
            <div>
                <CancelModal />
                <div className="page-header">
                    <h1>My Requests</h1>
                    <p>Track all supply requests and their delivery progress.</p>
                </div>

                {myRequests.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' }}>
                        <Package size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                        <div style={{ fontSize: 14, fontWeight: 600 }}>No requests yet</div>
                        <div style={{ fontSize: 13 }}>Use "Request Supplies" to submit your first request.</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {myRequests.map(r => {
                            const steps = ['REQUESTED', 'PENDING_DISPATCH', 'IN_TRANSIT', 'DELIVERED'];
                            const currentStep = r.status === 'REJECTED' ? -1 : steps.indexOf(r.status);
                            return (
                                <div key={r.id} className="card" style={{ padding: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                        <span className="mono bold" style={{ fontSize: 15 }}>{r.id}</span>
                                        <span className={`badge ${statusBadge(r.status)}`}>{statusLabel(r.status)}</span>
                                        <span className={`badge ${r.priority === 'Emergency' ? 'badge-red' : r.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{r.priority}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>
                                            {new Date(r.createdAt).toLocaleString()}
                                        </span>
                                        {r.status === 'REQUESTED' && (
                                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 10px', color: '#ef4444' }}
                                                onClick={() => setCancelConfirm(r.id)}>
                                                <X size={12} /> Cancel
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{r.payload}</div>
                                    {r.geminiSummary && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{r.geminiSummary}</div>}

                                    {/* Progress stepper */}
                                    {r.status !== 'REJECTED' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 12 }}>
                                            {steps.map((step, i) => (
                                                <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 0 }}>
                                                    <div style={{
                                                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                                        background: i <= currentStep ? 'var(--accent)' : 'var(--border)',
                                                        color: i <= currentStep ? 'white' : 'var(--text-tertiary)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 11, fontWeight: 700,
                                                    }}>
                                                        {i <= currentStep ? 'Γ£ô' : i + 1}
                                                    </div>
                                                    {i < steps.length - 1 && (
                                                        <div style={{ flex: 1, height: 2, background: i < currentStep ? 'var(--accent)' : 'var(--border)', margin: '0 4px' }} />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {r.status !== 'REJECTED' && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                                            <span>Requested</span><span>Approved</span><span>In Transit</span><span>Delivered</span>
                                        </div>
                                    )}
                                    {r.status === 'REJECTED' && (
                                        <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>
                                            This request was not approved by the dispatch team.
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

    /* ΓöÇΓöÇ Inventory ΓöÇΓöÇ */
    if (hash === '#inventory') {
        return (
            <div>
                <div className="page-header">
                    <h1>Received Inventory</h1>
                    <p>Verified deliveries and receipt history.</p>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Received</th><th>Delivery ID</th><th>Payload</th><th>From</th><th>Status</th></tr></thead>
                        <tbody>
                            {completed.map(d => (
                                <tr key={d.id}>
                                    <td className="mono muted">{new Date(d.createdAt).toLocaleString()}</td>
                                    <td className="mono bold">{d.id}</td>
                                    <td className="bold">{d.payload}</td>
                                    <td className="muted">{d.origin}</td>
                                    <td><span className="badge badge-green"><ShieldCheck size={11} style={{ verticalAlign: 'middle' }} /> Verified</span></td>
                                </tr>
                            ))}
                            {completed.length === 0 && (
                                <tr><td colSpan={5} className="empty-row">No deliveries received yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}
