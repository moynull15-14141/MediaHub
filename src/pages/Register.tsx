import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { Lock, Mail, UserPlus } from 'lucide-react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { Input } from '@/src/components/ui/input';
import { getApiBase } from '@/src/lib/api';

export default function Register() {
  const navigate = useNavigate();
  const { login, token, initializing } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiBase()}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Registration failed');
      }
      login(body.token, body.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Unable to register');
    } finally {
      setIsLoading(false);
    }
  };

  // See Login.tsx for why this waits on `initializing` before deciding.
  if (initializing) return null;
  if (token) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl space-y-6 rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-8 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 text-[var(--text-primary)]">
        <UserPlus className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-semibold">Create account</h1>
          <p className="text-sm text-[var(--text-muted)]">Register and upload your YouTube cookies to unlock authenticated downloads.</p>
        </div>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
          Email address
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>

        <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
          Password
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" autoComplete="new-password" required />
        </label>

        <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
          Confirm password
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" autoComplete="new-password" required />
        </label>

        <button type="submit" disabled={isLoading} className="w-full rounded-2xl button-primary px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60">
          {isLoading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-[var(--text-muted)]">
        Already have an account? <Link to="/login" className="text-blue-300 hover:text-blue-100">Sign in</Link>.
      </p>
    </motion.div>
  </div>
  );
}
