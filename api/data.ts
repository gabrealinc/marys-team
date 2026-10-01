import { neon } from '@neondatabase/serverless'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendTeamNotification } from '../lib/email.js'

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
  phone: string
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
      helper_phone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS availability (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      available_day TEXT NOT NULL,
      available_time TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_phone TEXT`
  await sql`
    CREATE TABLE IF NOT EXISTS notification_log (
      notification_key TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

function clean(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sendError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

function timeMatchesAvailability(slot: string, eventTime: string) {
  if (slot === 'anytime') return true
  const match = eventTime.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return false
  const minutes = Number(match[1]) * 60 + Number(match[2])
  const range = slot.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2])
    const end = Number(range[3]) * 60 + Number(range[4])
    return minutes >= start && minutes <= end
  }
  if (slot === 'morning') return minutes >= 480 && minutes < 720
  if (slot === 'afternoon') return minutes >= 720 && minutes < 1020
  return slot === 'evening' && minutes >= 1020 && minutes <= 1200
}

function readableTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return value
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]))
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function readableAvailabilityTime(value: string) {
  if (value === 'anytime') return 'All day'
  const range = value.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  if (range) return `${readableTime(range[1])} to ${readableTime(range[2])}`
  if (value === 'morning') return 'Morning (8 AM to noon)'
  if (value === 'afternoon') return 'Afternoon (noon to 5 PM)'
  if (value === 'evening') return 'Evening (5 PM to 8 PM)'
  return value
}

function readableDay(value: string) {
  if (!/^\d{8}$/.test(value)) return value
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T12:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')

  try {
    await ensureSchema()
    const sql = database()

    async function reserveNotification(key: string) {
      const rows = await sql`
        INSERT INTO notification_log (notification_key)
        VALUES (${key})
        ON CONFLICT DO NOTHING
        RETURNING notification_key
      `
      return rows.length > 0
    }

    async function releaseNotification(key: string) {
      await sql`DELETE FROM notification_log WHERE notification_key = ${key}`
    }

    async function notifyOnce(key: string, details: Parameters<typeof sendTeamNotification>[0]) {
      if (!await reserveNotification(key)) return
      try {
        const sent = await sendTeamNotification(details)
        if (!sent) await releaseNotification(key)
      } catch (error) {
        await releaseNotification(key)
        console.error('Notification email failed', error)
      }
    }

    async function findAvailabilityMatches(entries: AvailabilityInput[]) {
      const events = await sql`
        SELECT id, event_date AS date, day_label AS "dayLabel", event_time AS time,
          title, help_needed AS "helpNeeded"
        FROM team_events
        WHERE (helper IS NULL OR helper = '')
          AND help_needed <> 'No help needed, just sharing the schedule'
      `
      const matches = entries.flatMap((entry) => events
        .filter((event) => String(event.date).slice(0, 8) === entry.day && timeMatchesAvailability(entry.time, String(event.time)))
        .map((event) => ({ entry, event })))
      return matches
    }

    async function notifyNewAvailability(entries: AvailabilityInput[]) {
      if (!entries.length) return
      const matches = await findAvailabilityMatches(entries)
      const availabilityKey = `availability-added:${entries.map((entry) => entry.id).sort().join(':')}`
      if (!await reserveNotification(availabilityKey)) return
      const matchReservations = await Promise.all(matches.map(async (match) => {
        const key = `match:${match.entry.id}:${match.event.id}`
        return { key, reserved: await reserveNotification(key) }
      }))
      const reservedKeys = [availabilityKey, ...matchReservations.filter((result) => result.reserved).map((result) => result.key)]
      const person = entries[0]
      const dates = entries.map((entry) => readableDay(entry.day))
      const shownDates = dates.slice(0, 10).join(', ') + (dates.length > 10 ? `, plus ${dates.length - 10} more` : '')

      try {
        const sent = await sendTeamNotification({
          subject: `Mary's Team: ${person.name} added availability`,
          heading: 'New availability was added',
          intro: matches.length
            ? `${person.name} added availability, and it may match ${matches.length === 1 ? 'an open item' : `${matches.length} open items`} on the schedule.`
            : `${person.name} added availability. It does not currently match an open schedule item.`,
          rows: [
            { label: 'Person', value: person.name },
            { label: 'Phone', value: person.phone },
            { label: 'Dates', value: shownDates },
            { label: 'Available', value: readableAvailabilityTime(person.time) },
            { label: 'Can help with', value: person.note },
            ...matches.flatMap(({ event }) => [
              { label: 'Possible match', value: String(event.title) },
              { label: 'When', value: `${String(event.dayLabel)} at ${readableTime(String(event.time))}` },
              { label: 'Help needed', value: String(event.helpNeeded) },
            ]),
          ],
        })
        if (!sent) await Promise.all(reservedKeys.map(releaseNotification))
      } catch (error) {
        await Promise.all(reservedKeys.map(releaseNotification))
        console.error('New availability email failed', error)
      }
    }

    async function notifyAvailabilityMatches(entries: AvailabilityInput[]) {
      const matches = await findAvailabilityMatches(entries)
      if (!matches.length) return

      const reservationResults = await Promise.all(matches.map(async (match) => {
        const key = `match:${match.entry.id}:${match.event.id}`
        return { match, key, reserved: await reserveNotification(key) }
      }))
      const freshReservations = reservationResults.filter((result) => result.reserved)
      const freshMatches = freshReservations.map((result) => result.match)
      const reservedKeys = freshReservations.map((result) => result.key)
      if (!freshMatches.length) return

      try {
        const person = freshMatches[0].entry
        const sent = await sendTeamNotification({
          subject: `Mary's Team: ${person.name} may be available to help`,
          heading: 'A helper may be available',
          intro: `${person.name}'s availability matches ${freshMatches.length === 1 ? 'an open item' : `${freshMatches.length} open items`} on the schedule. No one has been signed up automatically.`,
          rows: [
            { label: 'Available helper', value: person.name },
            { label: 'Phone', value: person.phone },
            ...freshMatches.flatMap(({ event }) => [
              { label: 'Open item', value: String(event.title) },
              { label: 'When', value: `${String(event.dayLabel)} at ${readableTime(String(event.time))}` },
              { label: 'Help needed', value: String(event.helpNeeded) },
            ]),
          ],
        })
        if (!sent) await Promise.all(reservedKeys.map(releaseNotification))
      } catch (error) {
        await Promise.all(reservedKeys.map(releaseNotification))
        console.error('Availability match email failed', error)
      }
    }

    if (request.method === 'GET') {
      const events = await sql`
        SELECT id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, title, details, location,
          help_needed AS "helpNeeded", helper
        FROM team_events
        ORDER BY event_date ASC, created_at ASC
      `
      const availability = await sql`
        SELECT id, name, phone, available_day AS day, available_time AS time, note
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

    if (action === 'sendNotificationTest') {
      if (process.env.NOTIFICATION_MODE === 'live') return sendError(response, 404, 'The test email is no longer available.')
      const key = 'setup:test-email:v1'
      if (!await reserveNotification(key)) return response.status(200).json({ sent: true, alreadySent: true })
      try {
        const sent = await sendTeamNotification({
          subject: "Mary's Team email test",
          heading: 'Email notifications are connected',
          intro: "This is a test only. Mary and Stu have not been notified yet.",
          rows: [
            { label: 'Sign-up alerts', value: 'Ready for testing' },
            { label: 'Availability matches', value: 'Ready for testing' },
          ],
        })
        if (!sent) {
          await releaseNotification(key)
          return sendError(response, 503, 'Email notifications are not fully connected yet.')
        }
        return response.status(200).json({ sent: true })
      } catch (error) {
        await releaseNotification(key)
        console.error('Test email failed', error)
        return sendError(response, 502, 'The test email could not be sent. Please check the Google mail connection.')
      }
    }

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
      const phone = clean(request.body?.phone, 40)
      if (!eventId || !name || !phone) return sendError(response, 400, 'Please enter your name and phone number.')
      const rows = await sql`
        UPDATE team_events
        SET helper = ${name}, helper_phone = ${phone}
        WHERE id = ${eventId} AND (helper IS NULL OR helper = '')
        RETURNING id, helper, helper_phone AS "helperPhone", title,
          day_label AS "dayLabel", event_time AS time, help_needed AS "helpNeeded"
      `
      if (!rows.length) return sendError(response, 409, 'Someone else has already filled this slot. The schedule has been refreshed.')
      const claimed = rows[0]
      await notifyOnce(`claim:${eventId}`, {
        subject: `Mary's Team: ${name} signed up to help`,
        heading: 'A task was filled',
        intro: `${name} signed up to help with an item on Mary and Stu's schedule.`,
        rows: [
          { label: 'Helper', value: name },
          { label: 'Phone', value: phone },
          { label: 'Item', value: String(claimed.title) },
          { label: 'When', value: `${String(claimed.dayLabel)} at ${readableTime(String(claimed.time))}` },
          { label: 'Help', value: String(claimed.helpNeeded) },
        ],
      })
      return response.status(200).json({ id: eventId, helper: name })
    }

    if (action === 'addAvailabilityBatch') {
      const items = Array.isArray(request.body?.entries) ? request.body.entries.slice(0, 31) as Partial<AvailabilityInput>[] : []
      const entries = items.map((item) => ({
        id: clean(item.id, 80),
        name: clean(item.name, 120),
        phone: clean(item.phone, 40),
        day: clean(item.day, 120),
        time: clean(item.time, 120),
        note: clean(item.note, 500),
      }))
      if (!entries.length || entries.some((entry) => !entry.id || !entry.name || !entry.phone || !entry.day || !entry.time || !entry.note)) {
        return sendError(response, 400, 'Please complete your name, phone number, dates, times, and kind of help.')
      }
      const savedRows = await Promise.all(entries.map((entry) => sql`
        INSERT INTO availability (id, name, phone, available_day, available_time, note)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.day}, ${entry.time}, ${entry.note})
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `))
      await notifyNewAvailability(entries)
      return response.status(201).json({ entries: savedRows.flat() })
    }

    if (action === 'addAvailability') {
      const item = request.body?.entry as Partial<AvailabilityInput> | undefined
      const entry = {
        id: clean(item?.id, 80),
        name: clean(item?.name, 120),
        phone: clean(item?.phone, 40),
        day: clean(item?.day, 120),
        time: clean(item?.time, 120),
        note: clean(item?.note, 500),
      }
      if (!entry.id || !entry.name || !entry.phone || !entry.day || !entry.time) {
        return sendError(response, 400, 'Please add your name, phone number, day, and time.')
      }
      const [saved] = await sql`
        INSERT INTO availability (id, name, phone, available_day, available_time, note)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.day}, ${entry.time}, ${entry.note})
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `
      await notifyNewAvailability([entry])
      return response.status(201).json({ entry: saved })
    }

    if (action === 'updateAvailability') {
      const item = request.body?.entry as Partial<AvailabilityInput> | undefined
      const entry = {
        id: clean(item?.id, 80),
        name: clean(item?.name, 120),
        phone: clean(item?.phone, 40),
        day: clean(item?.day, 120),
        time: clean(item?.time, 120),
        note: clean(item?.note, 500),
      }
      if (!entry.id || !entry.name || !entry.phone || !entry.day || !entry.time || !entry.note) {
        return sendError(response, 400, 'Please complete your name, phone number, date, time, and kind of help.')
      }
      const rows = await sql`
        UPDATE availability
        SET name = ${entry.name}, phone = ${entry.phone}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note}
        WHERE id = ${entry.id}
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `
      if (!rows.length) return sendError(response, 404, 'This availability could not be found. The page may have changed.')
      return response.status(200).json({ entry: rows[0] })
    }

    if (action === 'updateAvailabilityBatch') {
      const items = Array.isArray(request.body?.entries) ? request.body.entries.slice(0, 31) as Partial<AvailabilityInput>[] : []
      const entries = items.map((item) => ({
        id: clean(item.id, 80),
        name: clean(item.name, 120),
        phone: clean(item.phone, 40),
        day: clean(item.day, 120),
        time: clean(item.time, 120),
        note: clean(item.note, 500),
      }))
      if (!entries.length || entries.some((entry) => !entry.id || !entry.name || !entry.phone || !entry.day || !entry.time || !entry.note)) {
        return sendError(response, 400, 'Please complete your name, phone number, dates, times, and kind of help.')
      }
      const savedRows = await Promise.all(entries.map((entry) => sql`
        UPDATE availability
        SET name = ${entry.name}, phone = ${entry.phone}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note}
        WHERE id = ${entry.id}
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `))
      if (savedRows.some((rows) => !rows.length)) return sendError(response, 404, 'One of these dates could not be found. Please refresh and try again.')
      await notifyAvailabilityMatches(entries)
      return response.status(200).json({ entries: savedRows.flat() })
    }

    if (action === 'deleteAvailability') {
      const availabilityId = clean(request.body?.availabilityId, 80)
      if (!availabilityId) return sendError(response, 400, 'Choose the availability you want to remove.')
      const rows = await sql`DELETE FROM availability WHERE id = ${availabilityId} RETURNING id`
      if (!rows.length) return sendError(response, 404, 'This availability was already removed.')
      return response.status(200).json({ id: availabilityId })
    }

    if (action === 'deleteAvailabilityBatch') {
      const availabilityIds = Array.isArray(request.body?.availabilityIds) ? request.body.availabilityIds.slice(0, 31).map((id: unknown) => clean(id, 80)).filter(Boolean) : []
      if (!availabilityIds.length) return sendError(response, 400, 'Choose at least one availability date to remove.')
      await Promise.all(availabilityIds.map((id: string) => sql`DELETE FROM availability WHERE id = ${id}`))
      return response.status(200).json({ ids: availabilityIds })
    }

    return sendError(response, 400, 'That action was not recognized.')
  } catch (error) {
    console.error(error)
    return sendError(response, 500, 'The shared schedule could not be reached. Please try again in a moment.')
  }
}
