import { useNavigate, useLocation } from 'react-router-dom';
import { Layers, LogOut, Code, Database } from 'lucide-react';

export default function Navbar({ user, setUser }) {
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = () => {
        setUser(null);
        navigate('/');
    };

    const getBreadcrumb = () => {
        if (location.pathname === '/admin') return 'Platform Operations';
        if (location.pathname === '/distributor') return 'Pharmacy Dispatch';
        if (location.pathname === '/receiver') return 'Clinic Receiving';
        return '';
    };

    return (
        <nav style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 2rem',
            height: '64px',
            background: 'var(--bg-color)',
            borderBottom: '1px solid var(--border-light)',
            position: 'sticky',
            top: 0,
            zIndex: 100
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                    <Layers size={20} />
                    <span style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.125rem' }}>Aero'ed</span>
                </div>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-strong)' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    <span>{user.name}</span>
                    <span style={{ color: 'var(--border-strong)' }}>/</span>
                    <span style={{ color: 'var(--text-primary)' }}>{getBreadcrumb()}</span>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <span className="sponsor-tag" title="Sponsor Integration"><Code size={12} /> GEMINI</span>
                    <span className="sponsor-tag" title="Sponsor Integration"><Database size={12} /> ATLAS</span>
                </div>

                <div style={{ width: '1px', height: '24px', background: 'var(--border-strong)' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="status-badge success"><span className="animate-pulse" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', marginRight: 6 }}></span>SYSTEM NORMAL</span>

                    <button onClick={handleLogout} className="btn-secondary" style={{ padding: '0.4rem', border: 'none' }} title="Sign Out">
                        <LogOut size={16} />
                    </button>
                </div>
            </div>
        </nav>
    );
}
