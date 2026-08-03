"use client"

import { useState } from "react"
import { DashboardView } from "@/components/dashboard-view"
import { OpenIncidents } from "@/components/open-incidents"
import { ResolvedIncidents } from "@/components/resolved-incidents"
import { MonitorsView } from "@/components/monitors-view"
import { SystemChecks } from "@/components/system-checks"
import { TrendsView } from "@/components/trends-view"
import { SpendView } from "@/components/spend-view"
import { CreditsView } from "@/components/credits-view"
import { TasksView } from "@/components/tasks-view"
import { RefreshCw } from "lucide-react"

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "open-incidents", label: "Open Incidents" },
  { id: "resolved", label: "Resolved" },
  { id: "monitors", label: "Monitors" },
  { id: "checks", label: "System Checks" },
  { id: "trends", label: "Trends" },
  { id: "spend", label: "Spend & Revenue" },
  { id: "credits", label: "Credits" },
  { id: "tasks", label: "Tasks" },
] as const

type TabId = (typeof tabs)[number]["id"]

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard")
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = () => setRefreshKey((k) => k + 1)

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card">
        <div className="max-w-[1440px] mx-auto px-4">
          <div className="flex items-center gap-2 overflow-x-auto py-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              onClick={handleRefresh}
              className="ml-auto px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1440px] mx-auto px-4 py-6" key={refreshKey}>
        {activeTab === "dashboard" && <DashboardView />}
        {activeTab === "open-incidents" && <OpenIncidents />}
        {activeTab === "resolved" && <ResolvedIncidents />}
        {activeTab === "monitors" && <MonitorsView />}
        {activeTab === "checks" && <SystemChecks />}
        {activeTab === "trends" && <TrendsView />}
        {activeTab === "spend" && <SpendView />}
        {activeTab === "credits" && <CreditsView />}
        {activeTab === "tasks" && <TasksView />}
      </main>
    </div>
  )
}
