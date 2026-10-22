import { describe, expect, it } from 'vitest'
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { json } from '../src/lib/http'

describe('json', () => {
  it('json_sets_content_type_and_body', () => {
    const r = json(200, { a: 1 }) as APIGatewayProxyStructuredResultV2
    expect(r.statusCode).toBe(200)
    expect(r.headers?.['content-type']).toBe('application/json')
    expect(r.body).toBe('{"a":1}')
  })
})
