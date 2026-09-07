export const SUITS = ['spade', 'club', 'heart', 'diamond'] as const
export type Suit = typeof SUITS[number]
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export type Card = Readonly<{ id: string; suit: Suit; rank: Rank }>
export type Prediction =
  | { kind: 'parity'; value: 'odd' | 'even' }
  | { kind: 'suit'; value: Suit }
  | { kind: 'rank'; value: Rank }

export const CONFIG = Object.freeze({
  initialCoins: 100, targetCoins: 130, maxRounds: 3,
  stakes: [10, 20, 30] as readonly number[],
  bonusStakes: [20, 40, 60] as readonly number[],
})

export function createDeck(): Card[] {
  return SUITS.flatMap(suit => ([1, 2, 3, 4, 5] as const)
    .map(rank => ({ id: `${suit}-${rank}`, suit, rank })))
}

export function createHighCards(): Card[] {
  return SUITS.flatMap(suit => ([6, 7, 8, 9, 10] as const)
    .map(rank => ({ id: `${suit}-${rank}`, suit, rank })))
}

export function createBonusSetup(
  baseBoard: readonly Card[],
  currentDeck: readonly Card[],
  selected: readonly string[],
  random = Math.random,
) {
  if (baseBoard.length !== 20 || createHighCards().some(high => baseBoard.some(card => card.id === high.id))) {
    throw new Error('기본 보드는 A부터 5까지 20장이어야 합니다.')
  }
  const remainingLow = removeCards(currentDeck, selected)
  const highCards = createHighCards()
  const deck = shuffle([...remainingLow, ...highCards], random)
  const activeIds = new Set(deck.map(card => card.id))
  let nextActive = 0
  const board = [...baseBoard, ...highCards].map(card =>
    activeIds.has(card.id) ? deck[nextActive++] : card)
  if (deck.length !== 31 || board.length !== 40 || nextActive !== deck.length ||
      new Set(board.map(card => card.id)).size !== board.length) {
    throw new Error('HIGH DECK을 구성할 수 없습니다.')
  }
  return { deck, board }
}

export function shuffle(deck: readonly Card[], random = Math.random): Card[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i--) {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('잘못된 난수입니다.')
    const j = Math.floor(value * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function removeCards(deck: readonly Card[], ids: readonly string[]): Card[] {
  if (new Set(deck.map(card => card.id)).size !== deck.length ||
      new Set(ids).size !== ids.length || ids.some(id => !deck.some(card => card.id === id))) {
    throw new Error('중복되거나 덱에 없는 카드입니다.')
  }
  return deck.filter(card => !ids.includes(card.id))
}

export function matches(card: Card, prediction: Prediction): boolean {
  if (prediction.kind === 'suit') return card.suit === prediction.value
  if (prediction.kind === 'rank') return card.rank === prediction.value
  return card.rank % 2 === (prediction.value === 'odd' ? 1 : 0)
}

export function quote(available: readonly Card[], prediction: Prediction, stake: number) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('베팅액은 양의 정수여야 합니다.')
  const count = available.filter(card => matches(card, prediction)).length
  const total = available.length
  const possible = count > 0
  const gross = possible ? Math.floor(stake * total / count) : 0
  return { count, total, possible, probability: total ? count / total : 0,
    multiplier: possible ? total / count : 0, gross, profit: gross - stake }
}

export type Round = Readonly<{
  deck: readonly Card[]
  selected: readonly [Card, Card, Card]
  settled: boolean
}>

export function selectRound(deck: readonly Card[], ids: readonly string[]): Round {
  if (ids.length !== 3) throw new Error('카드 3장을 선택하세요.')
  removeCards(deck, ids)
  const selected = ids.map(id => deck.find(card => card.id === id)!) as [Card, Card, Card]
  return { deck: [...deck], selected, settled: false }
}

export function settle(round: Round, coins: number, stake: number, prediction: Prediction) {
  if (round.settled) throw new Error('이미 정산한 라운드입니다.')
  const allowedWagers = new Set([
    ...CONFIG.stakes.flatMap(value => [value, value * 2]),
    ...CONFIG.bonusStakes,
  ])
  if (!Number.isSafeInteger(coins) || coins < 0 || !allowedWagers.has(stake) || stake > coins) {
    throw new Error('베팅할 수 없는 금액입니다.')
  }
  // 선택된 마지막 카드는 아직 알려지지 않았으므로 확률 분모에 포함한다.
  const available = removeCards(round.deck, round.selected.slice(0, 2).map(card => card.id))
  const offer = quote(available, prediction, stake)
  if (!offer.possible) throw new Error('적중 가능한 카드가 없습니다.')
  const won = matches(round.selected[2], prediction)
  const returned = won ? offer.gross : 0
  return { round: { ...round, settled: true } satisfies Round, won, returned,
    coins: coins - stake + returned,
    remaining: removeCards(round.deck, round.selected.map(card => card.id)) }
}
