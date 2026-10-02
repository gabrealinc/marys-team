import { neon } from '@neondatabase/serverless'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { sendTeamNotification } from '../lib/email.js'

type Category = 'appointment' | 'company' | 'home' | 'family' | 'dad'

type TeamEventInput = {
  id: string
  category: Category
  date: string
  dayLabel: string
  time: string
  endTime: string
  title: string
  details: string
  location?: string
  helpNeeded: string
  forWho: string
  repeatGroupId?: string
}

type AvailabilityInput = {
  id: string
  name: string
  phone: string
  day: string
  time: string
  note: string
}

type StuWorkDefaults = {
  weekdays: number[]
  startTime: string
  endTime: string
}

type SupportRequestNotification = {
  id: unknown
  approvalToken: unknown
  requesterName: unknown
  requesterPhone: unknown
  title: unknown
  dayLabel: unknown
  time: unknown
  endTime: unknown
  helpNeeded: unknown
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
      end_time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      location TEXT,
      help_needed TEXT NOT NULL,
      helper TEXT,
      helper_phone TEXT,
      repeat_group_id TEXT,
      for_who TEXT NOT NULL DEFAULT 'Family',
      schedule_source TEXT,
      is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE,
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
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS owner_key_hash TEXT`
  await sql`UPDATE availability SET owner_key_hash = 'legacy-organizer-only' WHERE owner_key_hash IS NULL`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_phone TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS repeat_group_id TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS for_who TEXT NOT NULL DEFAULT 'Family'`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS schedule_source TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`UPDATE team_events SET for_who = 'Mary' WHERE category = 'appointment' AND for_who = 'Family'`
  await sql`UPDATE team_events SET for_who = 'Stu' WHERE category = 'dad' AND for_who = 'Family'`
  await sql`
    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES team_events(id) ON DELETE CASCADE,
      requester_name TEXT NOT NULL,
      requester_phone TEXT NOT NULL,
      approval_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      notification_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    )
  `
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request_per_event ON support_requests(event_id) WHERE status = 'pending'`
  await sql`
    CREATE TABLE IF NOT EXISTS notification_log (
      notification_key TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS organizer_login_attempts (
      attempt_key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS stu_work_defaults (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS stu_work_exceptions (
      work_date TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

function clean(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function organizerSession(expiration: string, secret: string) {
  return `${expiration}.${createHmac('sha256', secret).update(expiration).digest('hex')}`
}

function organizerAttemptKey(request: VercelRequest, secret: string) {
  const forwarded = request.headers['x-forwarded-for']
  const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded || request.headers['x-real-ip'] || 'unknown').toString().split(',')[0].trim()
  return createHmac('sha256', secret).update(address).digest('hex')
}

function helperOwnerHash(token: string, secret: string) {
  return createHmac('sha256', secret).update(token).digest('hex')
}

function helperOwnerFromRequest(request: VercelRequest) {
  const token = request.cookies?.marys_helper
  const secret = process.env.ORGANIZER_SESSION_SECRET?.trim()
  if (!token || !secret || !/^[0-9a-f-]{36}$/i.test(token)) return ''
  return helperOwnerHash(token, secret)
}

function ensureHelperOwner(request: VercelRequest, response: VercelResponse) {
  const secret = process.env.ORGANIZER_SESSION_SECRET?.trim()
  if (!secret) throw new Error('Private availability editing is not connected yet.')
  const existingToken = request.cookies?.marys_helper
  const token = existingToken && /^[0-9a-f-]{36}$/i.test(existingToken) ? existingToken : randomUUID()
  if (!existingToken) response.setHeader('Set-Cookie', `marys_helper=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`)
  return helperOwnerHash(token, secret)
}

function organizerAuthorized(request: VercelRequest) {
  const secret = process.env.ORGANIZER_SESSION_SECRET?.trim()
  const cookie = request.cookies?.marys_organizer
  if (!secret || !cookie) return false
  const [expiration, signature] = cookie.split('.')
  if (!expiration || !signature || Number(expiration) < Date.now()) return false
  const expected = organizerSession(expiration, secret)
  const actualBuffer = Buffer.from(cookie)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function sendError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

function isNoSupport(value: string) {
  return value === 'No help needed' || value === 'No help needed, just sharing the schedule'
}

function parseEventInput(item: Partial<TeamEventInput> | undefined) {
  const forWho = clean(item?.forWho, 30)
  return {
    id: clean(item?.id, 80),
    category: clean(item?.category, 20) as Category,
    date: clean(item?.date, 30),
    dayLabel: clean(item?.dayLabel, 100),
    time: clean(item?.time, 20),
    endTime: clean(item?.endTime, 20),
    title: clean(item?.title, 160),
    details: clean(item?.details, 1000),
    location: clean(item?.location, 300),
    helpNeeded: clean(item?.helpNeeded, 200),
    forWho,
    repeatGroupId: clean(item?.repeatGroupId, 80),
  }
}

function eventIsValid(event: ReturnType<typeof parseEventInput>) {
  return Boolean(event.id && event.date && event.dayLabel && event.time && event.endTime && event.title && event.helpNeeded && ['Mary', 'Stu', 'Coco', 'Family'].includes(event.forWho) && ['appointment', 'company', 'home', 'family', 'dad'].includes(event.category) && event.endTime > event.time)
}

function timeMatchesAvailability(slot: string, eventTime: string, eventEndTime?: string) {
  if (slot === 'anytime') return true
  const match = eventTime.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return false
  const minutes = Number(match[1]) * 60 + Number(match[2])
  const endMatch = (eventEndTime || eventTime).match(/^(\d{1,2}):(\d{2})$/)
  const eventEnd = endMatch ? Number(endMatch[1]) * 60 + Number(endMatch[2]) : minutes
  const range = slot.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2])
    const end = Number(range[3]) * 60 + Number(range[4])
    return minutes >= start && eventEnd <= end
  }
  if (slot === 'morning') return minutes >= 480 && eventEnd <= 720
  if (slot === 'afternoon') return minutes >= 720 && eventEnd <= 1020
  return slot === 'evening' && minutes >= 1020 && eventEnd <= 1200
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

function phoenixToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function upcomingWorkDates(count = 90) {
  const start = new Date(`${phoenixToday()}T12:00:00Z`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return {
      dateKey: `${year}${month}${day}`,
      weekday: date.getUTCDay(),
      dayLabel: date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }),
    }
  })
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')

  try {
    await ensureSchema()
    const sql = database()
    const isOrganizer = organizerAuthorized(request)

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
      if (!await reserveNotification(key)) return false
      try {
        const sent = await sendTeamNotification(details)
        if (!sent) await releaseNotification(key)
        return sent
      } catch (error) {
        await releaseNotification(key)
        console.error('Notification email failed', error)
        return false
      }
    }

    async function notifySupportRequest(supportRequest: SupportRequestNotification) {
      const approvalUrl = `https://marys-team.vercel.app/?approve=${encodeURIComponent(String(supportRequest.approvalToken))}`
      const emailSent = await notifyOnce(`request:${String(supportRequest.id)}`, {
        subject: `Mary's Team: approval requested by ${String(supportRequest.requesterName)}`,
        heading: 'A support request needs approval',
        intro: `${String(supportRequest.requesterName)} would like to join an open time. Nothing has been confirmed yet.`,
        rows: [
          { label: 'Person', value: String(supportRequest.requesterName) },
          { label: 'Phone', value: String(supportRequest.requesterPhone) },
          { label: 'Schedule item', value: String(supportRequest.title) },
          { label: 'When', value: `${String(supportRequest.dayLabel)} from ${readableTime(String(supportRequest.time))} to ${readableTime(String(supportRequest.endTime))}` },
          { label: 'Support requested', value: String(supportRequest.helpNeeded) },
        ],
        actionUrl: approvalUrl,
        actionLabel: 'Review and approve request',
      })
      if (emailSent) await sql`UPDATE support_requests SET notification_sent_at = NOW() WHERE id = ${String(supportRequest.id)}`
      return emailSent
    }

    async function findAvailabilityMatches(entries: AvailabilityInput[]) {
      const events = await sql`
        SELECT id, event_date AS date, day_label AS "dayLabel", event_time AS time, end_time AS "endTime",
          title, help_needed AS "helpNeeded"
        FROM team_events
        WHERE (helper IS NULL OR helper = '')
          AND help_needed NOT IN ('No help needed', 'No help needed, just sharing the schedule')
      `
      const matches = entries.flatMap((entry) => events
        .filter((event) => String(event.date).slice(0, 8) === entry.day && timeMatchesAvailability(entry.time, String(event.time), String(event.endTime || '')))
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
      const helperOwner = helperOwnerFromRequest(request)
      const events = await sql`
        SELECT team_events.id,
          CASE WHEN category = 'dad' THEN 'family' ELSE category END AS category,
          event_date AS date, day_label AS "dayLabel", event_time AS time,
          end_time AS "endTime", title, details, location,
          CASE WHEN help_needed = 'No help needed, just sharing the schedule' THEN 'No help needed' ELSE help_needed END AS "helpNeeded",
          helper, repeat_group_id AS "repeatGroupId",
          schedule_source AS "scheduleSource", is_schedule_exception AS "isScheduleException",
          COALESCE(NULLIF(for_who, ''), CASE WHEN category = 'appointment' THEN 'Mary' WHEN category = 'dad' THEN 'Stu' ELSE 'Family' END) AS "forWho",
          pending.requester_name AS "requesterName",
          (pending.id IS NOT NULL) AS "requestPending"
        FROM team_events
        LEFT JOIN LATERAL (
          SELECT id, requester_name
          FROM support_requests
          WHERE event_id = team_events.id AND status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
        ) pending ON TRUE
        ORDER BY event_date ASC, team_events.created_at ASC
      `
      const availability = await sql`
        SELECT id, name, phone, available_day AS day, available_time AS time, note, owner_key_hash AS "ownerKeyHash"
        FROM availability
        ORDER BY created_at DESC
      `
      const publicEvents = events.map((event) => isOrganizer ? event : { ...event, requesterName: undefined })
      const publicAvailability = availability.map(({ ownerKeyHash, ...entry }) => ({
        ...entry,
        editable: isOrganizer || !ownerKeyHash || ownerKeyHash === helperOwner,
      }))
      const defaultRows = isOrganizer ? await sql`SELECT weekdays, start_time AS "startTime", end_time AS "endTime" FROM stu_work_defaults WHERE singleton = TRUE` : []
      const stuWorkDefaults = defaultRows.length ? {
        weekdays: String(defaultRows[0].weekdays).split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        startTime: String(defaultRows[0].startTime),
        endTime: String(defaultRows[0].endTime),
      } : null
      return response.status(200).json({ events: publicEvents, availability: publicAvailability, organizer: isOrganizer, stuWorkDefaults })
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST')
      return sendError(response, 405, 'This action is not supported.')
    }

    const action = clean(request.body?.action, 30)

    if (action === 'organizerLogin') {
      const configuredPin = process.env.ORGANIZER_PIN?.trim()
      const secret = process.env.ORGANIZER_SESSION_SECRET?.trim()
      const pin = clean(request.body?.pin, 20)
      if (!configuredPin || !secret) return sendError(response, 503, 'Organizer access is not connected yet.')
      const attemptKey = organizerAttemptKey(request, secret)
      const recentAttempts = await sql`
        SELECT failures
        FROM organizer_login_attempts
        WHERE attempt_key = ${attemptKey} AND last_attempt > NOW() - INTERVAL '15 minutes'
      `
      if (Number(recentAttempts[0]?.failures || 0) >= 8) return sendError(response, 429, 'Too many PIN attempts. Please wait 15 minutes and try again.')
      const entered = Buffer.from(pin)
      const expected = Buffer.from(configuredPin)
      if (entered.length !== expected.length || !timingSafeEqual(entered, expected)) {
        await sql`
          INSERT INTO organizer_login_attempts (attempt_key, failures, last_attempt)
          VALUES (${attemptKey}, 1, NOW())
          ON CONFLICT (attempt_key) DO UPDATE SET
            failures = CASE
              WHEN organizer_login_attempts.last_attempt <= NOW() - INTERVAL '15 minutes' THEN 1
              ELSE organizer_login_attempts.failures + 1
            END,
            last_attempt = NOW()
        `
        return sendError(response, 401, 'That organizer PIN is not correct.')
      }
      await sql`DELETE FROM organizer_login_attempts WHERE attempt_key = ${attemptKey}`
      const expiration = String(Date.now() + 30 * 24 * 60 * 60 * 1000)
      response.setHeader('Set-Cookie', `marys_organizer=${organizerSession(expiration, secret)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`)
      return response.status(200).json({ organizer: true })
    }

    if (action === 'organizerLogout') {
      response.setHeader('Set-Cookie', 'marys_organizer=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0')
      return response.status(200).json({ organizer: false })
    }

    if (action === 'getPendingRequests') {
      if (!isOrganizer) return sendError(response, 401, 'Organizer access is required.')
      const requests = await sql`
        SELECT support_requests.id, support_requests.event_id AS "eventId",
          support_requests.requester_name AS "requesterName", support_requests.requester_phone AS "requesterPhone",
          support_requests.notification_sent_at AS "notificationSentAt", team_events.title,
          team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded"
        FROM support_requests
        JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.status = 'pending'
        ORDER BY support_requests.created_at ASC
      `
      return response.status(200).json({ requests })
    }

    if (action === 'organizerDecideRequest') {
      if (!isOrganizer) return sendError(response, 401, 'Organizer access is required.')
      const requestId = clean(request.body?.requestId, 80)
      const decision = clean(request.body?.decision, 20)
      if (!requestId || !['approve', 'decline'].includes(decision)) return sendError(response, 400, 'Choose a request and a decision.')
      const requests = await sql`SELECT id, event_id AS "eventId", requester_name AS "requesterName", requester_phone AS "requesterPhone" FROM support_requests WHERE id = ${requestId} AND status = 'pending'`
      if (!requests.length) return sendError(response, 409, 'This request was already handled.')
      const supportRequest = requests[0]
      if (decision === 'approve') {
        const updated = await sql`UPDATE team_events SET helper = ${String(supportRequest.requesterName)}, helper_phone = ${String(supportRequest.requesterPhone)} WHERE id = ${String(supportRequest.eventId)} AND (helper IS NULL OR helper = '') RETURNING id`
        if (!updated.length) return sendError(response, 409, 'This time already has someone confirmed.')
      }
      await sql`UPDATE support_requests SET status = ${decision === 'approve' ? 'approved' : 'declined'}, decided_at = NOW() WHERE id = ${requestId}`
      return response.status(200).json({ id: requestId, decision })
    }

    if (action === 'sendNotificationTest') {
      if (process.env.NOTIFICATION_MODE === 'live' && !isOrganizer) return sendError(response, 401, 'Organizer access is required to send a test email.')
      const key = `setup:test-email:v2:${process.env.NOTIFICATION_MODE || 'test'}`
      if (!await reserveNotification(key)) return response.status(200).json({ sent: true, alreadySent: true })
      try {
        const sent = await sendTeamNotification({
          subject: "Mary's Team email test",
          heading: 'Email notifications are connected',
          intro: "This is a test only. It confirms that Mary's Team can send schedule and approval notifications.",
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

    if (action === 'saveStuWorkHours') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to change Stu’s work hours.')
      const rawWeekdays = Array.isArray(request.body?.weekdays) ? request.body.weekdays : []
      const weekdays = [...new Set(rawWeekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
      const startTime = clean(request.body?.startTime, 20)
      const endTime = clean(request.body?.endTime, 20)
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) {
        return sendError(response, 400, 'Choose a normal starting time and a later ending time.')
      }
      const defaults: StuWorkDefaults = { weekdays, startTime, endTime }
      await sql`
        INSERT INTO stu_work_defaults (singleton, weekdays, start_time, end_time, updated_at)
        VALUES (TRUE, ${weekdays.join(',')}, ${startTime}, ${endTime}, NOW())
        ON CONFLICT (singleton) DO UPDATE SET weekdays = EXCLUDED.weekdays, start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time, updated_at = NOW()
      `
      const exceptionRows = await sql`SELECT work_date AS "workDate" FROM stu_work_exceptions`
      const exceptions = new Set(exceptionRows.map((row) => String(row.workDate)))
      const selectedDays = new Set(weekdays)
      await Promise.all(upcomingWorkDates().map(async ({ dateKey, weekday, dayLabel }) => {
        if (exceptions.has(dateKey)) return
        const id = `stu-work-${dateKey}`
        if (!selectedDays.has(weekday)) {
          await sql`DELETE FROM team_events WHERE id = ${id} AND is_schedule_exception = FALSE`
          return
        }
        const eventDate = `${dateKey}T${startTime.replace(':', '')}00`
        await sql`
          INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, help_needed, for_who, schedule_source, is_schedule_exception)
          VALUES (${id}, 'family', ${eventDate}, ${dayLabel}, ${startTime}, ${endTime}, 'Stu’s Work Hours', 'Stu is working.', 'Spend time with Mary', 'Stu', 'stu_work', FALSE)
          ON CONFLICT (id) DO UPDATE SET event_date = EXCLUDED.event_date, day_label = EXCLUDED.day_label,
            event_time = EXCLUDED.event_time, end_time = EXCLUDED.end_time, title = EXCLUDED.title,
            details = EXCLUDED.details, help_needed = EXCLUDED.help_needed, for_who = EXCLUDED.for_who,
            schedule_source = EXCLUDED.schedule_source
          WHERE team_events.is_schedule_exception = FALSE
        `
      }))
      return response.status(200).json({ defaults })
    }

    if (action === 'addEvent' || action === 'addEventBatch') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const items: unknown[] = action === 'addEventBatch'
        ? (Array.isArray(request.body?.events) ? request.body.events.slice(0, 52) : [])
        : [request.body?.event]
      const events = items.map((item) => parseEventInput(item as Partial<TeamEventInput> | undefined))
      if (!events.length || events.some((event) => !eventIsValid(event))) return sendError(response, 400, 'Please complete the required schedule details, including an ending time.')
      const savedRows = await Promise.all(events.map((event) => sql`
        INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, location, help_needed, repeat_group_id, for_who)
        VALUES (${event.id}, ${event.category}, ${event.date}, ${event.dayLabel}, ${event.time}, ${event.endTime}, ${event.title}, ${event.details}, ${event.location || null}, ${event.helpNeeded}, ${event.repeatGroupId || null}, ${event.forWho})
        ON CONFLICT (id) DO UPDATE SET
          category = EXCLUDED.category, event_date = EXCLUDED.event_date, day_label = EXCLUDED.day_label,
          event_time = EXCLUDED.event_time, end_time = EXCLUDED.end_time, title = EXCLUDED.title,
          details = EXCLUDED.details, location = EXCLUDED.location, help_needed = EXCLUDED.help_needed,
          repeat_group_id = EXCLUDED.repeat_group_id, for_who = EXCLUDED.for_who
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, repeat_group_id AS "repeatGroupId", for_who AS "forWho"
      `))
      return response.status(201).json({ events: savedRows.flat() })
    }

    if (action === 'updateEvent') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const event = parseEventInput(request.body?.event as Partial<TeamEventInput> | undefined)
      if (!eventIsValid(event)) return sendError(response, 400, 'Please complete the required schedule details, including an ending time.')
      const previousRows = await sql`SELECT event_date AS date, schedule_source AS "scheduleSource" FROM team_events WHERE id = ${event.id}`
      const previous = previousRows[0]
      const rows = await sql`
        UPDATE team_events
        SET category = ${event.category}, event_date = ${event.date}, day_label = ${event.dayLabel},
          event_time = ${event.time}, end_time = ${event.endTime}, title = ${event.title},
          details = ${event.details}, location = ${event.location || null}, help_needed = ${event.helpNeeded}, for_who = ${event.forWho},
          helper = CASE WHEN ${isNoSupport(event.helpNeeded)} THEN NULL ELSE helper END,
          helper_phone = CASE WHEN ${isNoSupport(event.helpNeeded)} THEN NULL ELSE helper_phone END,
          is_schedule_exception = CASE WHEN schedule_source = 'stu_work' THEN TRUE ELSE is_schedule_exception END
        WHERE id = ${event.id}
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, repeat_group_id AS "repeatGroupId", for_who AS "forWho",
          schedule_source AS "scheduleSource", is_schedule_exception AS "isScheduleException"
      `
      if (!rows.length) return sendError(response, 404, 'This schedule item could not be found.')
      if (previous?.scheduleSource === 'stu_work') {
        const originalDate = String(previous.date).slice(0, 8)
        const updatedDate = event.date.slice(0, 8)
        await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${originalDate}) ON CONFLICT DO NOTHING`
        if (updatedDate !== originalDate) await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${updatedDate}) ON CONFLICT DO NOTHING`
      }
      if (isNoSupport(event.helpNeeded)) await sql`UPDATE support_requests SET status = 'declined', decided_at = NOW() WHERE event_id = ${event.id} AND status = 'pending'`
      return response.status(200).json({ event: rows[0] })
    }

    if (action === 'deleteEvent') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const eventId = clean(request.body?.eventId, 80)
      if (!eventId) return sendError(response, 400, 'Choose the schedule item to remove.')
      const previousRows = await sql`SELECT event_date AS date, schedule_source AS "scheduleSource" FROM team_events WHERE id = ${eventId}`
      if (previousRows[0]?.scheduleSource === 'stu_work') {
        await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${String(previousRows[0].date).slice(0, 8)}) ON CONFLICT DO NOTHING`
      }
      const rows = await sql`DELETE FROM team_events WHERE id = ${eventId} RETURNING id`
      if (!rows.length) return sendError(response, 404, 'This schedule item was already removed.')
      return response.status(200).json({ id: eventId })
    }

    if (action === 'getApprovalRequest') {
      const token = clean(request.body?.token, 120)
      const rows = await sql`
        SELECT support_requests.id, support_requests.status, support_requests.requester_name AS "requesterName",
          support_requests.requester_phone AS "requesterPhone", team_events.title,
          team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded"
        FROM support_requests
        JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.approval_token = ${token}
      `
      if (!rows.length) return sendError(response, 404, 'This request link is not available.')
      return response.status(200).json({ request: rows[0] })
    }

    if (action === 'approveRequest') {
      const token = clean(request.body?.token, 120)
      const requests = await sql`
        SELECT id, event_id AS "eventId", requester_name AS "requesterName", requester_phone AS "requesterPhone"
        FROM support_requests
        WHERE approval_token = ${token} AND status = 'pending'
      `
      if (!requests.length) return sendError(response, 409, 'This request was already handled or is no longer available.')
      const supportRequest = requests[0]
      const updated = await sql`
        UPDATE team_events
        SET helper = ${String(supportRequest.requesterName)}, helper_phone = ${String(supportRequest.requesterPhone)}
        WHERE id = ${String(supportRequest.eventId)} AND (helper IS NULL OR helper = '')
        RETURNING id, helper
      `
      if (!updated.length) return sendError(response, 409, 'This time already has someone confirmed.')
      await sql`UPDATE support_requests SET status = 'approved', decided_at = NOW() WHERE id = ${String(supportRequest.id)}`
      return response.status(200).json({ id: updated[0].id, helper: updated[0].helper })
    }

    if (action === 'retryPendingNotifications') {
      const pendingRequests = await sql`
        SELECT support_requests.id, support_requests.approval_token AS "approvalToken",
          support_requests.requester_name AS "requesterName", support_requests.requester_phone AS "requesterPhone",
          team_events.title, team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded"
        FROM support_requests
        JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.status = 'pending' AND support_requests.notification_sent_at IS NULL
        ORDER BY support_requests.created_at ASC
        LIMIT 5
      `
      const results = await Promise.all(pendingRequests.map((pendingRequest) => notifySupportRequest(pendingRequest as SupportRequestNotification)))
      return response.status(200).json({ pending: pendingRequests.length, sent: results.filter(Boolean).length })
    }

    if (action === 'claimEvent') {
      const eventId = clean(request.body?.eventId, 80)
      const name = clean(request.body?.name, 120)
      const phone = clean(request.body?.phone, 40)
      if (!eventId || !name || !phone) return sendError(response, 400, 'Please enter your name and phone number.')
      const availableEvents = await sql`
        SELECT id, title, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", help_needed AS "helpNeeded", helper
        FROM team_events WHERE id = ${eventId}
      `
      if (!availableEvents.length) return sendError(response, 404, 'This schedule item could not be found.')
      const selectedEvent = availableEvents[0]
      if (isNoSupport(String(selectedEvent.helpNeeded))) return sendError(response, 400, 'This time is marked busy and is not accepting support requests.')
      if (selectedEvent.helper) return sendError(response, 409, 'Someone else has already filled this time.')

      const requestId = randomUUID()
      const approvalToken = randomUUID()
      const rows = await sql`
        INSERT INTO support_requests (id, event_id, requester_name, requester_phone, approval_token)
        VALUES (${requestId}, ${eventId}, ${name}, ${phone}, ${approvalToken})
        ON CONFLICT DO NOTHING
        RETURNING id
      `
      if (!rows.length) return sendError(response, 409, 'Someone has already requested this time. Mary or Stu can approve that request first.')
      const emailSent = await notifySupportRequest({ id: requestId, approvalToken, requesterName: name, requesterPhone: phone, title: selectedEvent.title, dayLabel: selectedEvent.dayLabel, time: selectedEvent.time, endTime: selectedEvent.endTime, helpNeeded: selectedEvent.helpNeeded })
      return response.status(202).json({ id: eventId, status: 'requested', requesterName: name, emailSent })
    }

    if (action === 'addAvailabilityBatch') {
      const ownerKeyHash = ensureHelperOwner(request, response)
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
        INSERT INTO availability (id, name, phone, available_day, available_time, note, owner_key_hash)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.day}, ${entry.time}, ${entry.note}, ${ownerKeyHash})
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `))
      await notifyNewAvailability(entries)
      return response.status(201).json({ entries: savedRows.flat().map((entry) => ({ ...entry, editable: true })) })
    }

    if (action === 'addAvailability') {
      const ownerKeyHash = ensureHelperOwner(request, response)
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
        INSERT INTO availability (id, name, phone, available_day, available_time, note, owner_key_hash)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.day}, ${entry.time}, ${entry.note}, ${ownerKeyHash})
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `
      await notifyNewAvailability([entry])
      return response.status(201).json({ entry: { ...saved, editable: true } })
    }

    if (action === 'updateAvailability') {
      const ownerKeyHash = ensureHelperOwner(request, response)
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
      const ownedRows = await sql`SELECT owner_key_hash AS "ownerKeyHash" FROM availability WHERE id = ${entry.id}`
      if (!ownedRows.length) return sendError(response, 404, 'This availability could not be found. The page may have changed.')
      if (!isOrganizer && ownedRows[0].ownerKeyHash && ownedRows[0].ownerKeyHash !== ownerKeyHash) return sendError(response, 403, 'Only the person who added this availability can change it.')
      const rows = await sql`
        UPDATE availability
        SET name = ${entry.name}, phone = ${entry.phone}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note},
          owner_key_hash = COALESCE(owner_key_hash, ${ownerKeyHash})
        WHERE id = ${entry.id}
        RETURNING id, name, phone, available_day AS day, available_time AS time, note
      `
      if (!rows.length) return sendError(response, 404, 'This availability could not be found. The page may have changed.')
      return response.status(200).json({ entry: rows[0] })
    }

    if (action === 'updateAvailabilityBatch') {
      const ownerKeyHash = ensureHelperOwner(request, response)
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
      const ownership = await Promise.all(entries.map((entry) => sql`SELECT owner_key_hash AS "ownerKeyHash" FROM availability WHERE id = ${entry.id}`))
      if (ownership.some((rows) => !rows.length)) return sendError(response, 404, 'One of these dates could not be found. Please refresh and try again.')
      if (!isOrganizer && ownership.some((rows) => rows[0].ownerKeyHash && rows[0].ownerKeyHash !== ownerKeyHash)) return sendError(response, 403, 'You can only change availability you added from this device.')
      const savedRows = await Promise.all(entries.map((entry) => sql`
        UPDATE availability
        SET name = ${entry.name}, phone = ${entry.phone}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note},
          owner_key_hash = COALESCE(owner_key_hash, ${ownerKeyHash})
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
      const ownerKeyHash = helperOwnerFromRequest(request)
      const ownedRows = await sql`SELECT owner_key_hash AS "ownerKeyHash" FROM availability WHERE id = ${availabilityId}`
      if (!ownedRows.length) return sendError(response, 404, 'This availability was already removed.')
      if (!isOrganizer && ownedRows[0].ownerKeyHash && ownedRows[0].ownerKeyHash !== ownerKeyHash) return sendError(response, 403, 'Only the person who added this availability can remove it.')
      const rows = await sql`DELETE FROM availability WHERE id = ${availabilityId} RETURNING id`
      if (!rows.length) return sendError(response, 404, 'This availability was already removed.')
      return response.status(200).json({ id: availabilityId })
    }

    if (action === 'deleteAvailabilityBatch') {
      const availabilityIds = Array.isArray(request.body?.availabilityIds) ? request.body.availabilityIds.slice(0, 31).map((id: unknown) => clean(id, 80)).filter(Boolean) : []
      if (!availabilityIds.length) return sendError(response, 400, 'Choose at least one availability date to remove.')
      const ownerKeyHash = helperOwnerFromRequest(request)
      const ownership = await Promise.all(availabilityIds.map((id: string) => sql`SELECT owner_key_hash AS "ownerKeyHash" FROM availability WHERE id = ${id}`))
      if (ownership.some((rows) => !rows.length)) return sendError(response, 404, 'One of these dates was already removed.')
      if (!isOrganizer && ownership.some((rows) => rows[0].ownerKeyHash && rows[0].ownerKeyHash !== ownerKeyHash)) return sendError(response, 403, 'You can only remove availability you added from this device.')
      await Promise.all(availabilityIds.map((id: string) => sql`DELETE FROM availability WHERE id = ${id}`))
      return response.status(200).json({ ids: availabilityIds })
    }

    return sendError(response, 400, 'That action was not recognized.')
  } catch (error) {
    console.error(error)
    return sendError(response, 500, 'The shared schedule could not be reached. Please try again in a moment.')
  }
}
