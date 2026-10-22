import { execFileSync } from 'node:child_process'

const profile = process.env.AWS_PROFILE ?? 'pigeon'
export const stackName = process.env.STACK_NAME ?? 'pigeon-post'

// In CI (GitHub sets CI=true) credentials come from the OIDC role in the environment, not a named profile.
const profileArgs = process.env.CI ? [] : ['--profile', profile]

export const aws = (...args) =>
  execFileSync('aws', [...args, ...profileArgs, '--region', 'us-east-1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

export function outputs() {
  const raw = aws('cloudformation', 'describe-stacks', '--stack-name', stackName, '--query', 'Stacks[0].Outputs', '--output', 'json')
  return Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]))
}
