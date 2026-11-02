import { generateKeyPairSync, createVerify } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from 'aws-sdk-client-mock'
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { notifyLetterDelivered, resetFcmCache } from '../src/lib/notify'
import { deviceSk } from '../src/lib/keys'

process.env.TABLE_NAME = 'PigeonPostTest'
process.env.AWS_REGION = 'us-east-1'
const ddb = mockClient(DynamoDBDocumentClient)
const sm = mockClient(SecretsManagerClient)

// a throwaway key for the fake service account: generated per run, never stored
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const SERVICE_ACCOUNT = { type: 'service_account', project_id: 'pigeon-test', client_email: 'sender@pigeon-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }

let profile: Record<string, any> | undefined
let devices: Record<string, any>[]
const deleted: string[] = []
let fetchMock: ReturnType<typeof vi.fn>
let sendStatus: (token: string) => { status: number; body?: unknown }

const sends = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('fcm.googleapis.com'))
const tokenCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('oauth2.googleapis.com'))
const setDevices = (...tokens: string[]) => (devices = tokens.map((token) => ({ PK: 'USER#b', SK: deviceSk(token), token, platform: 'android' })))

beforeEach(() => {
  process.env.FCM_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:fcm'
  resetFcmCache()
  ddb.reset()
  sm.reset()
  deleted.length = 0
  profile = { PK: 'USER#b', SK: 'PROFILE', settings: { notifyLetter: true, channel: 'browser' } }
  setDevices('tok-1', 'tok-2')
  sendStatus = () => ({ status: 200, body: { name: 'projects/x/messages/1' } })
  ddb.on(GetCommand).callsFake(() => ({ Item: profile }))
  ddb.on(QueryCommand).callsFake(() => ({ Items: devices }))
  ddb.on(DeleteCommand).callsFake((i) => (deleted.push(i.Key.SK), {}))
  sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(SERVICE_ACCOUNT) })
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'ya29.ACCESS', expires_in: 3600 }), { status: 200 })
    const token = JSON.parse(String(init.body)).message.token
    const r = sendStatus(token)
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notifyLetterDelivered', () => {
  it('notify_sends_to_each_token', async () => {
    await notifyLetterDelivered('b', 'Ann Smith')
    const s = sends()
    expect(s).toHaveLength(2)
    expect(String(s[0][0])).toBe('https://fcm.googleapis.com/v1/projects/pigeon-test/messages:send')
    expect(s[0][1].headers.authorization).toBe('Bearer ya29.ACCESS')
    expect(s.map(([, i]) => JSON.parse(i.body).message.token).sort()).toEqual(['tok-1', 'tok-2'])
    const m = JSON.parse(s[0][1].body).message
    expect(m.notification).toEqual({ title: 'A letter arrived', body: 'Ann sent you a letter' })
    expect(m.data).toEqual({ type: 'letter' })
    expect(m.android.notification.channel_id).toBe('letters')
    expect(JSON.stringify(m)).not.toContain('Smith')
    // the OAuth assertion is a real RS256 JWT for the right scope and audience
    const body = new URLSearchParams(String(tokenCalls()[0][1].body))
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [h, c, sig] = body.get('assertion')!.split('.')
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({ iss: SERVICE_ACCOUNT.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' })
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
  })

  it('notify_removes_unregistered_tokens', async () => {
    setDevices('gone', 'bad', 'old', 'good', 'flaky')
    sendStatus = (t) =>
      t === 'gone' ? { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }
      : t === 'bad' ? { status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } }
      : t === 'old' ? { status: 410 }
      : t === 'flaky' ? { status: 503, body: { error: { status: 'UNAVAILABLE' } } }
      : { status: 200 }
    await notifyLetterDelivered('b', 'Ann')
    expect(deleted.sort()).toEqual([deviceSk('bad'), deviceSk('gone'), deviceSk('old')].sort())
  })

  it('notify_skipped_when_user_disabled_letters', async () => {
    profile!.settings.notifyLetter = false
    await notifyLetterDelivered('b', 'Ann')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('notify_skipped_when_channel_is_email_only', async () => {
    profile!.settings.channel = 'email'
    await notifyLetterDelivered('b', 'Ann')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('notify_skipped_when_unconfigured_or_no_tokens', async () => {
    setDevices()
    await notifyLetterDelivered('b', 'Ann')
    expect(fetchMock).not.toHaveBeenCalled()
    setDevices('tok-1')
    process.env.FCM_SECRET_ARN = ''
    await notifyLetterDelivered('b', 'Ann')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(0)
  })

  it('notify_failure_does_not_fail_letter_delivery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValue(Object.assign(new Error('network down'), { name: 'TypeError' }))
    await expect(notifyLetterDelivered('b', 'Ann')).resolves.toBeUndefined()
    sm.reset()
    sm.on(GetSecretValueCommand).rejects(new Error('denied'))
    resetFcmCache()
    await expect(notifyLetterDelivered('b', 'Ann')).resolves.toBeUndefined()
    ddb.reset()
    ddb.on(GetCommand).rejects(new Error('ddb down'))
    await expect(notifyLetterDelivered('b', 'Ann')).resolves.toBeUndefined()
  })

  it('notify_never_puts_letter_text_or_token_in_logs', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    // every failure path: bad secret JSON, token endpoint error, send errors carrying the token in their body
    sm.on(GetSecretValueCommand).resolves({ SecretString: 'not json ' + SERVICE_ACCOUNT.private_key })
    await notifyLetterDelivered('b', 'Ann')
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(SERVICE_ACCOUNT) })
    resetFcmCache()
    sendStatus = (t) => ({ status: 500, body: { error: { message: `bad ${t} ya29.ACCESS secret words` } } })
    await notifyLetterDelivered('b', 'Ann')
    fetchMock.mockRejectedValue(Object.assign(new Error('boom tok-1 ya29.ACCESS'), { name: 'FetchError' }))
    await notifyLetterDelivered('b', 'Ann')
    const logged = spies.flatMap((s) => s.mock.calls).flat().map(String).join('\n')
    expect(logged).not.toMatch(/tok-1|tok-2|ya29|secret words|PRIVATE KEY|Smith/)
  })

  it('fcm_access_token_is_cached_between_sends', async () => {
    await notifyLetterDelivered('b', 'Ann')
    await notifyLetterDelivered('b', 'Ann')
    expect(tokenCalls()).toHaveLength(1)
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(1)
    expect(sends()).toHaveLength(4)
    // within five minutes of expiry the token is minted again
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 3600_000 - 4 * 60_000)
    await notifyLetterDelivered('b', 'Ann')
    expect(tokenCalls()).toHaveLength(2)
    expect(sm.commandCalls(GetSecretValueCommand)).toHaveLength(1)
  })
})
