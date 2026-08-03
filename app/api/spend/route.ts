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
        CHECK_TYPE,
        TARGET_TABLE,
        STATUS,
        METRIC_VALUE,
        THRESHOLD,
        GROUP_VALUE,
        CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
      WHERE (CHECK_TYPE = 'SPEND_PLATFORM' OR TARGET_TABLE ILIKE '%REVENUE%')
        AND CHECK_TIMESTAMP >= DATEADD(day, -14, CURRENT_TIMESTAMP())
      ORDER BY CHECK_TIMESTAMP DESC
    `)

    const results = rows.map((r) => ({
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      status: r.STATUS,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      groupValue: r.GROUP_VALUE,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
      category: r.CHECK_TYPE === "SPEND_PLATFORM" ? "SPEND" : "REVENUE",
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[spend]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load spend data" },
      { status: 500 }
    )
  }
}
