import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/src/components/auth/AuthContext';

// WhatsApp Campaign is the first module requiring a logged-in user - other
// modules support anonymous visitors via a cookie, this one manages a real
// business account and contact data.
export function RequireAuth() {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
