import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

export async function GET(request: NextRequest) {
  const dateStart = request.nextUrl.searchParams.get("dateStart")
  const dateEnd = request.nextUrl.searchParams.get("dateEnd")

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    let dateFilter = "r.CHECK_TIMESTAMP >= DATEADD(day, -1, CURRENT_TIMESTAMP())"
    if (dateStart && dateEnd) {
      dateFilter = `CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE BETWEEN '${dateStart}' AND '${dateEnd}'`
    } else if (dateStart) {
      dateFilter = `CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'`
    }

    const rows = await querySnowflake(`
      SELECT
        r.CHECK_TYPE, r.TARGET_TABLE, r.STATUS,
        r.METRIC_VALUE, r.THRESHOLD, r.SEVERITY, r.GROUP_VALUE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      WHERE ${dateFilter}
      ORDER BY r.CHECK_TIMESTAMP DESC
      LIMIT 500
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
