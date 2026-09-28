import { querySnowflake } from "@/lib/snowflake"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// Auto-resolves the known "MCP sync hasn't landed yet" false positive (see
// likelySyncDelay in /api/incidents/open): a ROW_COUNT/VOLUME check reading exactly
// 0 against a historical baseline that's never close to zero. Confirmed this is a
// real, hours-long upstream sync delay, not a checker bug -- a short retry (seconds
// apart) doesn't help (some of these already get rechecked within ~15-45s and still
// read 0), so this runs on a much longer cadence instead of adding query volume.
// Reuses VALIDATE_INCIDENT (the same procedure the UI's "Validate" button calls) --
// no new validation logic, just automating the click.
//
// Each VALIDATE_INCIDENT call runs a real COUNT(*) against the target view and
// takes ~13s alone (confirmed by direct timing) -- sequential calls for a full
// batch would blow past any function timeout, so these run with limited
// concurrency instead. Concurrency doesn't add Snowflake credit cost beyond
// running them sequentially (same warehouse, same total query-seconds) -- it only
// shortens how long the warehouse has to stay resumed for this sweep. Measured
// directly: 3 concurrent calls took 15.3s in isolation, but a real 9-incident sweep
// (3 rounds of 3) took 84s under normal load -- kept the batch small enough that
// even 2 rounds comfortably clears the 60s function timeout with real-world
// variance, since this runs every 30 min anyway and doesn't need to clear a whole
// backlog in one pass.
const MAX_INCIDENTS_PER_SWEEP = 5
const CONCURRENCY = 3

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

async function validateOne(incidentId: number): Promise<{ incidentId: number; message: string; resolved: boolean }> {
  try {
    const rows = await querySnowflake(`CALL TS_INGEST_DB.OBSERVABILITY.VALIDATE_INCIDENT(${incidentId})`)
    const message = rows[0]?.VALIDATE_INCIDENT || ""
    return { incidentId, message, resolved: message.toLowerCase().includes("is now resolved") }
  } catch (e) {
    return { incidentId, message: e instanceof Error ? e.message : "Validation failed", resolved: false }
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    // Single cheap metadata query against OBSERVABILITY_INCIDENTS -- no view/table
    // scans. Most sweeps will find few or no candidates once incidents resolve.
    const candidates = await querySnowflake(`
      SELECT INCIDENT_ID
      FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
      WHERE STATUS = 'OPEN'
        AND CHECK_TYPE IN ('ROW_COUNT', 'VOLUME')
        AND LAST_METRIC = 0
        AND LAST_DETAILS:lower::FLOAT > 0
      ORDER BY LAST_SEEN ASC
      LIMIT ${MAX_INCIDENTS_PER_SWEEP}
    `)

    const results = await runWithConcurrency(
      candidates.map((row) => row.INCIDENT_ID as number),
      CONCURRENCY,
      validateOne
    )

    return Response.json({
      checked: results.length,
      resolved: results.filter((r) => r.resolved).length,
      results,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[incidents/sweep-revalidate]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Sweep failed" },
      { status: 500 }
    )
  }
}
