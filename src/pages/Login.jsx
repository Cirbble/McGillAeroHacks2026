import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Send, Package, ArrowRight, LogIn, AlertCircle } from 'lucide-react';

const DEMO_ACCOUNTS = [
    { email: 'admin@aeroed.ca', password: 'admin', role: 'admin', name: 'Marc-André Lemaire', title: 'Platform Operations' },
    { email: 'dispatch@aeroed.ca', password: 'dispatch', role: 'distributor', name: 'Sophie Tremblay', title: 'Pharmacy Dispatch' },
    { email: 'clinic@aeroed.ca', password: 'clinic', role: 'receiver', name: 'Dr. Elise Kanatewat', title: 'Clinic Receiver — Chisasibi' },
];

export default function Login({ setUser }) {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        // Simulate network delay
        await new Promise(r => setTimeout(r, 600));

        const account = DEMO_ACCOUNTS.find(a => a.email === email.toLowerCase().trim() && a.password === password);
        if (!account) {
            setError('Invalid credentials. Check the demo accounts below.');
            setIsLoading(false);
            return;
        }

        setUser({ role: account.role, name: account.name, email: account.email, title: account.title });
        navigate(`/${account.role}`);
    };

    const quickLogin = (account) => {
        setEmail(account.email);
        setPassword(account.password);
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
                    <p>Bridging the healthcare gap in remote Northern Quebec communities with intelligent dispatch, real-time fleet orchestration, and immutable custody ledgers.</p>
                </div>
                <div className="login-brand-footer">Aero'ed Health Platform v1.2 &bull; Secure Environment</div>
            </div>

            <div className="login-form-side">
                <div className="login-form-inner">
                    <h2>Sign In</h2>
                    <p>Enter your credentials to access the platform.</p>

                    <form onSubmit={handleSubmit} style={{ marginTop: 28 }}>
                        <div style={{ marginBottom: 16 }}>
                            <label className="form-label">Email</label>
                            <input
                                type="email"
                                className="form-input"
                                placeholder="you@aeroed.ca"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div style={{ marginBottom: 24 }}>
                            <label className="form-label">Password</label>
                            <input
                                type="password"
                                className="form-input"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>

                        {error && (
                            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--danger-light)', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AlertCircle size={15} /> {error}
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: 14, fontSize: 14 }} disabled={isLoading}>
                            {isLoading ? 'Authenticating…' : <><LogIn size={16} /> Sign In</>}
                        </button>
                    </form>

                    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 12 }}>Demo Accounts</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {DEMO_ACCOUNTS.map(a => (
                                <button
                                    key={a.email}
                                    className="portal-btn"
                                    onClick={() => quickLogin(a)}
                                    type="button"
                                >
                                    <div className="portal-btn-left">
                                        <div className="portal-btn-icon" style={{ background: a.role === 'admin' ? '#f1f5f9' : a.role === 'distributor' ? '#eff6ff' : '#ecfdf5' }}>
                                            {a.role === 'admin' ? <Shield size={18} color="#0f172a" /> : a.role === 'distributor' ? <Send size={18} color="#2563eb" /> : <Package size={18} color="#059669" />}
                                        </div>
                                        <div className="portal-btn-text">
                                            <div className="portal-btn-title">{a.name}</div>
                                            <div className="portal-btn-desc">{a.email} &middot; {a.title}</div>
                                        </div>
                                    </div>
                                    <ArrowRight size={14} color="#94a3b8" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
