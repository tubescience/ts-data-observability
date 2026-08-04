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
    const checkType = searchParams.get("checkType")
    const targetTable = searchParams.get("targetTable")
    const groupValue = searchParams.get("groupValue") || ""
    const dateStart = searchParams.get("dateStart") || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const dateEnd = searchParams.get("dateEnd") || new Date().toISOString().slice(0, 10)

    if (!checkType || !targetTable) {
      return Response.json({ error: "checkType and targetTable are required" }, { status: 400 })
    }

    await querySnowflake("USE ROLE MCP_MONITOR")

    const groupClause = groupValue
      ? `AND r.GROUP_VALUE = '${groupValue.replace(/'/g, "''")}'`
      : `AND (r.GROUP_VALUE IS NULL OR r.GROUP_VALUE = '')`

    const rows = await querySnowflake(`
      SELECT
        r.STATUS,
        r.METRIC_VALUE,
        r.THRESHOLD,
        r.GROUP_VALUE,
        r.DETAILS,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE as CHECK_DATE,
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      WHERE r.CHECK_TYPE = '${checkType.replace(/'/g, "''")}'
        AND r.TARGET_TABLE = '${targetTable.replace(/'/g, "''")}'
        ${groupClause}
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
      ORDER BY r.CHECK_TIMESTAMP ASC
    `)

    const results = rows.map((r) => ({
      status: r.STATUS,
      metricValue: r.METRIC_VALUE,
      threshold: r.THRESHOLD,
      groupValue: r.GROUP_VALUE,
      details: r.DETAILS,
      checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
      checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/history]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load incident history" },
      { status: 500 }
    )
  }
}
