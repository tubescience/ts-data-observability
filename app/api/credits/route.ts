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
      WHERE r.CHECK_TYPE IN ('CREDITS', 'CREDITS_BY_WAREHOUSE', 'CREDITS_BY_ROLE', 'CREDITS_BY_USER')
        AND r.CHECK_TIMESTAMP >= DATEADD(day, -7, CURRENT_TIMESTAMP())
      ORDER BY r.CHECK_TIMESTAMP DESC
      LIMIT 100
    `)

    const results = rows.map((r) => ({
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      status: r.STATUS,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      groupValue: r.GROUP_VALUE,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[credits]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load credits data" },
      { status: 500 }
    )
  }
}
