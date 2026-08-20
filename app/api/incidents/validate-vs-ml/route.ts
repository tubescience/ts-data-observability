import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const ML_FORECAST_BASE_URL = "https://ts-observability-ml.vercel.app"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { checkType, groupValue } = body

    if (!checkType || !groupValue) {
      return Response.json({ error: "checkType and groupValue are required" }, { status: 400 })
    }

    const res = await fetch(`${ML_FORECAST_BASE_URL}/api/ml_forecast/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ check_type: checkType, group_value: String(groupValue) }),
    })
    const json = await res.json()

    if (!res.ok) {
      // FastAPI validation errors come back as { detail: [{ msg, loc, ... }] }
      // instead of the service's usual { message } shape.
      const message = Array.isArray(json?.detail)
        ? json.detail.map((d: any) => d.msg).join("; ")
        : json.message || json.error || `Error ${res.status}`
      return Response.json({ error: message }, { status: res.status })
    }

    return Response.json(json)
  } catch (e) {
    console.error(new Date().toISOString(), "[validate-vs-ml]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "ML forecast validation failed" },
      { status: 500 }
    )
  }
}
