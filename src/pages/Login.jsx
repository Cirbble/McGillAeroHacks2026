import { useNavigate } from 'react-router-dom';
import { Shield, Send, Package, ArrowRight } from 'lucide-react';

export default function Login({ setUser }) {
    const navigate = useNavigate();

    const handleLogin = (role) => {
        const names = { admin: 'Admin', distributor: 'Distributor', receiver: 'Receiver' };
        setUser({ role, name: names[role] });
        navigate(`/${role}`);
    };

    return (
        <div className="login-shell">
            <div className="login-brand">
                <div>
                    <div className="sidebar-brand" style={{ marginBottom: 48 }}>
                        <div className="sidebar-brand-icon"><div className="sidebar-brand-icon-inner" /></div>
                        <span className="sidebar-brand-name">Aero'ed</span>
                    </div>
                    <h1>Logistics engine<br /><strong>for medical drone<br />corridors.</strong></h1>
                    <p>Bridging the healthcare gap in remote communities with intelligent dispatch, real-time fleet orchestration, and immutable custody ledgers.</p>
                </div>
                <div className="login-brand-footer">Aero'ed Health Platform v1.2 &bull; Secure Environment</div>
            </div>

            <div className="login-form-side">
                <div className="login-form-inner">
                    <h2>Select Portal Identity</h2>
                    <p>Authenticate to access your assigned operational view.</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <button className="portal-btn" onClick={() => handleLogin('admin')}>
                            <div className="portal-btn-left">
                                <div className="portal-btn-icon" style={{ background: '#f1f5f9' }}><Shield size={20} color="#0f172a" /></div>
                                <div className="portal-btn-text">
                                    <div className="portal-btn-title">Platform Operations</div>
                                    <div className="portal-btn-desc">Admin &middot; Fleet routing &middot; Infrastructure</div>
                                </div>
                            </div>
                            <ArrowRight size={16} color="#94a3b8" />
                        </button>

                        <button className="portal-btn" onClick={() => handleLogin('distributor')}>
                            <div className="portal-btn-left">
                                <div className="portal-btn-icon" style={{ background: '#eff6ff' }}><Send size={20} color="#2563eb" /></div>
                                <div className="portal-btn-text">
                                    <div className="portal-btn-title">Pharmacy Dispatch</div>
                                    <div className="portal-btn-desc">Create manifests &middot; AI routing engine</div>
                                </div>
                            </div>
                            <ArrowRight size={16} color="#94a3b8" />
                        </button>

                        <button className="portal-btn" onClick={() => handleLogin('receiver')}>
                            <div className="portal-btn-left">
                                <div className="portal-btn-icon" style={{ background: '#ecfdf5' }}><Package size={20} color="#059669" /></div>
                                <div className="portal-btn-text">
                                    <div className="portal-btn-title">Clinic Receiver</div>
                                    <div className="portal-btn-desc">Inbound traffic &middot; Secure inventory pad</div>
                                </div>
                            </div>
                            <ArrowRight size={16} color="#94a3b8" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
