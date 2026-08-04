import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const monitorId = searchParams.get("monitorId")
    const dateStart = searchParams.get("dateStart") || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const dateEnd = searchParams.get("dateEnd") || new Date().toISOString().slice(0, 10)

    if (!monitorId) {
      return Response.json({ error: "monitorId is required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT
        r.CHECK_TYPE,
        r.TARGET_TABLE,
        r.STATUS,
        r.METRIC_VALUE,
        r.THRESHOLD,
        r.GROUP_VALUE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE as CHECK_DATE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG c ON r.CONFIG_ID = c.CONFIG_ID
      WHERE c.MONITOR_ID = ${Number(monitorId)}
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
      ORDER BY r.CHECK_TIMESTAMP ASC
    `)

    const results = rows.map((r) => ({
      checkType: r.CHECK_TYPE,
      targetTable: r.TARGET_TABLE,
      status: r.STATUS,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      groupValue: r.GROUP_VALUE,
      checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[monitors/history]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load monitor history" },
      { status: 500 }
    )
  }
}
