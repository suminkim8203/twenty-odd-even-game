import { describe, expect, it } from 'vitest'
import { clearRecords, defaultRecords, loadRecords, saveRecords, STORAGE_KEY } from './storage'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

describe('저장 기록', () => {
  it('저장값이 없거나 비어 있으면 기본값으로 시작한다', () => {
    const storage = new MemoryStorage()
    expect(loadRecords(storage)).toEqual({ records: defaultRecords(), status: 'empty' })
    storage.setItem(STORAGE_KEY, '   ')
    expect(loadRecords(storage)).toEqual({ records: defaultRecords(), status: 'empty' })
  })

  it('정상 기록을 저장하고 다시 읽는다', () => {
    const storage = new MemoryStorage()
    const records = { version: 2 as const, gamesPlayed: 4, wins: 2, bestCoins: 183, highDeckClears: 1, reduceMotion: true }
    expect(saveRecords(storage, records)).toBe(true)
    expect(loadRecords(storage)).toEqual({ records, status: 'ok' })
  })

  it('기존 버전 기록은 HIGH DECK 완주 0회인 새 형식으로 옮긴다', () => {
    const storage = new MemoryStorage()
    const legacy = { version: 1, gamesPlayed: 4, wins: 2, bestCoins: 183, reduceMotion: true }
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy))
    const records = { version: 2 as const, gamesPlayed: 4, wins: 2, bestCoins: 183, highDeckClears: 0, reduceMotion: true }
    expect(loadRecords(storage)).toEqual({ records, status: 'migrated' })
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(records)
  })

  it.each([
    '{broken json',
    JSON.stringify({ version: 2, gamesPlayed: '4', wins: 2, bestCoins: 183, highDeckClears: 0, reduceMotion: false }),
    JSON.stringify({ version: 2, gamesPlayed: 1, wins: 2, bestCoins: 183, highDeckClears: 0, reduceMotion: false }),
    JSON.stringify({ version: 2, gamesPlayed: 2, wins: 2, bestCoins: 183, highDeckClears: 3, reduceMotion: false }),
    JSON.stringify({ version: 2, gamesPlayed: -1, wins: 0, bestCoins: 0, highDeckClears: 0, reduceMotion: false }),
  ])('손상된 값 %s을 기본값으로 복구하고 저장소도 고친다', raw => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, raw)
    expect(loadRecords(storage)).toEqual({ records: defaultRecords(), status: 'recovered' })
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(defaultRecords())
  })

  it('저장소 접근이 실패해도 기본값으로 게임을 계속할 수 있다', () => {
    const storage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    expect(loadRecords(storage)).toEqual({ records: defaultRecords(), status: 'unavailable' })
    expect(saveRecords(storage, defaultRecords())).toBe(false)
    expect(clearRecords(storage)).toBe(false)
  })

  it('저장 초기화는 해당 게임 키를 제거한다', () => {
    const storage = new MemoryStorage()
    saveRecords(storage, { ...defaultRecords(), gamesPlayed: 3 })
    expect(clearRecords(storage)).toBe(true)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
})
