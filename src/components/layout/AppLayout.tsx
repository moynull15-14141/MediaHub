import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { DownloadCloud, History, Menu, Settings, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = [
    { to: '/', icon: DownloadCloud, label: 'Downloader' },
    { to: '/history', icon: History, label: 'History' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  const renderNav = () => (
    <nav className="flex-1 space-y-1 px-3 pt-5">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
            isActive ? 'bg-white/10 text-white shadow-lg shadow-blue-500/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'
          )}
        >
          <item.icon className="h-4 w-4" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] text-[#e2e8f0] font-sans selection:bg-blue-500/30">
      <aside className="hidden w-72 flex-col border-r border-white/10 bg-[#05070b]/90 backdrop-blur xl:flex">
        <div className="flex items-center gap-3 border-b border-white/10 px-6 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg shadow-blue-500/20">
            <DownloadCloud className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">MediaHub <span className="text-blue-400">PRO</span></div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Commercial Downloader</div>
          </div>
        </div>
        {renderNav()}
        <div className="border-t border-white/10 p-4">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> Secure workspace</div>
            <p className="mt-1 text-xs text-emerald-200/80">Protected by enterprise-grade safeguards.</p>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-white/10 bg-[#05070b]/70 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-300 xl:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <p className="text-sm font-semibold text-white">MediaHub PRO</p>
                <p className="text-xs text-slate-500">Premium media delivery workflow</p>
              </div>
            </div>
            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              All systems operational
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
            <Outlet />
          </div>
        </div>

        <footer className="border-t border-white/10 bg-[#05070b]/80 px-4 py-3 text-[11px] text-slate-500 md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>© 2026 MediaHub PRO</div>
            <div className="flex flex-wrap gap-3">
              <a href="#" className="transition hover:text-slate-300">Privacy</a>
              <a href="#" className="transition hover:text-slate-300">Terms</a>
              <a href="#" className="transition hover:text-slate-300">API</a>
              <a href="#" className="transition hover:text-slate-300">Contact</a>
              <span>Version 1.0</span>
            </div>
          </div>
        </footer>
      </main>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex xl:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <div className="relative flex h-full w-72 flex-col bg-[#05070b] p-4 shadow-2xl shadow-black/50">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-semibold text-white">Navigation</div>
              <button className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-300" onClick={() => setMobileOpen(false)} aria-label="Close navigation menu">
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
