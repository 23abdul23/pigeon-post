import { execSync } from 'node:child_process'
import { aws, outputs } from './stack.mjs'

const { SiteBucket, DistributionId } = outputs()
execSync('npm run build', { stdio: 'inherit' })
aws('s3', 'sync', 'dist', `s3://${SiteBucket}`, '--delete')
aws('cloudfront', 'create-invalidation', '--distribution-id', DistributionId, '--paths', '/*')
console.log(`deployed to bucket ${SiteBucket}, invalidated ${DistributionId}`)
