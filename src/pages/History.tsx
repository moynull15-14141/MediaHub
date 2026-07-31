import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Clock3, Copy, Download, ExternalLink, Filter, Search, Star, Trash2 } from 'lucide-react';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Skeleton } from '@/src/components/ui/skeleton';
import { getApiBase } from '@/src/lib/api';

export default function History() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('all');

  const apiBase = getApiBase();

  useEffect(() => {
    fetch(`${apiBase}/api/media/history`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setHistory(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [apiBase]);

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      const matchesQuery = `${item.title} ${item.url}`.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesDevice = deviceFilter === 'all' || item.device === deviceFilter;
      return matchesQuery && matchesStatus && matchesDevice;
    });
  }, [history, query, statusFilter, deviceFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Download History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Review your recent analyses, grouped by device and IP where available.</p>
        </div>
        <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-300">{history.length} tracked items</div>
      </div>

      <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2.5">
            <Search className="h-4 w-4 text-[var(--text-secondary)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search history" className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text-muted)]">
              <Filter className="h-4 w-4" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-sm text-[var(--text-primary)] outline-none">
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text-muted)]">
              <Filter className="h-4 w-4" />
              <select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} className="bg-transparent text-sm text-[var(--text-primary)] outline-none">
                <option value="all">All devices</option>
                <option value="Desktop">Desktop</option>
                <option value="Mobile">Mobile</option>
                <option value="Tablet">Tablet</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : filteredHistory.length === 0 ? (
            <EmptyState icon={Clock3} title="No matching history yet" description="Your past downloads will appear here with rich details, quick actions, and device-aware metadata." />
          ) : (
            <div className="space-y-3">
              {filteredHistory.map((item, index) => (
                <motion.div key={item.id || `${item.title}-${index}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="flex flex-col gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel-bg)] p-4 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)] md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-1 items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
                      <Download className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-[var(--text-primary)]">{item.title}</p>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{item.device || 'Unknown device'}</span>
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{item.platform || 'Unknown'}</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-2 text-sm text-[var(--text-muted)] sm:flex-row sm:flex-wrap">
                        <span className="flex items-center gap-1"><ExternalLink className="h-3.5 w-3.5" />{item.url}</span>
                        <span>IP: {item.clientIp || 'N/A'}</span>
                        <span>Status: {item.status || 'completed'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <button className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Download again">
                      <Download className="h-4 w-4" />
                    </button>
                    <button className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Copy link">
                      <Copy className="h-4 w-4" />
                    </button>
                    <button className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Favorite">
                      <Star className="h-4 w-4" />
                    </button>
                    <button className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text-secondary)] transition hover:bg-[var(--panel-bg)]" aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
