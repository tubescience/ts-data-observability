"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { X, Radar, Copy, Check, ArrowUp, ArrowDown, Minus, Lightbulb, CheckCircle2, AlertCircle, Radio, TrendingUp, ChevronDown, ChevronRight } from "lucide-react"
import { useTagColors, TagBadges, TagMultiSelect } from "@/components/tag-colors"
import { IncidentDetail } from "@/components/incident-detail"
import { MonitorDetailPopup } from "@/components/monitor-detail-popup"
import { SuggestedResolutionPopup, buildSuggestionMessage } from "@/components/suggested-resolution-popup"
import { LIVE_SPEND_CHECK_TYPES, useLiveSpendCheck, LiveSpendPopup } from "@/components/live-spend-check"
import { ML_FORECAST_CHECK_TYPES, useMlForecastCheck, MlForecastPopup } from "@/components/ml-forecast-check"
import { useValidateIncidentCheck, ValidateIncidentToasts } from "@/components/validate-incident-check"
import { ResolvedIncidents } from "@/components/resolved-incidents"
import { AnomaliesView } from "@/components/anomalies-view"
import { SeverityBadge } from "@/components/severity-badge"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"
import { formatTick } from "@/components/chart-utils"

interface Incident {
  incidentId: number
  incidentKey: string
  checkType: string
  targetTable: string
  groupValue: string | null
  groupName: string | null
  monitorId: number | null
  tags: string[]
  severity: string
  status: string
  failureCount: number
  lastMetric: number | null
  lastThreshold: number | null
  thresholdMin: number | null
  thresholdMax: number | null
  suggestedResolution: string | null
  suggestedResolutionReason: string | null
  firstSeen: string | null
  lastSeen: string | null
  createdAt: string | null
}

function getPSTDateOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

interface IncidentGroup {
  key: string
  checkType: string
  groupValue: string | null
  groupName: string | null
  targetTable: string | null
  incidents: Incident[]
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

function worstSeverity(incidents: Incident[]): string {
  return incidents.reduce(
    (worst, i) => ((SEVERITY_RANK[i.severity] || 0) > (SEVERITY_RANK[worst] || 0) ? i.severity : worst),
    incidents[0]?.severity || "MEDIUM"
  )
}

export function OpenIncidents() {
  const tagColors = useTagColors()
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [resolvingGroup, setResolvingGroup] = useState<IncidentGroup | null>(null)
  const [groupNotes, setGroupNotes] = useState("")
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // Tracks which Resolve screen actually triggered the check, so "Use in
  // Resolve" pastes back into that same screen's notes box rather than
  // always defaulting to the single-incident one.
  const [liveSpendOrigin, setLiveSpendOrigin] = useState<"single" | "group" | null>(null)
  const [mlForecastOrigin, setMlForecastOrigin] = useState<"single" | "group" | null>(null)
  const [viewing, setViewing] = useState<Incident | null>(null)
  const [viewingMonitorId, setViewingMonitorId] = useState<number | null>(null)
  const [viewingSuggestion, setViewingSuggestion] = useState<Incident | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [showAnomalies, setShowAnomalies] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [notes, setNotes] = useState("")
  const [severityFilter, setSeverityFilter] = useState("")
  const [checkFilter, setCheckFilter] = useState("")
  const [targetFilter, setTargetFilter] = useState("")
  const [groupFilter, setGroupFilter] = useState("")
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const today = getPSTDateOffset(0)
  const yesterday = getPSTDateOffset(-1)
  const thirtyDaysAgo = getPSTDateOffset(-30)
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const queryClient = useQueryClient()
  const liveSpend = useLiveSpendCheck()
  const mlForecast = useMlForecastCheck()
  const validateIncident = useValidateIncidentCheck()

  const { data, isLoading, error } = useQuery<Incident[]>({
    queryKey: ["incidents-open"],
    queryFn: () => fetch("/api/incidents/open").then((r) => r.json()),
  })

  const resolveMutation = useMutation({
    mutationFn: async ({ incidentIds, resolutionNotes }: { incidentIds: number[]; resolutionNotes: string }) => {
      const res = await fetch("/api/incidents/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentIds, resolutionNotes }),
      })
      if (!res.ok) throw new Error("Failed to resolve incident")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents-open"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      setResolving(null)
      setNotes("")
      setResolvingGroup(null)
      setGroupNotes("")
    },
  })

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (isLoading) return <div className="text-muted-foreground">Loading open incidents...</div>
  if (error) return <div className="text-destructive">Failed to load incidents</div>

  const allIncidents = data || []
  const severities = [...new Set(allIncidents.map((i) => i.severity))].sort()
  const checkTypes = [...new Set(allIncidents.map((i) => i.checkType))].sort()
  const allTags = [...new Set(allIncidents.flatMap((i) => i.tags))].sort()

  const matchesNonDateFilters = (i: Incident) => {
    if (severityFilter && i.severity !== severityFilter) return false
    if (checkFilter && i.checkType !== checkFilter) return false
    if (targetFilter && !i.targetTable.toLowerCase().includes(targetFilter.toLowerCase())) return false
    if (groupFilter && !(i.groupValue || "").toLowerCase().includes(groupFilter.toLowerCase()) && !(i.groupName || "").toLowerCase().includes(groupFilter.toLowerCase())) return false
    if (tagFilter.length > 0 && !tagFilter.every((t) => i.tags.includes(t))) return false
    return true
  }

  const incidents = allIncidents
    .filter((i) => {
      if (!matchesNonDateFilters(i)) return false
      if (dateStart && i.lastSeen && i.lastSeen.slice(0, 10) < dateStart) return false
      if (dateEnd && i.lastSeen && i.lastSeen.slice(0, 10) > dateEnd) return false
      return true
    })
    .sort((a, b) => {
      const check = a.checkType.localeCompare(b.checkType)
      if (check !== 0) return check
      const group = (a.groupName || a.groupValue || "").localeCompare(b.groupName || b.groupValue || "")
      if (group !== 0) return group
      const target = a.targetTable.localeCompare(b.targetTable)
      if (target !== 0) return target
      return (a.firstSeen || "").localeCompare(b.firstSeen || "")
    })

  // One accordion entry per (Check Type, Group) pair — matches the sort
  // order above, so groups come out already ordered by check type then group.
  // Only incidents sharing a real account/client groupValue represent the
  // same underlying entity and belong together. Checks with no groupValue
  // (table-total checks like FRESHNESS/ROW_COUNT), and checks grouped by
  // PLATFORM instead of account/client (e.g. V_SPEND_DAILY's SUM_VALUE_GROUPED
  // groups by codes like "TIK"/"FB"), are keyed by target table too, so
  // unrelated tables/monitors never get bundled together just because they
  // share a "No Group" bucket or a platform code.
  const PLATFORM_GROUP_VALUES = new Set([
    "YT", "GOOGLE", "TIK", "TIKTOK", "APLVN", "APPLOVIN",
    "FB", "FACEBOOK", "META", "SNAP", "SNAPCHAT", "PIN", "PINTEREST",
  ])
  const groups: IncidentGroup[] = []
  {
    const groupMap = new Map<string, IncidentGroup>()
    for (const inc of incidents) {
      const isEntityGroup = !!inc.groupValue && !PLATFORM_GROUP_VALUES.has(inc.groupValue.toUpperCase())
      const key = isEntityGroup ? `${inc.checkType}::${inc.groupValue}` : `${inc.checkType}::notarget::${inc.targetTable}`
      let g = groupMap.get(key)
      if (!g) {
        // Non-entity groups are bucketed by target table, not by groupValue — a single
        // group can span several platform codes (APLVN, TIK, YT...) sharing that table.
        // Showing one incident's groupValue as the group label would misrepresent the rest.
        g = {
          key,
          checkType: inc.checkType,
          groupValue: isEntityGroup ? inc.groupValue : null,
          groupName: isEntityGroup ? inc.groupName : null,
          targetTable: isEntityGroup ? null : inc.targetTable,
          incidents: [],
        }
        groupMap.set(key, g)
        groups.push(g)
      }
      g.incidents.push(inc)
    }
  }

  const incidentsIgnoringDate = allIncidents.filter(matchesNonDateFilters)
  const todayCount = incidentsIgnoringDate.filter((i) => i.lastSeen && i.lastSeen.slice(0, 10) === today).length
  const previousDaysCount = incidentsIgnoringDate.length - todayCount
  const isTodayFilter = dateStart === today && dateEnd === today
  const isPreviousDaysFilter = dateStart === thirtyDaysAgo && dateEnd === yesterday

  const columns: TableColumn[] = [
    {
      key: "incidentId",
      label: "ID",
      className: "text-xs font-mono",
      render: (val) => (
        <button
          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(String(val)); setCopiedId(val); setTimeout(() => setCopiedId(null), 1500) }}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy Incident ID"
        >
          <span>#{val}</span>
          {copiedId === val ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      ),
    },
    {
      key: "severity",
      label: "Severity",
      render: (_, row) => <SeverityBadge severity={row.severity} />,
    },
    {
      key: "targetTable",
      label: "Target",
      className: "max-w-[240px] truncate text-xs",
      render: (val) => <span title={val}>{val}</span>,
    },
    {
      key: "tags",
      label: "Tags",
      className: "text-xs",
      hideOnMobile: true,
      render: (_, row) => <TagBadges tags={(row as any).tags || []} colorMap={tagColors} />,
    },
    {
      key: "failureCount",
      label: "Failures",
      className: "text-xs",
    },
    {
      key: "lastMetric",
      label: "vs Threshold",
      className: "text-xs",
      render: (_, row) => <ThresholdIndicator metric={(row as any).lastMetric} threshold={(row as any).lastThreshold} />,
    },
    {
      key: "firstSeen",
      label: "First Seen",
      className: "text-xs text-muted-foreground",
      hideOnMobile: true,
      render: (val) => formatPST(val),
    },
    {
      key: "lastSeen",
      label: "Last Seen",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
    {
      key: "action",
      label: "Action",
      render: (_, row) => (
        <div className="flex items-center gap-1.5">
          {(row as any).monitorId != null && (
            <button
              onClick={(e) => { e.stopPropagation(); setViewingMonitorId((row as any).monitorId) }}
              className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded hover:bg-accent transition-colors min-h-[32px]"
              title="View Monitor"
            >
              <Radar className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setViewingSuggestion(row) }}
            className={`p-1.5 border border-border rounded hover:bg-accent transition-colors min-h-[32px] ${
              (row as any).suggestedResolution ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/40 hover:text-muted-foreground"
            }`}
            title={(row as any).suggestedResolution ? "View Suggested Resolution" : "No suggested resolution"}
          >
            <Lightbulb className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); validateIncident.runValidateIncidentCheck((row as any).incidentId) }}
            className="px-2 py-1 text-xs font-medium border border-border rounded hover:bg-accent transition-colors min-h-[32px]"
            title="Run VALIDATE_INCIDENT"
          >
            Validate
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setResolving(row) }}
            className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors min-h-[32px]"
          >
            Resolve
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl sm:text-2xl font-semibold">Open Incidents ({incidents.length})</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnomalies(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-border rounded-md hover:bg-accent transition-colors"
          >
            <AlertCircle className="w-4 h-4" />
            Anomalies
          </button>
          <button
            onClick={() => setShowResolved(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-border rounded-md hover:bg-accent transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            Resolved Incidents
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => { setDateStart(today); setDateEnd(today) }}
          className={`hover:underline transition-colors ${isTodayFilter ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {todayCount} Today
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          onClick={() => { setDateStart(thirtyDaysAgo); setDateEnd(yesterday) }}
          className={`hover:underline transition-colors ${isPreviousDaysFilter ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {previousDaysCount} Previous Days
        </button>
      </div>

      {/* Responsive filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Severities</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={checkFilter}
          onChange={(e) => setCheckFilter(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto"
        >
          <option value="">All Check Types</option>
          {checkTypes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Search target..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-40"
        />
        <input
          type="text"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          placeholder="Search group..."
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-36"
        />
        <TagMultiSelect allTags={allTags} selected={tagFilter} onChange={setTagFilter} colorMap={tagColors} className="w-full sm:w-auto" />
        <div className="flex items-center gap-1 text-xs text-muted-foreground col-span-1 sm:col-span-2 md:col-span-1">
          <span>From</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none"
          />
          <span>To</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none"
          />
        </div>
      </div>

      {groups.length === 0 && (
        <div className="text-muted-foreground text-center py-8 border border-border rounded-lg">No open incidents for selected filters</div>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const isSingle = group.incidents.length === 1
          const isOpen = expandedGroups.has(group.key)
          return (
            <div key={group.key} className="border border-border rounded-lg overflow-hidden">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(group.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(group.key) } }}
                className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/30 transition-colors text-left cursor-pointer"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <SeverityBadge severity={worstSeverity(group.incidents)} />
                <span className="font-mono text-xs shrink-0">{group.checkType}</span>
                <span className="text-sm font-medium truncate">
                  {group.groupValue ? (
                    group.groupName ? <>{group.groupName} <span className="text-muted-foreground font-normal">({group.groupValue})</span></> : group.groupValue
                  ) : group.targetTable ? (
                    <span className="break-all">{group.targetTable}</span>
                  ) : (
                    <span className="text-muted-foreground font-normal">No Group</span>
                  )}
                </span>
                {(() => {
                  const groupTags = [...new Set(group.incidents.flatMap((i) => i.tags))]
                  return groupTags.length > 0 ? (
                    <TagBadges tags={groupTags} colorMap={tagColors} />
                  ) : null
                })()}
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {group.incidents.length} incident{group.incidents.length !== 1 ? "s" : ""}
                </span>
                {isSingle && (
                  <button
                    onClick={(e) => { e.stopPropagation(); validateIncident.runValidateIncidentCheck(group.incidents[0].incidentId) }}
                    className="px-2 py-1 text-xs font-medium border border-border rounded hover:bg-accent transition-colors shrink-0"
                    title="Run VALIDATE_INCIDENT"
                  >
                    Validate
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); isSingle ? setResolving(group.incidents[0]) : setResolvingGroup(group) }}
                  className="px-2 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 transition-colors shrink-0"
                >
                  {isSingle ? "Resolve" : "Resolve All"}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border">
                  <ResponsiveTable
                    columns={columns}
                    data={group.incidents}
                    keyField="incidentId"
                    onRowClick={(row) => setViewing(row)}
                    emptyMessage="No incidents"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {viewing && (
        <IncidentDetail
          incident={viewing}
          onClose={() => setViewing(null)}
          onResolve={(inc, prefillNotes) => { setViewing(null); setResolving(inc); setNotes(prefillNotes || "") }}
        />
      )}

      {viewingMonitorId != null && (
        <MonitorDetailPopup
          monitorId={viewingMonitorId}
          onClose={() => setViewingMonitorId(null)}
        />
      )}

      {viewingSuggestion && (
        <SuggestedResolutionPopup
          resolution={viewingSuggestion.suggestedResolution}
          reason={viewingSuggestion.suggestedResolutionReason}
          onClose={() => setViewingSuggestion(null)}
          onUseInResolve={() => {
            setNotes(buildSuggestionMessage(viewingSuggestion.suggestedResolution, viewingSuggestion.suggestedResolutionReason))
            setResolving(viewingSuggestion)
            setViewingSuggestion(null)
          }}
        />
      )}

      {showAnomalies && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-end p-2 border-b border-border sticky top-0 bg-card z-10">
              <button onClick={() => setShowAnomalies(false)} className="text-muted-foreground hover:text-foreground p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <AnomaliesView />
            </div>
          </div>
        </div>
      )}

      {showResolved && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-end p-2 border-b border-border sticky top-0 bg-card z-10">
              <button onClick={() => setShowResolved(false)} className="text-muted-foreground hover:text-foreground p-2">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <ResolvedIncidents />
            </div>
          </div>
        </div>
      )}

      {resolving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Resolve Incident</h3>
              <button onClick={() => { setResolving(null); setNotes("") }} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Check:</span> {resolving.checkType}</div>
                <div className="break-all"><span className="text-muted-foreground">Target:</span> {resolving.targetTable}</div>
                {resolving.groupValue && (
                  <div>
                    <span className="text-muted-foreground">Group:</span>{" "}
                    {resolving.groupName ? <><span className="font-medium">{resolving.groupName}</span> ({resolving.groupValue})</> : resolving.groupValue}
                  </div>
                )}
                <div><span className="text-muted-foreground">Severity:</span> <SeverityBadge severity={resolving.severity} /></div>
                <div>
                  <span className="text-muted-foreground">Last Value:</span>{" "}
                  <span className="font-mono">{resolving.lastMetric != null ? formatTick(resolving.lastMetric) : "—"}</span>
                  {" · "}
                  <span className="text-muted-foreground">{resolving.thresholdMin != null ? "Min / Max:" : "Threshold:"}</span>{" "}
                  <span className="font-mono">
                    {resolving.thresholdMin != null && resolving.thresholdMax != null
                      ? `${formatTick(resolving.thresholdMin)} – ${formatTick(resolving.thresholdMax)}`
                      : resolving.lastThreshold != null ? formatTick(resolving.lastThreshold) : "—"}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Resolution / Action Taken</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-input rounded-md p-3 text-sm bg-background min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Describe the resolution or action taken..."
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border">
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:mr-auto">
                {LIVE_SPEND_CHECK_TYPES.has(resolving.checkType) && resolving.groupValue && (
                  <button
                    onClick={() => { setLiveSpendOrigin("single"); liveSpend.runLiveSpendCheck(resolving) }}
                    disabled={liveSpend.checkingLiveSpend}
                    className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-blue-500 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Radio className="w-4 h-4" />
                    {liveSpend.checkingLiveSpend ? "Checking..." : "Check Live Spend"}
                  </button>
                )}
                {ML_FORECAST_CHECK_TYPES.has(resolving.checkType) && resolving.groupValue && (
                  <button
                    onClick={() => { setMlForecastOrigin("single"); mlForecast.runMlForecastCheck(resolving) }}
                    disabled={mlForecast.checkingMlForecast}
                    className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrendingUp className="w-4 h-4" />
                    {mlForecast.checkingMlForecast ? "Checking..." : "Check ML Forecast"}
                  </button>
                )}
              </div>
              <button
                onClick={() => { setResolving(null); setNotes("") }}
                className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resolveMutation.mutate({ incidentIds: [resolving.incidentId], resolutionNotes: notes })}
                disabled={!notes.trim() || resolveMutation.isPending}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {resolveMutation.isPending ? "Saving..." : "Save Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resolvingGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Resolve All Incidents</h3>
              <button onClick={() => { setResolvingGroup(null); setGroupNotes("") }} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Check:</span> {resolvingGroup.checkType}</div>
                {resolvingGroup.groupValue && (
                  <div>
                    <span className="text-muted-foreground">Group:</span>{" "}
                    {resolvingGroup.groupName ? <><span className="font-medium">{resolvingGroup.groupName}</span> ({resolvingGroup.groupValue})</> : resolvingGroup.groupValue}
                  </div>
                )}
                <div><span className="text-muted-foreground">Incidents:</span> {resolvingGroup.incidents.length} (targets: {[...new Set(resolvingGroup.incidents.map((i) => i.targetTable))].length})</div>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Target</th>
                      <th className="text-left px-3 py-1.5 font-medium">Last Value</th>
                      <th className="text-left px-3 py-1.5 font-medium">Min / Max</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {resolvingGroup.incidents.map((i) => (
                      <tr key={i.incidentId}>
                        <td className="px-3 py-1.5 break-all">{i.targetTable}</td>
                        <td className="px-3 py-1.5 font-mono">{i.lastMetric != null ? formatTick(i.lastMetric) : "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">
                          {i.thresholdMin != null && i.thresholdMax != null
                            ? `${formatTick(i.thresholdMin)} – ${formatTick(i.thresholdMax)}`
                            : i.lastThreshold != null ? formatTick(i.lastThreshold) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Resolution / Action Taken</label>
                <textarea
                  value={groupNotes}
                  onChange={(e) => setGroupNotes(e.target.value)}
                  className="w-full border border-input rounded-md p-3 text-sm bg-background min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Describe the resolution or action taken — applied to every incident in this group..."
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 p-4 border-t border-border">
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:mr-auto">
                {LIVE_SPEND_CHECK_TYPES.has(resolvingGroup.checkType) && resolvingGroup.groupValue && (
                  <button
                    onClick={() => { setLiveSpendOrigin("group"); liveSpend.runLiveSpendCheck({ checkType: resolvingGroup.checkType, targetTable: resolvingGroup.incidents[0].targetTable, groupValue: resolvingGroup.groupValue, createdAt: resolvingGroup.incidents[0].createdAt }) }}
                    disabled={liveSpend.checkingLiveSpend}
                    className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-blue-500 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Radio className="w-4 h-4" />
                    {liveSpend.checkingLiveSpend ? "Checking..." : "Check Live Spend"}
                  </button>
                )}
                {ML_FORECAST_CHECK_TYPES.has(resolvingGroup.checkType) && resolvingGroup.groupValue && (
                  <button
                    onClick={() => { setMlForecastOrigin("group"); mlForecast.runMlForecastCheck({ checkType: resolvingGroup.checkType, groupValue: resolvingGroup.groupValue }) }}
                    disabled={mlForecast.checkingMlForecast}
                    className="px-4 py-2.5 text-sm inline-flex items-center gap-2 border border-purple-500 text-purple-600 dark:text-purple-400 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrendingUp className="w-4 h-4" />
                    {mlForecast.checkingMlForecast ? "Checking..." : "Check ML Forecast"}
                  </button>
                )}
              </div>
              <button
                onClick={() => { setResolvingGroup(null); setGroupNotes("") }}
                className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resolveMutation.mutate({ incidentIds: resolvingGroup.incidents.map((i) => i.incidentId), resolutionNotes: groupNotes })}
                disabled={!groupNotes.trim() || resolveMutation.isPending}
                className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {resolveMutation.isPending ? "Saving..." : `Resolve All (${resolvingGroup.incidents.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {liveSpend.showLiveSpendPopup && (
        <LiveSpendPopup
          loading={liveSpend.checkingLiveSpend}
          error={liveSpend.liveSpendError}
          result={liveSpend.liveSpendResult}
          checkType={liveSpend.liveSpendCheckType}
          onClose={() => liveSpend.setShowLiveSpendPopup(false)}
          onUseInResolve={(text) => {
            liveSpend.setShowLiveSpendPopup(false)
            if (liveSpendOrigin === "group") setGroupNotes(text)
            else setNotes(text)
          }}
        />
      )}

      {mlForecast.showMlForecastPopup && (
        <MlForecastPopup
          loading={mlForecast.checkingMlForecast}
          error={mlForecast.mlForecastError}
          result={mlForecast.mlForecastResult}
          onClose={() => mlForecast.setShowMlForecastPopup(false)}
          onUseInResolve={(text) => {
            mlForecast.setShowMlForecastPopup(false)
            if (mlForecastOrigin === "group") setGroupNotes(text)
            else setNotes(text)
          }}
        />
      )}

      <ValidateIncidentToasts toasts={validateIncident.toasts} onDismiss={validateIncident.dismissValidateToast} />
    </div>
  )
}

function formatPST(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  } catch {
    return iso.slice(0, 16).replace("T", " ")
  }
}

function ThresholdIndicator({ metric, threshold }: { metric: number | null; threshold: number | null }) {
  if (metric == null || threshold == null) return <span className="text-muted-foreground">—</span>

  const diff = metric - threshold
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus
  const color = diff < 0 ? "text-red-500" : diff > 0 ? "text-blue-500" : "text-muted-foreground"

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono ${color}`}
      title={`Value ${formatTick(metric)} vs threshold ${formatTick(threshold)}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {formatTick(metric)}
    </span>
  )
}
