import { useEffect, useState } from 'react';
import { Palette, UploadCloud, Trash2, Sun, Moon, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Select } from '@/src/components/ui/select';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { getApiBase } from '@/src/lib/api';

const THEME_KEY = 'mediahub-theme';

interface BrandInfo {
  companyName: string | null;
  logoUrl: string | null;
  sendTimezone: string;
  language: string;
}

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' }, { value: 'bn', label: 'Bangla' }, { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' }, { value: 'ar', label: 'Arabic' }, { value: 'hi', label: 'Hindi' },
  { value: 'pt', label: 'Portuguese' }, { value: 'id', label: 'Indonesian' },
];

export function BrandSettingsTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [brand, setBrand] = useState<BrandInfo | null | undefined>(undefined);
  const [companyName, setCompanyName] = useState('');
  const [language, setLanguage] = useState('en');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  const load = async () => {
    try {
      const account = await whatsappFetch<BrandInfo | null>(token, '/account');
      setBrand(account);
      setCompanyName(account?.companyName || '');
      setLanguage(account?.language || 'en');
    } catch (err: any) {
      push({ title: 'Failed to load brand settings', description: err.message });
    }
  };

  useEffect(() => {
    load();
    setTheme((localStorage.getItem(THEME_KEY) as 'light' | 'dark') || 'dark');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTheme = (mode: 'light' | 'dark') => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem(THEME_KEY, mode);
    setTheme(mode);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await whatsappFetch(token, '/account/settings', { method: 'PATCH', body: JSON.stringify({ companyName: companyName || null, language }) });
      push({ title: 'Brand settings saved' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to save brand settings', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getApiBase()}/api/whatsapp/account/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      push({ title: 'Logo updated' });
      load();
    } catch (err: any) {
      push({ title: 'Upload failed', description: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    try {
      await whatsappFetch(token, '/account/logo', { method: 'DELETE' });
      load();
    } catch (err: any) {
      push({ title: 'Failed to remove logo', description: err.message });
    }
  };

  if (brand === undefined) return <Skeleton className="h-64 w-full" />;
  if (!brand) return <Card><CardContent className="p-6 text-sm text-[var(--text-muted)]">Connect a WhatsApp account first to configure brand settings.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><Palette className="h-5 w-5" /></div>
            <CardTitle className="text-lg">Brand</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              Company name
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company" />
            </label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">
              <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Language</span>
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </label>
          </div>

          <div>
            <p className="mb-2 text-sm text-[var(--text-secondary)]">Logo</p>
            {brand.logoUrl ? (
              <div className="flex items-center gap-4">
                <img src={brand.logoUrl} alt="Logo" className="h-16 w-16 rounded-2xl border border-[var(--border)] object-contain bg-[var(--panel-bg)]" />
                <Button variant="outline" className="text-rose-300 hover:bg-rose-500/10" onClick={handleLogoRemove}><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
              </div>
            ) : (
              <label className="flex w-full max-w-xs cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] px-6 py-8 text-center hover:border-blue-500">
                <UploadCloud className="h-6 w-6 text-[var(--text-secondary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">{uploading ? 'Uploading…' : 'Upload logo'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
              </label>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save brand settings'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">Theme</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">Applies across all of MediaHub, not just WhatsApp Campaign.</p>
          <div className="flex gap-3">
            <Button variant={theme === 'light' ? 'default' : 'outline'} onClick={() => applyTheme('light')}><Sun className="mr-2 h-4 w-4" /> Light</Button>
            <Button variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => applyTheme('dark')}><Moon className="mr-2 h-4 w-4" /> Dark</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
