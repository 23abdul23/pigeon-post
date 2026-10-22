import { describe, expect, it } from 'vitest'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { getUserId, Unauthorized } from '../src/lib/auth'

const ev = (claims?: Record<string, string>) =>
  ({ requestContext: { authorizer: claims ? { jwt: { claims, scopes: [] } } : undefined } }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

describe('getUserId', () => {
  it('getUserId_throws_when_no_claims', () => {
    expect(() => getUserId(ev())).toThrow(Unauthorized)
    expect(() => getUserId(ev({}))).toThrow(Unauthorized)
  })
  it('getUserId_returns_sub', () => {
    expect(getUserId(ev({ sub: 'abc-123' }))).toBe('abc-123')
  })
})
