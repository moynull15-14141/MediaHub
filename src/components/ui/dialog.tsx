import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/src/lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

// Hand-rolled modal (no Radix in this repo) matching the rounded/var(--*)
// styling of the rest of the UI kit. Escape + backdrop click both close.
export function Dialog({ open, onClose, children, className }: DialogProps) {
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("relative w-full max-w-lg", className)}>{children}</div>
    </div>,
    document.body
  )
}

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "max-h-[85vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]",
        className
      )}
      {...props}
    />
  )
)
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mb-4 flex items-center justify-between gap-4", className)} {...props} />
)

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold text-[var(--text-primary)]", className)} {...props} />
  )
)
DialogTitle.displayName = "DialogTitle"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-6 flex flex-wrap justify-end gap-3", className)} {...props} />
)

function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close dialog"
      className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
    >
      <X className="h-4 w-4" />
    </button>
  )
}

export { DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogCloseButton }
