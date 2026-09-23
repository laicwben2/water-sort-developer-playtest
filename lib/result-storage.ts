import type { PlaytestResult, PlaytestResultsDocument } from './results'

export function resultsStorageKey(benchmark: string, sessionId: string): string {
  return 'water-sort-developer-playtest-results-v2:' + benchmark + ':' + sessionId
}

export function loadResults(benchmark: string, sessionId: string): PlaytestResult[] {
  const raw = window.localStorage.getItem(resultsStorageKey(benchmark, sessionId))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as PlaytestResultsDocument
    if (
      parsed.version !== 'difficulty-v2-playtest-results-v2' ||
      parsed.benchmark !== benchmark ||
      !Array.isArray(parsed.results)
    ) {
      return []
    }
    return parsed.results
  } catch {
    return []
  }
}

export function buildResultsDocument(
  benchmark: string,
  results: readonly PlaytestResult[],
): PlaytestResultsDocument {
  return {
    version: 'difficulty-v2-playtest-results-v2',
    benchmark,
    exportedAt: new Date().toISOString(),
    results: [...results],
  }
}

export async function submitResults(
  sessionId: string,
  document: PlaytestResultsDocument,
  clientVersion: string,
): Promise<void> {
  const response = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, clientVersion, document }),
  })

  if (!response.ok) {
    let message = 'Submission failed (' + response.status + ')'
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the status-based fallback.
    }
    throw new Error(message)
  }
}

export function saveResults(
  benchmark: string,
  sessionId: string,
  results: readonly PlaytestResult[],
): void {
  const document = buildResultsDocument(benchmark, results)
  window.localStorage.setItem(
    resultsStorageKey(benchmark, sessionId),
    JSON.stringify(document),
  )
}
