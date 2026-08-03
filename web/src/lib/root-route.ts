const AUTH_ERROR_KEYS = ["error", "error_code", "error_description"] as const
const MAX_AUTH_CODE_LENGTH = 2048

export type RootSearchParams = Record<
  string,
  string | string[] | undefined
>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function buildRootDestination(searchParams: RootSearchParams): string {
  const params = new URLSearchParams()
  const code = firstValue(searchParams.code)?.trim()

  if (code && code.length <= MAX_AUTH_CODE_LENGTH) {
    params.set("code", code)
  }

  AUTH_ERROR_KEYS.forEach((key) => {
    const value = firstValue(searchParams[key])?.trim()
    if (value) params.set(key, value.slice(0, 200))
  })

  const query = params.toString()
  return `/recipes${query ? `?${query}` : ""}`
}
