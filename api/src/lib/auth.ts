import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'

export class Unauthorized extends Error {
  constructor() {
    super('Unauthorized')
  }
}

/** The Cognito user id (`sub`) from the JWT the API Gateway authorizer already verified. */
export function getUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub
  if (typeof sub !== 'string' || !sub) throw new Unauthorized()
  return sub
}
