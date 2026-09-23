import benchmarkData from '../../../public/benchmark.json'
import { persistPlaytestResults } from '../../../lib/db'
import {
  SubmissionValidationError,
  validateSubmissionRequest,
  type SubmissionBenchmark,
} from '../../../lib/submission-validation'

const MAX_REQUEST_BYTES = 128 * 1024
const benchmark = benchmarkData as SubmissionBenchmark

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: 'Request too large' }, { status: 413 })
  }

  try {
    const body = await request.json()
    const submission = validateSubmissionRequest(body, benchmark)
    const serverVersion = process.env.VERCEL_GIT_COMMIT_SHA ?? 'local-dev'
    const saved = await persistPlaytestResults(
      submission.sessionId,
      submission.document.benchmark,
      submission.document.results,
      submission.clientVersion,
      serverVersion,
    )
    return Response.json({ ok: true, saved })
  } catch (error) {
    if (error instanceof SubmissionValidationError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'DATABASE_URL is not configured') {
      return Response.json({ error: 'Submission storage is not configured' }, { status: 503 })
    }

    console.error('Playtest submission failed', error)
    return Response.json({ error: 'Submission failed' }, { status: 500 })
  }
}
