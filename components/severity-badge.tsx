"use client"

import { Signal, SignalHigh, SignalMedium, SignalLow } from "lucide-react"

const SEVERITY_CONFIG: Record<string, { icon: typeof Signal; className: string }> = {
  CRITICAL: { icon: Signal, className: "text-red-600 dark:text-red-400" },
  HIGH: { icon: SignalHigh, className: "text-orange-600 dark:text-orange-400" },
  MEDIUM: { icon: SignalMedium, className: "text-yellow-600 dark:text-yellow-500" },
  LOW: { icon: SignalLow, className: "text-blue-600 dark:text-blue-400" },
}

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const config = SEVERITY_CONFIG[severity]
  const Icon = config?.icon || SignalMedium
  return (
    <span title={severity} aria-label={severity} className="inline-flex items-center">
      <Icon className={`w-4 h-4 ${config?.className || "text-muted-foreground"} ${className || ""}`} />
    </span>
  )
}
