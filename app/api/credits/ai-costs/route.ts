import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get("startDate") || ""
    const endDate = searchParams.get("endDate") || ""
    const user = searchParams.get("user") || ""

    let dateFilter = ""
    if (startDate && endDate) {
      dateFilter = `AND USAGE_DATE >= '${startDate.replace(/[^0-9\-]/g, "")}' AND USAGE_DATE <= '${endDate.replace(/[^0-9\-]/g, "")}'`
    } else {
      dateFilter = `AND USAGE_DATE >= DATEADD(day, -30, CURRENT_TIMESTAMP())`
    }

    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    // Run main query and user list in parallel
    const mainQuery = querySnowflake(`
      SELECT 
        USAGE_DATE,
        SERVICE_TYPE,
        SUM(CREDITS_USED) as CREDITS_USED
      FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_DAILY_HISTORY
      WHERE (SERVICE_TYPE ILIKE '%AI%' 
             OR SERVICE_TYPE ILIKE '%CORTEX%' 
             OR SERVICE_TYPE ILIKE '%AGENT%'
             OR SERVICE_TYPE ILIKE '%CONTAINER%')
        ${dateFilter}
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `)

    const usersQuery = querySnowflake(`
      SELECT DISTINCT user_name 
      FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
      WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
        AND user_name NOT LIKE 'SYSTEM%'
        AND (query_tag ILIKE '%cortex%' OR query_tag ILIKE '%ai%'
             OR role_name IN ('MCP_ADMIN', 'MCP_ENGINEER', 'MCP_MONITOR'))
      ORDER BY user_name
      LIMIT 30
    `).catch(() => [] as Record<string, any>[])

    const [rows, userRows] = await Promise.all([mainQuery, usersQuery])
    const users = (userRows as Record<string, any>[]).map((r) => r.USER_NAME).filter(Boolean)

    let results = rows.map((r) => ({
      usageDate: r.USAGE_DATE instanceof Date ? r.USAGE_DATE.toISOString().slice(0, 10) : String(r.USAGE_DATE).slice(0, 10),
      serviceType: r.SERVICE_TYPE,
      creditsUsed: r.CREDITS_USED,
    }))

    // If user filter, query per-user from QUERY_HISTORY
    if (user) {
      const safeUser = user.replace(/[^A-Z0-9_]/gi, "")
      const userDateFilter = startDate && endDate
        ? `AND TO_DATE(start_time) >= '${startDate.replace(/[^0-9\-]/g, "")}' AND TO_DATE(start_time) <= '${endDate.replace(/[^0-9\-]/g, "")}'`
        : `AND start_time >= DATEADD(day, -30, CURRENT_TIMESTAMP())`

      const userRows = await querySnowflake(`
        SELECT 
          TO_DATE(start_time) AS USAGE_DATE,
          CASE
            WHEN query_text ILIKE '%CORTEX.COMPLETE%' THEN 'CORTEX_COMPLETE'
            WHEN query_text ILIKE '%CORTEX.EMBED%' THEN 'CORTEX_EMBED'
            WHEN query_text ILIKE '%AI_CLASSIFY%' OR query_text ILIKE '%AI_EXTRACT%' OR query_text ILIKE '%AI_FILTER%' THEN 'AI_FUNCTIONS'
            WHEN query_text ILIKE '%CORTEX_SEARCH%' THEN 'CORTEX_SEARCH'
            ELSE 'OTHER_AI'
          END AS SERVICE_TYPE,
          COUNT(*) AS QUERY_COUNT,
          SUM(credits_used_cloud_services) AS CREDITS_USED
        FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
        WHERE user_name = '${safeUser}'
          AND (query_text ILIKE '%CORTEX%' OR query_text ILIKE '%AI_%')
          ${userDateFilter}
        GROUP BY 1, 2
        ORDER BY 1 DESC, 2
      `)

      results = userRows.map((r) => ({
        usageDate: r.USAGE_DATE instanceof Date ? r.USAGE_DATE.toISOString().slice(0, 10) : String(r.USAGE_DATE).slice(0, 10),
        serviceType: r.SERVICE_TYPE,
        creditsUsed: r.CREDITS_USED,
      }))
    }

    return Response.json({ data: results, users })
  } catch (e) {
    console.error(new Date().toISOString(), "[credits/ai-costs]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load AI costs" },
      { status: 500 }
    )
  }
}
