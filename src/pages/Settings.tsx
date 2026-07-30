import { motion } from 'motion/react';
import { Bell, BrushCleaning, Clock3, Database, Globe2, HardDrive, Info, Lock, ShieldCheck, Trash2, Video, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';

const sections = [
  {
    title: 'General',
    icon: Globe2,
    rows: [
      { label: 'Theme', value: 'Dark Premium' },
      { label: 'Language', value: 'English' },
      { label: 'Timezone', value: 'UTC+6' },
      { label: 'Date Format', value: 'DD/MM/YYYY' },
    ],
  },
  {
    title: 'Downloader',
    icon: Video,
    rows: [
      { label: 'Preferred Video Quality', value: '1080p' },
      { label: 'Preferred Audio Quality', value: '320kbps' },
      { label: 'Preferred Download Format', value: 'MP4' },
      { label: 'Auto Download', value: 'Enabled' },
      { label: 'Concurrent Downloads', value: '3' },
    ],
  },
  {
    title: 'History',
    icon: Clock3,
    rows: [
      { label: 'Enable History', value: 'On' },
      { label: 'Auto Delete History', value: '30 Days' },
    ],
  },
  {
    title: 'Storage',
    icon: HardDrive,
    rows: [
      { label: 'Cache Size', value: '184 MB' },
      { label: 'Storage Usage', value: '2.4 GB' },
    ],
  },
  {
    title: 'Privacy',
    icon: Lock,
    rows: [
      { label: 'Analytics Toggle', value: 'Enabled' },
      { label: 'Delete All Data', value: 'Available' },
    ],
  },
  {
    title: 'About',
    icon: Info,
    rows: [
      { label: 'Application Name', value: 'MediaHub PRO' },
      { label: 'Version', value: '1.0.0' },
      { label: 'Build Number', value: '20260729' },
      { label: 'License', value: 'Enterprise' },
      { label: 'Support', value: 'support@mediahub.pro' },
      { label: 'Contact', value: '+880 1700 000000' },
      { label: 'Privacy Policy', value: 'Updated 2026' },
      { label: 'Terms of Service', value: 'Updated 2026' },
    ],
  },
];

export default function Settings() {
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Fine-tune your downloader workflow, storage preferences, and privacy controls from one polished workspace.</p>
        </div>
        <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">Live configuration</div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section, index) => {
          const Icon = section.icon;
          return (
            <motion.div key={section.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
              <Card className="border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg text-white">{section.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {section.rows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      <span className="text-sm text-slate-400">{row.label}</span>
                      <span className="text-sm font-medium text-white">{row.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border-white/10 bg-gradient-to-br from-blue-600/10 via-transparent to-cyan-600/10">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck className="h-4 w-4" /> Premium control center</div>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">You can manage downloads, retention, and privacy without leaving the app experience.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">Clear History</Button>
              <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10">Clear Cache</Button>
              <Button className="bg-white text-black hover:bg-slate-200">Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
