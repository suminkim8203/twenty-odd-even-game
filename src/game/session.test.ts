import { describe, expect, it } from 'vitest'
import { CONFIG, createBonusSetup, createDeck, createHighCards } from './engine'
import { initialSession, sessionReducer as reduce, wager } from './session'
import type { Session } from './session'

function start(now = 0) {
  return reduce(initialSession(), { type: 'start', deck: createDeck(), now })
}

function prepare(state = start(), ids = ['heart-1', 'spade-2', 'club-4'], now = 100) {
  ids.forEach((id, index) => { state = reduce(state, { type: 'pick', id, now: now + index }) })
  return reduce(state, { type: 'reveal', now: now + 10 })
}

function bet(state: Session, prediction: 'odd' | 'even', now = 200, doubled = false) {
  state = reduce(state, { type: 'predict', value: { kind: 'parity', value: prediction }, now })
  if (doubled) state = reduce(state, { type: 'toggleDouble', now: now + 1 })
  state = reduce(state, { type: 'lockBet', now: now + 2 })
  return reduce(state, { type: 'settleBet', now: now + 3 })
}

function winMain() {
  let state = start()
  const rounds = [
    ['heart-1', 'spade-2', 'club-4'],
    ['heart-3', 'spade-4', 'club-5'],
    ['heart-5', 'spade-1', 'club-1'],
  ]
  rounds.forEach((ids, index) => {
    state = prepare(state, ids, 100 + index * 100)
    state = reduce(state, { type: 'predict', value: { kind: 'suit', value: 'club' }, now: 120 + index * 100 })
    state = reduce(state, { type: 'lockBet', now: 121 + index * 100 })
    state = reduce(state, { type: 'settleBet', now: 122 + index * 100 })
    if (index < 2) state = reduce(state, { type: 'next', now: 123 + index * 100 })
  })
  return state
}

function enterHigh(state = winMain(), now = 500) {
  const setup = createBonusSetup(state.board, state.deck, state.selected, () => 0.37)
  return reduce(state, { type: 'startBonus', ...setup, now })
}

describe('한 판 상태 전환', () => {
  it('공개 전에는 선택을 취소하고 다른 카드로 바꿀 수 있다', () => {
    let state = start()
    state = reduce(state, { type: 'pick', id: 'heart-1', now: 1 })
    state = reduce(state, { type: 'pick', id: 'heart-1', now: 2 })
    expect(state.selected).toEqual([])
    for (const id of ['heart-1', 'spade-2', 'club-4']) state = reduce(state, { type: 'pick', id, now: 3 })
    state = reduce(state, { type: 'pick', id: 'diamond-5', now: 4 })
    expect(state.selected).toEqual(['heart-1', 'spade-2', 'club-4'])
    state = reduce(state, { type: 'pick', id: 'spade-2', now: 5 })
    state = reduce(state, { type: 'pick', id: 'diamond-5', now: 6 })
    expect(state.selected).toEqual(['heart-1', 'club-4', 'diamond-5'])
  })

  it('예측 뒤 베팅을 잠그고 공개 효과가 끝난 뒤 한 번만 정산한다', () => {
    let state = prepare()
    state = reduce(state, { type: 'predict', value: { kind: 'parity', value: 'even' }, now: 200 })
    state = reduce(state, { type: 'lockBet', now: 201 })
    expect(state.phase).toBe('revealing')
    for (let i = 0; i < 10; i++) state = reduce(state, { type: 'settleBet', now: 202 + i })
    expect(state.phase).toBe('result')
    expect(state.coins).toBe(131)
    expect(state.history).toHaveLength(1)
  })

  it('목표를 먼저 넘어도 성공 처리하지 않고 3라운드를 계속한다', () => {
    let state = prepare()
    state = reduce(state, { type: 'predict', value: { kind: 'suit', value: 'club' }, now: 200 })
    state = reduce(state, { type: 'lockBet', now: 201 })
    state = reduce(state, { type: 'settleBet', now: 202 })
    expect(state.coins).toBe(152)
    expect(state.phase).toBe('result')
    state = reduce(state, { type: 'next', now: 203 })
    expect(state.phase).toBe('picking')
    expect(state.round).toBe(2)
  })

  it('DOUBLE DOWN은 실제 베팅을 두 배로 만들고 한 판에 한 번만 쓴다', () => {
    let state = prepare()
    state = reduce(state, { type: 'toggleDouble', now: 200 })
    expect(wager(state)).toBe(40)
    state = bet(state, 'even', 210)
    expect(state.coins).toBe(162)
    expect(state.doubleUsed).toBe(true)
    expect(state.history[0]).toMatchObject({ stake: 40, returned: 102, doubled: true })
    state = reduce(state, { type: 'next', now: 220 })
    state = prepare(state, state.deck.slice(0, 3).map(card => card.id), 230)
    const unchanged = reduce(state, { type: 'toggleDouble', now: 240 })
    expect(unchanged.doubled).toBe(false)
    expect(wager(unchanged)).toBe(20)
  })

  it('세 라운드가 끝난 시점의 코인으로 실패를 판정한다', () => {
    let state = start()
    let now = 100
    for (let round = 1; round <= 3; round++) {
      state = prepare(state, state.deck.slice(0, 3).map(card => card.id), now)
      const target = state.deck.find(card => card.id === state.selected[2])!
      state = bet(state, target.rank % 2 ? 'even' : 'odd', now + 20)
      if (round < 3) state = reduce(state, { type: 'next', now: now + 30 })
      now += 100
    }
    expect(state.phase).toBe('lost')
    expect(state.history).toHaveLength(3)
    expect(state.coins).toBe(40)
  })

  it('최종 성공 뒤 재시작하면 현재 판과 DOUBLE DOWN을 초기화한다', () => {
    let state = winMain()
    expect(state.phase).toBe('won')
    expect(state.coins).toBeGreaterThanOrEqual(CONFIG.targetCoins)
    state = reduce(state, { type: 'start', deck: createDeck(), now: 1000 })
    expect(state).toMatchObject({ phase: 'picking', coins: 100, round: 1, history: [], selected: [], elapsedMs: 0, doubleUsed: false })
  })

  it('일시정지와 포커스 이탈 시간은 최종 플레이 시간에서 제외한다', () => {
    let state = prepare(start(0), undefined, 100)
    state = reduce(state, { type: 'pause', now: 1000 })
    expect(state.elapsedMs).toBe(1000)
    state = reduce(state, { type: 'tick', now: 60000 })
    expect(state.elapsedMs).toBe(1000)
    state = reduce(state, { type: 'resume', now: 60000 })
    state = reduce(state, { type: 'tick', now: 61000 })
    expect(state.elapsedMs).toBe(2000)
  })

  it('다음 라운드에서도 보드 20칸과 원래 카드 위치를 유지한다', () => {
    let state = bet(prepare(), 'even')
    state = reduce(state, { type: 'next', now: 300 })
    expect(state.deck).toHaveLength(17)
    expect(state.board).toHaveLength(20)
    expect(state.board.map(card => card.id)).toEqual(createDeck().map(card => card.id))
  })

  it('기본 성공 뒤 HIGH DECK 31장과 40칸 보드로 전환한다', () => {
    const before = winMain()
    const remainingIds = new Set(before.deck.filter(card => !before.selected.includes(card.id)).map(card => card.id))
    const state = enterHigh(before)
    expect(state).toMatchObject({ mode: 'bonus', phase: 'picking', round: 1, stake: 40, doubleUsed: true })
    expect(state.deck).toHaveLength(31)
    expect(state.board).toHaveLength(40)
    before.board.forEach((card, index) => {
      if (!remainingIds.has(card.id)) expect(state.board[index]).toEqual(card)
    })
    expect(state.board.slice(0, 20).some(card => card.rank > 5)).toBe(true)
    expect(state.board.slice(20).some(card => card.rank <= 5)).toBe(true)
  })

  it('HIGH DECK에서 숫자를 맞히고 점수를 확정할 수 있다', () => {
    let state = enterHigh()
    const ids = state.deck.slice(0, 3).map(card => card.id)
    const hidden = state.deck[2]
    state = prepare(state, ids, 510)
    state = reduce(state, { type: 'predict', value: { kind: 'rank', value: hidden.rank }, now: 520 })
    state = reduce(state, { type: 'lockBet', now: 521 })
    state = reduce(state, { type: 'settleBet', now: 522 })
    expect(state.phase).toBe('result')
    expect(state.history.at(-1)).toMatchObject({ mode: 'bonus', won: true, stake: 40 })
    state = reduce(state, { type: 'cashOut', now: 523 })
    expect(state.phase).toBe('bonusCashed')
  })

  it('HIGH DECK에서 한 장만 남으면 자동 완주하고 마지막 카드를 보인다', () => {
    let state = enterHigh()
    const finalFour = createHighCards().slice(0, 4)
    state = { ...state, deck: finalFour, board: finalFour, round: 10 }
    state = prepare(state, finalFour.slice(0, 3).map(card => card.id), 510)
    state = reduce(state, { type: 'predict', value: { kind: 'rank', value: finalFour[2].rank }, now: 520 })
    state = reduce(state, { type: 'lockBet', now: 521 })
    state = reduce(state, { type: 'settleBet', now: 522 })
    expect(state.phase).toBe('bonusComplete')
    expect(state.deck).toEqual([finalFour[3]])
    expect(state.bonusFinalCard).toEqual(finalFour[3])
  })

  it('HIGH DECK에서 다음 베팅 금액이 부족하면 도전을 종료한다', () => {
    let state = enterHigh()
    state = { ...state, coins: 20, stake: 20 }
    const ids = state.deck.slice(0, 3).map(card => card.id)
    const hidden = state.deck[2]
    state = prepare(state, ids, 510)
    const wrong = hidden.rank % 2 ? 'even' : 'odd'
    state = bet(state, wrong, 520)
    expect(state.phase).toBe('bonusBust')
    expect(state.coins).toBe(0)
  })
})
