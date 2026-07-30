import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Clock3, Moon, Sun, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';

const themeKey = 'mediahub-theme';
const historyDaysKey = 'mediahub-history-days';

export default function Settings() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [autoDeleteDays, setAutoDeleteDays] = useState(30);
  const [saved, setSaved] = useState(false);

  const applyTheme = (mode: 'light' | 'dark') => {
    document.documentElement.dataset.theme = mode;
    setTheme(mode);
  };

  useEffect(() => {
    const storedTheme = (localStorage.getItem(themeKey) as 'light' | 'dark') || 'dark';
    const storedDays = Number(localStorage.getItem(historyDaysKey)) || 30;
    setAutoDeleteDays(storedDays);
    applyTheme(storedTheme);
  }, []);

  const handleSave = () => {
    localStorage.setItem(themeKey, theme);
    localStorage.setItem(historyDaysKey, String(autoDeleteDays));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Choose your UI mode and keep history organized by device / IP for your downloads.</p>
        </div>
        <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">Live configuration</div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="theme-surface border border-[var(--border)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                  <Sun className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg text-[var(--text)]">Theme</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button variant={theme === 'light' ? 'default' : 'outline'} onClick={() => applyTheme('light')} className="rounded-2xl px-4 py-2">
                  <Sun className="mr-2 h-4 w-4" /> Day mode
                </Button>
                <Button variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => applyTheme('dark')} className="rounded-2xl px-4 py-2">
                  <Moon className="mr-2 h-4 w-4" /> Night mode
                </Button>
              </div>
              <p className="text-sm text-[var(--text-muted)]">Your selected theme is saved locally and will persist across sessions.</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
          <Card className="theme-surface border border-[var(--border)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]">
                  <Clock3 className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg text-[var(--text)]">History</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-[var(--text-muted)]">Auto delete history after</label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={autoDeleteDays}
                  onChange={(e) => setAutoDeleteDays(Number(e.target.value))}
                  className="w-24 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-sm text-[var(--text-muted)]">History is stored with device and IP context so you can track downloads per device or location.</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <Card className="theme-surface border border-[var(--border)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]"><ShieldCheck className="h-4 w-4" /> Device-aware history</div>
              <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">Your download history will now include device type and client IP metadata for better auditability.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="default" className="px-6 py-3" onClick={handleSave}>Save settings</Button>
              <Button variant="outline" className="border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--surface)]" onClick={() => applyTheme(theme)}>
                Apply now
              </Button>
            </div>
            {saved && <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm text-emerald-300">Settings saved</div>}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
