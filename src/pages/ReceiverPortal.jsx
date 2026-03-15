import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { speakText, stopSpeaking, generateArrivalAlert } from '../services/elevenlabs';
import CorridorMapShared from '../components/CorridorMap';
import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    MapPin,
    Mic,
    Package,
    Send,
    ShieldCheck,
    Sparkles,
    Volume2,
    X,
} from 'lucide-react';

const FINAL_STATUSES = ['DELIVERED', 'REJECTED', 'CANCELLED'];
const ACTIVE_TRANSIT_STATUSES = ['IN_TRANSIT', 'HANDOFF', 'REROUTED', 'WEATHER_HOLD', 'ARRIVED'];

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

function statusLabel(status) {
    return {
        REQUESTED: 'Awaiting Dispatch Review',
        AWAITING_REVIEW: 'Under Review',
        PENDING_DISPATCH: 'Approved for Queue',
        READY_TO_LAUNCH: 'Queued for Launch',
        IN_TRANSIT: 'In Transit',
        HANDOFF: 'Relay Handoff',
        WEATHER_HOLD: 'Weather Hold',
        REROUTED: 'Rerouted',
        ARRIVED: 'Arrived — Confirm Receipt',
        DELIVERED: 'Delivered',
        REJECTED: 'Rejected',
        CANCELLED: 'Cancelled',
    }[status] || status;
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

function isSameCalendarDay(left, right) {
    const leftDate = toValidDate(left);
    const rightDate = toValidDate(right);
    return Boolean(leftDate && rightDate && leftDate.toDateString() === rightDate.toDateString());
}

function getDraftStorageKey(email) {
    return `aeroed.receiver.draft.${email || 'default'}`;
}

function readStoredDraft(email) {
    if (typeof window === 'undefined') return { prompt: '', preview: null, lang: 'en' };
    try {
        const raw = window.localStorage.getItem(getDraftStorageKey(email));
        if (!raw) return { prompt: '', preview: null, lang: 'en' };
        const parsed = JSON.parse(raw);
        return {
            prompt: typeof parsed?.prompt === 'string' ? parsed.prompt : '',
            preview: parsed?.preview && typeof parsed.preview === 'object' ? parsed.preview : null,
            lang: ['en', 'fr', 'iu'].includes(parsed?.lang) ? parsed.lang : 'en',
        };
    } catch {
        return { prompt: '', preview: null, lang: 'en' };
    }
}

function persistDraft(email, prompt, preview, lang) {
    if (typeof window === 'undefined') return;
    const storageKey = getDraftStorageKey(email);
    if (!prompt.trim() && !preview) {
        window.localStorage.removeItem(storageKey);
        return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify({ prompt, preview, lang }));
}

function buildPreviewNarration(preview, lang = 'en') {
    if (!preview) return '';
    if (lang === 'fr') {
        return [
            `Apercu de la demande pour ${preview.destination}.`,
            `Contenu: ${preview.payload}.`,
            `Priorite: ${preview.priority}.`,
            preview.geminiSummary || preview.reasoning || '',
            preview.clinicNotes ? `Notes: ${preview.clinicNotes}.` : '',
        ].filter(Boolean).join(' ');
    }
    if (lang === 'iu') {
        return [
            `${preview.destination} tukisinnaujuq takunnaqtaugiaqtuq.`,
            `Uumajuq: ${preview.payload}.`,
            `Piujuqtut: ${preview.priority}.`,
            preview.geminiSummary || preview.reasoning || '',
            preview.clinicNotes ? `Titiraqsimajut: ${preview.clinicNotes}.` : '',
        ].filter(Boolean).join(' ');
    }
    return [
        `Request preview for ${preview.destination}.`,
        `Payload: ${preview.payload}.`,
        `Priority: ${preview.priority}.`,
        preview.geminiSummary || preview.reasoning || '',
        preview.clinicNotes ? `Notes: ${preview.clinicNotes}.` : '',
    ].filter(Boolean).join(' ');
}

function getCurrentStep(status) {
    if (status === 'DELIVERED') return 5;
    if (status === 'ARRIVED') return 4;
    if (status === 'CANCELLED' || status === 'REJECTED') return -1;
    if (['REQUESTED', 'AWAITING_REVIEW'].includes(status)) return 1;
    if (['PENDING_DISPATCH', 'READY_TO_LAUNCH'].includes(status)) return 2;
    return 3;
}

function getSpeechRecognitionLocale(lang) {
    return {
        en: 'en-US',
        fr: 'fr-CA',
        iu: 'iu-Cans-CA',
    }[lang] || 'en-US';
}

function RequestTimeline({ status }) {
    if (status === 'REJECTED' || status === 'CANCELLED') return null;
    const currentStep = getCurrentStep(status);
    const labels = ['Drafted', 'Reviewed', 'Queued', 'Transit', 'Arrived', 'Confirmed'];

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 14 }}>
                {labels.map((label, index) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', flex: index < labels.length - 1 ? 1 : 0 }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: index < currentStep ? 'var(--accent)' : 'var(--border)', color: index < currentStep ? 'white' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                            {index < currentStep ? 'OK' : index + 1}
                        </div>
                        {index < labels.length - 1 && <div style={{ flex: 1, height: 2, background: index + 1 < currentStep ? 'var(--accent)' : 'var(--border)', margin: '0 4px' }} />}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                {labels.map((label) => <span key={label}>{label}</span>)}
            </div>
        </>
    );
}

export default function ReceiverPortal({ user }) {
    const {
        deliveries,
        stations,
        drones,
        lines,
        previewSupplyRequest,
        createSupplyRequest,
        cancelDelivery,
        updateDeliveryStatus,
    } = useStore();
    const location = useLocation();
    const hash = location.hash || '';
    const receiverEmail = user?.email || 'user@gmail.com';
    const receiverStation = user?.stationId || 'Chisasibi';
    const clinicName = user?.clinic || 'Chisasibi Health Centre';
    const requesterName = user?.name || clinicName;

    const initialDraft = readStoredDraft(receiverEmail);
    const [lang, setLang] = useState(initialDraft.lang);
    const [requestPrompt, setRequestPrompt] = useState(initialDraft.prompt);
    const [draftPreview, setDraftPreview] = useState(initialDraft.preview);
    const [isRecording, setIsRecording] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [requestError, setRequestError] = useState(null);
    const [requestResult, setRequestResult] = useState(null);
    const [cancelConfirm, setCancelConfirm] = useState(null);
    const announcedDeliveryRef = useRef(null);

    useEffect(() => {
        const interval = setInterval(() => useStore.getState().initializeData(true), 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        persistDraft(receiverEmail, requestPrompt, draftPreview, lang);
    }, [draftPreview, lang, receiverEmail, requestPrompt]);

    const relatedDeliveries = deliveries
        .filter((delivery) => (
            delivery.requestedByEmail === receiverEmail
            || delivery.destination === receiverStation
        ))
        .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    const inbound = relatedDeliveries
        .filter((delivery) => ACTIVE_TRANSIT_STATUSES.includes(delivery.status))
        .sort((a, b) => toTimestamp(a.eta, Number.POSITIVE_INFINITY) - toTimestamp(b.eta, Number.POSITIVE_INFINITY));
    const pendingDispatcherRequests = relatedDeliveries.filter((delivery) => ['REQUESTED', 'AWAITING_REVIEW'].includes(delivery.status));
    const currentRequests = relatedDeliveries.filter((delivery) => delivery.status !== 'DELIVERED');
    const deliveredHistory = relatedDeliveries
        .filter((delivery) => delivery.status === 'DELIVERED')
        .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
    const nextDelivery = inbound[0] || null;
    const minutesToArrival = nextDelivery ? Math.max(0, Math.ceil((toTimestamp(nextDelivery.eta, Date.now()) - Date.now()) / 60000)) : 0;
    const inboundDroneIds = new Set(inbound.map((delivery) => delivery.assignedDrone).filter(Boolean));
    const inboundDrones = drones.filter((drone) => inboundDroneIds.has(drone.id) || inboundDroneIds.has(drone.assignment));
    const openRequestCount = pendingDispatcherRequests.length + (draftPreview ? 1 : 0);

    useEffect(() => {
        if (!nextDelivery || minutesToArrival > 15 || announcedDeliveryRef.current === nextDelivery.id) return;
        announcedDeliveryRef.current = nextDelivery.id;
        speakText(generateArrivalAlert(nextDelivery, lang), lang).catch(() => { });
    }, [nextDelivery, minutesToArrival, lang]);

    const handleVoiceAlert = async () => {
        if (!nextDelivery) return;
        if (isSpeaking) { stopSpeaking(); setIsSpeaking(false); return; }
        setIsSpeaking(true);
        try {
            await speakText(generateArrivalAlert(nextDelivery, lang), lang);
        } finally {
            setIsSpeaking(false);
        }
    };

    const handleCancelDelivery = async () => {
        if (!cancelConfirm) return;
        try {
            await cancelDelivery(cancelConfirm);
            setCancelConfirm(null);
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    };

    const clearDraft = () => {
        setRequestPrompt('');
        setDraftPreview(null);
        setRequestError(null);
        setRequestResult(null);
        persistDraft(receiverEmail, '', null, lang);
    };

    const toggleRecording = () => {
        if (isRecording) {
            if (window._sttRecognition) {
                window._sttRecognition.stop();
                window._sttRecognition = null;
            }
            setIsRecording(false);
            return;
        }

        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            alert('Speech recognition is not supported in this browser.');
            return;
        }

        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = getSpeechRecognitionLocale(lang);
        recognition.onresult = (event) => {
            let newFinal = '';
            let interimTranscript = '';
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                if (event.results[index].isFinal) {
                    newFinal += `${event.results[index][0].transcript} `;
                } else {
                    interimTranscript += event.results[index][0].transcript;
                }
            }

            setRequestPrompt((previous) => {
                const base = previous.replace(/\u200b.*$/, '').trim();
                const withNew = newFinal ? `${base}${base ? ' ' : ''}${newFinal}`.trim() : base;
                return interimTranscript ? `${withNew}\u200b${interimTranscript}` : withNew;
            });
        };

        recognition.onerror = () => setIsRecording(false);
        recognition.onend = () => {
            setIsRecording(false);
            setRequestPrompt((previous) => previous.replace(/\u200b.*$/, '').trim());
            window._sttRecognition = null;
        };

        recognition.start();
        window._sttRecognition = recognition;
        setIsRecording(true);
    };

    const generatePreview = async (event) => {
        event.preventDefault();
        if (!requestPrompt.trim() || isGeneratingPreview) return;
        setIsGeneratingPreview(true);
        setRequestError(null);
        setRequestResult(null);
        try {
            const preview = await previewSupplyRequest({
                prompt: requestPrompt.trim(),
                clinic: clinicName,
                destination: receiverStation,
                requestedBy: requesterName,
                requestedByEmail: receiverEmail,
                language: lang,
            });
            setDraftPreview(preview);
        } catch (err) {
            setRequestError(err.message);
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    const submitConfirmedRequest = async () => {
        if (!draftPreview || isSubmitting) return;
        setIsSubmitting(true);
        setRequestError(null);
        try {
            const created = await createSupplyRequest({
                ...draftPreview,
                sourceText: requestPrompt.trim(),
                clinic: clinicName,
                destination: draftPreview.destination || receiverStation,
                requestedBy: requesterName,
                requestedByEmail: receiverEmail,
                status: 'REQUESTED',
                language: lang,
            });
            clearDraft();
            setRequestResult(created);
        } catch (err) {
            setRequestError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const speakPreview = async () => {
        if (!draftPreview) return;
        if (isSpeaking) { stopSpeaking(); setIsSpeaking(false); return; }
        setIsSpeaking(true);
        try {
            await speakText(buildPreviewNarration(draftPreview, lang), lang);
        } finally {
            setIsSpeaking(false);
        }
    };

    const CancelModal = () => {
        if (!cancelConfirm) return null;
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setCancelConfirm(null)}>
                <div className="card" style={{ width: 400, padding: 24 }} onClick={(event) => event.stopPropagation()}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cancel request?</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>This will remove request {cancelConfirm} from the active queue.</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button className="btn btn-secondary" onClick={() => setCancelConfirm(null)}>Keep Request</button>
                        <button className="btn" style={{ background: '#ef4444', color: 'white', border: 'none' }} onClick={handleCancelDelivery}>Cancel Request</button>
                    </div>
                </div>
            </div>
        );
    };

    if (hash === '') {
        return (
            <div>
                <CancelModal />
                <div className="page-header"><h1>Clinic Dashboard</h1><p>Delivery status and incoming shipments for {clinicName}.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 24 }}>
                    <div className="stat-card"><div className="stat-label">INCOMING DELIVERIES</div><div className="stat-value">{inbound.length}</div></div>
                    <div className="stat-card"><div className="stat-label">DELIVERED TODAY</div><div className="stat-value">{deliveredHistory.filter((delivery) => isSameCalendarDay(delivery.createdAt, new Date())).length}</div></div>
                    <div className="stat-card"><div className="stat-label">OPEN REQUESTS</div><div className="stat-value" style={{ color: openRequestCount ? '#ea580c' : 'inherit' }}>{openRequestCount}</div></div>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
                    <div className="card-header"><span className="card-header-title"><MapPin size={14} /> Inbound Drone Tracker</span></div>
                    <CorridorMapShared stations={stations} drones={inboundDrones} deliveries={inbound} lines={lines} height={440} showLines={false} />
                </div>
                {nextDelivery ? (
                    <div className="card" style={{ marginBottom: 24, padding: 24 }}>
                        {nextDelivery.status === 'ARRIVED' ? (
                            <div style={{ marginBottom: 14, padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#15803d', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                                <span><strong>Payload has arrived.</strong> Please inspect the shipment and confirm receipt to finalize delivery.</span>
                            </div>
                        ) : minutesToArrival <= 15 && (
                            <div style={{ marginBottom: 14, padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, color: '#9a3412', fontSize: 12, display: 'flex', gap: 8 }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                                <span>Arrival alert: this shipment is within 15 minutes. Audio notification is enabled when supported.</span>
                            </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{nextDelivery.status === 'ARRIVED' ? 'ARRIVED' : 'NEXT ARRIVAL'}</div>
                                <div className="mono" style={{ fontSize: 34, fontWeight: 700 }}>{nextDelivery.status === 'ARRIVED' ? '00:00' : `${String(Math.floor(minutesToArrival / 60)).padStart(2, '0')}:${String(minutesToArrival % 60).padStart(2, '0')}`}</div>
                            </div>
                            <div style={{ flex: 1, minWidth: 240 }}>
                                <div style={{ fontWeight: 600 }}>{nextDelivery.id} | {nextDelivery.payload}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>From {nextDelivery.origin} | <span className={`badge ${statusBadge(nextDelivery.status)}`}>{statusLabel(nextDelivery.status)}</span></div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <select className="form-input" style={{ width: 90, fontSize: 11, padding: '6px' }} value={lang} onChange={(event) => setLang(event.target.value)}>
                                    <option value="en">EN</option>
                                    <option value="fr">FR</option>
                                    <option value="iu">IU</option>
                                </select>
                                <button className="btn btn-primary" onClick={handleVoiceAlert}>{isSpeaking ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Volume2 size={14} />}</button>
                            </div>
                        </div>
                        {nextDelivery.status === 'ARRIVED' && (
                            <button
                                className="btn btn-primary"
                                onClick={() => updateDeliveryStatus(nextDelivery.id, 'DELIVERED')}
                                style={{ marginTop: 16, width: '100%', padding: '14px 20px', fontSize: 15, fontWeight: 700, background: '#16a34a' }}
                            >
                                <CheckCircle2 size={18} /> Confirm Receipt — Mark as Delivered
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="card" style={{ marginBottom: 24, textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}><Package size={28} style={{ marginBottom: 8, opacity: 0.3 }} /><div>No incoming deliveries.</div></div>
                )}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="card-header"><span className="card-header-title">Recent Activity</span></div>
                    <table className="data-table">
                        <thead><tr><th>Time</th><th>ID</th><th>Payload</th><th>Status</th></tr></thead>
                        <tbody>
                            {relatedDeliveries.slice(0, 8).map((delivery) => (
                                <tr key={delivery.id}>
                                    <td className="mono muted">{formatDateTime(delivery.createdAt)}</td>
                                    <td className="mono bold">{delivery.id}</td>
                                    <td className="bold">{delivery.payload}</td>
                                    <td><span className={`badge ${statusBadge(delivery.status)}`}>{statusLabel(delivery.status)}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (hash === '#request') {
        return (
            <div>
                <CancelModal />
                <div className="page-header"><h1>Request Supplies</h1><p>Describe what the clinic needs in natural language, review the AI draft, then confirm before dispatch sees it.</p></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16 }}>
                    <div className="card" style={{ padding: 24 }}>
                        <form onSubmit={generatePreview}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                                <div>
                                    <div className="form-label" style={{ marginBottom: 4 }}>Request language</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Generation, dictation, and read-back will use this language.</div>
                                </div>
                                <select className="form-input" style={{ width: 120, margin: 0 }} value={lang} onChange={(event) => setLang(event.target.value)}>
                                    <option value="en">English</option>
                                    <option value="fr">Francais</option>
                                    <option value="iu">Inuktitut</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <label className="form-label" style={{ marginBottom: 0 }}>What do you need?</label>
                                <button type="button" onClick={toggleRecording} style={{ border: 'none', borderRadius: 999, padding: '8px 12px', background: isRecording ? '#ef4444' : 'var(--accent-light)', color: isRecording ? 'white' : 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <Mic size={14} /> {isRecording ? 'Stop recording' : 'Use speech'}
                                </button>
                            </div>
                            <textarea className="form-input" style={{ minHeight: 160, resize: 'vertical' }} value={requestPrompt} onChange={(event) => setRequestPrompt(event.target.value)} placeholder="Example: We need insulated blood products for two trauma patients tonight, plus backup IV fluids. Keep cold-chain handling and arrival before 22:00 if possible." />
                            {isRecording && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>Listening...</div>}
                            {requestError && <div className="info-box" style={{ marginTop: 16, background: 'var(--danger-light)', borderColor: '#fca5a5', color: 'var(--danger)' }}>{requestError}</div>}
                            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                                <button type="submit" className="btn btn-primary" disabled={!requestPrompt.trim() || isGeneratingPreview}>
                                    {isGeneratingPreview ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating preview...</> : <><Sparkles size={14} /> Generate AI Preview</>}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={clearDraft} disabled={!requestPrompt.trim() && !draftPreview}>Clear Draft</button>
                            </div>
                        </form>

                        {draftPreview && (
                            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                                    <span className="badge badge-amber">Draft awaiting confirmation</span>
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nothing is sent to dispatch until you confirm.</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Payload</label>
                                        <input className="form-input" value={draftPreview.payload || ''} onChange={(event) => setDraftPreview((current) => ({ ...current, payload: event.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="form-label">Priority</label>
                                        <select className="form-input" value={draftPreview.priority || 'Routine'} onChange={(event) => setDraftPreview((current) => ({ ...current, priority: event.target.value }))}>
                                            <option value="Routine">Routine</option>
                                            <option value="Urgent">Urgent</option>
                                            <option value="Emergency">Emergency</option>
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                                    <div>
                                        <label className="form-label">Origin</label>
                                        <input className="form-input" value={draftPreview.origin || ''} onChange={(event) => setDraftPreview((current) => ({ ...current, origin: event.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="form-label">Destination</label>
                                        <input className="form-input" value={draftPreview.destination || ''} onChange={(event) => setDraftPreview((current) => ({ ...current, destination: event.target.value }))} />
                                    </div>
                                </div>
                                <label className="form-label">Dispatcher Summary</label>
                                <textarea className="form-input" style={{ minHeight: 90, resize: 'vertical', marginBottom: 16 }} value={draftPreview.geminiSummary || draftPreview.reasoning || ''} onChange={(event) => setDraftPreview((current) => ({ ...current, geminiSummary: event.target.value }))} />
                                <label className="form-label">Handling Notes</label>
                                <textarea className="form-input" style={{ minHeight: 90, resize: 'vertical' }} value={draftPreview.clinicNotes || ''} onChange={(event) => setDraftPreview((current) => ({ ...current, clinicNotes: event.target.value }))} />

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 16 }}>
                                    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Estimated Route</div>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{draftPreview.route?.length > 1 ? `${draftPreview.route.length - 1} legs` : 'Pending'}</div>
                                    </div>
                                    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>ETA</div>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{draftPreview.estimatedTime || 'Pending'}</div>
                                    </div>
                                    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Route State</div>
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{draftPreview.routeState || 'CLEAR'}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                                    <button type="button" className="btn btn-primary" onClick={submitConfirmedRequest} disabled={!draftPreview.payload?.trim() || isSubmitting}>
                                        {isSubmitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending...</> : <><Send size={14} /> Confirm and Send to Dispatch</>}
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={speakPreview}>
                                        {isSpeaking ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Volume2 size={14} />} Read Back
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setDraftPreview(null)}>Edit Prompt</button>
                                    <button type="button" className="btn btn-secondary" style={{ color: '#ef4444' }} onClick={clearDraft}>Cancel Draft</button>
                                </div>
                            </div>
                        )}

                        {requestResult && (
                            <div style={{ marginTop: 20, padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                                <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>Request Sent to Dispatch</div>
                                <div><strong>{requestResult.id}</strong> | {requestResult.payload}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{requestResult.geminiSummary || requestResult.reasoning}</div>
                            </div>
                        )}
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="card-header"><span className="card-header-title">Open Requests</span><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{openRequestCount}</span></div>
                        <div style={{ padding: 12, display: 'grid', gap: 10 }}>
                            {draftPreview && (
                                <div style={{ padding: '12px 14px', border: '1px solid #fed7aa', borderRadius: 10, background: '#fff7ed' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span className="badge badge-amber">Needs confirmation</span>
                                        <span style={{ fontSize: 11, color: '#9a3412' }}>Local draft only</span>
                                    </div>
                                    <div style={{ fontWeight: 600 }}>{draftPreview.payload}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{draftPreview.geminiSummary || 'Review and confirm before sending.'}</div>
                                </div>
                            )}
                            {pendingDispatcherRequests.map((request) => (
                                <div key={request.id} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                        <span className="mono bold">{request.id}</span>
                                        <span className={`badge ${statusBadge(request.status)}`}>{statusLabel(request.status)}</span>
                                        <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }} onClick={() => setCancelConfirm(request.id)}><X size={14} /></button>
                                    </div>
                                    <div style={{ fontWeight: 600 }}>{request.payload}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{request.geminiSummary || request.reasoning}</div>
                                </div>
                            ))}
                            {openRequestCount === 0 && <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '30px 0', fontSize: 13 }}>No open requests.</div>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (hash === '#tracking' || hash === '#requests') {
        return (
            <div>
                <CancelModal />
                <div className="page-header"><h1>Current Requests</h1><p>Track approvals, queueing, weather holds, and any cancelled or rejected requests that have not been delivered.</p></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {currentRequests.map((delivery) => (
                        <div key={delivery.id} className="card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                                <span className="mono bold">{delivery.id}</span>
                                <span className={`badge ${statusBadge(delivery.status)}`}>{statusLabel(delivery.status)}</span>
                                <span className={`badge ${delivery.priority === 'Emergency' ? 'badge-red' : delivery.priority === 'Urgent' ? 'badge-amber' : 'badge-neutral'}`}>{delivery.priority}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)' }}>{formatDateTime(delivery.createdAt)}</span>
                                {!FINAL_STATUSES.includes(delivery.status) && <button className="btn btn-secondary" style={{ color: '#ef4444' }} onClick={() => setCancelConfirm(delivery.id)}><X size={12} /> Cancel</button>}
                            </div>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{delivery.payload}</div>
                            {(delivery.geminiSummary || delivery.reasoning) && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{delivery.geminiSummary || delivery.reasoning}</div>}
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{delivery.origin} to {delivery.destination}</div>
                            {delivery.clinicNotes && <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>{delivery.clinicNotes}</div>}
                            <RequestTimeline status={delivery.status} />
                            {delivery.status === 'REJECTED' && <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#dc2626' }}>This request was not approved by dispatch.</div>}
                            {delivery.status === 'CANCELLED' && <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>This request was cancelled before completion.</div>}
                        </div>
                    ))}
                    {currentRequests.length === 0 && <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)' }}><Package size={32} style={{ marginBottom: 12, opacity: 0.3 }} /><div>No active requests right now.</div></div>}
                </div>
            </div>
        );
    }

    if (hash === '#history') {
        return (
            <div>
                <div className="page-header"><h1>Request History</h1><p>Delivered requests for {clinicName}.</p></div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Delivered</th><th>ID</th><th>Payload</th><th>Route</th><th>Status</th></tr></thead>
                        <tbody>
                            {deliveredHistory.map((delivery) => (
                                <tr key={delivery.id}>
                                    <td className="mono muted">{formatDateTime(delivery.createdAt)}</td>
                                    <td className="mono bold">{delivery.id}</td>
                                    <td className="bold">{delivery.payload}</td>
                                    <td className="muted">{delivery.origin} to {delivery.destination}</td>
                                    <td><span className="badge badge-green">{statusLabel(delivery.status)}</span></td>
                                </tr>
                            ))}
                            {deliveredHistory.length === 0 && <tr><td colSpan={5} className="empty-row">No delivered requests yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    if (hash === '#inventory') {
        return (
            <div>
                <div className="page-header"><h1>Received Inventory</h1><p>Delivered manifests for {clinicName}.</p></div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead><tr><th>Received</th><th>Delivery ID</th><th>Payload</th><th>From</th><th>Status</th></tr></thead>
                        <tbody>
                            {deliveredHistory.map((delivery) => (
                                <tr key={delivery.id}>
                                    <td className="mono muted">{formatDateTime(delivery.createdAt)}</td>
                                    <td className="mono bold">{delivery.id}</td>
                                    <td className="bold">{delivery.payload}</td>
                                    <td className="muted">{delivery.origin}</td>
                                    <td><span className="badge badge-green"><ShieldCheck size={11} style={{ verticalAlign: 'middle' }} /> Verified</span></td>
                                </tr>
                            ))}
                            {deliveredHistory.length === 0 && <tr><td colSpan={5} className="empty-row">No deliveries received yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return null;
}
