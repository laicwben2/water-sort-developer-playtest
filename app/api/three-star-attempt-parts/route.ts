import {handleChallengeFragmentPost} from '../../../lib/three-star-fragments'
import {persistChallengeFragment} from '../../../lib/three-star-fragment-db'
export const runtime='nodejs'
export async function POST(request:Request):Promise<Response> {return handleChallengeFragmentPost(request,persistChallengeFragment)}
