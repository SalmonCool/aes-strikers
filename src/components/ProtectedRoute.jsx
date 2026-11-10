import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="screen-loading">Loading…</div>;
  // Remember where they were headed (e.g. an arena invite link) so login can send them back
  return user ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
