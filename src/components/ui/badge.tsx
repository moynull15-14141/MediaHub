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
          // Theme-varied tokens (index.css) rather than fixed Tailwind
          // shades - the old bg-blue-500/10 text-blue-300 read fine on dark
          // surfaces but was low-contrast on light-mode's near-white ones.
          "bg-[var(--badge-info-bg)] text-[var(--badge-info-text)]": variant === "default",
          "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]": variant === "success",
          "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]": variant === "warning",
          "bg-[var(--badge-danger-bg)] text-[var(--badge-danger-text)]": variant === "danger",
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
