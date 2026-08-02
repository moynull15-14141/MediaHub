import { useEffect, useState } from 'react';
import { HeartPulse, RefreshCw, Database, Cog, Webhook, Cloud, Globe, Server, HardDrive, Cpu, MemoryStick } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Button } from '@/src/components/ui/button';
import { Skeleton } from '@/src/components/ui/skeleton';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';

interface HealthCard { name: string; status: 'green' | 'yellow' | 'red'; detail: string; }

const ICONS: Record<string, any> = {
  Database, 'Queue Worker': Cog, Webhook, 'Cloudflare R2': Cloud, 'Meta API': Globe,
  Server, Disk: HardDrive, CPU: Cpu, Memory: MemoryStick,
};

const statusDot = (status: HealthCard['status']) => (status === 'green' ? 'bg-emerald-400' : status === 'yellow' ? 'bg-amber-400' : 'bg-rose-400');
const statusText = (status: HealthCard['status']) => (status === 'green' ? 'text-emerald-300' : status === 'yellow' ? 'text-amber-300' : 'text-rose-300');
const statusLabel = (status: HealthCard['status']) => (status === 'green' ? 'Healthy' : status === 'yellow' ? 'Degraded' : 'Down');

export function SystemHealthTab() {
  const { token } = useAuth();
  const { push } = useToast();
  const [cards, setCards] = useState<HealthCard[] | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const result = await whatsappFetch<{ cards: HealthCard[] }>(token, '/account/system-health');
      setCards(result.cards);
    } catch (err: any) {
      push({ title: 'Failed to load system health', description: err.message });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = () => { setRefreshing(true); load(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-muted)]"><HeartPulse className="h-5 w-5" /></div>
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">System health</p>
            <p className="text-xs text-[var(--text-muted)]">Auto-refreshes every 15 seconds.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Refresh
        </Button>
      </div>

      {cards === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i}><Skeleton className="h-28 w-full" /></div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const Icon = ICONS[card.name] || Server;
            return (
              <Card key={card.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
                      <CardTitle className="text-sm">{card.name}</CardTitle>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${statusDot(card.status)}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className={`text-sm font-semibold ${statusText(card.status)}`}>{statusLabel(card.status)}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{card.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
