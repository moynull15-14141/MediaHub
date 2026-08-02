import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Select } from '@/src/components/ui/select';
import { useAuth } from '@/src/components/auth/AuthContext';
import { useToast } from '@/src/components/ui/toast-provider';
import { getApiBase } from '@/src/lib/api';
import { AnalyticsFilters, filtersToQuery } from './AnalyticsFiltersBar';

interface ExportMenuProps {
  dataset: 'OVERVIEW' | 'CAMPAIGNS' | 'CONTACTS' | 'TEMPLATES' | 'QUEUE' | 'API' | 'WEBHOOK';
  filters: AnalyticsFilters;
  page?: number;
  pageSize?: number;
  supportsPageScope?: boolean;
}

// One export control reused by every analytics tab - it hits the same
// /analytics/export endpoint (which itself reuses the exact service function
// each tab's data comes from), so an export can never disagree with what's
// on screen.
export function ExportMenu({ dataset, filters, page, pageSize, supportsPageScope }: ExportMenuProps) {
  const { token } = useAuth();
  const { push } = useToast();
  const [format, setFormat] = useState<'CSV' | 'XLSX' | 'PDF'>('CSV');
  const [scope, setScope] = useState<'page' | 'filtered' | 'all'>('filtered');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams(filtersToQuery(filters));
      params.set('dataset', dataset);
      params.set('format', format);
      params.set('scope', scope);
      if (scope === 'page') {
        params.set('page', String(page ?? 1));
        params.set('pageSize', String(pageSize ?? 25));
      }
      const res = await fetch(`${getApiBase()}/api/whatsapp/analytics/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset.toLowerCase()}-analytics.${format.toLowerCase()}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      push({ title: 'Export failed', description: err.message });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={format} onChange={(e) => setFormat(e.target.value as any)} className="w-24 py-1.5 text-xs">
        <option value="CSV">CSV</option>
        <option value="XLSX">Excel</option>
        <option value="PDF">PDF</option>
      </Select>
      <Select value={scope} onChange={(e) => setScope(e.target.value as any)} className="w-32 py-1.5 text-xs">
        {supportsPageScope && <option value="page">Current page</option>}
        <option value="filtered">Filtered results</option>
        <option value="all">Entire dataset</option>
      </Select>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
        <Download className="mr-1.5 h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
      </Button>
    </div>
  );
}
