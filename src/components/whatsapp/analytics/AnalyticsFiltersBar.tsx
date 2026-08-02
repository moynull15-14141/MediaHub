import { useEffect, useState } from 'react';
import { Filter, X, Search } from 'lucide-react';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Button } from '@/src/components/ui/button';
import { useAuth } from '@/src/components/auth/AuthContext';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

export interface AnalyticsFilters {
  dateFrom: string;
  dateTo: string;
  campaignId: string;
  templateId: string;
  status: string;
  groupId: string;
  labelId: string;
  search: string;
}

export const EMPTY_FILTERS: AnalyticsFilters = {
  dateFrom: '', dateTo: '', campaignId: '', templateId: '', status: '', groupId: '', labelId: '', search: '',
};

export const filtersToQuery = (filters: AnalyticsFilters): string => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
};

const STATUSES = ['NOT_STARTED', 'SCHEDULED', 'QUEUED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'];

interface Option { id: string; name: string; }

interface AnalyticsFiltersBarProps {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  showCampaign?: boolean;
  showTemplate?: boolean;
  showStatus?: boolean;
  showGroupLabel?: boolean;
  showSearch?: boolean;
}

// Shared across every Analytics tab so filters behave identically everywhere
// (Overview, Campaigns, Charts, Export all read the same AnalyticsFilters
// shape) - each tab just toggles which controls are relevant to it.
export function AnalyticsFiltersBar({ filters, onChange, showCampaign, showTemplate, showStatus, showGroupLabel, showSearch }: AnalyticsFiltersBarProps) {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState<Option[]>([]);
  const [templates, setTemplates] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [labels, setLabels] = useState<Option[]>([]);

  useEffect(() => {
    if (showCampaign) whatsappFetch<{ campaigns: Option[] }>(token, '/campaigns?pageSize=200').then((r) => setCampaigns(r.campaigns)).catch(() => {});
    if (showTemplate) whatsappFetch<Option[]>(token, '/templates').then(setTemplates).catch(() => {});
    if (showGroupLabel) {
      whatsappFetch<Option[]>(token, '/groups').then(setGroups).catch(() => {});
      whatsappFetch<Option[]>(token, '/labels').then(setLabels).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCampaign, showTemplate, showGroupLabel]);

  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...filters, ...patch });
  const hasActive = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-center gap-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        <Filter className="h-3.5 w-3.5" /> Filters
      </div>
      <label className="space-y-1 text-xs text-[var(--text-secondary)]">
        From
        <Input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} className="w-36" />
      </label>
      <label className="space-y-1 text-xs text-[var(--text-secondary)]">
        To
        <Input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} className="w-36" />
      </label>
      {showCampaign && (
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          Campaign
          <Select value={filters.campaignId} onChange={(e) => set({ campaignId: e.target.value })} className="w-44">
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>
      )}
      {showTemplate && (
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          Template
          <Select value={filters.templateId} onChange={(e) => set({ templateId: e.target.value })} className="w-44">
            <option value="">All templates</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
      )}
      {showStatus && (
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          Status
          <Select value={filters.status} onChange={(e) => set({ status: e.target.value })} className="w-36">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </label>
      )}
      {showGroupLabel && (
        <>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">
            Group
            <Select value={filters.groupId} onChange={(e) => set({ groupId: e.target.value })} className="w-36">
              <option value="">All groups</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs text-[var(--text-secondary)]">
            Label
            <Select value={filters.labelId} onChange={(e) => set({ labelId: e.target.value })} className="w-36">
              <option value="">All labels</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </label>
        </>
      )}
      {showSearch && (
        <label className="space-y-1 text-xs text-[var(--text-secondary)]">
          Search
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Name…" className="w-40 pl-8" />
          </div>
        </label>
      )}
      {hasActive && (
        <Button variant="outline" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          <X className="mr-1.5 h-3.5 w-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}
