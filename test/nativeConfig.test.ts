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

  it('flight_service_tracks_running_and_starting_instead_of_requested', () => {
    expect(service).not.toContain('AtomicBoolean')
    expect(plugin).not.toContain('requested')
    expect(service).toMatch(/static volatile boolean running\b/)
    expect(service).toMatch(/static volatile boolean starting\b/)
    // running is set only after startForeground, and cleared in onDestroy
    const onStart = service.slice(service.indexOf('public int onStartCommand'), service.indexOf('private void stopNow'))
    expect(onStart.indexOf('running = true')).toBeGreaterThan(onStart.indexOf('ServiceCompat.startForeground'))
    const onDestroy = service.slice(service.indexOf('public void onDestroy'))
    expect(onDestroy).toContain('running = false')
    expect(onDestroy).toContain('starting = false')
  })

  it('flight_refresh_while_running_notifies_instead_of_restarting', () => {
    const start = plugin.slice(plugin.indexOf('public void start('), plugin.indexOf('public void stop('))
    expect(start).toContain('FlightService.running')
    expect(start).toContain('FlightService.refresh(')
    const refresh = service.slice(service.indexOf('static boolean refresh('))
    expect(refresh).toContain('NotificationManager')
    expect(service).toMatch(/nm\.notify\(NOTIFICATION_ID/)
    // a refresh failure never clears the flags
    const catchBlock = start.slice(start.indexOf('catch'))
    expect(catchBlock).not.toMatch(/running\s*=\s*false/)
  })

  it('flight_stop_uses_stopService_when_running_and_ACTION_STOP_while_starting', () => {
    expect(plugin).toContain('FlightService.requestStop')
    const stop = service.slice(service.indexOf('static void requestStop('), service.indexOf('public void onTaskRemoved'))
    expect(stop).toContain('context.stopService(')
    expect(stop).toMatch(/if \(running\)/)
    expect(stop).toMatch(/if \(starting\)/)
    expect(stop).toContain('ACTION_STOP')
    expect(stop.indexOf('stopService(')).toBeLessThan(stop.indexOf('startForegroundService('))
    expect(service).toMatch(/ACTION_STOP\.equals/)
  })

  it('flight_service_reports_screen_on_only_when_unlocked', () => {
    expect(service).toContain('Intent.ACTION_USER_PRESENT')
    expect(service).toMatch(/filter\.addAction\(Intent\.ACTION_USER_PRESENT\)/)
    expect(service).toContain('KeyguardManager')
    expect(service).toContain('isKeyguardLocked()')
    expect(service).toContain('FlightPlugin.emit("screenOff")')
  })

  it('manifest_disables_backup', () => {
    const app = manifest.match(/<application[\s\S]*?>/)?.[0] ?? ''
    expect(app).toContain('android:allowBackup="false"')
    expect(manifest).not.toContain('android:allowBackup="true"')
  })

  it('android_gitignore_ignores_keystores_and_google_services', () => {
    const ignore = readFileSync(new URL('../android/.gitignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim())
    for (const pattern of ['*.jks', '*.keystore', 'google-services.json']) expect(ignore).toContain(pattern)
  })

  it('flight_service_stops_itself_when_orphaned', () => {
    expect(service).toContain('onTaskRemoved')
    const receiver = service.slice(service.indexOf('class FlightEndReceiver'))
    expect(receiver).toContain('requestStop')
  })
})

describe('API throttling (template.yaml)', () => {
  const httpApi = yamlBlock(template, 'HttpApi')

  it('httpapi_has_default_route_throttling', () => {
    expect(httpApi).toContain('Type: AWS::Serverless::HttpApi')
    const d = yamlBlock(httpApi, 'DefaultRouteSettings')
    expect(d).toMatch(/ThrottlingBurstLimit: 50\b/)
    expect(d).toMatch(/ThrottlingRateLimit: 25\b/)
  })

  it('weather_route_has_a_stricter_throttle', () => {
    const r = yamlBlock(httpApi, 'RouteSettings')
    const w = r.slice(r.indexOf("'GET /weather':"))
    expect(r).toContain("'GET /weather':")
    expect(w).toMatch(/ThrottlingBurstLimit: 20\b/)
    expect(w).toMatch(/ThrottlingRateLimit: 5\b/)
    // the route key must match a real route, or the stage deploy fails
    expect(template).toMatch(/Method: GET, Path: \/weather/)
  })
})
