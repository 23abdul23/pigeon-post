import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const template = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8')
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')

/** The text of one YAML block, from its key line to the next key at the same or shallower indent. */
function yamlBlock(src: string, key: string): string {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.trimStart() === `${key}:`)
  if (start === -1) return ''
  const indent = lines[start].length - lines[start].trimStart().length
  const out: string[] = [lines[start]]
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trimStart()
    const lineIndent = line.length - trimmed.length
    if (trimmed !== '' && lineIndent <= indent) break
    out.push(line)
  }
  return out.join('\n')
}

describe('native sign-in and API configuration', () => {
  it('template_allows_native_callback_and_logout_uris', () => {
    const client = yamlBlock(template, 'UserPoolClient')
    expect(client).toContain('app.pigeonpost://auth/callback')
    expect(client).toContain('app.pigeonpost://signin')
  })

  it('template_cors_allows_https_localhost', () => {
    const httpApi = yamlBlock(template, 'HttpApi')
    const allowOrigins = httpApi.slice(httpApi.indexOf('AllowOrigins:'))
    expect(allowOrigins).toContain('https://localhost')
  })

  it('letters_bucket_cors_allows_https_localhost', () => {
    const bucket = yamlBlock(template, 'LettersBucket')
    const cors = bucket.slice(bucket.indexOf('CorsConfiguration:'))
    expect(cors).toContain('https://localhost')
  })

  it('manifest_declares_the_app_pigeonpost_scheme', () => {
    const filters = manifest.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? []
    const viewFilter = filters.find(
      (f) =>
        f.includes('android.intent.action.VIEW') &&
        f.includes('android.intent.category.BROWSABLE') &&
        /android:scheme="app\.pigeonpost"/.test(f),
    )
    expect(viewFilter).toBeDefined()
  })

  it('manifest_main_activity_launch_mode_is_singleTask_or_singleTop', () => {
    const activity = manifest.match(/<activity[\s\S]*?<\/activity>/)?.[0] ?? ''
    expect(activity).toMatch(/android:launchMode="(singleTask|singleTop)"/)
  })
})
