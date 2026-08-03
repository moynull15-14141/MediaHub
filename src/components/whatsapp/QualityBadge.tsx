import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';

// Phase B.2 - shared between WhatsappAccounts.tsx and CampaignFormDialog.tsx
// so quality rating gets one consistent badge treatment instead of a third
// duplicate implementation. Mirrors the color mapping already used by
// healthBadge() (qualityToHealth on the backend maps the same GREEN/YELLOW/
// RED values to HEALTHY/WARNING/UNHEALTHY).
export const QualityBadge = ({ rating }: { rating: string | null }) => {
  switch ((rating || '').toUpperCase()) {
    case 'GREEN':
      return <Badge variant="success"><ShieldCheck className="h-3.5 w-3.5" /> Green</Badge>;
    case 'YELLOW':
      return <Badge variant="warning"><AlertTriangle className="h-3.5 w-3.5" /> Yellow</Badge>;
    case 'RED':
      return <Badge variant="danger"><AlertTriangle className="h-3.5 w-3.5" /> Red</Badge>;
    default:
      return <Badge variant="outline">N/A</Badge>;
  }
};
