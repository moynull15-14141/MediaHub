import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Smartphone, Gauge, CalendarClock, ShieldOff, FileStack, Webhook, Activity,
  Lock, Bell, Palette, HeartPulse,
} from 'lucide-react';
import { AccountSettingsTab } from '@/src/components/whatsapp/settings/AccountSettingsTab';
import { QueueSettingsTab } from '@/src/components/whatsapp/settings/QueueSettingsTab';
import { WorkingHoursTab } from '@/src/components/whatsapp/settings/WorkingHoursTab';
import { BlacklistTab } from '@/src/components/whatsapp/settings/BlacklistTab';
import { CampaignDefaultsTab } from '@/src/components/whatsapp/settings/CampaignDefaultsTab';
import { WebhookMonitorTab } from '@/src/components/whatsapp/settings/WebhookMonitorTab';
import { ApiHealthTab } from '@/src/components/whatsapp/settings/ApiHealthTab';
import { SecurityTab } from '@/src/components/whatsapp/settings/SecurityTab';
import { NotificationsTab } from '@/src/components/whatsapp/settings/NotificationsTab';
import { BrandSettingsTab } from '@/src/components/whatsapp/settings/BrandSettingsTab';
import { SystemHealthTab } from '@/src/components/whatsapp/settings/SystemHealthTab';

type TabKey =
  | 'account' | 'queue' | 'workingHours' | 'blacklist' | 'campaignDefaults'
  | 'webhook' | 'apiHealth' | 'security' | 'notifications' | 'brand' | 'systemHealth';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'account', label: 'Account', icon: Smartphone },
  { key: 'queue', label: 'Queue', icon: Gauge },
  { key: 'workingHours', label: 'Working Hours', icon: CalendarClock },
  { key: 'blacklist', label: 'Blacklist', icon: ShieldOff },
  { key: 'campaignDefaults', label: 'Campaign Defaults', icon: FileStack },
  { key: 'webhook', label: 'Webhook', icon: Webhook },
  { key: 'apiHealth', label: 'API Health', icon: Activity },
  { key: 'security', label: 'Security', icon: Lock },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'brand', label: 'Brand', icon: Palette },
  { key: 'systemHealth', label: 'System Health', icon: HeartPulse },
];

export default function WhatsappSettings() {
  const [tab, setTab] = useState<TabKey>('account');

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Configure every part of the WhatsApp Campaign module.</p>
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
        {tab === 'account' && <AccountSettingsTab />}
        {tab === 'queue' && <QueueSettingsTab />}
        {tab === 'workingHours' && <WorkingHoursTab />}
        {tab === 'blacklist' && <BlacklistTab />}
        {tab === 'campaignDefaults' && <CampaignDefaultsTab />}
        {tab === 'webhook' && <WebhookMonitorTab />}
        {tab === 'apiHealth' && <ApiHealthTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'brand' && <BrandSettingsTab />}
        {tab === 'systemHealth' && <SystemHealthTab />}
      </motion.div>
    </div>
  );
}
