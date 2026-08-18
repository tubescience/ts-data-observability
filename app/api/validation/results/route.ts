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
    const sp = request.nextUrl.searchParams
    const mode = sp.get("mode") || "general"
    const groupValue = sp.get("groupValue") || ""
    const checkType = sp.get("checkType") || ""
    const target = sp.get("target") || ""
    const dateStart = sp.get("dateStart") || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const dateEnd = sp.get("dateEnd") || new Date().toISOString().slice(0, 10)

    await querySnowflake("USE ROLE MCP_MONITOR")

    if (mode === "account" || mode === "client") {
      if (!groupValue) {
        return Response.json({ error: "groupValue is required for account/client mode" }, { status: 400 })
      }
      // Fetch the full set for this entity — a single account/client's result
      // set is small, so filtering by check type / target happens client-side,
      // keeping the filter dropdown options stable as other filters change.
      const rows = await querySnowflake(`
        SELECT
          CHECK_TYPE, TARGET_TABLE, STATUS, METRIC_VALUE, THRESHOLD, GROUP_VALUE,
          CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE as CHECK_DATE,
          CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE GROUP_VALUE = '${groupValue.replace(/'/g, "''")}'
          AND CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE >= '${dateStart}'
          AND CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
        ORDER BY CHECK_TIMESTAMP ASC
      `)

      return Response.json({
        mode,
        results: rows.map((r) => ({
          checkType: r.CHECK_TYPE,
          targetTable: r.TARGET_TABLE,
          status: r.STATUS,
          metricValue: r.METRIC_VALUE,
          threshold: r.THRESHOLD,
          groupValue: r.GROUP_VALUE,
          checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
          checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
        })),
      })
    }

    // General mode: no single account/client to scope metric units to, so
    // pre-aggregate to daily pass/fail counts server-side instead of shipping
    // every raw row (this view can span tens of thousands of results/day).
    // checkTypes are queried independent of the active filters so that dropdown
    // stays stable; targets are narrowed by the selected check type (if any),
    // mirroring how account/client mode scopes its target list.
    const checkTypeClause = checkType ? `AND CHECK_TYPE = '${checkType.replace(/'/g, "''")}'` : ""
    const targetClause = target ? `AND TARGET_TABLE = '${target.replace(/'/g, "''")}'` : ""
    const dateClause = `
      CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE >= '${dateStart}'
      AND CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
    `

    const [agg, checkTypeRows, targetRows] = await Promise.all([
      querySnowflake(`
        SELECT
          CONVERT_TIMEZONE('America/Los_Angeles', CHECK_TIMESTAMP)::DATE as CHECK_DATE,
          STATUS,
          COUNT(*) as CNT
        FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE ${dateClause}
          ${checkTypeClause}
          ${targetClause}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `),
      querySnowflake(`
        SELECT DISTINCT CHECK_TYPE FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE ${dateClause}
        ORDER BY 1
      `),
      querySnowflake(`
        SELECT DISTINCT TARGET_TABLE FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
        WHERE ${dateClause}
          ${checkTypeClause}
        ORDER BY 1 LIMIT 500
      `),
    ])

    return Response.json({
      mode,
      daily: agg.map((r) => ({
        checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
        status: r.STATUS,
        count: r.CNT,
      })),
      checkTypes: checkTypeRows.map((r) => r.CHECK_TYPE),
      targets: targetRows.map((r) => r.TARGET_TABLE),
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[validation/results]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load results" },
      { status: 500 }
    )
  }
}
