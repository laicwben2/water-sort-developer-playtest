'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { applyMove, calculatePour, isSolved, type Board } from '../lib/game'
import {
  GIVE_UP_REASONS,
  type GiveUpReason,
  type PlaytestAction,
  type PlaytestResult,
} from '../lib/results'
import {
  buildResultsDocument,
  loadResults,
  saveResults,
  submitResults,
} from '../lib/result-storage'
import { deterministicShuffle, getOrCreateSessionId } from '../lib/session'

interface Puzzle {
  benchmarkId: string
  capacity: number
  board: Board
}

interface BlindBenchmark {
  version: string
  benchmark: string
  puzzles: Puzzle[]
}

type Phase = 'intro' | 'ready' | 'playing' | 'feedback' | 'complete'
type Outcome = 'solved' | 'gave-up'

const palette = [
  '#ef5350', '#42a5f5', '#66bb6a', '#ffca28',
  '#ab47bc', '#26c6da', '#ff7043', '#8d6e63',
  '#78909c', '#ec407a', '#7e57c2', '#9ccc65',
]

const reasonLabels: Record<GiveUpReason, string> = {
  'no-next-move': '不知道下一步怎麼走',
  'likely-dead-end': '感覺已經走進死路',
  'repeated-restarts': '重開多次仍無法完成',
  'too-many-choices': '選擇太多，不知道哪個較好',
  'taking-too-long': '題目太耗時間',
  'no-longer-fun': '覺得這題不想繼續玩',
  other: '其他',
}

function cloneBoard(board: Board): Board {
  return board.map((tube) => [...tube])
}

function formatTime(milliseconds: number): string {
  const tenths = Math.floor(milliseconds / 100) % 10
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export function PlaytestShell() {
  const [benchmark, setBenchmark] = useState<BlindBenchmark | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [board, setBoard] = useState<Board>([])
  const [selectedTube, setSelectedTube] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [moves, setMoves] = useState(0)
  const [restarts, setRestarts] = useState(0)
  const [actions, setActions] = useState<PlaytestAction[]>([])
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [message, setMessage] = useState('')
  const [results, setResults] = useState<PlaytestResult[]>([])
  const [perceivedDifficulty, setPerceivedDifficulty] = useState('')
  const [confidence, setConfidence] = useState('')
  const [frustration, setFrustration] = useState('')
  const [giveUpReasons, setGiveUpReasons] = useState<GiveUpReason[]>([])
  const [giveUpNote, setGiveUpNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)

    fetch('/benchmark.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load benchmark')
        return response.json() as Promise<BlindBenchmark>
      })
      .then(setBenchmark)
      .catch((error) => {
        console.error(error)
        setMessage('載入測試資料失敗。')
      })
  }, [])

  const orderedPuzzles = useMemo(() => {
    if (!benchmark || !sessionId) return []
    return deterministicShuffle(benchmark.puzzles, sessionId)
  }, [benchmark, sessionId])

  useEffect(() => {
    if (!benchmark || !sessionId || orderedPuzzles.length === 0) return
    const stored = loadResults(benchmark.benchmark, sessionId)
    setResults(stored)

    if (stored.length > 0) {
      submitResults(sessionId, buildResultsDocument(benchmark.benchmark, stored))
        .catch((error) => {
          console.warn('Background playtest sync failed', error)
        })
    }

    const completedIds = new Set(stored.map((result) => result.benchmarkId))
    const firstPending = orderedPuzzles.findIndex(
      (puzzle) => !completedIds.has(puzzle.benchmarkId),
    )
    if (firstPending === -1 && stored.length > 0) {
      setPhase('complete')
      setCurrentIndex(orderedPuzzles.length - 1)
    } else {
      setCurrentIndex(firstPending === -1 ? 0 : firstPending)
    }
  }, [benchmark, orderedPuzzles, sessionId])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const currentPuzzle = orderedPuzzles[currentIndex]
  const completedIds = useMemo(
    () => new Set(results.map((result) => result.benchmarkId)),
    [results],
  )

  function stopTimer(): number {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    const startedAt = startedAtRef.current
    const finalElapsed = startedAt === null ? elapsedMs : Math.round(performance.now() - startedAt)
    setElapsedMs(finalElapsed)
    startedAtRef.current = null
    return finalElapsed
  }

  function beginPuzzle(): void {
    if (!currentPuzzle) return
    setBoard(cloneBoard(currentPuzzle.board))
    setSelectedTube(null)
    setElapsedMs(0)
    setMoves(0)
    setRestarts(0)
    setActions([])
    setOutcome(null)
    setMessage('')
    setPerceivedDifficulty('')
    setConfidence('')
    setFrustration('')
    setGiveUpReasons([])
    setGiveUpNote('')
    setPhase('playing')

    const startedAt = performance.now()
    startedAtRef.current = startedAt
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setElapsedMs(Math.round(performance.now() - startedAt))
    }, 100)
  }

  function finishPuzzle(nextOutcome: Outcome): void {
    stopTimer()
    setSelectedTube(null)
    setOutcome(nextOutcome)
    setPhase('feedback')
    setMessage(
      nextOutcome === 'solved'
        ? '完成。請先留下這題的感受。'
        : '已記為放棄。請告訴我們卡住的原因。',
    )
  }

  function handleTubeClick(index: number): void {
    if (phase !== 'playing' || !currentPuzzle) return
    setMessage('')

    if (selectedTube === null) {
      if (board[index]?.length === 0) return
      setSelectedTube(index)
      return
    }

    if (selectedTube === index) {
      setSelectedTube(null)
      return
    }

    const move = calculatePour(board, selectedTube, index, currentPuzzle.capacity)
    setSelectedTube(null)
    if (!move) {
      setMessage('這一步不能倒入目標試管。')
      return
    }

    const next = applyMove(board, move)
    const atMs = startedAtRef.current === null
      ? elapsedMs
      : Math.round(performance.now() - startedAtRef.current)

    setBoard(next)
    setMoves((value) => value + 1)
    setActions((value) => [...value, { type: 'move', atMs, ...move }])

    if (isSolved(next, currentPuzzle.capacity)) {
      setBoard(next)
      setTimeout(() => finishPuzzle('solved'), 0)
    }
  }

  function restartPuzzle(): void {
    if (phase !== 'playing' || !currentPuzzle) return

    const atMs = startedAtRef.current === null
      ? elapsedMs
      : Math.round(performance.now() - startedAtRef.current)

    setBoard(cloneBoard(currentPuzzle.board))
    setSelectedTube(null)
    setRestarts((value) => value + 1)
    setActions((value) => [...value, { type: 'restart', atMs }])
    setMessage('已重開本題；計時與累積步數持續。')
  }

  function requestGiveUp(): void {
    if (phase !== 'playing') return
    if (
      window.confirm(
        '確定要放棄這一題嗎？目前時間、步數、重開與操作紀錄都會保留。',
      )
    ) {
      finishPuzzle('gave-up')
    }
  }

  function toggleGiveUpReason(reason: GiveUpReason): void {
    setGiveUpReasons((current) =>
      current.includes(reason)
        ? current.filter((value) => value !== reason)
        : [...current, reason],
    )
  }

  async function saveFeedback(): Promise<void> {
    if (!benchmark || !sessionId || !currentPuzzle || !outcome) return

    const difficulty = Number(perceivedDifficulty)
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      setMessage('請先選擇 1–5 的主觀難度。')
      return
    }
    if (outcome === 'gave-up' && giveUpReasons.length === 0) {
      setMessage('放棄的題目請至少選擇一個原因。')
      return
    }
    if (
      outcome === 'gave-up' &&
      giveUpReasons.includes('other') &&
      giveUpNote.trim() === ''
    ) {
      setMessage('選擇「其他」時請填寫說明。')
      return
    }

    const result: PlaytestResult = {
      benchmarkId: currentPuzzle.benchmarkId,
      outcome,
      elapsedMs,
      moves,
      restarts,
      actions: actions.map((action) => ({ ...action })),
      finalBoard: cloneBoard(board),
      perceivedDifficulty: difficulty,
      ...(confidence ? { confidence: Number(confidence) } : {}),
      ...(frustration ? { frustration: Number(frustration) } : {}),
      ...(outcome === 'gave-up' ? { giveUpReasons } : {}),
      ...(outcome === 'gave-up' && giveUpNote.trim()
        ? { giveUpNote: giveUpNote.trim() }
        : {}),
    }

    const nextResults = [
      ...results.filter((entry) => entry.benchmarkId !== currentPuzzle.benchmarkId),
      result,
    ]
    setResults(nextResults)
    saveResults(benchmark.benchmark, sessionId, nextResults)

    setSubmitting(true)
    let syncWarning = ''
    try {
      await submitResults(
        sessionId,
        buildResultsDocument(benchmark.benchmark, nextResults),
      )
    } catch (error) {
      console.warn('Playtest sync failed', error)
      syncWarning = '；已保存在本機，但伺服器提交失敗，之後會自動重試'
    } finally {
      setSubmitting(false)
    }

    const nextPending = orderedPuzzles.findIndex(
      (puzzle, index) =>
        index > currentIndex &&
        !nextResults.some((entry) => entry.benchmarkId === puzzle.benchmarkId),
    )

    if (nextPending === -1) {
      const anyPending = orderedPuzzles.findIndex(
        (puzzle) =>
          !nextResults.some((entry) => entry.benchmarkId === puzzle.benchmarkId),
      )
      if (anyPending === -1) {
        setPhase('complete')
        setMessage('本次盲測已完成' + syncWarning + '。')
        return
      }
      setCurrentIndex(anyPending)
    } else {
      setCurrentIndex(nextPending)
    }

    setPhase('ready')
    setBoard([])
    setOutcome(null)
    setMessage(currentPuzzle.benchmarkId + ' 已儲存' + syncWarning + '。')
  }

  if (!benchmark || !sessionId) {
    return (
      <>
        <h1>Water Sort Developer Playtest</h1>
        <section className="card">
          <strong>{message || '載入測試資料中…'}</strong>
        </section>
      </>
    )
  }

  return (
    <>
      <h1>Water Sort Developer Playtest</h1>
      <p className="muted">
        這是盲測版本。頁面不會顯示原始 Easy / Medium / Hard、最佳步數或 solver 指標。
      </p>

      <section className="card">
        <div className="row">
          <strong>匿名 Session</strong>
          <code>{sessionId.slice(0, 8)}</code>
          <span className="muted">已完成 {results.length} / {orderedPuzzles.length}</span>
        </div>

        {phase === 'intro' && (
          <>
            <p>
              題目順序會依匿名 session 隨機化，而且重新整理後維持同一順序。
              完成或明確放棄並送出回饋後，該題結果會保存在這個瀏覽器。
            </p>
            <button className="primary" onClick={() => setPhase('ready')}>
              開始測試
            </button>
          </>
        )}

        {phase !== 'intro' && phase !== 'complete' && currentPuzzle && (
          <>
            <div className="row">
              <strong>第 {currentIndex + 1} / {orderedPuzzles.length} 題</strong>
              <span>{currentPuzzle.benchmarkId}</span>
            </div>

            {phase === 'ready' && (
              <div className="order">
                {orderedPuzzles.map((puzzle, index) => (
                  <div
                    key={puzzle.benchmarkId}
                    className={
                      'pill' +
                      (index === currentIndex ? ' current' : '') +
                      (completedIds.has(puzzle.benchmarkId) ? ' completed' : '')
                    }
                  >
                    {puzzle.benchmarkId}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === 'ready' && currentPuzzle && (
          <div className="ready-panel">
            <strong>盤面尚未顯示</strong>
            <p className="muted">按「開始本題」後才顯示盤面並開始計時。</p>
            <button className="primary" onClick={beginPuzzle}>
              開始本題
            </button>
          </div>
        )}

        {(phase === 'playing' || phase === 'feedback') && currentPuzzle && (
          <>
            <div className="stats">
              <div className="stat"><span>時間</span><strong>{formatTime(elapsedMs)}</strong></div>
              <div className="stat"><span>步數</span><strong>{moves}</strong></div>
              <div className="stat"><span>重開</span><strong>{restarts}</strong></div>
              <div className="stat">
                <span>狀態</span>
                <strong>
                  {phase === 'playing'
                    ? '進行中'
                    : outcome === 'solved'
                      ? '完成'
                      : '放棄'}
                </strong>
              </div>
            </div>

            {message && phase !== 'playing' && phase !== 'feedback' && (
          <p className="message">{message}</p>
        )}

            <div className="board-wrap">
              <div className="board" aria-label={currentPuzzle.benchmarkId}>
                {board.map((tube, tubeIndex) => (
                  <button
                    className={'tube' + (selectedTube === tubeIndex ? ' selected' : '')}
                    key={tubeIndex}
                    type="button"
                    disabled={phase !== 'playing'}
                    onClick={() => handleTubeClick(tubeIndex)}
                    aria-label={`試管 ${tubeIndex + 1}`}
                  >
                    {Array.from({ length: currentPuzzle.capacity }, (_, slot) => {
                      const color = tube[slot]
                      return (
                        <span
                          className="cell"
                          key={slot}
                          style={{
                            background:
                              color === undefined
                                ? 'transparent'
                                : palette[color % palette.length],
                            borderColor:
                              color === undefined
                                ? 'transparent'
                                : 'rgba(0,0,0,.2)',
                          }}
                        />
                      )
                    })}
                  </button>
                ))}
              </div>
            </div>

            {phase === 'playing' && (
              <div className="row controls">
                <button onClick={restartPuzzle}>重開本題</button>
                <button className="danger" onClick={requestGiveUp}>放棄</button>
              </div>
            )}
          </>
        )}

        {message && <p className="message">{message}</p>}

        {phase === 'feedback' && outcome && (
          <section className="feedback">
            <h2>本題回饋</h2>

            <label>
              主觀難度 1–5
              <select
                value={perceivedDifficulty}
                onChange={(event) => setPerceivedDifficulty(event.target.value)}
              >
                <option value="">請選擇</option>
                <option value="1">1 — 很簡單</option>
                <option value="2">2 — 簡單</option>
                <option value="3">3 — 中等</option>
                <option value="4">4 — 困難</option>
                <option value="5">5 — 很困難</option>
              </select>
            </label>

            <label>
              信心 1–5（可選）
              <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
                <option value="">略過</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label>
              挫折感 1–5（可選）
              <select
                value={frustration}
                onChange={(event) => setFrustration(event.target.value)}
              >
                <option value="">略過</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            {outcome === 'gave-up' && (
              <fieldset>
                <legend>為什麼放棄？（可複選，至少一項）</legend>
                <div className="reason-grid">
                  {GIVE_UP_REASONS.map((reason) => (
                    <label className="check-row" key={reason}>
                      <input
                        type="checkbox"
                        checked={giveUpReasons.includes(reason)}
                        onChange={() => toggleGiveUpReason(reason)}
                      />
                      {reasonLabels[reason]}
                    </label>
                  ))}
                </div>

                <label>
                  其他說明
                  <textarea
                    value={giveUpNote}
                    onChange={(event) => setGiveUpNote(event.target.value)}
                    placeholder="選擇「其他」時必填；否則可留白"
                  />
                </label>
              </fieldset>
            )}

            <button className="primary" onClick={saveFeedback} disabled={submitting}>
              {submitting ? '提交中…' : '儲存並繼續'}
            </button>
          </section>
        )}

        {phase === 'complete' && (
          <section className="complete-panel">
            <h2>本次盲測完成</h2>
            <p>共完成 {results.length} 題。結果已保存在這個瀏覽器，並會同步到匿名研究資料庫。</p>
            <p className="muted">若暫時同步失敗，重新開啟頁面時會自動重送本機已完成結果。</p>
          </section>
        )}
      </section>
    </>
  )
}
