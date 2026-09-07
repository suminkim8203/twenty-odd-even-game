import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { CONFIG, createBonusSetup, createDeck, quote, shuffle } from './game/engine'
import type { Card, Prediction } from './game/engine'
import { active, initialSession, sessionReducer, unknownCards, wager } from './game/session'
import type { Action } from './game/session'
import { clearRecords, defaultRecords, loadRecords, saveRecords } from './game/storage'
import type { LoadResult, Records } from './game/storage'

const symbols = { spade: '♠', club: '♣', heart: '♥', diamond: '♦' }
const choices: { label: string; prediction: Prediction }[] = [
  { label: '홀수', prediction: { kind: 'parity', value: 'odd' } },
  { label: '짝수', prediction: { kind: 'parity', value: 'even' } },
  { label: '♠ 스페이드', prediction: { kind: 'suit', value: 'spade' } },
  { label: '♣ 클로버', prediction: { kind: 'suit', value: 'club' } },
  { label: '♥ 하트', prediction: { kind: 'suit', value: 'heart' } },
  { label: '♦ 다이아', prediction: { kind: 'suit', value: 'diamond' } },
]
const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const phaseLabels = { ready: '시작 대기', picking: '카드 선택', betting: '예측과 베팅', revealing: '마지막 카드 공개', result: '라운드 결과', won: '성공', lost: '실패', bonusCashed: '점수 확정', bonusBust: 'HIGH DECK 종료', bonusComplete: 'HIGH DECK 완주' }
type Input = Action extends infer A ? A extends Action ? Omit<A, 'now'> : never : never
function cardName(card: Card) { return `${symbols[card.suit]} ${card.rank === 1 ? 'A' : card.rank}` }
function PlayingCard({ card, index, picked, suspense = false }: { card?: Card; index: number; picked: boolean; suspense?: boolean }) {
  return <div className={`card ${card ? `revealed ${['heart', 'diamond'].includes(card.suit) ? 'red' : ''}` : `back${suspense ? ' suspense' : ''}`}`}
    aria-label={card ? `${index + 1}번째 카드 ${cardName(card)}` : `${index + 1}번째 카드 ${picked ? '뒷면' : '선택 대기'}`}>
    {card ? <>{card.rank === 1 ? 'A' : card.rank}<span>{symbols[card.suit]}</span></> : <span>{picked ? '?' : index + 1}</span>}
  </div>
}
export default function App() {
  const [initialLoad] = useState<LoadResult>(() => {
    try { return loadRecords(window.localStorage) }
    catch { return { records: defaultRecords(), status: 'unavailable' } }
  })
  const [state, dispatch] = useReducer(sessionReducer, undefined, initialSession)
  const [records, setRecords] = useState(initialLoad.records)
  const recordsRef = useRef(records)
  const [reduceMotion, setReduceMotion] = useState(initialLoad.records.reduceMotion)
  const [storageNotice, setStorageNotice] = useState(() => initialLoad.status === 'recovered'
    ? '손상된 저장값을 기본값으로 복구했습니다.'
    : initialLoad.status === 'migrated' ? '기존 저장 기록을 새 형식으로 안전하게 갱신했습니다.'
    : initialLoad.status === 'unavailable' ? '기록 저장을 사용할 수 없습니다. 게임은 계속할 수 있습니다.' : '')
  const [resetArmed, setResetArmed] = useState(false)
  const recordedRun = useRef<number | null>(null)
  const recordedBonus = useRef<number | null>(null)
  const historyScroll = useRef<HTMLDivElement>(null)
  const persist = useCallback((next: Records) => {
    recordsRef.current = next
    setRecords(next)
    let saved = false
    try { saved = saveRecords(window.localStorage, next) } catch { saved = false }
    setStorageNotice(saved ? '' : '기록을 저장하지 못했습니다. 현재 게임은 계속할 수 있습니다.')
  }, [])
  const send = (action: Input) => dispatch({ ...action, now: performance.now() } as Action)
  useEffect(() => {
    const pause = () => dispatch({ type: 'pause', now: performance.now() })
    const visibility = () => { if (document.hidden) pause() }
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    if (state.phase !== 'revealing' || state.paused) return
    const timer = window.setTimeout(() => dispatch({ type: 'settleBet', now: performance.now() }), reduceMotion ? 0 : 1400)
    return () => window.clearTimeout(timer)
  }, [state.phase, state.paused, reduceMotion])
  const ended = state.phase === 'won' || state.phase === 'lost'
  const bonusEnded = state.phase === 'bonusCashed' || state.phase === 'bonusBust' || state.phase === 'bonusComplete'
  const terminal = ended || bonusEnded
  useEffect(() => {
    if (!ended || recordedRun.current === state.startedAt) return
    recordedRun.current = state.startedAt
    const current = recordsRef.current
    persist({ ...current,
      gamesPlayed: current.gamesPlayed + 1,
      wins: current.wins + (state.phase === 'won' ? 1 : 0),
      bestCoins: Math.max(current.bestCoins, state.coins),
    })
  }, [ended, state.startedAt, state.phase, state.coins, persist])
  useEffect(() => {
    if (!(state.phase === 'bonusCashed' || state.phase === 'bonusComplete') || recordedBonus.current === state.startedAt) return
    recordedBonus.current = state.startedAt
    const current = recordsRef.current
    persist({ ...current,
      bestCoins: Math.max(current.bestCoins, state.coins),
      highDeckClears: current.highDeckClears + (state.phase === 'bonusComplete' ? 1 : 0),
    })
  }, [state.phase, state.startedAt, state.coins, persist])
  useEffect(() => {
    const list = historyScroll.current
    if (list) list.scrollTop = list.scrollHeight
  }, [state.history.length])
  const changeReduceMotion = (value: boolean) => {
    setReduceMotion(value)
    persist({ ...recordsRef.current, reduceMotion: value })
  }
  const resetStorage = () => {
    let cleared = false
    try { cleared = clearRecords(window.localStorage) } catch { cleared = false }
    const next = defaultRecords()
    recordsRef.current = next
    setRecords(next)
    setReduceMotion(false)
    setResetArmed(false)
    setStorageNotice(cleared ? '저장 기록과 효과 설정을 초기화했습니다.' : '저장소를 지우지 못했지만 현재 화면의 기록은 초기화했습니다.')
  }
  const last = state.history.at(-1)
  const settledThisRound = last?.mode === state.mode && last?.round === state.round
  const revealed = state.phase !== 'picking' && state.phase !== 'ready'
  const needsOdds = state.phase === 'betting' || state.phase === 'revealing'
  const available = needsOdds && state.selected.length === 3 ? unknownCards(state) : state.deck
  const actualWager = wager(state)
  const offer = state.prediction ? quote(available, state.prediction, actualWager) : null
  const goalStatus = state.coins >= CONFIG.targetCoins
    ? `잠정 통과 +${state.coins - CONFIG.targetCoins}`
    : `목표까지 ${CONFIG.targetCoins - state.coins}`
  const stakes = state.mode === 'main' ? CONFIG.stakes : CONFIG.bonusStakes
  return <main className={reduceMotion ? 'reduce-motion' : ''}>
    <header><a className="brand" href="./" aria-label="TWENTY 홈">TWENTY<span className="brand-suits" aria-hidden="true"><i>♠</i><i>♥</i><i>♣</i><i className="diamond">♦</i></span></a><div className="header-tools"><span className="badge">20장으로 읽는 마지막 한 장</span><label className="motion-toggle"><input type="checkbox" checked={reduceMotion} onChange={event => changeReduceMotion(event.target.checked)} />움직임 줄이기</label></div></header>
    <section className="intro"><p className="eyebrow">20 CARDS. ONE CHOICE.</p>
      <h1>ODD<br />OR EVEN?</h1>
      <p>두 장을 보고, 남은 가능성을 선택하세요.<br />3라운드가 끝날 때 <strong>{CONFIG.targetCoins}코인</strong>을 만들면 성공!</p>
      <ol className="rules"><li>뒷면 카드 중 3장을 차례로 선택합니다.</li><li>앞의 두 장을 공개하고 베팅액과 홀짝 또는 무늬를 고릅니다.</li><li>3라운드 성공 후 HIGH DECK에 도전할 수 있습니다.</li></ol>
      <div className="facts"><span>A = 1 · 숫자 1~5</span><span>기본 3라운드</span><span>HIGH DECK · 6~10</span></div>
      <p className="note">사용한 카드는 다음 라운드에서 제외됩니다. 중간에 목표를 넘어도 3라운드를 모두 진행합니다.</p>
      <section className="saved-records" aria-label="저장 기록"><h2>저장 기록</h2><div><span>완료한 판<strong>{records.gamesPlayed}</strong></span><span>성공<strong>{records.wins}</strong></span><span>HIGH 완주<strong>{records.highDeckClears}</strong></span><span>최고 코인<strong>{records.bestCoins || '—'}</strong></span></div>
        {resetArmed ? <p className="reset-confirm">정말 모두 지울까요? <button onClick={resetStorage}>초기화</button><button onClick={() => setResetArmed(false)}>취소</button></p> : <button className="reset-link" onClick={() => setResetArmed(true)}>저장 초기화</button>}
        {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
      </section>
      {state.history.length > 0 && <section className="history"><h2>이번 판 기록 <small>{state.history.length}건</small></h2><div className="history-scroll" ref={historyScroll} tabIndex={0} aria-label="이번 판 기록 목록"><ol>{state.history.map(entry => <li key={`${entry.mode}-${entry.round}`}>{entry.mode === 'bonus' ? 'HIGH ' : ''}{entry.round}R · {cardName(entry.card)} · {entry.won ? '적중' : '빗나감'}{entry.doubled ? ' · DOUBLE DOWN' : ''} · {entry.returned - entry.stake > 0 ? '+' : ''}{entry.returned - entry.stake} → {entry.coins}코인</li>)}</ol></div></section>}
    </section>
    <section className="table" aria-label="카드 게임">
      <div className="section-title"><h2 aria-live="polite">{phaseLabels[state.phase]}</h2>{active(state) && <button className="small" onClick={() => send({ type: state.paused ? 'resume' : 'pause' })}>{state.paused ? '계속하기' : '일시정지'}</button>}</div>
      <div className="status"><div>보유 코인<strong>{state.coins}{state.mode === 'main' && <small> / {CONFIG.targetCoins}</small>}</strong></div><div>라운드<strong>{state.mode === 'bonus' ? `HIGH ${state.round}` : state.round}<small>{state.mode === 'main' ? ' / 3' : ''}</small></strong></div><div>현재 상황<strong className={state.coins >= CONFIG.targetCoins ? 'safe' : ''}>{state.mode === 'bonus' ? '점수 도전 중' : goalStatus}{state.mode === 'main' && <small>코인</small>}</strong></div></div>
      {state.paused ? <div className="pause-panel" role="status"><h3>잠시 쉬어가세요</h3><p>게임과 플레이 시간 기록이 멈췄습니다.<br />준비되면 계속하기를 눌러주세요.</p><button className="primary" onClick={() => send({ type: 'resume' })}>계속하기</button></div> : <>
        <div className="cards">{[0, 1, 2].map(index => {
          const card = state.board.find(item => item.id === state.selected[index])
          return <div className="card-slot" key={index}><PlayingCard index={index} picked={!!card} suspense={index === 2 && state.phase === 'revealing'} card={revealed && (index < 2 || settledThisRound) ? card : undefined} /><small>{index === 2 ? '마지막 예측 카드' : `${index + 1}번째 카드`}</small></div>
        })}</div>
        {state.phase === 'ready' && <div className="welcome"><p>100코인으로 시작해 3라운드를 진행합니다.<br />빠르게 플레이하면 30초 안에 끝낼 수 있습니다.</p><button className="primary" onClick={() => send({ type: 'start', deck: shuffle(createDeck()) })}>게임 시작</button></div>}
        {state.phase === 'picking' && <><p className="hint">{state.selected.length === 3 ? '선택 완료! 앞의 두 장을 확인하세요.' : `카드 ${3 - state.selected.length}장을 더 골라주세요. 선택 순서대로 놓입니다.`}</p>
          {state.round > 1 && <p className="used-guide"><span className="used-sample">A♥</span> 앞면 카드는 이전 라운드에서 사용되어 다시 고를 수 없습니다.</p>}
          <div className="deck">{state.board.map((card, index) => {
            const used = !state.deck.some(remaining => remaining.id === card.id)
            const order = state.selected.indexOf(card.id)
            const red = card.suit === 'heart' || card.suit === 'diamond'
            return <button className={`deck-card${used ? ` used-card${red ? ' red' : ''}` : ''}`} key={card.id}
              disabled={used || (order < 0 && state.selected.length === 3)}
              aria-label={used ? `사용한 카드 ${index + 1}, ${cardName(card)}` : `뒷면 카드 ${index + 1}${order >= 0 ? `, ${order + 1}번째 선택됨` : ''}`}
              aria-pressed={order >= 0} onClick={() => send({ type: 'pick', id: card.id })}>
              {used ? <><b>{card.rank === 1 ? 'A' : card.rank}</b><span>{symbols[card.suit]}</span></> : order >= 0 ? order + 1 : '✦'}
            </button>
          })}</div><button className="primary wide" disabled={state.selected.length !== 3} onClick={() => send({ type: 'reveal' })}>앞의 두 장 공개</button></>}
        {state.phase === 'betting' && <>
          <p className="hint">미공개 {available.length}장 기준 · 마지막 카드도 포함 · 충분히 생각한 뒤 결정하세요.</p>
          <fieldset><legend>1. 베팅액{state.mode === 'bonus' && ' · HIGH STAKES'}</legend>{stakes.map(value => <button key={value} disabled={value > state.coins} aria-pressed={state.stake === value} onClick={() => send({ type: 'stake', value })}>{value} 코인</button>)}</fieldset>
          {state.mode === 'main' && <button className="double-down" disabled={state.doubleUsed || state.stake * 2 > state.coins} aria-pressed={state.doubled} onClick={() => send({ type: 'toggleDouble' })}>
            <strong>{state.doubleUsed ? 'DOUBLE DOWN 사용 완료' : state.doubled ? `DOUBLE DOWN ON · ${actualWager}코인` : 'DOUBLE DOWN · 한 판에 한 번'}</strong>
            <span>{state.doubleUsed ? '이번 판에는 다시 사용할 수 없습니다.' : '베팅액과 적중 반환액을 두 배 기준으로 계산합니다.'}</span>
          </button>}
          <fieldset className="prediction-field"><legend>2. 마지막 카드 예측 · 확률 / 원금 포함 반환</legend><div className="odds">{choices.map(({ label, prediction }) => {
            const choice = quote(available, prediction, actualWager)
            const selected = state.prediction?.kind === prediction.kind && state.prediction?.value === prediction.value
            return <button key={label} disabled={!choice.possible} aria-pressed={selected} onClick={() => send({ type: 'predict', value: prediction })}><span>{label} <small>{choice.count}장</small></span><strong>{(choice.probability * 100).toFixed(1)}%</strong><span>{choice.possible ? `${choice.gross}코인 반환` : '남은 카드 없음'}</span></button>
          })}</div></fieldset>
          {state.mode === 'bonus' && <fieldset className="rank-field"><legend>3. 숫자 맞히기 · 무늬와 관계없이 숫자 하나</legend><div className="rank-odds">{ranks.map(rank => {
            const prediction: Prediction = { kind: 'rank', value: rank }
            const choice = quote(available, prediction, actualWager)
            const selected = state.prediction?.kind === 'rank' && state.prediction.value === rank
            return <button key={rank} disabled={!choice.possible} aria-pressed={selected} onClick={() => send({ type: 'predict', value: prediction })}><strong>{rank === 1 ? 'A' : rank}</strong><span>{(choice.probability * 100).toFixed(1)}%</span><small>{choice.possible ? `${choice.gross} 반환` : '없음'}</small></button>
          })}</div></fieldset>}
          <p className="bet-summary" aria-live="polite">{offer ? `적중 시 ${offer.gross}코인 반환 · 순이익 +${offer.profit} / 빗나가면 −${actualWager}` : state.mode === 'bonus' ? '홀짝·무늬·숫자 중 하나를 선택하세요.' : '홀짝 또는 무늬 중 하나를 선택하세요.'}</p>
          <button className="primary wide" disabled={!state.prediction} onClick={() => send({ type: 'lockBet' })}>{actualWager}코인 베팅 확정</button>
        </>}
        {state.phase === 'revealing' && <div className="reveal-panel" role="status"><span>✦</span><h3>마지막 한 장</h3><p>선택은 확정됐습니다. 카드를 공개합니다…</p></div>}
        {(state.phase === 'result' || terminal) && <div className={`result-panel ${last?.won ? 'win' : 'miss'}${state.phase === 'bonusComplete' ? ' high-complete' : ''}`} role="status">
          <h3>{state.phase === 'won' ? '목표 달성!' : state.phase === 'lost' ? '이번 판 종료' : state.phase === 'bonusCashed' ? '점수 확정!' : state.phase === 'bonusComplete' ? 'HIGH DECK 완주!' : state.phase === 'bonusBust' ? '도전 종료' : last?.won ? '예측 적중!' : '아쉽게 빗나갔어요'}</h3>
          {settledThisRound && last && <p>{cardName(last.card)} · {last.won ? `${last.returned}코인 반환 (순이익 +${last.returned - last.stake})` : `${last.stake}코인을 잃었습니다.`}</p>}
          {state.phase === 'won' ? <><p>{state.reason}</p><p className="final-time">기본 게임 시간 <strong>{(state.elapsedMs / 1000).toFixed(1)}초</strong></p><div className="result-actions"><button onClick={() => send({ type: 'start', deck: shuffle(createDeck()) })}>점수 확정 · 새 게임</button><button className="primary high-button" onClick={() => send({ type: 'startBonus', ...createBonusSetup(state.board, state.deck, state.selected) })}>HIGH DECK 도전 · 6~10 해금</button></div></>
          : state.phase === 'lost' ? <><p>{state.reason}</p><p className="final-time">최종 플레이 시간 <strong>{(state.elapsedMs / 1000).toFixed(1)}초</strong></p><button className="primary" onClick={() => send({ type: 'start', deck: shuffle(createDeck()) })}>다시 시작 · 100코인</button></>
          : bonusEnded ? <><p>{state.reason}</p>{state.phase === 'bonusComplete' && state.bonusFinalCard && <p className="last-card">마지막 남은 카드 <strong>{cardName(state.bonusFinalCard)}</strong></p>}{state.phase === 'bonusComplete' ? <div className="high-complete-stats"><span>최종 스코어<strong>{state.coins}코인</strong></span><span>최고 코인 기록<strong>{Math.max(records.bestCoins, state.coins)}코인</strong></span><span>HIGH DECK 완주<strong>{records.highDeckClears}회</strong></span><small>전체 플레이 시간 {(state.elapsedMs / 1000).toFixed(1)}초</small></div> : <p className="final-time">확정 점수 <strong>{state.coins}코인</strong> · 전체 시간 {(state.elapsedMs / 1000).toFixed(1)}초</p>}{state.phase === 'bonusBust' && <p className="note">기본 게임 성공 기록은 유지되지만 HIGH DECK 최고 점수는 갱신되지 않습니다.</p>}<button className="primary" onClick={() => send({ type: 'start', deck: shuffle(createDeck()) })}>새 게임 · 100코인</button></>
          : state.mode === 'bonus' ? <><p className="checkpoint">현재 {state.coins}코인 · 지금 확정하거나 더 높은 점수에 도전하세요.</p><div className="result-actions"><button onClick={() => send({ type: 'cashOut' })}>점수 확정</button><button className="primary" onClick={() => send({ type: 'next' })}>계속 도전 · {state.deck.length - 3}장 남음</button></div></>
          : <><p className={`checkpoint ${state.coins >= CONFIG.targetCoins ? 'safe' : ''}`}>{goalStatus}{state.coins >= CONFIG.targetCoins ? ' · 마지막까지 지켜내세요.' : '코인'}</p><button className="primary" onClick={() => send({ type: 'next' })}>다음 라운드 · {state.deck.length - 3}장 남음</button></>}
        </div>}
      </>}
      <p className="note">시간 제한 없음 · 최종 플레이 시간만 기록 · 창을 벗어나면 게임과 기록이 자동 일시정지</p>
    </section>
    <footer>게임 전용 가상 코인 · 충전 및 현금화 없음</footer>
  </main>
}
