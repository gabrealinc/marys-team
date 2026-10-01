import { neon } from '@neondatabase/serverless'
import type { VercelRequest, VercelResponse } from '@vercel/node'

type Category = 'appointment' | 'home' | 'dad'

type TeamEventInput = {
  id: string
  category: Category
  date: string
  dayLabel: string
  time: string
  title: string
  details: string
  location?: string
  helpNeeded: string
}

type AvailabilityInput = {
  id: string
  name: string
  day: string
  time: string
  note: string
}

function database() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('The shared database is not connected yet.')
  return neon(url)
}

async function ensureSchema() {
  const sql = database()
  await sql`
    CREATE TABLE IF NOT EXISTS team_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      event_date TEXT NOT NULL,
      day_label TEXT NOT NULL,
      event_time TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      location TEXT,
      help_needed TEXT NOT NULL,
      helper TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS availability (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      available_day TEXT NOT NULL,
      available_time TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

function clean(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sendError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')

  try {
    await ensureSchema()
    const sql = database()

    if (request.method === 'GET') {
      const events = await sql`
        SELECT id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, title, details, location,
          help_needed AS "helpNeeded", helper
        FROM team_events
        ORDER BY event_date ASC, created_at ASC
      `
      const availability = await sql`
        SELECT id, name, available_day AS day, available_time AS time, note
        FROM availability
        ORDER BY created_at DESC
      `
      return response.status(200).json({ events, availability })
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST')
      return sendError(response, 405, 'This action is not supported.')
    }

    const action = clean(request.body?.action, 30)

    if (action === 'addEvent') {
      const item = request.body?.event as Partial<TeamEventInput> | undefined
      const event = {
        id: clean(item?.id, 80),
        category: clean(item?.category, 20) as Category,
        date: clean(item?.date, 30),
        dayLabel: clean(item?.dayLabel, 100),
        time: clean(item?.time, 60),
        title: clean(item?.title, 160),
        details: clean(item?.details, 1000),
        location: clean(item?.location, 300),
        helpNeeded: clean(item?.helpNeeded, 200),
      }
      if (!event.id || !event.date || !event.dayLabel || !event.time || !event.title || !event.helpNeeded || !['appointment', 'home', 'dad'].includes(event.category)) {
        return sendError(response, 400, 'Please complete the required appointment or task details.')
      }
      const [saved] = await sql`
        INSERT INTO team_events (id, category, event_date, day_label, event_time, title, details, location, help_needed)
        VALUES (${event.id}, ${event.category}, ${event.date}, ${event.dayLabel}, ${event.time}, ${event.title}, ${event.details}, ${event.location || null}, ${event.helpNeeded})
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, title, details, location,
          help_needed AS "helpNeeded", helper
      `
      return response.status(201).json({ event: saved })
    }

    if (action === 'claimEvent') {
      const eventId = clean(request.body?.eventId, 80)
      const name = clean(request.body?.name, 120)
      if (!eventId || !name) return sendError(response, 400, 'Please enter your name.')
      const rows = await sql`
        UPDATE team_events
        SET helper = ${name}
        WHERE id = ${eventId} AND (helper IS NULL OR helper = '')
        RETURNING id, helper
      `
      if (!rows.length) return sendError(response, 409, 'Someone else has already filled this slot. The schedule has been refreshed.')
      return response.status(200).json({ id: eventId, helper: name })
    }

    if (action === 'addAvailability') {
      const item = request.body?.entry as Partial<AvailabilityInput> | undefined
      const entry = {
        id: clean(item?.id, 80),
        name: clean(item?.name, 120),
        day: clean(item?.day, 120),
        time: clean(item?.time, 120),
        note: clean(item?.note, 500),
      }
      if (!entry.id || !entry.name || !entry.day || !entry.time) {
        return sendError(response, 400, 'Please add your name, day, and time.')
      }
      const [saved] = await sql`
        INSERT INTO availability (id, name, available_day, available_time, note)
        VALUES (${entry.id}, ${entry.name}, ${entry.day}, ${entry.time}, ${entry.note})
        RETURNING id, name, available_day AS day, available_time AS time, note
      `
      return response.status(201).json({ entry: saved })
    }

    return sendError(response, 400, 'That action was not recognized.')
  } catch (error) {
    console.error(error)
    return sendError(response, 500, 'The shared schedule could not be reached. Please try again in a moment.')
  }
}
