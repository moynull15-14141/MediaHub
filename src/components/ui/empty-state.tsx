import { ReactNode } from 'react';
import { cn } from '@/src/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: any;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] px-8 py-16 text-center shadow-inner shadow-black/20', className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
