import { createContext, useContext, useMemo, useState, ReactNode } from 'react';

interface ToastItem {
  id: number;
  title: string;
  description: string;
}

const ToastContext = createContext<{ push: (toast: Omit<ToastItem, 'id'>) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = (toast: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2600);
  };

  const value = useMemo(() => ({ push }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="rounded-2xl border border-white/10 bg-[#0b0b0f]/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur">
            <p className="text-sm font-semibold text-white">{toast.title}</p>
            <p className="mt-1 text-sm text-slate-400">{toast.description}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
