import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { DownloadCloud, History, Menu, Settings, ShieldCheck, X, LogIn, LogOut, Key } from 'lucide-react';
import { useAuth } from '@/src/components/auth/AuthContext';
import { cn } from '@/src/lib/utils';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const { token, user, logout } = useAuth();
  const navItems = [
    { to: '/', icon: DownloadCloud, label: 'Downloader' },
    { to: '/history', icon: History, label: 'History' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    { to: '/cookies', icon: Key, label: 'Upload cookies' },
  ];

  const renderNav = () => (
    <nav className="flex-1 space-y-3 px-4 pt-6">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-3xl px-4 py-3 text-sm font-semibold transition-all duration-200',
            isActive
              ? 'bg-blue-500/10 text-blue-300 shadow-[0_20px_60px_rgba(59,130,246,0.18)] backdrop-blur text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--panel-bg)] hover:text-[var(--text-primary)]'
          )}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden font-sans selection:bg-blue-500/30" style={{ backgroundColor: 'var(--app-bg)', color: 'var(--text-primary)' }}>
      <aside className="hidden w-80 flex-col rounded-[32px] border shadow-[0_30px_80px_rgba(15,23,42,0.18)] xl:flex" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 border-b px-6 py-6" style={{ borderColor: 'var(--border)' }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-[0_20px_70px_rgba(56,189,248,0.25)]">
            <DownloadCloud className="h-6 w-6 text-[var(--text-primary)]" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">MediaHub <span className="text-blue-400">PRO</span></div>
            <div className="text-xs uppercase tracking-[0.25em] text-[var(--text-secondary)]">Commercial Downloader</div>
          </div>
        </div>
        {renderNav()}
        <div className="border-t px-4 py-4" style={{ borderColor: 'var(--border)' }}>
          <div className="rounded-3xl border px-4 py-4 text-sm" style={{ backgroundColor: 'var(--panel-bg)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]"><ShieldCheck className="h-4 w-4" /> Secure workspace</div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Protected by enterprise-grade safeguards.</p>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b px-4 py-3 backdrop-blur md:px-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--text-secondary)] xl:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">MediaHub PRO</p>
                <p className="text-xs text-[var(--text-secondary)]">Premium media delivery workflow</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {token ? (
                <>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1 text-xs text-[var(--text-secondary)]">{user?.email}</span>
                  <button
                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]"
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                  >
                    <LogOut className="h-4 w-4" /> Logout
                  </button>
                </>
              ) : (
                <button
                  className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--panel-bg)]"
                  onClick={() => navigate('/login')}
                >
                  <LogIn className="h-4 w-4" /> Login
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
            <Outlet />
          </div>
        </div>

        <footer className="border-t px-4 py-3 text-[11px] md:px-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>© 2026 MediaHub PRO</div>
            <div className="flex flex-wrap gap-3">
              <a href="#" className="transition hover:text-[var(--text-primary)] text-[var(--text-secondary)]">Privacy</a>
              <a href="#" className="transition hover:text-[var(--text-primary)] text-[var(--text-secondary)]">Terms</a>
              <a href="#" className="transition hover:text-[var(--text-primary)] text-[var(--text-secondary)]">API</a>
              <a href="#" className="transition hover:text-[var(--text-primary)] text-[var(--text-secondary)]">Contact</a>
              <span>Version 1.0</span>
            </div>
          </div>
        </footer>
      </main>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative flex h-full w-72 flex-col bg-[var(--surface)] p-4 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-semibold text-[var(--text-primary)]">Navigation</div>
              <button className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--text-secondary)]" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderNav()}
          </div>
        </div>
      )}
    </div>
  );
}
