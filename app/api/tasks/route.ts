import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT
        r.CHECK_TYPE, r.TARGET_TABLE, r.STATUS,
        r.METRIC_VALUE, r.THRESHOLD, r.SEVERITY, r.GROUP_VALUE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      WHERE r.CHECK_TYPE IN ('TASK_HEALTH', 'DT_REFRESH', 'PIPE_HEALTH', 'COALESCE_RUN')
        AND r.CHECK_TIMESTAMP >= DATEADD(day, -3, CURRENT_TIMESTAMP())
      ORDER BY r.CHECK_TIMESTAMP DESC
      LIMIT 100
    `)

    const results = rows.map((r) => ({
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      status: r.STATUS,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      severity: r.SEVERITY,
      groupValue: r.GROUP_VALUE,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[tasks]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load tasks data" },
      { status: 500 }
    )
  }
}
