import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import DistributorPortal from './pages/DistributorPortal';
import ReceiverPortal from './pages/ReceiverPortal';
import Layout from './components/Layout';

const USER_STORAGE_KEY = 'aeroed.demo.user';

function readStoredUser() {
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(USER_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || !['admin', 'distributor', 'receiver'].includes(parsed.role)) {
            return null;
        }

        return parsed;
    } catch (err) {
        console.warn('Failed to restore saved session:', err);
        return null;
    }
}

function App() {
    const [user, setUser] = useState(() => readStoredUser());

    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (user) {
            window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
            return;
        }

        window.localStorage.removeItem(USER_STORAGE_KEY);
    }, [user]);

    return (
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route
                    path="/"
                    element={user ? <Navigate to={`/${user.role}`} replace /> : <Login setUser={setUser} />}
                />

                <Route path="/admin/*" element={
                    user?.role === 'admin' ?
                        <Layout user={user} setUser={setUser}><AdminDashboard /></Layout>
                        : <Navigate to="/" replace />
                } />

                <Route path="/distributor/*" element={
                    user?.role === 'distributor' ?
                        <Layout user={user} setUser={setUser}><DistributorPortal /></Layout>
                        : <Navigate to="/" replace />
                } />

                <Route path="/receiver/*" element={
                    user?.role === 'receiver' ?
                        <Layout user={user} setUser={setUser}><ReceiverPortal /></Layout>
                        : <Navigate to="/" replace />
                } />

                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    );
}

export default App;
