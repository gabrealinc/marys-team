import { createHash } from 'node:crypto'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { nameKey, samePerson } from './care.js'
type Sql = NeonQueryFunction<false, false>
export async function ensureDirectory(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS directory_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', alias_keys TEXT[] NOT NULL DEFAULT '{}')`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_person_id TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS person_id TEXT`
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS person_id TEXT`
  await sql`ALTER TABLE care_team ADD COLUMN IF NOT EXISTS person_id TEXT`
  await sql`ALTER TABLE support_contacts ADD COLUMN IF NOT EXISTS person_id TEXT`
}
export async function synchronizeDirectory(sql: Sql) {
  const [stored, sources] = await Promise.all([
    sql`SELECT id, name, phone, email, alias_keys AS aliases FROM directory_people`,
    sql`SELECT id, 'care' AS kind, name, phone, email, person_id AS "personId" FROM care_team
      UNION ALL SELECT id, 'contact', name, phone, email, person_id FROM support_contacts
      UNION ALL SELECT id, 'event', helper, COALESCE(helper_phone, ''), COALESCE(helper_email, ''), helper_person_id FROM team_events WHERE COALESCE(TRIM(helper), '') <> ''
      UNION ALL SELECT id, 'request', requester_name, requester_phone, requester_email, person_id FROM support_requests WHERE TRIM(requester_name) <> ''
      UNION ALL SELECT id, 'availability', name, phone, email, person_id FROM availability WHERE TRIM(name) <> ''`,
  ])
  const people = stored.map((row) => ({ id: String(row.id), name: String(row.name), phone: String(row.phone || ''), email: String(row.email || ''), aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [] as string[] }))
  const links: { id: string; kind: string; person_id: string }[] = []
  const inputs = [...sources, ...['Mary', 'Stu', 'Gabby', 'Spencer'].map((name) => ({ id: '', kind: 'family', name, phone: '', email: '', personId: null }))]
  for (const source of inputs) {
    const name = String(source.name || '').trim(); if (!name) continue
    const key = nameKey(name)
    let person = people.find((entry) => source.personId && entry.id === source.personId) || people.find((entry) => entry.aliases.includes(key) || samePerson(entry, { name, phone: String(source.phone || ''), email: String(source.email || '') }))
    if (!person) { person = { id: `person-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`, name, phone: String(source.phone || ''), email: String(source.email || ''), aliases: [key] }; people.push(person) }
    if (!person.aliases.includes(key)) person.aliases.push(key)
    person.phone ||= String(source.phone || ''); person.email ||= String(source.email || '')
    if (source.id) links.push({ id: String(source.id), kind: String(source.kind), person_id: person.id })
  }
  await sql`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(people)}::jsonb) AS p(id text, name text, phone text, email text, aliases text[])),
    saved AS (INSERT INTO directory_people (id, name, phone, email, alias_keys) SELECT id, name, phone, email, aliases FROM incoming
      ON CONFLICT (id) DO UPDATE SET phone = CASE WHEN directory_people.phone = '' THEN EXCLUDED.phone ELSE directory_people.phone END,
        email = CASE WHEN directory_people.email = '' THEN EXCLUDED.email ELSE directory_people.email END,
        alias_keys = ARRAY(SELECT DISTINCT unnest(directory_people.alias_keys || EXCLUDED.alias_keys)) RETURNING id),
    links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, kind text, person_id text)),
    linked_care AS (UPDATE care_team t SET person_id = l.person_id FROM links l WHERE l.kind = 'care' AND t.id = l.id AND t.person_id IS DISTINCT FROM l.person_id RETURNING t.id),
    linked_contacts AS (UPDATE support_contacts t SET person_id = l.person_id FROM links l WHERE l.kind = 'contact' AND t.id = l.id AND t.person_id IS DISTINCT FROM l.person_id RETURNING t.id),
    linked_requests AS (UPDATE support_requests t SET person_id = l.person_id FROM links l WHERE l.kind = 'request' AND t.id = l.id AND t.person_id IS DISTINCT FROM l.person_id RETURNING t.id),
    linked_availability AS (UPDATE availability t SET person_id = l.person_id FROM links l WHERE l.kind = 'availability' AND t.id = l.id AND t.person_id IS DISTINCT FROM l.person_id RETURNING t.id)
    UPDATE team_events t SET helper_person_id = l.person_id FROM links l WHERE l.kind = 'event' AND t.id = l.id AND t.helper_person_id IS DISTINCT FROM l.person_id
  `
}
