import { useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Radio, Server, Activity, Send, FolderLock, Inbox, Package, LogOut, PlusCircle, ClipboardList, Map, Clock } from 'lucide-react';
import { useStore } from '../store';

export default function Layout({ user, setUser, children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const hash = location.hash || '';
    const initializeData = useStore((state) => state.initializeData);
    const deliveries = useStore((state) => state.deliveries);

    const handleLogout = () => { setUser(null); navigate('/'); };

    useEffect(() => {
        initializeData(true).catch((err) => {
            console.error('Failed to initialize application data:', err);
        });
    }, [initializeData, location.pathname]);

    // Notification counts
    const pendingRequests = deliveries.filter(d => ['REQUESTED', 'AWAITING_REVIEW'].includes(d.status)).length;
    const activeDeliveries = deliveries.filter(d => ['IN_TRANSIT', 'HANDOFF', 'READY_TO_LAUNCH', 'REROUTED', 'PENDING_DISPATCH'].includes(d.status)).length;
    // Clinic badge: only count requests made BY the clinic (requestedBy is set), not all active deliveries
    const clinicRequestCount = deliveries.filter(d => d.requestedBy && !['DELIVERED', 'REJECTED'].includes(d.status)).length;

    const navConfig = {
        admin: [
            { name: 'Platform Overview', hash: '', icon: LayoutDashboard },
            { name: 'Live Operations', hash: '#operations', icon: Radio },
            { name: 'Infrastructure', hash: '#infrastructure', icon: Server },
            { name: 'Analytics', hash: '#analytics', icon: Activity },
        ],
        distributor: [
            { name: 'Overview', hash: '', icon: LayoutDashboard },
            { name: 'Incoming Requests', hash: '#requests', icon: ClipboardList, badge: pendingRequests },
            { name: 'Active Deliveries', hash: '#active', icon: Radio, badge: activeDeliveries },
            { name: 'Dispatch Console', hash: '#dispatch', icon: Send },
            { name: 'Custody Ledger', hash: '#ledger', icon: FolderLock },
            { name: 'History', hash: '#history', icon: Clock },
        ],
        receiver: [
            { name: 'Dashboard', hash: '', icon: LayoutDashboard },
            { name: 'Request Supplies', hash: '#request', icon: PlusCircle },
            { name: 'My Requests', hash: '#tracking', icon: ClipboardList, badge: clinicRequestCount },
            { name: 'Inventory', hash: '#inventory', icon: Package },
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
                            {link.badge > 0 && (
                                <span style={{
                                    marginLeft: 'auto',
                                    background: '#ef4444',
                                    color: 'white',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    borderRadius: 10,
                                    padding: '1px 7px',
                                    minWidth: 18,
                                    textAlign: 'center',
                                    lineHeight: '16px',
                                }}>{link.badge}</span>
                            )}
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
                    <div className="topbar-right" />
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
