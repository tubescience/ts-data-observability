"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"

interface Tag {
  name: string
  color: string
}

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#16a34a", "#059669", "#10b981", "#0891b2", "#06b6d4",
  "#3b82f6", "#2563eb", "#4f46e5", "#7c3aed", "#8b5cf6",
  "#a855f7", "#9333ea", "#ec4899", "#e11d48", "#f43f5e",
  "#64748b", "#475569", "#78716c", "#6b7280",
]

export function TagsView() {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState("#3b82f6")
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editColor, setEditColor] = useState("")

  const { data: tags = [], isLoading } = useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: () => fetch("/api/tags").then((r) => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: (tag: Tag) =>
      fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tag),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      fetch("/api/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  })

  const handleAdd = () => {
    const name = newName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")
    if (!name) return
    saveMutation.mutate({ name, color: newColor })
    setNewName("")
  }

  const handleSaveEdit = (name: string) => {
    saveMutation.mutate({ name, color: editColor })
    setEditingTag(null)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold">Tag Management</h2>

      {/* Add new tag */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Add New Tag</h3>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="tag-name"
              className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-8 h-8 rounded border border-input cursor-pointer"
              />
              <span className="text-xs font-mono text-muted-foreground">{newColor}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-sm border ${newColor === c ? "border-foreground ring-1 ring-foreground" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || saveMutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Tag list */}
      {isLoading && <div className="text-muted-foreground text-sm">Loading tags...</div>}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Tag</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Color</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Preview</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tags.map((tag) => (
              <tr key={tag.name} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-mono text-xs">{tag.name}</td>
                <td className="px-4 py-2.5">
                  {editingTag === tag.name ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-6 h-6 rounded border border-input cursor-pointer"
                      />
                      <div className="flex flex-wrap gap-1">
                        {PRESET_COLORS.slice(0, 12).map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-4 h-4 rounded-sm border ${editColor === c ? "border-foreground" : "border-transparent"}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <button
                        onClick={() => handleSaveEdit(tag.name)}
                        className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded"
                      >Save</button>
                      <button
                        onClick={() => setEditingTag(null)}
                        className="px-2 py-1 text-xs border border-border rounded"
                      >Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingTag(tag.name); setEditColor(tag.color) }}
                      className="flex items-center gap-2 hover:opacity-70"
                    >
                      <span className="w-4 h-4 rounded-sm border border-border" style={{ backgroundColor: tag.color }} />
                      <span className="text-xs font-mono text-muted-foreground">{tag.color}</span>
                    </button>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className="px-2 py-0.5 rounded text-[11px] font-medium text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => deleteMutation.mutate(tag.name)}
                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                    title="Delete tag"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
