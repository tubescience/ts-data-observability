"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, XCircle, ChevronDown, ChevronRight, Copy, Check } from "lucide-react"
import { SpendMonitorChart } from "@/components/spend-monitor-chart"
import { useTagColors, TagBadge } from "@/components/tag-colors"

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch { return "—" }
}

interface Check {
  configId: number
  checkType: string
  enabled: boolean
  severity: string
  thresholdPct: number | null
  thresholdValue: number | null
  sumColumn: string | null
  groupByColumn: string | null
  granularity: string
  domain: string
}

interface Monitor {
  monitorId: number
  monitorName: string
  targetDatabase: string
  targetSchema: string
  targetTable: string
  enabled: boolean
  owner: string
  description: string | null
  scheduleCron: string | null
  warehouse: string | null
  taskName: string | null
  sourceLayer: string
  platform: string
  tags: string[]
  lastRun: string | null
  primaryProcedure: string | null
  parentTaskName: string | null
  parentSchedule: string | null
  createdAt: string | null
  checks: Check[]
}

export function SpendMonitorsView() {
  const tagColors = useTagColors()
  const { data, isLoading, error } = useQuery<Monitor[]>({
    queryKey: ["monitors"],
    queryFn: () => fetch("/api/monitors").then((r) => r.json()),
  })

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [granularityMode, setGranularityMode] = useState<"ACCOUNT" | "CLIENT">("ACCOUNT")
  const [showActive, setShowActive] = useState(true)
  const [nameFilter, setNameFilter] = useState<string>("")
  const [tagFilter, setTagFilter] = useState<string>("")
  const [sourceLayerFilter, setSourceLayerFilter] = useState<string>("")
  const [platformFilter, setPlatformFilter] = useState<string>("")

  if (isLoading) return <div className="text-muted-foreground">Loading spend monitors...</div>
  if (error) return <div className="text-destructive">Failed to load spend monitors</div>

  // Scoped to the selected grouping mode — a monitor shows up under "By
  // Account" only if it has an account-grain spend check, and under "By
  // Client" only if it has a client-grain one. Platform-grain spend checks
  // (e.g. the V_SPEND_DAILY family) have neither, so they never appear here.
  const spendMonitors = (data || []).filter((m) => m.checks.some((c) => c.domain === "SPEND" && c.granularity === granularityMode))

  type FilterKey = "tag" | "sourceLayer" | "platform" | "name"
  const activeFilters: Record<FilterKey, string> = {
    tag: tagFilter,
    sourceLayer: sourceLayerFilter,
    platform: platformFilter,
    name: nameFilter,
  }

  // Applies every filter except `excludeKey` — used both for the final
  // displayed list (excludeKey = null) and for computing each dropdown's own
  // options scoped to the OTHER active filters (cascading facets).
  function scopedMonitors(excludeKey: FilterKey | null): Monitor[] {
    return spendMonitors.filter((m) => {
      if (m.enabled !== showActive) return false
      if (excludeKey !== "tag" && activeFilters.tag && !(m.tags || []).includes(activeFilters.tag)) return false
      if (excludeKey !== "sourceLayer" && activeFilters.sourceLayer && m.sourceLayer !== activeFilters.sourceLayer) return false
      if (excludeKey !== "platform" && activeFilters.platform && m.platform !== activeFilters.platform) return false
      if (excludeKey !== "name" && activeFilters.name) {
        const regex = new RegExp(`\\b${activeFilters.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
        if (!regex.test(m.monitorName) && !regex.test(m.targetTable)) return false
      }
      return true
    })
  }

  // Include the currently selected value even if the other active filters
  // would otherwise exclude it, so a selection never silently vanishes from
  // its own dropdown — it'll just show 0 monitors if the combination is empty.
  function optionsFor(excludeKey: FilterKey, current: string, extract: (m: Monitor) => string[]): string[] {
    const values = new Set(scopedMonitors(excludeKey).flatMap(extract))
    if (current) values.add(current)
    return [...values].sort()
  }

  const allTags = optionsFor("tag", tagFilter, (m) => m.tags || [])
  const allSourceLayers = optionsFor("sourceLayer", sourceLayerFilter, (m) => [m.sourceLayer])
  const allPlatforms = optionsFor("platform", platformFilter, (m) => [m.platform])

  const monitors = scopedMonitors(null)

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-xl sm:text-2xl font-semibold">Spend Monitors ({monitors.length})</h2>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setGranularityMode("ACCOUNT")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              granularityMode === "ACCOUNT" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            By Account
          </button>
          <button
            onClick={() => setGranularityMode("CLIENT")}
            className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
              granularityMode === "CLIENT" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            By Client
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <input
          type="text"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Search monitor name or table..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-64"
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Platforms</option>
          {allPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={sourceLayerFilter}
          onChange={(e) => setSourceLayerFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Source Layers</option>
          {allSourceLayers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setShowActive((v) => !v)}
          role="switch"
          aria-checked={showActive}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-input rounded-md bg-background hover:bg-accent transition-colors w-full sm:w-auto sm:ml-auto"
        >
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${showActive ? "bg-green-600" : "bg-muted-foreground/30"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showActive ? "translate-x-[19px]" : "translate-x-1"}`} />
          </span>
          {showActive ? "Active Monitors" : "Inactive Monitors"}
        </button>
      </div>

      <div className="space-y-3">
        {monitors.map((m, i) => {
          const spendChecks = m.checks.filter((c) => c.domain === "SPEND" && c.granularity === granularityMode)
          const isOpen = expanded.has(m.monitorId)
          return (
            <div key={`${m.monitorId}-${i}`} className="border border-border rounded-lg overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggle(m.monitorId)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(m.monitorId) } }}
                className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/30 transition-colors text-left cursor-pointer"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {m.monitorName}
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(m.monitorId)); setCopiedId(m.monitorId); setTimeout(() => setCopiedId(null), 1500) }}
                      className="inline-flex items-center gap-0.5 ml-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy Monitor ID"
                    >
                      <span className="text-xs font-normal">#{m.monitorId}</span>
                      {copiedId === m.monitorId ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.targetDatabase}.{m.targetSchema}.{m.targetTable}
                  </div>
                </div>
                <span className="hidden sm:inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary shrink-0">
                  {m.platform}
                </span>
                {m.tags.length > 0 && (
                  <div className="hidden md:flex flex-wrap gap-1 shrink-0">
                    {m.tags.map((t) => (
                      <TagBadge key={t} tag={t} colorMap={tagColors} />
                    ))}
                  </div>
                )}
                <div className="text-xs text-muted-foreground shrink-0 hidden md:block">
                  {m.lastRun ? formatPST(m.lastRun) : "—"}
                </div>
                {m.enabled ? (
                  <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                )}
              </div>

              {isOpen && (
                <div className="border-t border-border bg-muted/20 px-3 sm:px-4 py-3 space-y-4">
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Schedule:</span>{" "}
                      {m.scheduleCron
                        ? m.scheduleCron
                        : m.taskName
                        ? `Task: ${m.taskName}`
                        : m.parentSchedule
                        ? `${m.parentSchedule} (parent task: ${m.parentTaskName})`
                        : m.primaryProcedure
                        ? `Runs via parent job: ${m.primaryProcedure}`
                        : "—"}
                    </div>
                    <div><span className="text-muted-foreground">Last Run:</span> {formatPST(m.lastRun)}</div>
                    <div><span className="text-muted-foreground">Source Layer:</span> {m.sourceLayer}</div>
                    <div><span className="text-muted-foreground">Platform:</span> {m.platform}</div>
                  </div>

                  <SpendMonitorChart
                    monitorId={m.monitorId}
                    spendCheckTypes={spendChecks.map((c) => c.checkType)}
                    enabled={isOpen}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
