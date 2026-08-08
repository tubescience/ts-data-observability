"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ResponsiveTable, TableColumn } from "@/components/ui/responsive-table"

interface SpendResult {
  checkType: string
  targetTable: string
  status: string
  metricValue: number | null
  threshold: number | null
  groupValue: string | null
  checkTimestamp: string | null
  category: string
}

function getPSTToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

export function SpendView() {
  const today = getPSTToday()
  const [dateStart, setDateStart] = useState(today)
  const [dateEnd, setDateEnd] = useState(today)
  const [spendStatus, setSpendStatus] = useState("")
  const [spendCheck, setSpendCheck] = useState("SPEND_PLATFORM")
  const [spendPlatform, setSpendPlatform] = useState("")
  const [revenueStatus, setRevenueStatus] = useState("")
  const [revenueCheck, setRevenueCheck] = useState("SUM_VALUE_GROUPED")
  const [revenuePlatform, setRevenuePlatform] = useState("")

  const { data, isLoading, error } = useQuery<SpendResult[]>({
    queryKey: ["spend"],
    queryFn: () => fetch("/api/spend").then((r) => r.json()),
  })

  if (isLoading) return <div className="text-muted-foreground">Loading spend data...</div>
  if (error) return <div className="text-destructive">Failed to load spend data</div>

  const allResults = data || []

  const dateFiltered = allResults.filter((r) => {
    if (dateStart && r.checkTimestamp && r.checkTimestamp.slice(0, 10) < dateStart) return false
    if (dateEnd && r.checkTimestamp && r.checkTimestamp.slice(0, 10) > dateEnd) return false
    return true
  })

  const spendAll = dateFiltered.filter((r) => r.category === "SPEND")
  const revenueAll = dateFiltered.filter((r) => r.category === "REVENUE")

  const spendCheckTypes = [...new Set(spendAll.map((r) => r.checkType))].sort()
  const spendStatuses = [...new Set(spendAll.map((r) => r.status))].sort()
  const spendPlatforms = [...new Set(spendAll.map((r) => r.groupValue).filter(Boolean))].sort()

  const revenueCheckTypes = [...new Set(revenueAll.map((r) => r.checkType))].sort()
  const revenueStatuses = [...new Set(revenueAll.map((r) => r.status))].sort()
  const revenuePlatforms = [...new Set(revenueAll.map((r) => r.groupValue).filter(Boolean))].sort()

  const spendResults = spendAll.filter((r) => {
    if (spendStatus && r.status !== spendStatus) return false
    if (spendCheck && r.checkType !== spendCheck) return false
    if (spendPlatform && r.groupValue !== spendPlatform) return false
    return true
  })

  const revenueResults = revenueAll.filter((r) => {
    if (revenueStatus && r.status !== revenueStatus) return false
    if (revenueCheck && r.checkType !== revenueCheck) return false
    if (revenuePlatform && r.groupValue !== revenuePlatform) return false
    return true
  })

  const spendColumns: TableColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (_, row) => (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${row.status === "PASS" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"}`}>
          {row.status}
        </span>
      ),
    },
    { key: "checkType", label: "Check", className: "font-mono text-xs", hideOnMobile: true },
    { key: "groupValue", label: "Platform", className: "font-medium text-xs", render: (val) => val || "—" },
    {
      key: "metricValue",
      label: "Value",
      className: "font-mono text-xs",
      render: (val, row) => val != null ? "$" + val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
    },
    {
      key: "threshold",
      label: "Threshold",
      className: "font-mono text-xs",
      hideOnMobile: true,
      render: (val) => val != null ? "$" + val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
    },
    {
      key: "checkTimestamp",
      label: "Time (PST)",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
  ]

  const revenueColumns: TableColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (_, row) => (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${row.status === "PASS" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"}`}>
          {row.status}
        </span>
      ),
    },
    { key: "checkType", label: "Check", className: "font-mono text-xs", hideOnMobile: true },
    { key: "groupValue", label: "Platform", className: "font-medium text-xs", render: (val) => val || "—" },
    {
      key: "metricValue",
      label: "Value",
      className: "font-mono text-xs",
      render: (val) => val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
    },
    {
      key: "threshold",
      label: "Threshold",
      className: "font-mono text-xs",
      hideOnMobile: true,
      render: (val) => val != null ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—",
    },
    {
      key: "checkTimestamp",
      label: "Time (PST)",
      className: "text-xs text-muted-foreground",
      render: (val) => formatPST(val),
    },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold">Spend & Revenue Results</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1 text-xs text-muted-foreground col-span-1 sm:col-span-2 md:col-span-1">
          <span>From</span>
          <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none" />
          <span>To</span>
          <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
            className="border border-input rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring flex-1 md:flex-none" />
        </div>
      </div>

      {/* SPEND Section */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium">Platform Spend</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 md:flex md:flex-wrap gap-3 items-center">
          <select value={spendCheck} onChange={(e) => setSpendCheck(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Checks</option>
            {spendCheckTypes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={spendStatus} onChange={(e) => setSpendStatus(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Statuses</option>
            {spendStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={spendPlatform} onChange={(e) => setSpendPlatform(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Platforms</option>
            {spendPlatforms.map((p) => <option key={p} value={p!}>{p}</option>)}
          </select>
        </div>
        <ResponsiveTable columns={spendColumns} data={spendResults} emptyMessage="No spend results" />
      </div>

      {/* REVENUE Section */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium">Revenue</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 md:flex md:flex-wrap gap-3 items-center">
          <select value={revenueCheck} onChange={(e) => setRevenueCheck(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Checks</option>
            {revenueCheckTypes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={revenueStatus} onChange={(e) => setRevenueStatus(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Statuses</option>
            {revenueStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={revenuePlatform} onChange={(e) => setRevenuePlatform(e.target.value)}
            className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-auto">
            <option value="">All Platforms</option>
            {revenuePlatforms.map((p) => <option key={p} value={p!}>{p}</option>)}
          </select>
        </div>
        <ResponsiveTable columns={revenueColumns} data={revenueResults} emptyMessage="No revenue results" />
      </div>
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
