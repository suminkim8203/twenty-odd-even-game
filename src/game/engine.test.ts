import { describe, expect, it } from 'vitest'
import { createBonusSetup, createDeck, createHighCards, matches, quote, removeCards, selectRound, settle, shuffle } from './engine'

describe('20장 카드와 확률', () => {
  it('고유한 20장에 홀수 12장, 짝수 8장을 생성한다', () => {
    const deck = createDeck()
    expect(new Set(deck.map(card => card.id)).size).toBe(20)
    expect(deck.filter(card => matches(card, { kind: 'parity', value: 'odd' }))).toHaveLength(12)
    expect(deck.filter(card => matches(card, { kind: 'parity', value: 'even' }))).toHaveLength(8)
  })
  it('HIGH DECK용 6~10 카드 20장을 별도로 생성한다', () => {
    const high = createHighCards()
    expect(high).toHaveLength(20)
    expect(new Set(high.map(card => card.id)).size).toBe(20)
    expect(high.every(card => card.rank >= 6 && card.rank <= 10)).toBe(true)
    expect(high.some(card => createDeck().some(base => base.id === card.id))).toBe(false)
  })
  it('HIGH DECK에서 사용 카드는 고정하고 나머지 31장을 빈자리 전체에 다시 섞는다', () => {
    const board = createDeck()
    const alreadyUsed = board.slice(0, 6)
    const currentDeck = removeCards(board, alreadyUsed.map(card => card.id))
    const selected = currentDeck.slice(0, 3).map(card => card.id)
    let seed = 17
    const random = () => ((seed = seed * 48271 % 2147483647) / 2147483647)
    const setup = createBonusSetup(board, currentDeck, selected, random)
    expect(setup.deck).toHaveLength(31)
    expect(setup.board).toHaveLength(40)
    expect(new Set(setup.board.map(card => card.id)).size).toBe(40)
    alreadyUsed.forEach(card => expect(setup.board[board.indexOf(card)]).toEqual(card))
    selected.forEach(id => expect(setup.board[board.findIndex(card => card.id === id)]).toEqual(board.find(card => card.id === id)))
    expect(setup.board.slice(0, 20).some(card => card.rank > 5)).toBe(true)
    expect(setup.board.slice(20).some(card => card.rank <= 5)).toBe(true)
  })
  it('섞어도 원본과 카드 집합을 보존한다', () => {
    const deck = createDeck()
    const original = [...deck]
    const shuffled = shuffle(deck, () => 0.25)
    expect(deck).toEqual(original)
    expect(shuffled).not.toEqual(deck)
    expect(shuffled.map(card => card.id).sort()).toEqual(deck.map(card => card.id).sort())
  })
  it('공개 카드가 홀홀/홀짝/짝짝일 때 정확히 계산한다', () => {
    for (const [ids, oddCount] of [
      [['heart-1', 'spade-3'], 10],
      [['heart-1', 'spade-2'], 11],
      [['heart-2', 'spade-4'], 12],
    ] as const) {
      const available = removeCards(createDeck(), ids)
      const odd = quote(available, { kind: 'parity', value: 'odd' }, 20)
      const even = quote(available, { kind: 'parity', value: 'even' }, 20)
      expect(odd.total).toBe(18)
      expect(odd.count).toBe(oddCount)
      expect(odd.probability + even.probability).toBeCloseTo(1)
      expect(odd.gross).toBe(Math.floor(20 * 18 / oddCount))
    }
  })
  it('소진된 무늬와 빈 덱은 적중 불가능하다', () => {
    const deck = createDeck().filter(card => card.suit !== 'heart')
    expect(quote(deck, { kind: 'suit', value: 'heart' }, 20).possible).toBe(false)
    expect(quote([], { kind: 'parity', value: 'odd' }, 20).probability).toBe(0)
  })
})

describe('선택과 정산', () => {
  const ids = ['heart-1', 'spade-2', 'club-4']
  it('선택 순서를 유지하고 숨겨진 카드까지 포함한 확률로 정산한다', () => {
    const round = selectRound(createDeck(), ids)
    const result = settle(round, 100, 20, { kind: 'parity', value: 'even' })
    expect(round.selected.map(card => card.id)).toEqual(ids)
    expect(result.won).toBe(true)
    expect(result.returned).toBe(51)
    expect(result.coins).toBe(131)
    expect(result.remaining).toHaveLength(17)
    expect(result.remaining.some(card => ids.includes(card.id))).toBe(false)
    expect(() => settle(result.round, 131, 20, { kind: 'parity', value: 'even' })).toThrow()
  })
  it('오답이면 베팅액만 차감한다', () => {
    expect(settle(selectRound(createDeck(), ids), 100, 20,
      { kind: 'parity', value: 'odd' }).coins).toBe(80)
  })
  it('중복 선택, 없는 카드, 부족한 잔액, 잘못된 베팅을 거절한다', () => {
    expect(() => selectRound(createDeck(), ['heart-1', 'heart-1', 'club-4'])).toThrow()
    expect(() => selectRound(createDeck(), ['heart-1', 'spade-9', 'club-4'])).toThrow()
    expect(() => selectRound(createDeck(), ['heart-1'])).toThrow()
    const round = selectRound(createDeck(), ids)
    for (const stake of [0, -10, 15, 30, NaN]) {
      expect(() => settle(round, 20, stake, { kind: 'parity', value: 'odd' })).toThrow()
    }
  })
  it('3라운드에 걸쳐 사용한 카드를 계속 제외한다', () => {
    let deck = createDeck()
    for (const size of [17, 14, 11]) {
      const round = selectRound(deck, deck.slice(0, 3).map(card => card.id))
      const value = round.selected[2].rank % 2 ? 'odd' : 'even'
      deck = settle(round, 100, 10, { kind: 'parity', value }).remaining
      expect(deck).toHaveLength(size)
    }
  })
})
