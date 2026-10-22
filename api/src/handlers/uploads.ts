import { randomUUID } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES } from '../lib/constants'
import { bad, fail, json, parseBody, route } from '../lib/http'
import { queryAll, type LetterRow } from '../lib/letters'
import { userPk } from '../lib/keys'

// WHEN_REQUIRED: the SDK default would sign a CRC32 of the empty body into presigned URLs, and S3 would reject every real upload
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' })
const Bucket = () => process.env.LETTERS_BUCKET!
const EXPIRES_S = 300

/**
 * POST /uploads/presign { contentType, size } -> { url, key }: a 5-minute PUT to `letters/<sub>/<uuid>`. Content type and
 * length are signed headers, so S3 refuses a body of another size or type than the one validated here.
 */
export const presign = route(async (sub, event) => {
  const { contentType, size } = parseBody(event.body)
  if (typeof contentType !== 'string' || !ATTACHMENT_TYPES.includes(contentType)) bad('only PNG, JPG or PDF')
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > ATTACHMENT_MAX_BYTES) bad('files must be 5 MB or smaller')
  const key = `letters/${sub}/${randomUUID()}`
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType as string, ContentLength: size as number }), {
    expiresIn: EXPIRES_S,
    signableHeaders: new Set(['content-type', 'content-length']),
  })
  return json(200, { url, key })
})

/** GET /uploads/url?key= -> { url }: a 5-minute GET, for the caller's own uploads or an attachment on a letter that reached them. */
export const download = route(async (sub, event) => {
  const key = event.queryStringParameters?.key ?? ''
  const m = /^letters\/([\w-]{1,64})\/[\w-]{1,64}$/.exec(key)
  if (!m) return bad('invalid key')
  if (m[1] !== sub) {
    const inbox = await queryAll<LetterRow>(userPk(sub), 'LETTER#')
    const mayRead = inbox.some((l) => (l.status === 'DELIVERED' || l.status === 'OPENED') && l.attachments?.some((a) => a.key === key))
    if (!mayRead) return fail(403, 'not your attachment')
  }
  return json(200, { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: Bucket(), Key: key }), { expiresIn: EXPIRES_S }) })
})

const ROUTES: Record<string, ReturnType<typeof route>> = { 'POST /uploads/presign': presign, 'GET /uploads/url': download }
export const handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => (ROUTES[event.routeKey] ?? (async () => json(404, { error: 'not found' })))(event)
