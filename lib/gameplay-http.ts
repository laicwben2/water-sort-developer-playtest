import { GameplayValidationError, validateGameplaySession, type GameplaySession } from './gameplay-validation'
import { GameplayConflictError } from './gameplay-db'
export const MAX_GAMEPLAY_BYTES = 8 * 1024 * 1024
class TooLargeError extends Error {}
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_GAMEPLAY_BYTES) throw new TooLargeError()
  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError()
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_GAMEPLAY_BYTES) { await reader.cancel(); throw new TooLargeError() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { throw new SyntaxError('Invalid UTF-8') }
  return JSON.parse(text)
}
export async function handleGameplayPost(request: Request, save: (record: GameplaySession) => Promise<void>): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'Expected application/json' }, { status: 415 })
  try {
    const record = validateGameplaySession(await readBody(request))
    const key = request.headers.get('idempotency-key')
    if (key && key.toLowerCase() !== record.sessionId) throw new GameplayValidationError('Idempotency key must match sessionId')
    await save(record)
    return Response.json({ ok: true, sessionId: record.sessionId })
  } catch (error) {
    if (error instanceof TooLargeError) return Response.json({ error: 'Request too large' }, { status: 413 })
    if (error instanceof GameplayValidationError || error instanceof SyntaxError) return Response.json({ error: 'Invalid gameplay session' }, { status: 400 })
    if (error instanceof GameplayConflictError) return Response.json({ error: error.message }, { status: 409 })
    console.error('Gameplay session storage unavailable', error instanceof Error ? error.name : 'unknown')
    return Response.json({ error: 'Gameplay storage unavailable' }, { status: 503, headers: { 'Retry-After': '60' } })
  }
}
