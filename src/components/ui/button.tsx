import * as React from "react"
import { cn } from "@/src/lib/utils"

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost', size?: 'default' | 'sm' | 'lg' | 'icon' }>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-[18px] text-sm font-semibold transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)] disabled:pointer-events-none disabled:opacity-50",
          {
            "button-primary shadow-[0_18px_40px_rgba(37,99,235,0.22)] hover:-translate-y-0.5 active:translate-y-0": variant === "default",
            "button-outline border bg-transparent text-[var(--text-primary)] hover:bg-[var(--panel-bg)]": variant === "outline",
            "button-ghost text-[var(--text-primary)] hover:bg-[var(--panel-bg)]": variant === "ghost",
            "h-10 px-5 py-2.5": size === "default",
            "h-9 rounded-[16px] px-4": size === "sm",
            "h-11 rounded-[20px] px-8": size === "lg",
            // 44px (not the previous 40px) to meet the ~44px touch-target
            // guideline - a single change here fixes every icon-only button
            // in the app (delete/edit/duplicate actions across every list
            // page) without touching each call site.
            "h-11 w-11 rounded-full": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
