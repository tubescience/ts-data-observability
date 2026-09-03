"use client"

import { useState } from "react"
import { X, Copy, Radio } from "lucide-react"
import { formatTick } from "@/components/chart-utils"

// Check types with an account/client GROUP_VALUE that maps to a real ad-platform
// spend figure — the only ones live spend validation can meaningfully check.
export const LIVE_SPEND_CHECK_TYPES = new Set([
  "SPEND_CLIENT",
  "SPEND_ACCOUNT",
  "SRC_SPEND_CLIENT",
  "SRC_SPEND_ACCOUNT",
  "SUM_VALUE_GROUPED",
])

interface LiveSpendRow {
  account_id?: string
  account_name?: string
  client_name?: string
  currency?: string
  snowflake_spend?: number
  // ADPIP (TGT_ADPIP_REPORT.V_SPEND_DAILY) is a second reporting layer the
  // validation service started returning alongside snowflake_spend (MCP's
  // V_SPEND_DAILY) -- absent on older/cached responses, so treat as optional.
  adpip_spend?: number | null
  platform_spend?: number | null
  diff?: number | null
  diff_pct?: number | null
  diff_adpip?: number | null
  diff_adpip_pct?: number | null
  error?: string | null
}

interface LiveSpendPlatformResult {
  platform: string
  status?: string
  message?: string
  rows?: LiveSpendRow[]
  // Client-level checks compare two internal reporting layers instead of a live
  // platform API -- these override the generic "Our Data"/"Live API" labels and
  // footer note so the table doesn't misrepresent what's actually being compared.
  ourLabel?: string
  compareLabel?: string
  note?: string
}

export interface LiveSpendTarget {
  checkType: string
  targetTable: string
  groupValue: string | null
  createdAt: string | null
}

// Encapsulates the fetch + popup-visibility state so both Incident Detail
// and the Resolve Incident screen can trigger the same live spend check.
export function useLiveSpendCheck() {
  const [checkingLiveSpend, setCheckingLiveSpend] = useState(false)
  const [liveSpendResult, setLiveSpendResult] = useState<{ date: string; results: LiveSpendPlatformResult[] } | null>(null)
  const [liveSpendError, setLiveSpendError] = useState("")
  const [showLiveSpendPopup, setShowLiveSpendPopup] = useState(false)
  const [liveSpendCheckType, setLiveSpendCheckType] = useState("")

  const runLiveSpendCheck = async (target: LiveSpendTarget) => {
    setShowLiveSpendPopup(true)
    setCheckingLiveSpend(true)
    setLiveSpendResult(null)
    setLiveSpendError("")
    setLiveSpendCheckType(target.checkType)
    try {
      const res = await fetch("/api/incidents/validate-vs-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkType: target.checkType,
          targetTable: target.targetTable,
          groupValue: target.groupValue,
          createdAt: target.createdAt,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setLiveSpendError(json.error || `Error ${res.status}`)
        return
      }
      setLiveSpendResult(json)
    } catch (err) {
      setLiveSpendError(err instanceof Error ? err.message : "Live spend check failed")
    } finally {
      setCheckingLiveSpend(false)
    }
  }

  return {
    checkingLiveSpend,
    liveSpendResult,
    liveSpendError,
    showLiveSpendPopup,
    setShowLiveSpendPopup,
    liveSpendCheckType,
    runLiveSpendCheck,
  }
}

// Full-precision, comma-grouped quantity (e.g. "2,352.52") — resolution
// notes shouldn't get the K/M-abbreviated formatTick used in the charts.
function formatFullQty(value: number | null | undefined): string {
  if (value == null) return "—"
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  pinterest: "Pinterest",
  applovin: "AppLovin",
  reporting: "Client Spend (Reporting Comparison)",
}

function LiveSpendPlatformPanel({ result, onUseInResolve }: { result: LiveSpendPlatformResult; onUseInResolve: (text: string) => void }) {
  const label = PLATFORM_LABELS[result.platform] || result.platform

  if (result.status === "error") {
    return (
      <div className="border border-border rounded-lg p-3 bg-muted/20">
        <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
        <div className="text-sm text-destructive">{result.message}</div>
      </div>
    )
  }

  const rows = result.rows || []
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-lg p-3 bg-muted/20">
        <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
        <div className="text-sm text-muted-foreground">{result.message || "No rows returned."}</div>
      </div>
    )
  }

  const ourLabel = result.ourLabel || "MCP V_SPEND_DAILY"
  const compareLabel = result.compareLabel || "Live API"
  const adpipLabel = "ADPIP V_SPEND_DAILY"
  const hasAdpip = rows.some((r) => r.adpip_spend != null)

  const validRows = rows.filter((r) => !r.error)
  const totalOur = validRows.reduce((sum, r) => sum + (r.snowflake_spend ?? 0), 0)
  const totalAdpip = validRows.reduce((sum, r) => sum + (r.adpip_spend ?? 0), 0)
  const totalApi = validRows.reduce((sum, r) => sum + (r.platform_spend ?? 0), 0)
  const totalDiffPct = totalApi !== 0 ? ((totalOur - totalApi) / totalApi) * 100 : null
  const totalAdpipDiffPct = totalApi !== 0 ? ((totalAdpip - totalApi) / totalApi) * 100 : null
  const currencies = new Set(validRows.map((r) => r.currency).filter(Boolean))
  const totalCurrency = currencies.size === 1 ? [...currencies][0] : undefined
  const totalCloseMatch = totalDiffPct != null && Math.abs(totalDiffPct) <= 2
  const totalAdpipCloseMatch = totalAdpipDiffPct != null && Math.abs(totalAdpipDiffPct) <= 2
  const totalDiffText = totalDiffPct != null ? `${totalDiffPct > 0 ? "+" : ""}${totalDiffPct.toFixed(2)}%` : "—"
  const totalAdpipDiffText = totalAdpipDiffPct != null ? `${totalAdpipDiffPct > 0 ? "+" : ""}${totalAdpipDiffPct.toFixed(2)}%` : "—"
  const totalResolveMessage =
    `Validated vs ${compareLabel}: ${label} — All accounts\n` +
    `${ourLabel}: ${formatFullQty(totalOur)}${totalCurrency ? " " + totalCurrency : ""}  ` +
    (hasAdpip ? `${adpipLabel}: ${formatFullQty(totalAdpip)}${totalCurrency ? " " + totalCurrency : ""}  ` : "") +
    `${compareLabel}: ${formatFullQty(totalApi)}${totalCurrency ? " " + totalCurrency : ""}  ` +
    `Diff: ${totalDiffText}` +
    (hasAdpip ? ` (ADPIP diff: ${totalAdpipDiffText})` : "")

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-muted/50 text-xs font-semibold">{label}</div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-xs">Account / Client</th>
            <th className="text-right px-3 py-1.5 font-medium text-xs">{ourLabel}</th>
            {hasAdpip && <th className="text-right px-3 py-1.5 font-medium text-xs">{adpipLabel}</th>}
            <th className="text-right px-3 py-1.5 font-medium text-xs">{compareLabel}</th>
            <th className="text-right px-3 py-1.5 font-medium text-xs">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => {
            const hasError = !!row.error
            const closeMatch = !hasError && row.diff_pct != null && Math.abs(row.diff_pct) <= 2
            const adpipCloseMatch = !hasError && row.diff_adpip_pct != null && Math.abs(row.diff_adpip_pct) <= 2
            const name = row.account_name || row.client_name || row.account_id || ""
            const id = row.account_id || ""
            const diffText = row.diff_pct != null ? `${row.diff_pct > 0 ? "+" : ""}${row.diff_pct.toFixed(2)}%` : "—"
            const adpipDiffText = row.diff_adpip_pct != null ? `${row.diff_adpip_pct > 0 ? "+" : ""}${row.diff_adpip_pct.toFixed(2)}%` : "—"
            const resolveMessage =
              `Validated vs ${compareLabel}: ${id} ${name}\n` +
              `${ourLabel}: ${formatFullQty(row.snowflake_spend)}${row.currency ? " " + row.currency : ""} (${diffText})\n` +
              (row.adpip_spend != null
                ? `${adpipLabel}: ${formatFullQty(row.adpip_spend)}${row.currency ? " " + row.currency : ""} (${adpipDiffText})\n`
                : "") +
              `${compareLabel}: ${formatFullQty(row.platform_spend)}${row.currency ? " " + row.currency : ""}`
            return (
              <tr key={i}>
                <td className="px-3 py-2 text-xs">
                  <div>{row.account_name || row.account_id || "—"}</div>
                  {row.client_name && <div className="text-muted-foreground">{row.client_name}</div>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <div>
                    {row.snowflake_spend != null ? formatTick(row.snowflake_spend) : "—"}
                    {row.currency && <span className="text-muted-foreground ml-1">{row.currency}</span>}
                  </div>
                  {!hasError && row.diff_pct != null && (
                    <div className={closeMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      {row.diff_pct > 0 ? "+" : ""}{row.diff_pct.toFixed(1)}%
                    </div>
                  )}
                </td>
                {hasAdpip && (
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <div>
                      {row.adpip_spend != null ? formatTick(row.adpip_spend) : "—"}
                      {row.adpip_spend != null && row.currency && <span className="text-muted-foreground ml-1">{row.currency}</span>}
                    </div>
                    {!hasError && row.diff_adpip_pct != null && (
                      <div className={adpipCloseMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {row.diff_adpip_pct > 0 ? "+" : ""}{row.diff_adpip_pct.toFixed(1)}%
                      </div>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {hasError ? (
                    <span className="text-muted-foreground italic">{row.error}</span>
                  ) : row.platform_spend != null ? (
                    formatTick(row.platform_spend)
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {(name || id) && (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigator.clipboard.writeText(resolveMessage)}
                        className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded hover:bg-accent transition-colors"
                        title="Copy validation summary"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onUseInResolve(resolveMessage)}
                        className="px-2 py-1 text-xs font-medium border border-border rounded hover:bg-accent transition-colors whitespace-nowrap"
                        title="Insert into the Resolve Incident message box"
                      >
                        Use in Resolve
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-3 py-2 text-xs">Total ({validRows.length} account{validRows.length !== 1 ? "s" : ""})</td>
              <td className="px-3 py-2 text-right font-mono text-xs">
                <div>
                  {formatTick(totalOur)}
                  {totalCurrency && <span className="text-muted-foreground ml-1 font-normal">{totalCurrency}</span>}
                </div>
                <div className={totalCloseMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {totalDiffPct != null ? `${totalDiffPct > 0 ? "+" : ""}${totalDiffPct.toFixed(1)}%` : "—"}
                </div>
              </td>
              {hasAdpip && (
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <div>
                    {formatTick(totalAdpip)}
                    {totalCurrency && <span className="text-muted-foreground ml-1 font-normal">{totalCurrency}</span>}
                  </div>
                  <div className={totalAdpipCloseMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                    {totalAdpipDiffPct != null ? `${totalAdpipDiffPct > 0 ? "+" : ""}${totalAdpipDiffPct.toFixed(1)}%` : "—"}
                  </div>
                </td>
              )}
              <td className="px-3 py-2 text-right font-mono text-xs">
                {formatTick(totalApi)}
                {totalCurrency && <span className="text-muted-foreground ml-1 font-normal">{totalCurrency}</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => navigator.clipboard.writeText(totalResolveMessage)}
                    className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded hover:bg-accent transition-colors"
                    title="Copy total validation summary"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onUseInResolve(totalResolveMessage)}
                    className="px-2 py-1 text-xs font-medium border border-border rounded hover:bg-accent transition-colors whitespace-nowrap"
                    title="Insert total into the Resolve Incident message box"
                  >
                    Use in Resolve
                  </button>
                </div>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
      <div className="px-3 py-2 bg-muted/20 text-xs text-muted-foreground">
        {result.note || "Spend shown in each account's native currency, not USD — small diffs can be normal timing/rounding."}
      </div>
    </div>
  )
}

// Client checks never hit a live ad-platform API (see runClientSpendComparison
// server-side) -- SUM_VALUE_GROUPED/DATA_RECENCY only fall back to that path for
// incidents grouped by client, so the platform-API wording still fits them best.
const CLIENT_CHECK_TYPES = new Set(["SPEND_CLIENT", "SRC_SPEND_CLIENT"])

export function LiveSpendPopup({
  loading,
  error,
  result,
  checkType,
  onClose,
  onUseInResolve,
}: {
  loading: boolean
  error: string
  result: { date: string; results: LiveSpendPlatformResult[] } | null
  checkType?: string
  onClose: () => void
  onUseInResolve: (text: string) => void
}) {
  const loadingMessage = checkType && CLIENT_CHECK_TYPES.has(checkType)
    ? "Comparing TGT_ADPIP_REPORT vs MCP Reporting spend..."
    : "Checking live spend against the platform API..."

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-semibold flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-500" />
            Live Spend Validation
            {result && <span className="text-xs font-normal text-muted-foreground">for {result.date}</span>}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 animate-pulse py-8">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {loadingMessage}
            </div>
          )}
          {error && <div className="text-destructive text-sm text-center py-4">{error}</div>}
          {result && result.results.map((platformResult, i) => (
            <LiveSpendPlatformPanel key={i} result={platformResult} onUseInResolve={onUseInResolve} />
          ))}
        </div>

        <div className="flex justify-end p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm border border-border rounded-md hover:bg-accent transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
