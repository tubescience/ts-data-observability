/**
 * Snowflake query helper.
 *
 * Auth (auto-detected by SNOWFLAKE_AUTHENTICATOR env var):
 *   - "EXTERNALBROWSER" — browser SSO, for local dev with your personal user
 *   - "SNOWFLAKE_JWT"   — key-pair auth, for Vercel / production (default)
 *
 * Required env vars:
 *   SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_WAREHOUSE,
 *   SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA, SNOWFLAKE_ROLE
 *
 * For key-pair auth (Vercel):
 *   SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH
 *   SNOWFLAKE_PRIVATE_KEY_PASSPHRASE (if key is encrypted)
 *
 * Usage:
 *   const rows = await querySnowflake("SELECT ...")
 */

import snowflake from "snowflake-sdk"
import crypto from "crypto"

snowflake.configure({ logLevel: "ERROR" })

function getPrivateKey(): string {
  const keyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH
  if (keyPath) {
    const fs = require("fs") as typeof import("fs")
    const pem = fs.readFileSync(keyPath, "utf8")
    const keyObj = crypto.createPrivateKey({
      key: pem,
      format: "pem",
      ...(process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
        ? { passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE }
        : {}),
    })
    return keyObj.export({ type: "pkcs8", format: "pem" }) as string
  }

  const raw = process.env.SNOWFLAKE_PRIVATE_KEY
  if (!raw) {
    throw new Error(
      "Missing Snowflake private key. Set SNOWFLAKE_PRIVATE_KEY_PATH (file) or SNOWFLAKE_PRIVATE_KEY (inline PEM)."
    )
  }
  const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
  const keyObj = crypto.createPrivateKey({
    key: pem,
    format: "pem",
    ...(process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
      ? { passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE }
      : {}),
  })
  return keyObj.export({ type: "pkcs8", format: "pem" }) as string
}

function getConnectionConfig(): snowflake.ConnectionOptions {
  const account = process.env.SNOWFLAKE_ACCOUNT
  const username = process.env.SNOWFLAKE_USER

  if (!account || !username) {
    throw new Error(
      "Missing Snowflake credentials. Set SNOWFLAKE_ACCOUNT and SNOWFLAKE_USER environment variables."
    )
  }

  const authenticator = process.env.SNOWFLAKE_AUTHENTICATOR || "SNOWFLAKE_JWT"

  const base: snowflake.ConnectionOptions = {
    account,
    username,
    authenticator,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE,
    application: "TSDataObservability",
  }

  if (authenticator === "SNOWFLAKE_JWT") {
    base.privateKey = getPrivateKey()
  }

  return base
}

interface QueryOptions {
  warehouse?: string
}

// Persistent connection to avoid reconnecting every request
let cachedConn: any = null
let connReady = false
let connPromise: Promise<any> | null = null
// A Snowflake connection processes one statement at a time -- a single shared
// connection reused across concurrent requests (same warm serverless instance)
// means a slow query (e.g. a multi-minute scan against an RLS-heavy MCP view)
// blocks every other request behind it until it finishes, including totally
// unrelated, normally-instant queries. Confirmed in production: /api/incidents/open
// and /api/dashboard (small, fast metadata-only queries) were returning 504s
// purely because they landed on the same warm instance as a slow validate call.
// Tracking busy state per-connection lets a concurrent caller fall back to its
// own short-lived connection instead of queueing behind the shared one.
let cachedConnBusy = false

function openNewConnection(): Promise<any> {
  return new Promise((resolve, reject) => {
    const config = getConnectionConfig()
    const conn = snowflake.createConnection(config)
    conn.connect((err: any) => {
      if (err) return reject(new Error(`Snowflake connection failed: ${err.message}`))
      resolve(conn)
    })
  })
}

function getOrCreateConnection(): Promise<any> {
  if (cachedConn && connReady) return Promise.resolve(cachedConn)
  if (connPromise) return connPromise

  connPromise = openNewConnection().then(
    (conn) => {
      cachedConn = conn
      connReady = true
      return conn
    },
    (err) => {
      connPromise = null
      throw err
    }
  )

  connPromise.catch(() => { connPromise = null; cachedConn = null; connReady = false })
  return connPromise
}

function isStaleConnectionError(err: any): boolean {
  const message = err?.message || ""
  return (
    /not connected/i.test(message) ||
    /terminated connection/i.test(message) ||
    /connection is up but not authenticated/i.test(message) ||
    err?.code === "410001"
  )
}

function runQuery(conn: any, query: string, options: QueryOptions): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    const execOpts: any = { sqlText: query }
    if (options.warehouse) {
      execOpts.parameters = { QUERY_WAREHOUSE_NAME: options.warehouse }
    }

    conn.execute({
      ...execOpts,
      complete: (err: any, _stmt: any, rows: any) => {
        if (err) reject(err)
        else resolve((rows ?? []) as Record<string, any>[])
      },
    })
  })
}

// Runs several queries sequentially on a SINGLE connection, instead of each one
// going through querySnowflake() independently. A Snowflake connection can only
// process one statement at a time anyway, so firing N queries via
// Promise.all(queries.map(querySnowflake)) buys no real parallelism -- it just
// means the first claims the shared connection and the other N-1 each pay a
// fresh JWT handshake (~1-1.5s measured) to open their own ephemeral connection.
// On a cold instance (dashboard's 6-way fan-out) that stacked up to ~10s for a
// page of queries that are individually fast. Sequential-on-one-connection is
// both cheaper and no slower than the "parallel" version ever actually was.
export async function querySnowflakeBatch(
  queries: string[],
  options: QueryOptions = {}
): Promise<Record<string, any>[][]> {
  const useShared = !cachedConnBusy
  if (useShared) cachedConnBusy = true

  if (!useShared) {
    const conn = await openNewConnection()
    try {
      const results: Record<string, any>[][] = []
      for (const q of queries) results.push(await runQuery(conn, q, options))
      return results
    } catch (err: any) {
      throw new Error(`Query failed: ${err.message}`)
    } finally {
      conn.destroy(() => {})
    }
  }

  try {
    let conn: any
    try {
      conn = await getOrCreateConnection()
    } catch {
      cachedConn = null; connReady = false; connPromise = null
      conn = await getOrCreateConnection()
    }

    try {
      const results: Record<string, any>[][] = []
      for (const q of queries) results.push(await runQuery(conn, q, options))
      return results
    } catch (err: any) {
      if (isStaleConnectionError(err)) {
        cachedConn = null; connReady = false; connPromise = null
      }
      throw new Error(`Query failed: ${err.message}`)
    }
  } finally {
    cachedConnBusy = false
  }
}

export async function querySnowflake(
  query: string,
  options: QueryOptions = {},
  allowRetry = true
): Promise<Record<string, any>[]> {
  // Claim the shared-connection slot synchronously, before any `await` -- two
  // calls racing from the same request (e.g. Promise.all([queryA(), queryB()]))
  // both start executing before either hits an await, so the check-and-set has
  // to happen in that same synchronous tick or both could see "not busy" and
  // collide on the one shared connection anyway.
  const useShared = !cachedConnBusy
  if (useShared) cachedConnBusy = true

  // The shared connection is already claimed (by this call or a concurrent one)
  // -- don't queue behind it (it could be a multi-minute scan). Use a one-off
  // connection for this call instead; it's closed afterward, never cached.
  if (!useShared) {
    const conn = await openNewConnection()
    try {
      return await runQuery(conn, query, options)
    } catch (err: any) {
      throw new Error(`Query failed: ${err.message}`)
    } finally {
      conn.destroy(() => {})
    }
  }

  try {
    let conn: any
    try {
      conn = await getOrCreateConnection()
    } catch {
      // Retry once with fresh connection
      cachedConn = null; connReady = false; connPromise = null
      conn = await getOrCreateConnection()
    }

    try {
      return await runQuery(conn, query, options)
    } catch (err: any) {
      if (isStaleConnectionError(err)) {
        cachedConn = null; connReady = false; connPromise = null
        if (allowRetry) {
          cachedConnBusy = false // release before the retry claims its own slot
          return await querySnowflake(query, options, false)
        }
      }
      throw new Error(`Query failed: ${err.message}`)
    }
  } finally {
    cachedConnBusy = false
  }
}
