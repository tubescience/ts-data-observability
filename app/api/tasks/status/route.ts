import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const filterType = request.nextUrl.searchParams.get("type") || "all"

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    const typeFilter = filterType === "pipes"
      ? "AND r.CHECK_TYPE = 'PIPE_HEALTH'"
      : filterType === "tasks"
        ? "AND r.CHECK_TYPE IN ('TASK_HEALTH', 'DT_REFRESH')"
        : "AND r.CHECK_TYPE IN ('PIPE_HEALTH', 'TASK_HEALTH', 'DT_REFRESH')"

    const rows = await querySnowflake(`
      WITH latest AS (
        SELECT
          r.CHECK_TYPE,
          r.TARGET_TABLE,
          r.STATUS,
          r.METRIC_VALUE,
          r.SEVERITY,
          ROW_NUMBER() OVER (PARTITION BY r.TARGET_TABLE ORDER BY r.CHECK_TIMESTAMP DESC) as rn
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
        WHERE r.CHECK_TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
          ${typeFilter}
      )
      SELECT CHECK_TYPE, TARGET_TABLE, STATUS, METRIC_VALUE, SEVERITY
      FROM latest
      WHERE rn = 1
      ORDER BY STATUS DESC, TARGET_TABLE
    `)

    const results = rows.map((r) => {
      const parts = (r.TARGET_TABLE || "").split(".")
      return {
        database: parts[0] || "",
        schema: parts[1] || "",
        name: parts[2] || r.TARGET_TABLE,
        objectType: r.CHECK_TYPE === "PIPE_HEALTH" ? "PIPE" : "TASK",
        status: r.STATUS,
        detail: r.METRIC_VALUE != null ? `Metric: ${r.METRIC_VALUE}` : "—",
        severity: r.SEVERITY,
      }
    })

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[tasks/status]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load pipe/task status" },
      { status: 500 }
    )
  }
}
