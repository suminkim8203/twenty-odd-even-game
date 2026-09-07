export const STORAGE_KEY = 'twenty:records:v1'

export type Records = Readonly<{
  version: 2
  gamesPlayed: number
  wins: number
  bestCoins: number
  highDeckClears: number
  reduceMotion: boolean
}>

export type LoadStatus = 'ok' | 'empty' | 'migrated' | 'recovered' | 'unavailable'
export type LoadResult = { records: Records; status: LoadStatus }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function defaultRecords(): Records {
  return { version: 2, gamesPlayed: 0, wins: 0, bestCoins: 0, highDeckClears: 0, reduceMotion: false }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function isRecords(value: unknown): value is Records {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return data.version === 2 &&
    isNonNegativeInteger(data.gamesPlayed) &&
    isNonNegativeInteger(data.wins) &&
    isNonNegativeInteger(data.bestCoins) &&
    isNonNegativeInteger(data.highDeckClears) &&
    data.wins <= data.gamesPlayed &&
    data.highDeckClears <= data.wins &&
    typeof data.reduceMotion === 'boolean'
}

function migrateLegacy(value: unknown): Records | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.version !== 1 || !isNonNegativeInteger(data.gamesPlayed) ||
      !isNonNegativeInteger(data.wins) || !isNonNegativeInteger(data.bestCoins) ||
      data.wins > data.gamesPlayed || typeof data.reduceMotion !== 'boolean') return null
  return { version: 2, gamesPlayed: data.gamesPlayed, wins: data.wins,
    bestCoins: data.bestCoins, highDeckClears: 0, reduceMotion: data.reduceMotion }
}

export function saveRecords(storage: StorageLike, records: Records): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

export function loadRecords(storage: StorageLike): LoadResult {
  const fallback = defaultRecords()
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null || raw.trim() === '') return { records: fallback, status: 'empty' }
    const parsed: unknown = JSON.parse(raw)
    if (isRecords(parsed)) return { records: parsed, status: 'ok' }
    const migrated = migrateLegacy(parsed)
    if (migrated) return { records: migrated, status: saveRecords(storage, migrated) ? 'migrated' : 'unavailable' }
    return { records: fallback, status: saveRecords(storage, fallback) ? 'recovered' : 'unavailable' }
  } catch {
    return { records: fallback, status: saveRecords(storage, fallback) ? 'recovered' : 'unavailable' }
  }
}

export function clearRecords(storage: StorageLike): boolean {
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
