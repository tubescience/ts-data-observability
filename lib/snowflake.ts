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

function getOrCreateConnection(): Promise<any> {
  if (cachedConn && connReady) return Promise.resolve(cachedConn)
  if (connPromise) return connPromise

  connPromise = new Promise((resolve, reject) => {
    const config = getConnectionConfig()
    const conn = snowflake.createConnection(config)
    conn.connect((err: any) => {
      if (err) {
        connPromise = null
        return reject(new Error(`Snowflake connection failed: ${err.message}`))
      }
      cachedConn = conn
      connReady = true
      resolve(conn)
    })
  })

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

export async function querySnowflake(
  query: string,
  options: QueryOptions = {},
  allowRetry = true
): Promise<Record<string, any>[]> {
  let conn: any
  try {
    conn = await getOrCreateConnection()
  } catch {
    // Retry once with fresh connection
    cachedConn = null; connReady = false; connPromise = null
    conn = await getOrCreateConnection()
  }

  try {
    return await new Promise((resolve, reject) => {
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
  } catch (err: any) {
    if (isStaleConnectionError(err)) {
      cachedConn = null; connReady = false; connPromise = null
      if (allowRetry) return querySnowflake(query, options, false)
    }
    throw new Error(`Query failed: ${err.message}`)
  }
}
