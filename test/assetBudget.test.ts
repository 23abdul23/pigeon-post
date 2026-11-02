import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(__dirname, '..', 'src', 'assets')
const MB = 1024 * 1024
const files = () => readdirSync(DIR).map((name) => ({ name, size: statSync(join(DIR, name)).size }))

describe('src/assets budget', () => {
  it('no_single_file_in_src_assets_exceeds_1_MB', () => {
    const big = files().filter((f) => f.size > MB)
    expect(big).toEqual([])
  })
  it('total_src_assets_under_4_MB', () => {
    const total = files().reduce((n, f) => n + f.size, 0)
    expect(total).toBeLessThan(4 * MB)
  })
  it('no_wav_files_in_src_assets', () => {
    expect(files().filter((f) => /\.wav$/i.test(f.name))).toEqual([])
  })
})
