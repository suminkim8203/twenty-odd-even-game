import { CONFIG, quote, removeCards, selectRound, settle } from './engine'
import type { Card, Prediction } from './engine'

export type Phase = 'ready' | 'picking' | 'betting' | 'revealing' | 'result' | 'won' | 'lost'
  | 'bonusCashed' | 'bonusBust' | 'bonusComplete'
export type Mode = 'main' | 'bonus'
export type Entry = {
  mode: Mode; round: number; card: Card; stake: number; returned: number
  won: boolean; coins: number; doubled: boolean
}
export type Session = {
  phase: Phase; mode: Mode; deck: readonly Card[]; board: readonly Card[]; selected: string[]; coins: number
  round: number; stake: number; prediction: Prediction | null; doubled: boolean; doubleUsed: boolean
  elapsedMs: number; lastAt: number | null; startedAt: number; paused: boolean
  history: Entry[]; reason: string; bonusFinalCard: Card | null
}

export function initialSession(): Session {
  return { phase: 'ready', mode: 'main', deck: [], board: [], selected: [], coins: CONFIG.initialCoins,
    round: 1, stake: 20, prediction: null, doubled: false, doubleUsed: false,
    elapsedMs: 0, lastAt: null, startedAt: 0, paused: false, history: [], reason: '', bonusFinalCard: null }
}

export type Action = (
  | { type: 'start'; deck: readonly Card[] }
  | { type: 'startBonus'; deck: readonly Card[]; board: readonly Card[] }
  | { type: 'pick'; id: string }
  | { type: 'reveal' }
  | { type: 'stake'; value: number }
  | { type: 'predict'; value: Prediction }
  | { type: 'toggleDouble' }
  | { type: 'lockBet' | 'settleBet' | 'next' | 'cashOut' }
  | { type: 'pause' | 'resume' | 'tick' }
) & { now: number }

export function active(state: Session) {
  return ['picking', 'betting', 'revealing', 'result'].includes(state.phase)
}

export function wager(state: Session) {
  return state.stake * (state.doubled ? 2 : 1)
}

export function unknownCards(state: Session) {
  return removeCards(state.deck, state.selected.slice(0, 2))
}

function advanceTime(state: Session, now: number): Session {
  if (!active(state) || state.paused || state.lastAt === null) return state
  return { ...state, elapsedMs: state.elapsedMs + Math.max(0, now - state.lastAt), lastAt: Math.max(now, state.lastAt) }
}

export function sessionReducer(previous: Session, action: Action): Session {
  let state = advanceTime(previous, action.now)
  if (action.type === 'start') {
    if (active(state)) return state
    return { ...initialSession(), phase: 'picking', deck: [...action.deck], board: [...action.deck],
      lastAt: action.now, startedAt: action.now }
  }
  if (action.type === 'startBonus') {
    if (state.phase !== 'won') return state
    if (action.deck.length !== 31 || action.board.length !== 40 ||
        new Set(action.deck.map(card => card.id)).size !== 31 ||
        new Set(action.board.map(card => card.id)).size !== 40 ||
        action.deck.some(card => !action.board.some(boardCard => boardCard.id === card.id))) return state
    return { ...state, phase: 'picking', mode: 'bonus', deck: [...action.deck],
      board: [...action.board], selected: [], round: 1, stake: 40,
      prediction: null, doubled: false, doubleUsed: true, reason: '', lastAt: action.now }
  }
  if (!active(state)) return state
  if (action.type === 'resume') return state.paused ? { ...state, paused: false, lastAt: action.now } : state
  if (action.type === 'pause') return { ...state, paused: true, lastAt: null }
  if (state.paused) return state

  switch (action.type) {
    case 'pick':
      if (state.phase !== 'picking' || !state.deck.some(card => card.id === action.id)) return state
      if (state.selected.includes(action.id)) return { ...state, selected: state.selected.filter(id => id !== action.id) }
      if (state.selected.length === 3) return state
      return { ...state, selected: [...state.selected, action.id] }
    case 'reveal':
      return state.phase === 'picking' && state.selected.length === 3 ? { ...state, phase: 'betting' } : state
    case 'stake':
      if (state.phase !== 'betting' || !(state.mode === 'main' ? CONFIG.stakes : CONFIG.bonusStakes).includes(action.value) || action.value > state.coins) return state
      return { ...state, stake: action.value, doubled: state.doubled && action.value * 2 <= state.coins }
    case 'predict':
      return state.phase === 'betting' && quote(unknownCards(state), action.value, wager(state)).possible
        ? { ...state, prediction: action.value } : state
    case 'toggleDouble':
      return state.phase === 'betting' && state.mode === 'main' && !state.doubleUsed && state.stake * 2 <= state.coins
        ? { ...state, doubled: !state.doubled } : state
    case 'lockBet':
      return state.phase === 'betting' && state.prediction ? { ...state, phase: 'revealing' } : state
    case 'settleBet': {
      if (state.phase !== 'revealing' || !state.prediction) return state
      const actualStake = wager(state)
      const result = settle(selectRound(state.deck, state.selected), state.coins, actualStake, state.prediction)
      const entry = { mode: state.mode, round: state.round, card: result.round.selected[2], stake: actualStake,
        returned: result.returned, won: result.won, coins: result.coins, doubled: state.doubled }
      state = { ...state, coins: result.coins, history: [...state.history, entry],
        phase: 'result', doubleUsed: state.doubleUsed || state.doubled, doubled: false }
      if (state.mode === 'main' && state.round >= CONFIG.maxRounds) {
        const won = result.coins >= CONFIG.targetCoins
        return { ...state, phase: won ? 'won' : 'lost', lastAt: null,
          reason: won ? '3라운드 최종 목표를 달성했습니다.' : `목표까지 ${CONFIG.targetCoins - result.coins}코인이 부족합니다.` }
      }
      if (state.mode === 'bonus') {
        if (result.remaining.length < 3) {
          return { ...state, phase: 'bonusComplete', deck: result.remaining, lastAt: null,
            bonusFinalCard: result.remaining[0] ?? null, reason: 'HIGH DECK의 마지막 한 장까지 확인했습니다.' }
        }
        if (result.coins < Math.min(...CONFIG.bonusStakes)) {
          return { ...state, phase: 'bonusBust', lastAt: null,
            reason: '다음 HIGH DECK 베팅에 필요한 코인이 부족합니다.' }
        }
      } else if (result.coins < Math.min(...CONFIG.stakes)) {
        return { ...state, phase: 'lost', lastAt: null, reason: '다음 라운드에 베팅할 코인이 부족합니다.' }
      }
      return state
    }
    case 'next':
      if (state.phase !== 'result') return state
      return { ...state, phase: 'picking', deck: removeCards(state.deck, state.selected), round: state.round + 1,
        selected: [], prediction: null, doubled: false,
        stake: state.stake <= state.coins ? state.stake : (state.mode === 'main' ? CONFIG.stakes[0] : CONFIG.bonusStakes[0]) }
    case 'cashOut':
      return state.phase === 'result' && state.mode === 'bonus'
        ? { ...state, phase: 'bonusCashed', lastAt: null, reason: 'HIGH DECK 점수를 확정했습니다.' }
        : state
    default:
      return state
  }
}
