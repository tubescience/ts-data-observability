import { querySnowflake, querySnowflakeBatch } from "@/lib/snowflake"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await querySnowflake("USE ROLE MCP_MONITOR")
    const [accounts, clients] = await querySnowflakeBatch([
      `
        SELECT DISTINCT account_id::VARCHAR AS id, account_name AS name
        FROM TS_PROD_MCP_DB.REPORT.V_SPEND_DAILY
        WHERE account_id IS NOT NULL AND account_name IS NOT NULL
          AND date >= DATEADD(day, -30, CURRENT_DATE())
        ORDER BY account_name
      `,
      `
        SELECT DISTINCT client_id::VARCHAR AS id, client_name AS name
        FROM TS_PROD_MCP_DB.REPORT.V_SPEND_DAILY
        WHERE client_id IS NOT NULL AND client_name IS NOT NULL
          AND date >= DATEADD(day, -30, CURRENT_DATE())
        ORDER BY client_name
      `,
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
