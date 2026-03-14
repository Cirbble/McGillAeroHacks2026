import { useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Radio, Server, Activity, Send, FolderLock, Inbox, Package, LogOut } from 'lucide-react';
import { useStore } from '../store';

export default function Layout({ user, setUser, children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const hash = location.hash || '';
    const initializeData = useStore((state) => state.initializeData);

    const handleLogout = () => { setUser(null); navigate('/'); };

    useEffect(() => {
        initializeData().catch((err) => {
            console.error('Failed to initialize application data:', err);
        });
    }, [initializeData]);

    const navConfig = {
        admin: [
            { name: 'Platform Overview', hash: '', icon: LayoutDashboard },
            { name: 'Live Operations', hash: '#operations', icon: Radio },
            { name: 'Infrastructure', hash: '#infrastructure', icon: Server },
            { name: 'Analytics', hash: '#analytics', icon: Activity },
        ],
        distributor: [
            { name: 'Dispatch Console', hash: '', icon: Send },
            { name: 'Custody Ledger', hash: '#ledger', icon: FolderLock },
            { name: 'Routing History', hash: '#history', icon: Inbox },
        ],
        receiver: [
            { name: 'Inbound Traffic', hash: '', icon: Radio },
            { name: 'Secured Inventory', hash: '#inventory', icon: Package },
        ],
    };

    const links = navConfig[user.role] || [];
    const moduleLabel = { admin: 'Platform Operations', distributor: 'Pharmacy Distribution', receiver: 'Clinic Receiver' }[user.role];
    const currentLink = links.find(l => l.hash === hash) || links[0];

    return (
        <div className="app-shell">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <div className="sidebar-brand-icon"><div className="sidebar-brand-icon-inner" /></div>
                    <span className="sidebar-brand-name">Aero'ed</span>
                </div>

                <div className="sidebar-section-label">{moduleLabel}</div>

                <nav className="sidebar-nav">
                    {links.map((link) => (
                        <Link
                            key={link.hash}
                            to={`/${user.role}${link.hash}`}
                            className={`sidebar-link ${hash === link.hash ? 'active' : ''}`}
                        >
                            <link.icon size={16} />
                            {link.name}
                        </Link>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">{user.name.charAt(0)}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span className="sidebar-username">{user.name}</span>
                            {user.email && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</span>}
                        </div>
                    </div>
                    <button className="sidebar-logout" onClick={handleLogout} title="Logout">
                        <LogOut size={16} />
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="main-area">
                <header className="topbar">
                    <div className="topbar-breadcrumb">
                        <span style={{ color: 'var(--text-secondary)' }}>Aero'ed Network</span>
                        <span className="topbar-breadcrumb-sep">/</span>
                        <span className="topbar-breadcrumb-current">{currentLink.name}</span>
                    </div>
                    <div className="topbar-right">
                        <span className="status-dot">Network Online</span>
                    </div>
                </header>

                <div className="page-content">
                    <div className="page-inner">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
}
