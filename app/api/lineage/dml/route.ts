import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_]/g, "")
}

export async function GET(request: NextRequest) {
  const objectName = request.nextUrl.searchParams.get("object")
  if (!objectName) {
    return Response.json({ error: "Missing 'object' query parameter" }, { status: 400 })
  }

  const parts = objectName.toUpperCase().trim().split(".")
  if (parts.length < 2) {
    return Response.json({ error: "Provide at least SCHEMA.OBJECT_NAME" }, { status: 400 })
  }

  const objName = sanitize(parts[parts.length - 1])
  const schemaName = sanitize(parts.length >= 3 ? parts[parts.length - 2] : parts[0])
  const dbName = parts.length >= 3 ? sanitize(parts[0]) : null

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    // Upstream: find source tables + execution context
    const upstream = await querySnowflake(
      "SELECT DISTINCT " +
      "REPLACE(REGEXP_SUBSTR(query_text, 'FROM\\\\s+\"([^\"]+)\"\\\\.\"([^\"]+)\"\\\\.\"([^\"]+)\"', 1, 1, 'i'), 'FROM ', '') AS source_ref, " +
      "role_name, warehouse_name, query_tag " +
      "FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY " +
      "WHERE (query_text ILIKE '%MERGE%INTO%" + schemaName + "%" + objName + "%FROM%' " +
      "OR query_text ILIKE '%INSERT%INTO%" + schemaName + "%" + objName + "%SELECT%FROM%') " +
      (dbName ? "AND query_text ILIKE '%" + dbName + "%' " : "") +
      "AND start_time > DATEADD('day', -30, CURRENT_TIMESTAMP()) " +
      "AND execution_status = 'SUCCESS' " +
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY REPLACE(REGEXP_SUBSTR(query_text, 'FROM\\\\s+\"([^\"]+)\"\\\\.\"([^\"]+)\"\\\\.\"([^\"]+)\"', 1, 1, 'i'), 'FROM ', '') ORDER BY start_time DESC) = 1 " +
      "LIMIT 20"
    )

    // Downstream: find target tables + execution context
    const downstream = await querySnowflake(
      "SELECT DISTINCT " +
      "REPLACE(REGEXP_SUBSTR(query_text, 'INTO\\\\s+\"([^\"]+)\"\\\\.\"([^\"]+)\"\\\\.\"([^\"]+)\"', 1, 1, 'i'), 'INTO ', '') AS target_ref, " +
      "role_name, warehouse_name, query_tag " +
      "FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY " +
      "WHERE (query_text ILIKE '%MERGE%INTO%' OR query_text ILIKE '%INSERT%INTO%') " +
      "AND query_text ILIKE '%FROM%" + schemaName + "%" + objName + "%' " +
      (dbName ? "AND query_text ILIKE '%" + dbName + "%' " : "") +
      "AND query_text NOT ILIKE '%INTO%" + schemaName + "%" + objName + "%' " +
      "AND start_time > DATEADD('day', -30, CURRENT_TIMESTAMP()) " +
      "AND execution_status = 'SUCCESS' " +
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY REPLACE(REGEXP_SUBSTR(query_text, 'INTO\\\\s+\"([^\"]+)\"\\\\.\"([^\"]+)\"\\\\.\"([^\"]+)\"', 1, 1, 'i'), 'INTO ', '') ORDER BY start_time DESC) = 1 " +
      "LIMIT 20"
    )

    const parseContext = (tag: string, role: string, warehouse: string) => {
      let process = role || ""
      if (tag) {
        try {
          const parsed = JSON.parse(tag)
          if (parsed.coalesce) {
            process = `Coalesce: ${parsed.coalesce.jobName || "Job"} / ${parsed.coalesce.stageName || ""}`
          } else if (parsed.task_name) {
            process = `Task: ${parsed.task_name}`
          }
        } catch {
          if (tag.length < 100) process = tag
        }
      }
      return { process, role, warehouse }
    }

    const parseFqn = (ref: string, row: Record<string, any>) => {
      if (!ref) return null
      const clean = ref.replace(/"/g, "").trim()
      const p = clean.split(".")
      if (p.length >= 3) {
        const ctx = parseContext(row.QUERY_TAG || "", row.ROLE_NAME || "", row.WAREHOUSE_NAME || "")
        return {
          database: p[0], schema: p[1], name: p[2],
          type: "TABLE", level: 1, fqn: clean,
          process: ctx.process, role: ctx.role, warehouse: ctx.warehouse,
        }
      }
      return null
    }

    const upFormatted = upstream
      .map((r) => parseFqn(r.SOURCE_REF || "", r))
      .filter((x): x is NonNullable<typeof x> => x !== null && !x.name.includes(objName))

    const downFormatted = downstream
      .map((r) => parseFqn(r.TARGET_REF || "", r))
      .filter((x): x is NonNullable<typeof x> => x !== null && !x.name.includes(objName))

    return Response.json({ upstream: upFormatted, downstream: downFormatted })
  } catch (e) {
    console.error(new Date().toISOString(), "[lineage/dml]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load DML lineage" },
      { status: 500 }
    )
  }
}
