"use client"

import React from "react"

export interface TableColumn {
  key: string
  label: string
  className?: string
  hideOnMobile?: boolean
  render?: (value: any, row: any) => React.ReactNode
}

interface ResponsiveTableProps {
  columns: TableColumn[]
  data: any[]
  keyField?: string
  onRowClick?: (row: any) => void
  emptyMessage?: string
}

export function ResponsiveTable({ columns, data, keyField, onRowClick, emptyMessage }: ResponsiveTableProps) {
  if (data.length === 0) {
    return <div className="text-muted-foreground py-8 text-center text-sm">{emptyMessage || "No data"}</div>
  }

  return (
    <>
      {/* Desktop table */}
      <div className="responsive-table-desktop border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row, i) => (
                <tr
                  key={keyField ? row[keyField] : i}
                  className={`hover:bg-muted/30 ${onRowClick ? "cursor-pointer" : ""}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-3 py-2 ${col.className || ""}`}>
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card layout */}
      <div className="responsive-table-mobile space-y-3">
        {data.map((row, i) => (
          <div
            key={keyField ? row[keyField] : i}
            className={`border border-border rounded-lg p-3 bg-card space-y-2 ${onRowClick ? "cursor-pointer active:bg-muted/30" : ""}`}
            onClick={() => onRowClick?.(row)}
          >
            {columns
              .filter((col) => !col.hideOnMobile)
              .map((col) => (
                <div key={col.key} className="flex items-start justify-between gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">{col.label}</span>
                  <span className={`text-xs text-right ${col.className || ""}`}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  )
}
