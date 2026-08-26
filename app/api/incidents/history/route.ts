import { querySnowflake } from "@/lib/snowflake"
import { computeThresholdBand } from "@/lib/threshold-band"
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
        CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP) as CHECK_TIMESTAMP_PST,
        -- The real pass/fail band varies by check: some (ROW_COUNT/VOLUME baseline
        -- mode) already compute and store their own lower/upper; SUM_VALUE_GROUPED's
        -- day-of-week baseline anomaly check flags |z-score| >= 3 from the DOW mean
        -- (THRESHOLD there is just yesterday's raw value, not a real limit); and some
        -- fall back to a plain +/- pct band. See lib/threshold-band.ts.
        r.DETAILS:lower::FLOAT AS DETAILS_LOWER,
        r.DETAILS:upper::FLOAT AS DETAILS_UPPER,
        r.DETAILS:dow_baseline_mean::FLOAT AS DOW_MEAN,
        r.DETAILS:dow_baseline_std::FLOAT AS DOW_STD,
        COALESCE(r.DETAILS:threshold_pct::FLOAT, cfg.THRESHOLD_PCT) AS EFFECTIVE_THRESHOLD_PCT
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS r
      LEFT JOIN TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_CONFIG cfg ON r.CONFIG_ID = cfg.CONFIG_ID
      WHERE r.CHECK_TYPE = '${checkType.replace(/'/g, "''")}'
        AND r.TARGET_TABLE = '${targetTable.replace(/'/g, "''")}'
        ${groupClause}
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE >= '${dateStart}'
        AND CONVERT_TIMEZONE('America/Los_Angeles', r.CHECK_TIMESTAMP)::DATE <= '${dateEnd}'
      ORDER BY r.CHECK_TIMESTAMP ASC
    `)

    const results = rows.map((r) => {
      const band = computeThresholdBand({
        lower: r.DETAILS_LOWER,
        upper: r.DETAILS_UPPER,
        dowBaselineMean: r.DOW_MEAN,
        dowBaselineStd: r.DOW_STD,
        threshold: r.THRESHOLD,
        thresholdPct: r.EFFECTIVE_THRESHOLD_PCT,
      })
      return {
        status: r.STATUS,
        metricValue: r.METRIC_VALUE,
        threshold: r.THRESHOLD,
        thresholdMin: band.min,
        thresholdMax: band.max,
        groupValue: r.GROUP_VALUE,
        details: r.DETAILS,
        checkDate: toIso(r.CHECK_DATE)?.slice(0, 10) ?? null,
        checkTimestamp: toIso(r.CHECK_TIMESTAMP_PST),
      }
    })

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/history]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load incident history" },
      { status: 500 }
    )
  }
}
