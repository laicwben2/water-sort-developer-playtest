const SESSION_KEY = 'water-sort-developer-playtest-session-v1'

export function getOrCreateSessionId(): string {
  const existing = window.localStorage.getItem(SESSION_KEY)
  if (existing) return existing

  const created = crypto.randomUUID()
  window.localStorage.setItem(SESSION_KEY, created)
  return created
}

function xmur3(input: string): () => number {
  let hash = 1779033703 ^ input.length
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    return (hash ^= hash >>> 16) >>> 0
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6D2B79F5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function deterministicShuffle<T>(values: readonly T[], sessionId: string): T[] {
  const seed = xmur3(sessionId)()
  const random = mulberry32(seed)
  const shuffled = [...values]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }

  return shuffled
}
