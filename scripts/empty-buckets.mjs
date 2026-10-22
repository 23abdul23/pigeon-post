// Run before `sam delete`: CloudFormation cannot delete non-empty buckets.
import { aws, outputs } from './stack.mjs'

const o = outputs()
for (const b of [o.SiteBucket, o.LettersBucket].filter(Boolean)) {
  aws('s3', 'rm', `s3://${b}`, '--recursive')
  console.log(`emptied ${b}`)
}
