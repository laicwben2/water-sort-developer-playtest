export type Board = number[][]

export interface Move {
  from: number
  to: number
  color: number
  amount: number
}

function topRunLength(tube: readonly number[]): number {
  if (tube.length === 0) return 0
  const color = tube[tube.length - 1]
  let count = 0
  for (let index = tube.length - 1; index >= 0 && tube[index] === color; index -= 1) {
    count += 1
  }
  return count
}

export function calculatePour(
  board: Board,
  from: number,
  to: number,
  capacity: number,
): Move | null {
  if (from === to || from < 0 || to < 0 || from >= board.length || to >= board.length) return null

  const source = board[from]
  const target = board[to]
  if (source.length === 0 || target.length >= capacity) return null

  const color = source[source.length - 1]
  const targetColor = target[target.length - 1]
  if (targetColor !== undefined && targetColor !== color) return null

  const amount = Math.min(topRunLength(source), capacity - target.length)
  return amount > 0 ? { from, to, color, amount } : null
}

export function applyMove(board: Board, move: Move): Board {
  const next = board.map((tube) => [...tube])
  const removed = next[move.from].splice(-move.amount)
  next[move.to].push(...removed)
  return next
}

export function isSolved(board: Board, capacity: number): boolean {
  return board.every(
    (tube) =>
      tube.length === 0 ||
      (tube.length === capacity && tube.every((color) => color === tube[0])),
  )
}
