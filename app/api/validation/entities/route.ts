import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const [accounts, clients] = await Promise.all([
      querySnowflake(`
        SELECT DISTINCT account_id::VARCHAR AS id, account_name AS name
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY
        WHERE account_id IS NOT NULL AND account_name IS NOT NULL
          AND date >= DATEADD(day, -90, CURRENT_DATE())
        ORDER BY account_name
      `),
      querySnowflake(`
        SELECT DISTINCT client_id::VARCHAR AS id, client_name AS name
        FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY
        WHERE client_id IS NOT NULL AND client_name IS NOT NULL
          AND date >= DATEADD(day, -90, CURRENT_DATE())
        ORDER BY client_name
      `),
    ])

    return Response.json({
      accounts: accounts.map((r) => ({ id: r.ID, name: r.NAME })),
      clients: clients.map((r) => ({ id: r.ID, name: r.NAME })),
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[validation/entities]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load entities" },
      { status: 500 }
    )
  }
}
