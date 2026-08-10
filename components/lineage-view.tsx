"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUp, ArrowDown } from "lucide-react"

interface LineageNode {
  database: string
  schema: string
  name: string
  type: string
  fqn: string
}

interface LineageResult {
  upstream: LineageNode[]
  downstream: LineageNode[]
}

export function LineageView() {
  const [objectInput, setObjectInput] = useState("")
  const [searchObject, setSearchObject] = useState("")

  const { data, isLoading, error } = useQuery<LineageResult>({
    queryKey: ["lineage", searchObject],
    queryFn: () =>
      fetch(`/api/lineage?object=${encodeURIComponent(searchObject)}`).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.error)))
        return r.json()
      }),
    enabled: !!searchObject,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (objectInput.trim()) setSearchObject(objectInput.trim())
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Object Lineage</h2>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          value={objectInput}
          onChange={(e) => setObjectInput(e.target.value)}
          placeholder="DATABASE.SCHEMA.OBJECT_NAME"
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-full sm:w-96 font-mono"
        />
        <button
          type="submit"
          disabled={!objectInput.trim()}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Show Lineage
        </button>
      </form>

      {isLoading && <div className="text-muted-foreground">Loading lineage...</div>}
      {error && <div className="text-destructive text-sm">{(error as Error).message}</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <LineageSection
            title="Upstream (depends on)"
            icon={<ArrowUp className="w-4 h-4" />}
            nodes={data.upstream}
            color="blue"
          />
          <LineageSection
            title="Downstream (depended by)"
            icon={<ArrowDown className="w-4 h-4" />}
            nodes={data.downstream}
            color="amber"
          />
        </div>
      )}
    </div>
  )
}

function LineageSection({
  title,
  icon,
  nodes,
  color,
}: {
  title: string
  icon: React.ReactNode
  nodes: LineageNode[]
  color: "blue" | "amber"
}) {
  const headerColor = color === "blue"
    ? "text-blue-600 dark:text-blue-400"
    : "text-amber-600 dark:text-amber-400"

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-muted/50 flex items-center gap-2">
        <span className={headerColor}>{icon}</span>
        <h3 className={`text-sm font-semibold ${headerColor}`}>{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{nodes.length} object{nodes.length !== 1 ? "s" : ""}</span>
      </div>
      {nodes.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">No dependencies found</div>
      ) : (
        <div className="divide-y divide-border">
          {nodes.map((node, i) => (
            <div key={i} className="px-4 py-2.5 hover:bg-muted/30 flex items-center gap-3">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${typeColor(node.type)}`}>
                {node.type}
              </span>
              <span className="font-mono text-xs truncate" title={node.fqn}>
                {node.fqn}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function typeColor(type: string): string {
  const colors: Record<string, string> = {
    TABLE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    VIEW: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PROCEDURE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    PIPE: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    FUNCTION: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    STAGE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    STREAM: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    TASK: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400",
  }
  return colors[type?.toUpperCase()] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
}
