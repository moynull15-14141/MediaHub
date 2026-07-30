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
    <div className={cn('flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] px-8 py-16 text-center shadow-inner shadow-black/20', className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
