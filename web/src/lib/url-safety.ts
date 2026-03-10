import dns from "node:dns/promises"
import net from "node:net"

const DISALLOWED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
])

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeUrlError"
  }
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  return octets
}

function isPrivateIpv4(ip: string): boolean {
  const octets = parseIpv4(ip)
  if (!octets) return true
  const [a, b] = octets

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a === 0
  )
}

function extractMappedIpv4(ip: string): string | null {
  const normalized = ip.toLowerCase()
  if (!normalized.startsWith("::ffff:")) return null
  const candidate = normalized.slice("::ffff:".length)
  return net.isIP(candidate) === 4 ? candidate : null
}

export function isPrivateIpAddress(ip: string): boolean {
  const kind = net.isIP(ip)

  if (kind === 4) {
    return isPrivateIpv4(ip)
  }

  if (kind === 6) {
    const normalized = ip.toLowerCase()
    const mapped = extractMappedIpv4(normalized)
    if (mapped) {
      return isPrivateIpv4(mapped)
    }
    if (normalized.startsWith("::ffff:")) {
      return true
    }

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    )
  }

  return true
}

function isDisallowedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (DISALLOWED_HOSTNAMES.has(normalized)) return true
  if (normalized.endsWith(".local")) return true
  return false
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1)
  }
  return hostname
}

export type LookupAddresses = (hostname: string) => Promise<string[]>

async function defaultLookupAddresses(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export async function assertSafePublicRecipeUrl(
  rawUrl: string,
  lookupAddresses: LookupAddresses = defaultLookupAddresses
): Promise<URL> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError("Invalid URL format")
  }

  if (parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Only HTTPS URLs are allowed")
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed")
  }

  const normalizedHostname = normalizeHostname(parsed.hostname)

  if (isDisallowedHostname(normalizedHostname)) {
    throw new UnsafeUrlError("Hostname is not allowed")
  }

  const hostnameIpKind = net.isIP(normalizedHostname)
  if (hostnameIpKind !== 0) {
    if (isPrivateIpAddress(normalizedHostname)) {
      throw new UnsafeUrlError("Target resolves to a private network")
    }
    return parsed
  }

  const addresses = await lookupAddresses(normalizedHostname)
  if (addresses.length === 0) {
    throw new UnsafeUrlError("Could not resolve hostname")
  }

  for (const address of addresses) {
    if (isPrivateIpAddress(address)) {
      throw new UnsafeUrlError("Target resolves to a private network")
    }
  }

  return parsed
}

export async function fetchRecipeHtmlSafely(
  rawUrl: string,
  options: {
    timeoutMs: number
    userAgent: string
    maxRedirects?: number
    maxBytes?: number
  }
): Promise<string> {
  const maxRedirects = options.maxRedirects ?? 5
  const maxBytes = options.maxBytes ?? 2_000_000

  let currentUrl = await assertSafePublicRecipeUrl(rawUrl)

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          "User-Agent": options.userAgent,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: controller.signal,
      })

      const isRedirect = response.status >= 300 && response.status < 400
      if (isRedirect) {
        const location = response.headers.get("location")
        if (!location) {
          throw new UnsafeUrlError("Redirect missing location header")
        }
        currentUrl = await assertSafePublicRecipeUrl(new URL(location, currentUrl).toString())
        continue
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch page (${response.status})`)
      }

      const contentType = response.headers.get("content-type") || ""
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new UnsafeUrlError("URL did not return HTML content")
      }

      const contentLength = response.headers.get("content-length")
      if (contentLength && Number(contentLength) > maxBytes) {
        throw new UnsafeUrlError("HTML response is too large")
      }

      const html = await response.text()
      if (Buffer.byteLength(html, "utf8") > maxBytes) {
        throw new UnsafeUrlError("HTML response is too large")
      }

      return html
    } finally {
      clearTimeout(timer)
    }
  }

  throw new UnsafeUrlError("Too many redirects")
}
