import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import DistributorPortal from './pages/DistributorPortal';
import ReceiverPortal from './pages/ReceiverPortal';
import Layout from './components/Layout';

function App() {
    const [user, setUser] = useState(null);

    return (
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
                <Route path="/" element={<Login setUser={setUser} />} />

                <Route path="/admin/*" element={
                    user?.role === 'admin' ?
                        <Layout user={user} setUser={setUser}><AdminDashboard /></Layout>
                        : <Navigate to="/" />
                } />

                <Route path="/distributor/*" element={
                    user?.role === 'distributor' ?
                        <Layout user={user} setUser={setUser}><DistributorPortal /></Layout>
                        : <Navigate to="/" />
                } />

                <Route path="/receiver/*" element={
                    user?.role === 'receiver' ?
                        <Layout user={user} setUser={setUser}><ReceiverPortal /></Layout>
                        : <Navigate to="/" />
                } />

                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </Router>
    );
}

export default App;
