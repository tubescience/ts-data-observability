"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { DashboardView } from "@/components/dashboard-view"
import { OpenIncidents } from "@/components/open-incidents"
import { MonitorsView } from "@/components/monitors-view"
import { SpendMonitorsView } from "@/components/spend-monitors-view"
import { TrendsView } from "@/components/trends-view"
import { CreditsView } from "@/components/credits-view"
import { TasksView } from "@/components/tasks-view"
import { LineageView } from "@/components/lineage-view"
import { TagsView } from "@/components/tags-view"
import { MobileNav } from "@/components/mobile-nav"
import { RefreshCw, Menu } from "lucide-react"

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "open-incidents", label: "Open Incidents" },
  { id: "monitors", label: "Monitors" },
  { id: "spend-monitors", label: "Spend Monitors" },
  { id: "trends", label: "Trends" },
  { id: "credits", label: "Credits" },
  { id: "tasks", label: "Tasks" },
  { id: "lineage", label: "Lineage" },
  { id: "tags", label: "Tags" },
] as const

type TabId = (typeof tabs)[number]["id"]

export function AppShell() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const initialTab = (tabs.find((t) => t.id === tabParam)?.id ?? "dashboard") as TabId
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [refreshKey, setRefreshKey] = useState(0)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const handleRefresh = () => setRefreshKey((k) => k + 1)

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card">
        <div className="max-w-[1440px] mx-auto px-4">
          <div className="flex items-center gap-2 py-2">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Desktop tab bar */}
            <div className="hidden md:flex items-center gap-2 overflow-x-auto flex-1">
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
            </div>

            {/* Mobile: show active tab label */}
            <span className="md:hidden text-sm font-medium truncate">
              {tabs.find((t) => t.id === activeTab)?.label}
            </span>

            <button
              onClick={handleRefresh}
              className="ml-auto px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5 transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <MobileNav
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <main className="max-w-[1440px] mx-auto px-4 py-4 sm:py-6" key={refreshKey}>
        {activeTab === "dashboard" && <DashboardView />}
        {activeTab === "open-incidents" && <OpenIncidents />}
        {activeTab === "monitors" && <MonitorsView />}
        {activeTab === "spend-monitors" && <SpendMonitorsView />}
        {activeTab === "trends" && <TrendsView />}
        {activeTab === "credits" && <CreditsView />}
        {activeTab === "tasks" && <TasksView />}
        {activeTab === "lineage" && <LineageView />}
        {activeTab === "tags" && <TagsView />}
      </main>
    </div>
  )
}
