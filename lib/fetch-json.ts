// Shared fetch+parse helper for React Query `queryFn`s. A bare
// `fetch(url).then(r => r.json())` treats a 500 response's `{ error: "..." }`
// body as valid data -- react-query never enters its error state, and
// downstream `.map()`/`.find()` on the error object can crash or silently
// render empty. This throws instead, so query errors surface correctly.
export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json()
  if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`)
  return json
}
