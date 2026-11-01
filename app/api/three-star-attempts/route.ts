import {handleChallengeAttemptPost} from '../../../lib/three-star-attempts'
import {persistChallengeAttempt} from '../../../lib/three-star-attempt-db'
export const runtime='nodejs'
export async function POST(request:Request):Promise<Response> {return handleChallengeAttemptPost(request,persistChallengeAttempt)}
