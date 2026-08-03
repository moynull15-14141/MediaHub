import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/src/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className={cn("peer absolute inset-0 h-5 w-5 cursor-pointer appearance-none rounded-md border border-[var(--border)] bg-[var(--input-bg)] transition checked:border-[var(--accent)] checked:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2", className)}
        {...props}
      />
      <Check className="pointer-events-none relative h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100" />
    </span>
  )
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
