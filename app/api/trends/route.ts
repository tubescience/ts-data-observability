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
        CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE as CHECK_DATE,
        COUNT(CASE WHEN STATUS = 'PASS' THEN 1 END) as PASSED,
        COUNT(CASE WHEN STATUS IN ('FAIL','ERROR') THEN 1 END) as FAILED,
        COUNT(CASE WHEN STATUS = 'ANOMALY' THEN 1 END) as ANOMALIES,
        COUNT(*) as TOTAL
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
      WHERE CHECK_TIMESTAMP >= DATEADD(day, -14, CURRENT_TIMESTAMP())
        AND STATUS IN ('PASS','FAIL','ERROR','ANOMALY')
      GROUP BY 1
      ORDER BY 1
    `)

    const trends = rows.map((r) => ({
      date: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
      passed: r.PASSED,
      failed: r.FAILED,
      anomalies: r.ANOMALIES,
      total: r.TOTAL,
      healthScore: r.TOTAL > 0 ? Math.round((r.PASSED / r.TOTAL) * 100) : 100,
    }))

    return Response.json(trends)
  } catch (e) {
    console.error(new Date().toISOString(), "[trends]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load trends" },
      { status: 500 }
    )
  }
}
