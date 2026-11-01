import {persistThreeStarChallenge} from '../../../lib/three-star-db'
import {handleThreeStarPost} from '../../../lib/three-star-http'
export const runtime='nodejs'
export async function POST(request:Request):Promise<Response> { return handleThreeStarPost(request,persistThreeStarChallenge) }
