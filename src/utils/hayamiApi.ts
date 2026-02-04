import { browser } from 'wxt/browser'

// Cache the key briefly to avoid hitting storage on every request
let cachedApiKey: string | null | undefined
let cachedAt = 0
const CACHE_TTL_MS = 60_000

async function getHayamiApiKey(): Promise<string | null> {
  const now = Date.now()
  if (cachedApiKey !== undefined && now - cachedAt < CACHE_TTL_MS) {
    return cachedApiKey
  }

  try {
    const result = (await browser.storage.sync.get('hayamiPlusApiKey')) as { hayamiPlusApiKey?: string }
    cachedApiKey = result.hayamiPlusApiKey || null
    cachedAt = now
    return cachedApiKey
  } catch (error) {
    console.warn('[hayamiApi] Failed to load Hayami Plus API key', error)
    cachedApiKey = null
    cachedAt = now
    return null
  }
}

export async function fetchHayami(input: string, init?: RequestInit): Promise<Response> {
  const apiKey = await getHayamiApiKey()
  const headers = new Headers(init?.headers || {})

  if (apiKey) {
    headers.set('x-api-key', apiKey)
  }

  return fetch(input, { ...init, headers })
}
