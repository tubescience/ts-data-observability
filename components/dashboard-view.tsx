"use client"

import { useQuery } from "@tanstack/react-query"
import { Activity, AlertTriangle, CheckCircle, XCircle, ShieldCheck, Clock } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell } from "recharts"

interface CheckTypeEntry {
  name: string
  pass: number
  fail: number
}

interface TrendEntry {
  date: string
  passed: number
  failed: number
}

interface DashboardData {
  healthScore: number
  passed: number
  failed: number
  anomalies: number
  openIncidents: number
  resolvedToday: number
  checkTypeBreakdown: CheckTypeEntry[]
  weekTrend: TrendEntry[]
}

export function DashboardView() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard")
      const json = await r.json()
      if (!r.ok || json.error) throw new Error(json.error || `HTTP ${r.status}`)
      return json
    },
  })

  if (isLoading) return <div className="text-muted-foreground">Loading dashboard...</div>
  if (error || !data) return <div className="text-destructive">Failed to load dashboard: {error?.message}</div>

  const scoreColor = data.healthScore >= 90 ? "text-green-500" : data.healthScore >= 70 ? "text-yellow-500" : "text-red-500"

  const pieData = [
    { name: "Passed", value: data.passed, color: "#22c55e" },
    { name: "Failed", value: data.failed, color: "#ef4444" },
    { name: "Anomalies", value: data.anomalies, color: "#eab308" },
  ].filter((d) => d.value > 0)

  const failingChecks = (data.checkTypeBreakdown ?? []).filter((c) => c.fail > 0).slice(0, 10)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Health Overview</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard icon={<ShieldCheck className="w-5 h-5" />} label="Health Score" value={`${data.healthScore}%`} valueColor={scoreColor} />
        <MetricCard icon={<CheckCircle className="w-5 h-5 text-green-500" />} label="Passed" value={data.passed.toLocaleString()} />
        <MetricCard icon={<XCircle className="w-5 h-5 text-red-500" />} label="Failed" value={data.failed.toLocaleString()} />
        <MetricCard icon={<AlertTriangle className="w-5 h-5 text-yellow-500" />} label="Anomalies" value={data.anomalies.toLocaleString()} />
        <MetricCard icon={<Activity className="w-5 h-5 text-orange-500" />} label="Open Incidents" value={data.openIncidents.toLocaleString()} />
        <MetricCard icon={<Clock className="w-5 h-5 text-blue-500" />} label="Resolved Today" value={data.resolvedToday.toLocaleString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Results Pie */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Today&apos;s Results</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 7-Day Trend */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">7-Day Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.weekTrend ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="passed" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Failing Check Types */}
      {failingChecks.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Failures by Check Type (Today)</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, failingChecks.length * 30)}>
            <BarChart data={failingChecks} layout="vertical" margin={{ left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={100} />
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="fail" fill="#ef4444" name="Failed" radius={[0, 4, 4, 0]} />
              <Bar dataKey="pass" fill="#22c55e" name="Passed" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, valueColor }: { icon: React.ReactNode; label: string; value: string; valueColor?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${valueColor || ""}`}>{value}</div>
    </div>
  )
}
