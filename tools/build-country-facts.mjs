// Builds src/data/countryFacts.json (capital, population, languages, currency, demonym per ISO alpha-2) from Wikidata (CC0).
// Run: node tools/build-country-facts.mjs   (needs network; one SPARQL query per property, then merged here)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const wanted = new Set(JSON.parse(readFileSync(new URL('src/data/countries.json', root), 'utf8')).map((c) => c.cc))

async function sparql(body) {
  const q = `SELECT ?cc ?v ?d WHERE { ?c wdt:P297 ?cc. ${body} }`
  const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(q)
  const headers = { Accept: 'application/sparql-results+json', 'User-Agent': 'pigeon-post-build-country-facts/1.0 (one-off data build)' }
  for (let i = 0; i < 3; i++) {
    try {
      let json
      try {
        const r = await fetch(url, { headers })
        if (!r.ok) throw new Error(String(r.status))
        json = await r.json()
      } catch {
        // node's fetch ignores HTTPS_PROXY before v22.21; curl honours it
        json = JSON.parse(execFileSync('curl', ['-sSf', '-m', '90', ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url], { maxBuffer: 1 << 26 }).toString())
      }
      return json.results.bindings.filter((b) => wanted.has(b.cc.value))
    } catch {
      await new Promise((res) => setTimeout(res, 3000))
    }
  }
  throw new Error('query failed: ' + body)
}
const label = (p, extra = '') => `?c wdt:${p} ?x. ?x rdfs:label ?v. FILTER(LANG(?v)='en') ${extra}`

const facts = {}
const slot = (cc) => (facts[cc] ??= {})
const push = (cc, key, v, max) => {
  const a = (slot(cc)[key] ??= [])
  if (!a.includes(v) && a.length < max) a.push(v)
}

for (const b of await sparql(label('P36'))) slot(b.cc.value).capital ??= b.v.value
// wdt: returns the preferred-rank (else normal-rank) statements, which Wikidata keeps on the latest figure; take the max if several
for (const b of await sparql('?c wdt:P1082 ?v.')) {
  const v = Math.round(Number(b.v.value))
  const o = slot(b.cc.value)
  if (!o.population || v > o.population) o.population = v
}
for (const b of await sparql(label('P37'))) push(b.cc.value, 'languages', b.v.value, 4)
for (const b of await sparql(label('P38'))) slot(b.cc.value).currency ??= b.v.value
for (const b of await sparql("?c p:P1549 ?s. ?s ps:P1549 ?v. FILTER(LANG(?v)='en')")) slot(b.cc.value).demonym ??= b.v.value

// Wikidata lists several currencies for multi-territory states (France: CFP franc) and none for some euro states
for (const cc of 'AD AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT MC ME PT SM SK SI ES VA'.split(' ')) if (facts[cc]) facts[cc].currency = 'euro'
// Wikidata's preferred India figure is years stale (1.33B); UN 2023 estimate
if (facts.IN) facts.IN.population = 1428000000
const out = {}
for (const cc of [...wanted].sort()) if (facts[cc]) out[cc] = facts[cc]
writeFileSync(new URL('src/data/countryFacts.json', root), JSON.stringify(out))
const gaps = [...wanted].filter((cc) => !out[cc])
const missing = (k) => [...wanted].filter((cc) => !out[cc]?.[k])
console.log(`${Object.keys(out).length}/${wanted.size} countries; no entry: ${gaps.join(' ') || '-'}`)
for (const k of ['capital', 'population', 'languages', 'currency', 'demonym']) console.log(`missing ${k}: ${missing(k).join(' ') || '-'}`)
for (const cc of ['PT', 'FR', 'IN']) console.log(cc, JSON.stringify(out[cc]))
