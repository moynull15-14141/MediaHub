import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/src/components/auth/AuthContext';
import { Skeleton } from '@/src/components/ui/skeleton';

// WhatsApp Campaign is the first module requiring a logged-in user - other
// modules support anonymous visitors via a cookie, this one manages a real
// business account and contact data.
export function RequireAuth() {
  const { token, initializing } = useAuth();
  const location = useLocation();

  // While AuthContext hasn't finished its one-time localStorage hydration
  // check, `token` is still its useState(null) default even when a valid
  // session exists - redirecting on that transient null is exactly what
  // caused the login-page flash on every hard refresh of a protected route.
  // Hold here (same loading convention used for data-fetch waits elsewhere
  // in the app) until the real value is known.
  if (initializing) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
