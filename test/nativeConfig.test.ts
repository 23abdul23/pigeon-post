import { existsSync, readFileSync } from 'node:fs'
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

const javaDir = new URL('../android/app/src/main/java/app/pigeonpost/', import.meta.url)
const plugin = readFileSync(new URL('FlightPlugin.java', javaDir), 'utf8')
const service = readFileSync(new URL('FlightService.java', javaDir), 'utf8')
const statIconUrl = new URL('../android/app/src/main/res/drawable/ic_stat_flight.xml', import.meta.url)

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

  it('manifest_declares_foreground_service_permissions', () => {
    for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_SPECIAL_USE', 'POST_NOTIFICATIONS']) {
      expect(manifest).toMatch(new RegExp(`<uses-permission[^>]*android:name="android\\.permission\\.${name}"`))
    }
  })

  it('manifest_declares_FlightService_with_foregroundServiceType', () => {
    const service = manifest.match(/<service[\s\S]*?<\/service>/)?.[0] ?? ''
    expect(service).toMatch(/android:name="\.FlightService"/)
    expect(service).toMatch(/android:foregroundServiceType="specialUse"/)
    expect(service).toMatch(/android:exported="false"/)
    expect(service).toMatch(/<property[^>]*android:name="android\.app\.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"[^>]*android:value="[^"]+"/)
  })

  it('flight_plugin_reads_endsAtMs_without_getDouble', () => {
    expect(plugin).not.toContain('getDouble("endsAtMs"')
    expect(plugin).toContain('opt("endsAtMs")')
  })

  it('flight_service_uses_a_monochrome_vector_status_icon', () => {
    expect(existsSync(statIconUrl)).toBe(true)
    expect(readFileSync(statIconUrl, 'utf8')).toContain('<vector')
    expect(service).toContain('setSmallIcon(R.drawable.ic_stat_flight)')
    expect(service).not.toMatch(/setSmallIcon\(R\.mipmap/)
  })

  it('flight_stop_goes_through_the_service_not_stopService', () => {
    expect(plugin).not.toContain('stopService(')
    expect(plugin).toContain('FlightService.requestStop')
    expect(service).toContain('ACTION_STOP')
    expect(plugin).toContain('FlightService.requested')
    expect(service).toContain('AtomicBoolean requested')
    expect(service).toMatch(/ACTION_STOP\.equals/)
  })

  it('flight_service_stops_itself_when_orphaned', () => {
    expect(service).toContain('onTaskRemoved')
    const receiver = service.slice(service.indexOf('class FlightEndReceiver'))
    expect(receiver).toContain('requestStop')
  })
})
