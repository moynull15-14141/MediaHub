import * as React from "react"
import { cn } from "@/src/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "input-field h-12 w-full rounded-[18px] px-4 py-3 text-sm placeholder:text-[var(--input-placeholder)] transition-all duration-200 ease-out focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
