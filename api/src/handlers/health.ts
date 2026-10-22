import { json } from '../lib/http'

export const handler = async () => json(200, { ok: true })
