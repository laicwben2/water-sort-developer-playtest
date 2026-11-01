import { persistGameplaySession } from '../../../lib/gameplay-db'
import { handleGameplayPost } from '../../../lib/gameplay-http'
export const runtime = 'nodejs'
export async function POST(request: Request): Promise<Response> {
  return handleGameplayPost(request, persistGameplaySession)
}
