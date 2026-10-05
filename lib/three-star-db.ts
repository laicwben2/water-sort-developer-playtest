import {persistLegacyChallenge} from './three-star-attempt-db'
import {GameplayConflictError} from './gameplay-db'
import {challengePayloadHash, type ThreeStarChallengeRecord} from './three-star-validation'
export function confirmChallengeDuplicate(record: ThreeStarChallengeRecord, row: {challengeId: string; payloadHash: string}): void {
  if(row.challengeId.toLowerCase()!==record.challengeId || row.payloadHash!==challengePayloadHash(record)) throw new GameplayConflictError('An immutable first-three-star record already exists')
}
export async function persistThreeStarChallenge(record: ThreeStarChallengeRecord): Promise<void> {
  await persistLegacyChallenge(record,challengePayloadHash(record))
}
