import { useEffect, useState } from 'react';
import { LayoutTemplate, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Badge } from '@/src/components/ui/badge';
import { Skeleton } from '@/src/components/ui/skeleton';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/src/components/ui/table';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { whatsappFetch } from '@/src/lib/whatsapp-api';
import { AnalyticsFiltersBar, AnalyticsFilters } from './AnalyticsFiltersBar';
import { ExportMenu } from './ExportMenu';
import { LineChart } from './charts/LineChart';

interface TemplateRow {
  id: string; name: string; category: string; isFavorite: boolean; usageCount: number;
  successPercent: number; readPercent: number; failurePercent: number; ctr: number | null;
}
interface TemplateAnalytics {
  templates: TemplateRow[]; mostUsed: TemplateRow[]; favorites: TemplateRow[];
  usageTrend: { date: string; count: number }[];
}

export function TemplateAnalyticsTab({ filters, onFiltersChange }: { filters: AnalyticsFilters; onFiltersChange: (f: AnalyticsFilters) => void }) {
  const { token } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<TemplateAnalytics | undefined>(undefined);

  useEffect(() => {
    whatsappFetch<TemplateAnalytics>(token, '/analytics/templates')
      .then(setData)
      .catch((err) => push({ title: 'Failed to load template analytics', description: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AnalyticsFiltersBar filters={filters} onChange={onFiltersChange} />
        <ExportMenu dataset="TEMPLATES" filters={filters} />
      </div>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : data.templates.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="No templates yet" description="Create templates and use them in campaigns to see usage analytics here." />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Template usage &amp; performance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Usage</TableHead>
                    <TableHead>Success %</TableHead><TableHead>Read %</TableHead><TableHead>Failure %</TableHead><TableHead>CTR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">{t.isFavorite && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />} {t.name}</span>
                      </TableCell>
                      <TableCell><Badge variant="outline">{t.category}</Badge></TableCell>
                      <TableCell>{t.usageCount}</TableCell>
                      <TableCell>{t.successPercent}%</TableCell>
                      <TableCell>{t.readPercent}%</TableCell>
                      <TableCell>{t.failurePercent}%</TableCell>
                      <TableCell className="text-[var(--text-muted)]">{t.ctr ?? 'N/A'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Usage trend</CardTitle></CardHeader>
            <CardContent>
              <LineChart series={[{ name: 'Campaigns using a template', color: '#8b5cf6', points: data.usageTrend.map((d) => ({ label: d.date, value: d.count })) }]} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
