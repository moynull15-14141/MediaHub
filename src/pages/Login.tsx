import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { Lock, Mail, ArrowLeftCircle } from 'lucide-react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { Input } from '@/src/components/ui/input';
import { getApiBase } from '@/src/lib/api';

export default function Login() {
  const navigate = useNavigate();
  const { login, token, initializing } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBase()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Login failed');
      }
      login(body.token, body.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Unable to login');
    } finally {
      setIsLoading(false);
    }
  };

  // Wait for AuthContext's one-time localStorage check before deciding -
  // otherwise an already-logged-in user hard-refreshing on /login would
  // briefly see the form render (token still the useState(null) default)
  // before this redirect kicks in. Once resolved, an authenticated user is
  // bounced straight back rather than being able to sit on the login screen.
  if (initializing) return null;
  if (token) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl space-y-6 rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-8 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 text-[var(--text-primary)]">
        <ArrowLeftCircle className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-semibold">Login</h1>
          <p className="text-sm text-[var(--text-muted)]">Enter your account details to start using MediaHub.</p>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
          Email address
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="pl-10"
              autoComplete="email"
              required
            />
          </div>
        </label>

        <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
          Password
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="pl-10"
              autoComplete="current-password"
              required
            />
          </div>
        </label>

        <button type="submit" disabled={isLoading} className="w-full rounded-2xl button-primary px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60">
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-muted)]">
        Don’t have an account? <Link to="/register" className="text-blue-300 hover:text-blue-100">Create one</Link>.
      </p>
    </motion.div>
  </div>
  );
}
