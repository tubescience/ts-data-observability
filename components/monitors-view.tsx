"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle, XCircle, ChevronDown, ChevronRight, BarChart3, Copy, Check } from "lucide-react"
import { MonitorHistory } from "@/components/monitor-history"
import { useTagColors, TagBadge } from "@/components/tag-colors"
import { SeverityBadge } from "@/components/severity-badge"

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
  dateColumn: string | null
  keyColumns: string | null
  nullColumns: string | null
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
  tags: string[]
  lastRun: string | null
  createdAt: string | null
  checks: Check[]
}

export function MonitorsView() {
  const tagColors = useTagColors()
  const { data, isLoading, error } = useQuery<Monitor[]>({
    queryKey: ["monitors"],
    queryFn: () => fetch("/api/monitors").then((r) => r.json()),
  })

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [nameFilter, setNameFilter] = useState<string>("")
  const [tagFilter, setTagFilter] = useState<string>("")
  const [sourceLayerFilter, setSourceLayerFilter] = useState<string>("")
  const [granularityFilter, setGranularityFilter] = useState<string>("")
  const [domainFilter, setDomainFilter] = useState<string>("")
  const [historyMonitor, setHistoryMonitor] = useState<Monitor | null>(null)

  if (isLoading) return <div className="text-muted-foreground">Loading monitors...</div>
  if (error) return <div className="text-destructive">Failed to load monitors</div>

  const allMonitors = data || []

  type FilterKey = "status" | "tag" | "sourceLayer" | "granularity" | "domain" | "name"
  const activeFilters: Record<FilterKey, string> = {
    status: statusFilter,
    tag: tagFilter,
    sourceLayer: sourceLayerFilter,
    granularity: granularityFilter,
    domain: domainFilter,
    name: nameFilter,
  }

  // Applies every filter except `excludeKey` — used both for the final
  // displayed list (excludeKey = null) and for computing each dropdown's own
  // options scoped to the OTHER active filters (cascading facets).
  function scopedMonitors(excludeKey: FilterKey | null): Monitor[] {
    return allMonitors.filter((m) => {
      if (excludeKey !== "status") {
        if (activeFilters.status === "enabled" && !m.enabled) return false
        if (activeFilters.status === "disabled" && m.enabled) return false
      }
      if (excludeKey !== "tag" && activeFilters.tag && !(m.tags || []).includes(activeFilters.tag)) return false
      if (excludeKey !== "sourceLayer" && activeFilters.sourceLayer && m.sourceLayer !== activeFilters.sourceLayer) return false
      if (excludeKey !== "granularity" && activeFilters.granularity && !m.checks.some((c) => c.granularity === activeFilters.granularity)) return false
      if (excludeKey !== "domain" && activeFilters.domain && !m.checks.some((c) => c.domain === activeFilters.domain)) return false
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
  const allGranularities = optionsFor("granularity", granularityFilter, (m) => m.checks.map((c) => c.granularity))
  const allDomains = optionsFor("domain", domainFilter, (m) => m.checks.map((c) => c.domain))

  const monitors = scopedMonitors(null)

  const enabledCount = monitors.filter((m) => m.enabled).length

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
        <h2 className="text-xl sm:text-2xl font-semibold">Monitors ({monitors.length})</h2>
        <span className="text-sm text-muted-foreground">{enabledCount} enabled</span>
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Statuses</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
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
          value={granularityFilter}
          onChange={(e) => setGranularityFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Granularities</option>
          {allGranularities.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {monitors.map((m, i) => (
          <div key={`${m.monitorId}-${i}`} className="border border-border rounded-lg overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => toggle(m.monitorId)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(m.monitorId) } }}
              className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/30 transition-colors text-left cursor-pointer"
            >
              {expanded.has(m.monitorId) ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              {m.enabled ? (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
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
              <div className="text-xs text-muted-foreground shrink-0">
                {m.checks.length} check{m.checks.length !== 1 ? "s" : ""}
              </div>
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
            </div>

            {expanded.has(m.monitorId) && (
              <div className="border-t border-border bg-muted/20 px-3 sm:px-4 py-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div><span className="text-muted-foreground">Owner:</span> {m.owner}</div>
                    <div><span className="text-muted-foreground">Warehouse:</span> {m.warehouse || "—"}</div>
                    <div><span className="text-muted-foreground">Schedule:</span> {m.scheduleCron || "—"}</div>
                    <div><span className="text-muted-foreground">Last Run:</span> {formatPST(m.lastRun)}</div>
                    <div><span className="text-muted-foreground">Task:</span> {m.taskName || "—"}</div>
                    <div><span className="text-muted-foreground">Source Layer:</span> {m.sourceLayer}</div>
                  </div>
                  <button
                    onClick={() => setHistoryMonitor(m)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-full sm:w-auto"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    History
                  </button>
                </div>
                {m.description && (
                  <div className="text-xs text-muted-foreground">{m.description}</div>
                )}

                {m.checks.length > 0 && (
                  <>
                    {/* Desktop checks table */}
                    <div className="responsive-table-desktop border border-border rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-2 py-1.5 font-medium">Enabled</th>
                            <th className="text-left px-2 py-1.5 font-medium">Check Type</th>
                            <th className="text-left px-2 py-1.5 font-medium">Domain</th>
                            <th className="text-left px-2 py-1.5 font-medium">Granularity</th>
                            <th className="text-left px-2 py-1.5 font-medium">Severity</th>
                            <th className="text-left px-2 py-1.5 font-medium">Threshold</th>
                            <th className="text-left px-2 py-1.5 font-medium">Columns</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {m.checks.map((c) => (
                            <tr key={c.configId} className="hover:bg-muted/30">
                              <td className="px-2 py-1.5">
                                {c.enabled ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                              </td>
                              <td className="px-2 py-1.5 font-mono">{c.checkType}</td>
                              <td className="px-2 py-1.5">{c.domain}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{c.granularity}</td>
                              <td className="px-2 py-1.5">
                                <SeverityBadge severity={c.severity} />
                              </td>
                              <td className="px-2 py-1.5">
                                {c.thresholdPct != null && `${c.thresholdPct}%`}
                                {c.thresholdValue != null && c.thresholdPct == null && c.thresholdValue}
                                {c.thresholdPct == null && c.thresholdValue == null && "—"}
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">
                                {[c.dateColumn, c.keyColumns, c.nullColumns, c.sumColumn, c.groupByColumn].filter(Boolean).join(", ") || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile checks cards */}
                    <div className="responsive-table-mobile space-y-2">
                      {m.checks.map((c) => (
                        <div key={c.configId} className="border border-border rounded-md p-2.5 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-medium">{c.checkType}</span>
                            {c.enabled ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          </div>
                          <div className="text-muted-foreground">{c.domain} · {c.granularity}</div>
                          <div className="flex items-center gap-2">
                            <SeverityBadge severity={c.severity} />
                            <span className="text-muted-foreground">
                              {c.thresholdPct != null ? `${c.thresholdPct}%` : c.thresholdValue != null ? c.thresholdValue : "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {historyMonitor && (
        <MonitorHistory
          monitorId={historyMonitor.monitorId}
          monitorName={historyMonitor.monitorName}
          targetTable={`${historyMonitor.targetDatabase}.${historyMonitor.targetSchema}.${historyMonitor.targetTable}`}
          onClose={() => setHistoryMonitor(null)}
        />
      )}
    </div>
  )
}
