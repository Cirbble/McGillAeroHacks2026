import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { speakText, generateArrivalAlert } from '../services/elevenlabs';
import { Package, Volume2, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';

export default function ReceiverPortal() {
    const { deliveries, updateDeliveryStatus } = useStore();
    const location = useLocation();
    const hash = location.hash || '';
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [lang, setLang] = useState('en');

    const inbound = deliveries.filter(d => (d.status === 'IN_TRANSIT' || d.status === 'HANDOFF') && d.currentLeg > 0).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    const completed = deliveries.filter(d => d.status === 'DELIVERED').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const next = inbound[0];

    const handleVoiceAlert = async () => {
        if (!next) return;
        setIsSpeaking(true);
        try {
            const msg = generateArrivalAlert(next, lang);
            await speakText(msg, lang);
        } catch (err) {
            console.error('ElevenLabs error:', err);
            alert('Voice alert failed: ' + err.message);
        } finally {
            setIsSpeaking(false);
        }
    };

    /* ── Inbound Traffic ── */
    if (hash === '') {
        return (
            <div>
                <div className="page-header">
                    <h1>Inbound Traffic</h1>
                    <p>Monitor real-time payload descents to your clinic landing pad.</p>
                </div>

                <div className="card" style={{ maxWidth: 600, padding: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 48px' }}>
                        {next ? (
                            <>
                                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 28 }}>
                                    <Package size={26} color="var(--text)" />
                                </div>

                                <div className="countdown-display">14<span style={{ color: 'var(--text-tertiary)', opacity: 0.4 }}>:</span>22</div>
                                <div className="countdown-label" style={{ marginTop: 8, marginBottom: 40 }}>Minutes to Pad Arrival</div>

                                <div className="manifest-detail-card" style={{ marginBottom: 28 }}>
                                    <div className="manifest-detail-header">
                                        <span>Manifest</span>
                                        <span className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>{next.id}</span>
                                    </div>
                                    <div className="manifest-detail-row">
                                        <span className="manifest-detail-label">Payload</span>
                                        <span className="manifest-detail-value">{next.payload}</span>
                                    </div>
                                    <div className="manifest-detail-row">
                                        <span className="manifest-detail-label">Origin</span>
                                        <span className="manifest-detail-value">{next.origin}</span>
                                    </div>
                                    <div className="manifest-detail-row">
                                        <span className="manifest-detail-label">Relay Progress</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                                <div style={{ height: '100%', width: `${(next.currentLeg / next.totalLegs) * 100}%`, background: 'var(--accent)', borderRadius: 3 }} />
                                            </div>
                                            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>Leg {next.currentLeg}/{next.totalLegs}</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 20 }}>
                                    {[{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }, { code: 'iu', label: 'ᐃᓄᒃᑎᑐᑦ' }].map(l => (
                                        <button
                                            key={l.code}
                                            className={`toggle-btn ${lang === l.code ? 'active' : ''}`}
                                            onClick={() => setLang(l.code)}
                                            style={{ padding: '6px 14px', fontSize: 12 }}
                                        >
                                            {l.label}
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 420 }}>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ flex: 1, padding: 14 }}
                                        onClick={handleVoiceAlert}
                                        disabled={isSpeaking}
                                    >
                                        {isSpeaking ? (
                                            <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Speaking…</>
                                        ) : (
                                            <><Volume2 size={16} /> Voice Alert</>
                                        )}
                                    </button>
                                    <button className="btn btn-primary" style={{ flex: 1, padding: 14 }} onClick={() => updateDeliveryStatus(next.id, 'DELIVERED')}>
                                        <CheckCircle2 size={16} /> Confirm Receipt
                                    </button>
                                </div>

                                {isSpeaking && (
                                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Volume2 size={14} /> ElevenLabs is narrating the arrival alert…
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <Package size={48} style={{ color: 'var(--border)', marginBottom: 16 }} />
                                <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>No Inbound Flights</h2>
                                <p style={{ maxWidth: 300, margin: '0 auto', fontSize: 13 }}>Landing pad clear. Awaiting dispatch from Chibougamau Hub.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    /* ── Secured Inventory ── */
    if (hash === '#inventory') {
        return (
            <div>
                <div className="page-header">
                    <h1>Secured Inventory</h1>
                    <p>Historical delivery receipts and verification log.</p>
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
                                    <td><span className="badge badge-green">Verified</span></td>
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
