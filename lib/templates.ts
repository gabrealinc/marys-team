import { createHash } from 'node:crypto'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { TeamEvent } from './schedule.js'
type Sql = NeonQueryFunction<false, false>
export type RoutineItem = Pick<TeamEvent, 'category' | 'forWho' | 'time' | 'endTime' | 'title' | 'details' | 'location' | 'helpNeeded' | 'isFlexible'> & { weekday: number }

export async function saveTemplate(sql: Sql, id: string, name: string, eventIds: string[]) {
  const rows = await sql`SELECT category, for_who AS "forWho", event_date AS date, event_time AS time, end_time AS "endTime", title, details, location, help_needed AS "helpNeeded", is_flexible AS "isFlexible"
    FROM team_events WHERE id = ANY(${eventIds}::text[]) AND proposal_type IS NULL AND help_needed <> 'Group event'`
  const items = rows.map((event) => {
    const { date, ...item } = event
    return { ...item, weekday: new Date(`${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}T12:00:00Z`).getUTCDay() }
  })
  if (!items.length) throw new Error('Select at least one routine item. Meals and group events cannot be copied.')
  await sql`INSERT INTO schedule_templates(id, name, items) VALUES (${id}, ${name}, ${JSON.stringify(items)}::jsonb)
    ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, items = EXCLUDED.items`
  return { id, name, items }
}

export async function previewTemplate(sql: Sql, id: string, weekOf: string) {
  const rows = await sql`SELECT items FROM schedule_templates WHERE id = ${id}`
  if (!rows.length) throw new Error('This routine is no longer available.')
  const monday = new Date(`${weekOf}T12:00:00Z`)
  if (Number.isNaN(monday.getTime()) || monday.getUTCDay() !== 1) throw new Error('Choose a Monday to start the week.')
  const items = rows[0].items as RoutineItem[]
  const proposed = items.map((item) => {
    const day = new Date(monday); day.setUTCDate(day.getUTCDate() + (item.weekday + 6) % 7)
    const key = day.toISOString().slice(0, 10).replaceAll('-', '')
    return { ...item, id: `routine-${createHash('sha256').update(`${id}:${key}:${item.title}:${item.forWho}:${item.time}`).digest('hex').slice(0, 32)}`,
      date: `${key}T${(item.isFlexible ? '00:00' : item.time).replace(':', '')}00`,
      dayLabel: day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    }
  })
  const existing = await sql`SELECT id, event_date AS date, for_who AS "forWho", title, event_time AS time, end_time AS "endTime", is_flexible AS "isFlexible" FROM team_events
    WHERE SUBSTRING(event_date, 1, 8) BETWEEN ${weekOf.replaceAll('-', '')} AND ${proposed.map((item) => item.date.slice(0, 8)).sort().at(-1) || weekOf.replaceAll('-', '')}`
  return proposed.map((item) => ({ ...item,
    exists: existing.some((event) => event.id === item.id || (event.forWho === item.forWho && event.date === item.date && event.title === item.title)),
    conflict: !item.isFlexible && existing.some((event) => event.forWho === item.forWho && !event.isFlexible && String(event.date).slice(0, 8) === item.date.slice(0, 8) && String(event.time) < item.endTime && String(event.endTime) > item.time),
  }))
}

export async function applyTemplate(sql: Sql, id: string, weekOf: string, selectedIds: string[]) {
  const preview = await previewTemplate(sql, id, weekOf)
  const items = preview.filter((item) => selectedIds.includes(item.id) && !item.exists && !item.conflict)
  if (!items.length) return []
  return sql`INSERT INTO team_events(id, category, for_who, event_date, day_label, event_time, end_time, title, details, location, help_needed, is_flexible)
    SELECT id, category, "forWho", date, "dayLabel", time, "endTime", title, details, location, "helpNeeded", "isFlexible"
    FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS i(id text, category text, "forWho" text, date text, "dayLabel" text, time text, "endTime" text, title text, details text, location text, "helpNeeded" text, "isFlexible" boolean)
    ON CONFLICT(id) DO NOTHING RETURNING id`
}
