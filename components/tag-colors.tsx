"use client"

import { useState, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"

interface TagMeta {
  name: string
  color: string
}

export function useTagColors() {
  const { data } = useQuery<TagMeta[]>({
    queryKey: ["tags"],
    queryFn: () => fetch("/api/tags").then((r) => r.json()),
    staleTime: 60000,
  })

  const colorMap = new Map<string, string>()
  for (const t of data || []) {
    colorMap.set(t.name, t.color)
  }

  return colorMap
}

export function TagBadge({ tag, colorMap }: { tag: string; colorMap: Map<string, string> }) {
  const color = colorMap.get(tag) || "#6b7280"
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
      style={{ backgroundColor: color }}
    >
      {tag}
    </span>
  )
}

export function TagBadges({ tags, colorMap }: { tags: string[]; colorMap: Map<string, string> }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => <TagBadge key={t} tag={t} colorMap={colorMap} />)}
    </div>
  )
}

interface TagMultiSelectProps {
  allTags: string[]
  selected: string[]
  onChange: (tags: string[]) => void
  colorMap: Map<string, string>
  className?: string
  placeholder?: string
  selectedPrefix?: string
}

export function TagMultiSelect({ allTags, selected, onChange, colorMap, className, placeholder = "All Tags", selectedPrefix = "" }: TagMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function toggleTag(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag])
  }

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
    ? `${selectedPrefix}${selected[0]}`
    : `${selectedPrefix}${selected.length} Tags`

  return (
    <div className={`relative ${className || ""}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border border-input rounded-md px-3 py-2 text-sm bg-background hover:bg-accent transition-colors w-full sm:w-auto flex items-center justify-between gap-2 min-w-[110px]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 min-w-[190px] max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg p-1">
          {allTags.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No tags</div>}
          {allTags.map((t) => (
            <label key={t} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(t)}
                onChange={() => toggleTag(t)}
                className="rounded border-input"
              />
              <TagBadge tag={t} colorMap={colorMap} />
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border mt-1"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
