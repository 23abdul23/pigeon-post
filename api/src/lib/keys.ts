export const userPk = (sub: string) => `USER#${sub}`
export const PROFILE_SK = 'PROFILE'
export const codePk = (inviteCode: string) => `CODE#${inviteCode}`
export const tripSk = (id: string) => `TRIP#${id}`
export const sessionSk = (id: string) => `SESSION#${id}`
export const storySk = (id: string) => `STORY#${id}`
export const stampSk = (cc: string) => `STAMP#${cc}`
export const friendSk = (otherSub: string) => `FRIEND#${otherSub}`
export const letterSk = (id: string) => `LETTER#${id}`
export const flightSk = () => 'FLIGHT'
export const sentSk = (id: string) => `SENT#${id}`
export const placePk = (placeId: string) => `PLACE#${placeId}`
export const placeStorySk = (lens: string) => `STORY#${lens}`
export const composeUsageSk = (day: string) => `USAGE#compose#${day}`
