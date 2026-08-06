import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const days = searchParams.get("days") || "30"

    await querySnowflake("USE ROLE MCP_MONITOR")
    const rows = await querySnowflake(`
      SELECT 
        USAGE_DATE,
        SERVICE_TYPE,
        SUM(CREDITS_USED) as CREDITS_USED
      FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_DAILY_HISTORY
      WHERE USAGE_DATE >= DATEADD(day, -${Number(days)}, CURRENT_TIMESTAMP())
        AND (SERVICE_TYPE ILIKE '%AI%' 
             OR SERVICE_TYPE ILIKE '%CORTEX%' 
             OR SERVICE_TYPE ILIKE '%AGENT%'
             OR SERVICE_TYPE ILIKE '%CONTAINER%')
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `)

    const results = rows.map((r) => ({
      usageDate: r.USAGE_DATE instanceof Date ? r.USAGE_DATE.toISOString().slice(0, 10) : String(r.USAGE_DATE).slice(0, 10),
      serviceType: r.SERVICE_TYPE,
      creditsUsed: r.CREDITS_USED,
    }))

    return Response.json(results)
  } catch (e) {
    console.error(new Date().toISOString(), "[credits/ai-costs]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load AI costs" },
      { status: 500 }
    )
  }
}
