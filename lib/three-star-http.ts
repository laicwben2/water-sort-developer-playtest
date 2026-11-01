import {GameplayValidationError} from './gameplay-validation'
import {GameplayConflictError} from './gameplay-db'
import {readGameplayBody, TooLargeError} from './gameplay-http'
import {validateThreeStarChallenge, type ThreeStarChallengeRecord} from './three-star-validation'
export async function handleThreeStarPost(request: Request, save: (record: ThreeStarChallengeRecord)=>Promise<void>): Promise<Response> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({error:'Expected application/json'},{status:415})
  try {
    const record=validateThreeStarChallenge(await readGameplayBody(request))
    const key=request.headers.get('idempotency-key')
    if(key && key.toLowerCase()!==record.challengeId)throw new GameplayValidationError('Idempotency key must match challengeId')
    await save(record)
    return Response.json({ok:true,challengeId:record.challengeId})
  } catch(error) {
    if(error instanceof TooLargeError)return Response.json({error:'Request too large'},{status:413})
    if(error instanceof GameplayValidationError || error instanceof SyntaxError)return Response.json({error:'Invalid three-star challenge'},{status:400})
    if(error instanceof GameplayConflictError)return Response.json({error:error.message},{status:409})
    console.error('Three-star storage unavailable',error instanceof Error?error.name:'unknown')
    return Response.json({error:'Challenge storage unavailable'},{status:503,headers:{'Retry-After':'60'}})
  }
}
