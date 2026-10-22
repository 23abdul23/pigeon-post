import { execSync } from 'node:child_process'
import { aws, outputs } from './stack.mjs'

const { SiteBucket, DistributionId, UserPoolId, UserPoolClientId, CognitoDomain, ApiUrl } = outputs()
// Real values from the stack; process env wins over the placeholders in .env.production.
const env = {
  ...process.env,
  VITE_COGNITO_USER_POOL_ID: UserPoolId,
  VITE_COGNITO_CLIENT_ID: UserPoolClientId,
  VITE_COGNITO_DOMAIN: CognitoDomain,
  VITE_API_URL: ApiUrl,
}
execSync('npm run build', { stdio: 'inherit', env })
aws('s3', 'sync', 'dist', `s3://${SiteBucket}`, '--delete')
aws('cloudfront', 'create-invalidation', '--distribution-id', DistributionId, '--paths', '/*')
console.log(`deployed to bucket ${SiteBucket}, invalidated ${DistributionId}`)
