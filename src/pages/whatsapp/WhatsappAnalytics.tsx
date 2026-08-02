import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard, Megaphone, Users, LayoutTemplate, Layers, Activity, Webhook, LineChart as LineChartIcon, FileClock,
} from 'lucide-react';
import { OverviewTab } from '@/src/components/whatsapp/analytics/OverviewTab';
import { CampaignAnalyticsTab } from '@/src/components/whatsapp/analytics/CampaignAnalyticsTab';
import { ContactAnalyticsTab } from '@/src/components/whatsapp/analytics/ContactAnalyticsTab';
import { TemplateAnalyticsTab } from '@/src/components/whatsapp/analytics/TemplateAnalyticsTab';
import { QueueAnalyticsTab } from '@/src/components/whatsapp/analytics/QueueAnalyticsTab';
import { ApiAnalyticsTab } from '@/src/components/whatsapp/analytics/ApiAnalyticsTab';
import { WebhookAnalyticsTab } from '@/src/components/whatsapp/analytics/WebhookAnalyticsTab';
import { ChartsTab } from '@/src/components/whatsapp/analytics/ChartsTab';
import { ReportsTab } from '@/src/components/whatsapp/analytics/ReportsTab';
import { AnalyticsFilters, EMPTY_FILTERS } from '@/src/components/whatsapp/analytics/AnalyticsFiltersBar';

type TabKey = 'overview' | 'campaigns' | 'contacts' | 'templates' | 'queue' | 'api' | 'webhook' | 'charts' | 'reports';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'queue', label: 'Queue', icon: Layers },
  { key: 'api', label: 'API', icon: Activity },
  { key: 'webhook', label: 'Webhook', icon: Webhook },
  { key: 'charts', label: 'Charts', icon: LineChartIcon },
  { key: 'reports', label: 'Reports', icon: FileClock },
];

export default function WhatsappAnalytics() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [filters, setFilters] = useState<AnalyticsFilters>(EMPTY_FILTERS);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Analytics &amp; Reporting</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Live insights computed directly from your campaigns, contacts, and delivery data.</p>
      </motion.div>

      <div className="flex flex-wrap gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${tab === t.key ? 'bg-blue-500/15 text-blue-300' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {tab === 'overview' && <OverviewTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'campaigns' && <CampaignAnalyticsTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'contacts' && <ContactAnalyticsTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'templates' && <TemplateAnalyticsTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'queue' && <QueueAnalyticsTab />}
        {tab === 'api' && <ApiAnalyticsTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'webhook' && <WebhookAnalyticsTab />}
        {tab === 'charts' && <ChartsTab filters={filters} onFiltersChange={setFilters} />}
        {tab === 'reports' && <ReportsTab />}
      </motion.div>
    </div>
  );
}
