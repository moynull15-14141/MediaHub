import * as React from "react"
import { cn } from "@/src/lib/utils"

const Badge = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'success' | 'warning' | 'danger' | 'outline' }>(
  ({ className, variant = 'default', style, ...props }, ref) => (
    <span
      ref={ref}
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        {
          "bg-blue-500/10 text-blue-300": variant === "default",
          "bg-emerald-500/10 text-emerald-300": variant === "success",
          "bg-amber-500/10 text-amber-300": variant === "warning",
          "bg-rose-500/10 text-rose-300": variant === "danger",
          "border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]": variant === "outline",
        },
        className
      )}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export { Badge }
