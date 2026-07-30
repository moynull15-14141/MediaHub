import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { Input } from '@/src/components/ui/input';
import { getApiBase } from '@/src/lib/api';

export default function CookieUpload() {
  const { token, user, setUser } = useAuth();
  const [cookies, setCookies] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError('You must be logged in to upload cookies.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${getApiBase()}/api/auth/cookies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cookies }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Cookie upload failed');
      }
      setMessage('Cookies uploaded successfully. You can now analyze protected videos.');
      if (user) {
        setUser({ ...user, cookieUploadedAt: new Date().toISOString() });
      }
    } catch (err: any) {
      setError(err.message || 'Unable to upload cookies');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-4xl space-y-6 rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-8 shadow-[var(--shadow-card)]">
      <div className="space-y-2 text-[var(--text-primary)]">
        <h1 className="text-3xl font-semibold">Upload YouTube cookies</h1>
        <p className="max-w-2xl text-sm text-[var(--text-muted)]">Paste the raw cookies exported from your browser so MediaHub can access protected or age-restricted YouTube media.</p>
      </div>

      {error && <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {message && <div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}

      <form onSubmit={handleUpload} className="space-y-4">
        <label className="block text-sm text-[var(--text-secondary)]">
          Cookies text
          <textarea
            rows={10}
            value={cookies}
            onChange={(e) => setCookies(e.target.value)}
            placeholder="Paste cookies.txt content here"
            className="mt-2 w-full rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        <button type="submit" disabled={isLoading} className="rounded-2xl button-primary px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60">
          {isLoading ? 'Uploading…' : 'Upload cookies'}
        </button>
      </form>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
        <p className="font-semibold text-[var(--text-primary)]">Tip:</p>
        <p className="mt-2">Use a browser extension or developer tools to export YouTube cookies as text, then paste the full contents here.</p>
      </div>
    </motion.div>
  );
}
