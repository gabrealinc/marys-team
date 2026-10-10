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
  helper?: string
  helperPhone?: string
  helperEmail?: string
  forWho: string
  repeatGroupId?: string
  scheduleSource?: string
  isFlexible?: boolean
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

type FoodSettings = { weekdays: number[]; startTime: string; endTime: string }
type VisitSettings = { startTime: string; endTime: string }
type FamilyInTown = { Stu: boolean; Gabby: boolean; Spencer: boolean }
type FamilyInTownDates = { Stu: string[]; Gabby: string[]; Spencer: string[] }
type CareTeamMember = { id: string; name: string; phone: string; email: string; role: string; weekdays: number[]; startTime: string; endTime: string; autoAssign: boolean }

type SupportRequestNotification = {
  id: unknown
  approvalToken: unknown
  requesterName: unknown
  requesterPhone: unknown
  requesterEmail: unknown
  title: unknown
  dayLabel: unknown
  time: unknown
  endTime: unknown
  helpNeeded: unknown
  details?: unknown
  location?: unknown
  proposalType?: unknown
  isFlexible?: unknown
  requestStartTime?: unknown
  requestEndTime?: unknown
  requestNote?: unknown
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
      helper_email TEXT,
      repeat_group_id TEXT,
      for_who TEXT NOT NULL DEFAULT 'Family',
      schedule_source TEXT,
      is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE,
      is_flexible BOOLEAN NOT NULL DEFAULT FALSE,
      is_proposed BOOLEAN NOT NULL DEFAULT FALSE,
      proposal_type TEXT,
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
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_email TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS repeat_group_id TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS for_who TEXT NOT NULL DEFAULT 'Family'`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS schedule_source TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_flexible BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_proposed BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS proposal_type TEXT`
  await sql`
    CREATE TABLE IF NOT EXISTS food_settings (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      weekdays TEXT NOT NULL DEFAULT '1,3',
      start_time TEXT NOT NULL DEFAULT '14:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`INSERT INTO food_settings (singleton, weekdays, start_time, end_time) VALUES (TRUE, '1,3', '14:00', '18:00') ON CONFLICT (singleton) DO NOTHING`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS visit_start_time TEXT NOT NULL DEFAULT '10:00'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS visit_end_time TEXT NOT NULL DEFAULT '17:00'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS stu_in_town BOOLEAN NOT NULL DEFAULT TRUE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS gabby_in_town BOOLEAN NOT NULL DEFAULT TRUE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS spencer_in_town BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS stu_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS gabby_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS spencer_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`UPDATE team_events SET title = 'Stu at Work' WHERE schedule_source = 'stu_work' AND title <> 'Stu at Work'`
  await sql`UPDATE team_events SET details = ${defaultEventDetails} WHERE TRIM(details) = '' OR details = 'See Mary or Stu for details.'`
  await sql`UPDATE team_events SET for_who = 'Mary' WHERE category = 'appointment' AND for_who = 'Family'`
  await sql`UPDATE team_events SET for_who = 'Stu' WHERE category = 'dad' AND for_who = 'Family'`
  await sql`
    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES team_events(id) ON DELETE CASCADE,
      requester_name TEXT NOT NULL,
      requester_phone TEXT NOT NULL,
      requester_email TEXT NOT NULL DEFAULT '',
      approval_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      notification_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    )
  `
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS requester_email TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS decline_reason TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_start_time TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_end_time TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_note TEXT NOT NULL DEFAULT ''`
  await sql`
    CREATE TABLE IF NOT EXISTS care_team (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Helper',
      weekdays TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS support_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
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

const defaultEventDetails = 'Text Mary directly if you have any questions.'

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
    details: clean(item?.details, 1000) || defaultEventDetails,
    location: clean(item?.location, 300),
    helpNeeded: clean(item?.helpNeeded, 200),
    helper: clean(item?.helper, 120),
    helperPhone: clean(item?.helperPhone, 50),
    helperEmail: clean(item?.helperEmail, 200).toLocaleLowerCase(),
    forWho,
    repeatGroupId: clean(item?.repeatGroupId, 80),
    scheduleSource: clean(item?.scheduleSource, 40),
    isFlexible: Boolean(item?.isFlexible),
  }
}

function eventIsValid(event: ReturnType<typeof parseEventInput>) {
  const validTime = event.isFlexible ? event.time === 'anytime' && event.endTime === 'anytime' : event.endTime > event.time
  const validDriver = !event.helper || Boolean(event.helperPhone && /^\S+@\S+\.\S+$/.test(event.helperEmail))
  return Boolean(event.id && event.date && event.dayLabel && event.time && event.endTime && event.title && event.helpNeeded && ['Mary', 'Stu', 'Gabby', 'Spencer', 'Coco', 'Family'].includes(event.forWho) && ['appointment', 'company', 'home', 'family', 'dad'].includes(event.category) && validTime && validDriver)
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

function calendarText(value: unknown) {
  return String(value || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;')
}

function calendarUtc(dateKey: string, time: string) {
  const iso = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T${time}:00-07:00`
  return new Date(iso).toISOString().replaceAll('-', '').replaceAll(':', '').replace('.000', '')
}

function nextCalendarDay(dateKey: string) {
  const date = new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
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

function calendarWeekRange(eventDate: string) {
  const dateKey = eventDate.slice(0, 8)
  if (!/^\d{8}$/.test(dateKey)) return null
  const date = new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T12:00:00Z`)
  const sunday = new Date(date)
  sunday.setUTCDate(date.getUTCDate() - date.getUTCDay())
  const saturday = new Date(sunday)
  saturday.setUTCDate(sunday.getUTCDate() + 6)
  const compact = (value: Date) => `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`
  return { start: compact(sunday), end: compact(saturday) }
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

    async function notifyOnce(key: string, details: Parameters<typeof sendTeamNotification>[0], recipients?: string[]) {
      if (!await reserveNotification(key)) return false
      try {
        const sent = await sendTeamNotification(details, recipients)
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
      const proposalType = String(supportRequest.proposalType || '')
      const isPlan = proposalType === 'food' || proposalType === 'stop_by'
      const requestLabel = proposalType === 'food' ? 'food drop-off' : proposalType === 'stop_by' ? 'stop-by' : 'support request'
      const emailSent = await notifyOnce(`request:${String(supportRequest.id)}`, {
        subject: `Mary's Team: ${requestLabel} requested by ${String(supportRequest.requesterName)}`,
        heading: isPlan ? 'A proposed plan needs approval' : 'A support request needs approval',
        intro: isPlan
          ? `${String(supportRequest.requesterName)} proposed a ${requestLabel}. It will stay private until it is approved.`
          : `${String(supportRequest.requesterName)} would like to join an open time. Nothing has been confirmed yet.`,
        rows: [
          { label: 'Person', value: String(supportRequest.requesterName) },
          { label: 'Phone', value: String(supportRequest.requesterPhone) },
          { label: 'Email', value: String(supportRequest.requesterEmail) },
          { label: 'Schedule item', value: String(supportRequest.title) },
          { label: 'Time offered', value: Boolean(supportRequest.isFlexible) ? 'Anytime' : `${String(supportRequest.dayLabel)} from ${readableTime(String(supportRequest.requestStartTime || supportRequest.time))} to ${readableTime(String(supportRequest.requestEndTime || supportRequest.endTime))}` },
          ...(supportRequest.requestNote ? [{ label: 'Note or question', value: String(supportRequest.requestNote) }] : []),
          ...(isPlan ? [{ label: 'Details', value: String(supportRequest.details || 'No additional details.') }] : [{ label: 'Support requested', value: String(supportRequest.helpNeeded) }]),
        ],
        actionUrl: approvalUrl,
        actionLabel: 'Review and approve request',
      })
      if (emailSent) await sql`UPDATE support_requests SET notification_sent_at = NOW() WHERE id = ${String(supportRequest.id)}`
      return emailSent
    }

    async function notifySupportDecision(supportRequest: Record<string, unknown>, decision: 'approve' | 'decline', _declineReason = '') {
      const email = String(supportRequest.requesterEmail || '')
      if (!email) return false
      const approved = decision === 'approve'
      const proposalType = String(supportRequest.proposalType || '')
      const isPlan = proposalType === 'food' || proposalType === 'stop_by'
      const savedLocation = String(supportRequest.location || '')
      const approvedLocation = savedLocation.toLocaleLowerCase() === 'home'
        ? String(process.env.HOME_ADDRESS || 'Mary and Stu’s home')
        : savedLocation
      if (!approved) {
        const name = String(supportRequest.requesterName || '').trim()
        return notifyOnce(`decision:${String(supportRequest.id)}:${decision}`, {
          subject: "Mary's Team: Mary's schedule has changed",
          heading: "Mary's schedule has changed",
          intro: `${name ? `${name}, ` : ''}Mary no longer needs help at the scheduled time below. Thank you so much for your support. We will reach out when new times for help become available. If you would still like to help, please share Mary’s GoFundMe with friends and family.`,
          rows: [
            { label: 'Schedule item', value: String(supportRequest.title) },
            { label: 'When', value: Boolean(supportRequest.isFlexible) ? 'Anytime' : `${String(supportRequest.dayLabel)} from ${readableTime(String(supportRequest.requestStartTime || supportRequest.time))} to ${readableTime(String(supportRequest.requestEndTime || supportRequest.endTime))}` },
          ],
          actionUrl: 'https://www.gofundme.com/f/support-mary-greenberg?cp_src=d',
          actionLabel: "Share Mary's GoFundMe",
        }, [email])
      }
      return notifyOnce(`decision:${String(supportRequest.id)}:${decision}`, {
        subject: "Mary's Team: your request was approved",
        heading: 'You are confirmed',
        intro: `Thank you for being part of Mary’s Team. Mary or Stu approved your ${isPlan ? 'proposed plan' : 'request'}.`,
        rows: [
          { label: 'Schedule item', value: String(supportRequest.title) },
          { label: 'When', value: Boolean(supportRequest.isFlexible) ? 'Anytime' : `${String(supportRequest.dayLabel)} from ${readableTime(String(supportRequest.requestStartTime || supportRequest.time))} to ${readableTime(String(supportRequest.requestEndTime || supportRequest.endTime))}` },
          ...(approvedLocation ? [{ label: 'Where', value: approvedLocation }] : []),
          ...(isPlan ? [{ label: 'Details', value: String(supportRequest.details || 'No additional details.') }] : [{ label: 'Support requested', value: String(supportRequest.helpNeeded) }]),
          { label: 'Mary', value: 'mary@hcttravel.com' },
          { label: 'Stu', value: 'ancalaeyes@aol.com' },
        ],
        actionUrl: `https://marys-team.vercel.app/api/data?calendar=${encodeURIComponent(String(supportRequest.eventId))}`,
        actionLabel: 'Add to my calendar',
      }, [email])
    }

    async function notifyAssignedDriver(event: ReturnType<typeof parseEventInput>) {
      if (!event.helper || !event.helperEmail) return false
      const isRide = event.helpNeeded === 'Need a ride'
      const destination = event.location.toLocaleLowerCase() === 'home'
        ? String(process.env.HOME_ADDRESS || 'Mary and Stu’s home')
        : event.location
      return notifyOnce(`assignment:${event.id}:${event.helperEmail}`, {
        subject: `Mary's Team: you are confirmed for ${event.title}`,
        heading: isRide ? 'You are confirmed as the driver' : 'You are confirmed',
        intro: isRide ? `Thank you, ${event.helper}. The family has added you as the confirmed driver for this appointment.` : `Thank you, ${event.helper}. The family has added you to the schedule.`,
        rows: [
          { label: isRide ? 'Appointment' : 'Schedule item', value: event.title },
          { label: 'Details', value: event.details },
          { label: 'When', value: `${event.dayLabel} from ${readableTime(event.time)} to ${readableTime(event.endTime)}` },
          ...(!isRide ? [{ label: 'Support', value: event.helpNeeded }] : []),
          ...(destination ? [{ label: 'Where', value: destination }] : []),
          { label: 'Mary', value: 'mary@hcttravel.com' },
          { label: 'Stu', value: 'ancalaeyes@aol.com' },
        ],
        actionUrl: `https://marys-team.vercel.app/api/data?calendar=${encodeURIComponent(event.id)}`,
        actionLabel: 'Add to my calendar',
      }, [event.helperEmail])
    }

    async function notifyAssignmentRemoved(previous: Record<string, unknown>, event: ReturnType<typeof parseEventInput>) {
      const email = String(previous.helperEmail || '').trim().toLocaleLowerCase()
      if (!email) return false
      const name = String(previous.helper || '').trim()
      return notifyOnce(`assignment-removed:${event.id}:${email}:${event.date}:${event.time}:${event.endTime}`, {
        subject: "Mary's Team: Mary's schedule has changed",
        heading: "Mary's schedule has changed",
        intro: `${name ? `${name}, ` : ''}Mary no longer needs help at the scheduled time below. Thank you so much for your support. We will reach out when new times for help become available. If you would still like to help, please share Mary’s GoFundMe with friends and family.`,
        rows: [
          { label: 'Schedule item', value: event.title },
          { label: 'When', value: event.isFlexible ? 'Anytime' : `${event.dayLabel} from ${readableTime(event.time)} to ${readableTime(event.endTime)}` },
        ],
        actionUrl: 'https://www.gofundme.com/f/support-mary-greenberg?cp_src=d',
        actionLabel: "Share Mary's GoFundMe",
      }, [email])
    }

    async function approveSupportRequest(supportRequest: Record<string, unknown>) {
      if (supportRequest.proposalType === 'food') {
        const week = calendarWeekRange(String(supportRequest.date))
        if (!week) throw new Error('This meal date is not valid.')
      }

      const eventId = String(supportRequest.eventId)
      const eventRows = await sql`SELECT event_date AS date, event_time AS time, end_time AS "endTime", helper, schedule_source AS "scheduleSource", is_flexible AS "isFlexible", proposal_type AS "proposalType" FROM team_events WHERE id = ${eventId}`
      if (!eventRows.length) return false
      const event = eventRows[0]
      if (event.helper) return false
      const start = String(supportRequest.requestStartTime || event.time)
      const end = String(supportRequest.requestEndTime || event.endTime)
      const eventStart = String(event.time)
      const eventEnd = String(event.endTime)
      const canSplit = !event.isFlexible && !event.proposalType && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)
      const dateKey = String(event.date).slice(0, 8)
      if (canSplit && event.scheduleSource === 'stu_work') await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${dateKey}) ON CONFLICT DO NOTHING`

      if (canSplit && start > eventStart) {
        const beforeId = randomUUID()
        const beforeDate = `${dateKey}T${eventStart.replace(':', '')}00`
        await sql`
          INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, location, help_needed, repeat_group_id, for_who, schedule_source, is_schedule_exception, is_flexible)
          SELECT ${beforeId}, category, ${beforeDate}, day_label, ${eventStart}, ${start}, title, details, location, help_needed, repeat_group_id, for_who, schedule_source, TRUE, FALSE
          FROM team_events WHERE id = ${eventId}
        `
      }
      if (canSplit && end < eventEnd) {
        const afterId = randomUUID()
        const afterDate = `${dateKey}T${end.replace(':', '')}00`
        await sql`
          INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, location, help_needed, repeat_group_id, for_who, schedule_source, is_schedule_exception, is_flexible)
          SELECT ${afterId}, category, ${afterDate}, day_label, ${end}, ${eventEnd}, title, details, location, help_needed, repeat_group_id, for_who, schedule_source, TRUE, FALSE
          FROM team_events WHERE id = ${eventId}
        `
      }

      const approvedDate = canSplit ? `${dateKey}T${start.replace(':', '')}00` : String(event.date)
      const updated = await sql`
        UPDATE team_events
        SET event_date = ${approvedDate}, event_time = ${start}, end_time = ${end}, helper = ${String(supportRequest.requesterName)},
          helper_phone = ${String(supportRequest.requesterPhone)}, helper_email = ${String(supportRequest.requesterEmail)}, is_proposed = FALSE,
          is_schedule_exception = CASE WHEN ${canSplit} THEN TRUE ELSE is_schedule_exception END
        WHERE id = ${eventId} AND (helper IS NULL OR helper = '')
        RETURNING id
      `
      return updated.length > 0
    }

    async function findAvailabilityMatches(entries: AvailabilityInput[]) {
      const events = await sql`
        SELECT id, event_date AS date, day_label AS "dayLabel", event_time AS time, end_time AS "endTime",
          title, help_needed AS "helpNeeded", is_flexible AS "isFlexible"
        FROM team_events
        WHERE (helper IS NULL OR helper = '')
          AND help_needed NOT IN ('No help needed', 'No help needed, just sharing the schedule')
      `
      const matches = entries.flatMap((entry) => events
        .filter((event) => Boolean(event.isFlexible) || (String(event.date).slice(0, 8) === entry.day && timeMatchesAvailability(entry.time, String(event.time), String(event.endTime || ''))))
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
              { label: 'When', value: Boolean(event.isFlexible) ? 'Anytime' : `${String(event.dayLabel)} at ${readableTime(String(event.time))}` },
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
              { label: 'When', value: Boolean(event.isFlexible) ? 'Anytime' : `${String(event.dayLabel)} at ${readableTime(String(event.time))}` },
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
      const calendarId = clean(Array.isArray(request.query.calendar) ? request.query.calendar[0] : request.query.calendar, 100)
      if (calendarId) {
        const rows = await sql`
          SELECT id, event_date AS date, event_time AS time, end_time AS "endTime", title, details, location,
            help_needed AS "helpNeeded", is_flexible AS "isFlexible"
          FROM team_events
          WHERE id = ${calendarId} AND is_proposed = FALSE
          LIMIT 1
        `
        if (!rows.length) return sendError(response, 404, 'This calendar item is no longer available.')
        const event = rows[0]
        const dateKey = String(event.date).slice(0, 8)
        const isAllDay = Boolean(event.isFlexible) || !/^\d{2}:\d{2}$/.test(String(event.time))
        const timing = isAllDay
          ? [`DTSTART;VALUE=DATE:${dateKey}`, `DTEND;VALUE=DATE:${nextCalendarDay(dateKey)}`]
          : [`DTSTART:${calendarUtc(dateKey, String(event.time))}`, `DTEND:${calendarUtc(dateKey, String(event.endTime))}`]
        const calendar = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marys Team//Family Calendar//EN', 'CALSCALE:GREGORIAN',
          'BEGIN:VEVENT', `UID:${calendarText(event.id)}@marys-team`, ...timing,
          `SUMMARY:${calendarText(event.title)}`,
          `DESCRIPTION:${calendarText(`${String(event.details)} Support: ${String(event.helpNeeded)}`)}`,
          `LOCATION:${calendarText(String(event.location || '').toLocaleLowerCase() === 'home' ? process.env.HOME_ADDRESS || 'Mary and Stu’s home' : event.location || '')}`,
          'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n')
        response.setHeader('Content-Type', 'text/calendar; charset=utf-8')
        response.setHeader('Content-Disposition', `attachment; filename="marys-team-${calendarId.replace(/[^a-zA-Z0-9_-]/g, '')}.ics"`)
        return response.status(200).send(calendar)
      }
      const helperOwner = helperOwnerFromRequest(request)
      const events = await sql`
        SELECT team_events.id,
          CASE WHEN category = 'dad' THEN 'family' ELSE category END AS category,
          event_date AS date, day_label AS "dayLabel", COALESCE(pending.request_start_time, event_time) AS time,
          COALESCE(pending.request_end_time, end_time) AS "endTime", title, details, location,
          CASE WHEN help_needed = 'No help needed, just sharing the schedule' THEN 'No help needed' ELSE help_needed END AS "helpNeeded",
          helper, helper_phone AS "helperPhone", helper_email AS "helperEmail", repeat_group_id AS "repeatGroupId",
          schedule_source AS "scheduleSource", is_schedule_exception AS "isScheduleException",
          is_flexible AS "isFlexible", proposal_type AS "proposalType",
          COALESCE(NULLIF(for_who, ''), CASE WHEN category = 'appointment' THEN 'Mary' WHEN category = 'dad' THEN 'Stu' ELSE 'Family' END) AS "forWho",
          pending.requester_name AS "requesterName",
          (pending.id IS NOT NULL) AS "requestPending"
        FROM team_events
        LEFT JOIN LATERAL (
          SELECT id, requester_name, request_start_time, request_end_time
          FROM support_requests
          WHERE event_id = team_events.id AND status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
        ) pending ON TRUE
        WHERE is_proposed = FALSE OR pending.id IS NOT NULL
        ORDER BY event_date ASC, team_events.created_at ASC
      `
      const availability = await sql`
        SELECT id, name, phone, available_day AS day, available_time AS time, note, owner_key_hash AS "ownerKeyHash"
        FROM availability
        ORDER BY created_at DESC
      `
      const foodRows = await sql`
        SELECT DISTINCT SUBSTRING(event_date, 1, 8) AS date
        FROM team_events
        WHERE proposal_type = 'food' AND (is_proposed = FALSE OR EXISTS (
          SELECT 1 FROM support_requests WHERE event_id = team_events.id AND status = 'pending'
        ))
      `
      const foodReservedDates = foodRows.map((row) => String(row.date))
      const homeAddress = String(process.env.HOME_ADDRESS || '').trim().toLocaleLowerCase()
      const visibleEvents = isOrganizer ? events : events.filter((event) => event.proposalType !== 'stop_by')
      const publicEvents = visibleEvents.map((event) => isOrganizer ? event : {
        ...event,
        location: String(event.location || '').trim().toLocaleLowerCase() === 'home' || (homeAddress && String(event.location || '').trim().toLocaleLowerCase() === homeAddress) ? 'Home' : event.location,
        helperPhone: undefined,
        helperEmail: undefined,
      })
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
      const foodRowsSettings = await sql`SELECT weekdays, start_time AS "startTime", end_time AS "endTime", visit_start_time AS "visitStartTime", visit_end_time AS "visitEndTime", stu_in_town AS "stuInTown", gabby_in_town AS "gabbyInTown", spencer_in_town AS "spencerInTown", stu_in_town_dates AS "stuInTownDates", gabby_in_town_dates AS "gabbyInTownDates", spencer_in_town_dates AS "spencerInTownDates" FROM food_settings WHERE singleton = TRUE`
      const foodSettings: FoodSettings = foodRowsSettings.length ? {
        weekdays: String(foodRowsSettings[0].weekdays).split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        startTime: String(foodRowsSettings[0].startTime),
        endTime: String(foodRowsSettings[0].endTime),
      } : { weekdays: [1, 3], startTime: '14:00', endTime: '18:00' }
      const visitSettings: VisitSettings = { startTime: String(foodRowsSettings[0]?.visitStartTime || '10:00'), endTime: String(foodRowsSettings[0]?.visitEndTime || '17:00') }
      const familyInTown: FamilyInTown = { Stu: Boolean(foodRowsSettings[0]?.stuInTown ?? true), Gabby: Boolean(foodRowsSettings[0]?.gabbyInTown ?? true), Spencer: Boolean(foodRowsSettings[0]?.spencerInTown ?? false) }
      const parseDates = (value: unknown) => String(value || '').split(',').filter((date) => /^\d{8}$/.test(date))
      const familyInTownDates: FamilyInTownDates = { Stu: parseDates(foodRowsSettings[0]?.stuInTownDates), Gabby: parseDates(foodRowsSettings[0]?.gabbyInTownDates), Spencer: parseDates(foodRowsSettings[0]?.spencerInTownDates) }
      const careRows = await sql`SELECT id, name, phone, email, role, weekdays, start_time AS "startTime", end_time AS "endTime", auto_assign AS "autoAssign" FROM care_team ORDER BY name ASC`
      const careTeam = careRows.map((row) => ({ ...row, weekdays: String(row.weekdays || '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6), phone: isOrganizer ? row.phone : '', email: isOrganizer ? row.email : '' })) as CareTeamMember[]
      const savedSupportContacts = isOrganizer ? await sql`SELECT id, name, phone, email, 'contact_list' AS source, created_at AS "createdAt" FROM support_contacts ORDER BY created_at DESC` : []
      const requestContacts = isOrganizer ? await sql`
        SELECT DISTINCT ON (LOWER(requester_email), requester_phone)
          id, requester_name AS name, requester_phone AS phone, requester_email AS email,
          'request' AS source, created_at AS "createdAt"
        FROM support_requests
        WHERE TRIM(requester_name) <> '' AND (TRIM(requester_phone) <> '' OR TRIM(requester_email) <> '')
        ORDER BY LOWER(requester_email), requester_phone, created_at DESC
      ` : []
      const supportContacts = [...savedSupportContacts, ...requestContacts]
        .filter((contact, index, contacts) => contacts.findIndex((item) => {
          const emailMatches = String(contact.email || '').trim() && String(item.email || '').trim().toLocaleLowerCase() === String(contact.email || '').trim().toLocaleLowerCase()
          const phoneMatches = String(contact.phone || '').replace(/\D/g, '') && String(item.phone || '').replace(/\D/g, '') === String(contact.phone || '').replace(/\D/g, '')
          return Boolean(emailMatches || phoneMatches)
        }) === index)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      return response.status(200).json({ events: publicEvents, availability: publicAvailability, organizer: isOrganizer, stuWorkDefaults, foodSettings, visitSettings, familyInTown, familyInTownDates, foodReservedDates, careTeam, supportContacts })
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
          support_requests.requester_email AS "requesterEmail",
          support_requests.request_start_time AS "requestStartTime", support_requests.request_end_time AS "requestEndTime", support_requests.request_note AS "requestNote",
          support_requests.notification_sent_at AS "notificationSentAt", team_events.title,
          team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded", team_events.details, team_events.location,
          team_events.proposal_type AS "proposalType", team_events.is_flexible AS "isFlexible"
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
      const declineReason = clean(request.body?.declineReason, 500)
      if (!requestId || !['approve', 'decline'].includes(decision)) return sendError(response, 400, 'Choose a request and a decision.')
      if (decision === 'decline' && !declineReason) return sendError(response, 400, 'Please add a short reason so the person knows what changed.')
      const requests = await sql`
        SELECT support_requests.id, support_requests.event_id AS "eventId", support_requests.requester_name AS "requesterName",
          support_requests.requester_phone AS "requesterPhone", support_requests.requester_email AS "requesterEmail",
          support_requests.request_start_time AS "requestStartTime", support_requests.request_end_time AS "requestEndTime", support_requests.request_note AS "requestNote",
          team_events.title, team_events.event_date AS date, team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded", team_events.details, team_events.location,
          team_events.proposal_type AS "proposalType", team_events.is_flexible AS "isFlexible"
        FROM support_requests JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.id = ${requestId} AND support_requests.status = 'pending'
      `
      if (!requests.length) return sendError(response, 409, 'This request was already handled.')
      const supportRequest = requests[0]
      if (decision === 'approve') {
        try {
          if (!await approveSupportRequest(supportRequest)) return sendError(response, 409, 'This time already has someone confirmed.')
        } catch (error) {
          return sendError(response, 409, error instanceof Error ? error.message : 'This request could not be approved.')
        }
      }
      await sql`UPDATE support_requests SET status = ${decision === 'approve' ? 'approved' : 'declined'}, decline_reason = ${decision === 'decline' ? declineReason : null}, decided_at = NOW() WHERE id = ${requestId}`
      const emailSent = await notifySupportDecision(supportRequest, decision as 'approve' | 'decline', declineReason)
      return response.status(200).json({ id: requestId, decision, emailSent })
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
      const rawWeekdays: unknown[] = Array.isArray(request.body?.weekdays) ? request.body.weekdays : []
      const weekdays: number[] = [...new Set(
        rawWeekdays
          .map((value: unknown) => Number(value))
          .filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6),
      )].sort((a, b) => a - b)
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
          VALUES (${id}, 'family', ${eventDate}, ${dayLabel}, ${startTime}, ${endTime}, 'Stu at Work', 'Stu is working.', 'Spend time with Mary', 'Stu', 'stu_work', FALSE)
          ON CONFLICT (id) DO UPDATE SET event_date = EXCLUDED.event_date, day_label = EXCLUDED.day_label,
            event_time = EXCLUDED.event_time, end_time = EXCLUDED.end_time, title = EXCLUDED.title,
            details = EXCLUDED.details, help_needed = EXCLUDED.help_needed, for_who = EXCLUDED.for_who,
            schedule_source = EXCLUDED.schedule_source
          WHERE team_events.is_schedule_exception = FALSE
        `
      }))
      return response.status(200).json({ defaults })
    }

    if (action === 'saveFoodSettings') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to change food drop-off days.')
      const rawWeekdays: unknown[] = Array.isArray(request.body?.weekdays) ? request.body.weekdays : []
      const weekdays = [...new Set(rawWeekdays.map((value: unknown) => Number(value)).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
      const startTime = clean(request.body?.startTime, 20)
      const endTime = clean(request.body?.endTime, 20)
      if (!weekdays.length || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) return sendError(response, 400, 'Choose at least one food day and a valid time range.')
      await sql`
        INSERT INTO food_settings (singleton, weekdays, start_time, end_time, updated_at)
        VALUES (TRUE, ${weekdays.join(',')}, ${startTime}, ${endTime}, NOW())
        ON CONFLICT (singleton) DO UPDATE SET weekdays = EXCLUDED.weekdays, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, updated_at = NOW()
      `
      return response.status(200).json({ foodSettings: { weekdays, startTime, endTime } })
    }

    if (action === 'saveVisitSettings') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to change visiting hours.')
      const startTime = clean(request.body?.startTime, 20)
      const endTime = clean(request.body?.endTime, 20)
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) return sendError(response, 400, 'Choose valid visiting hours.')
      await sql`UPDATE food_settings SET visit_start_time = ${startTime}, visit_end_time = ${endTime}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ visitSettings: { startTime, endTime } })
    }

    if (action === 'saveFamilyInTown') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to update who is in town.')
      const person = clean(request.body?.person, 20)
      const inTown = request.body?.inTown === true
      if (!['Stu', 'Gabby', 'Spencer'].includes(person)) return sendError(response, 400, 'Choose Stu, Gabby, or Spencer.')
      if (person === 'Stu') await sql`UPDATE food_settings SET stu_in_town = ${inTown}, updated_at = NOW() WHERE singleton = TRUE`
      if (person === 'Gabby') await sql`UPDATE food_settings SET gabby_in_town = ${inTown}, updated_at = NOW() WHERE singleton = TRUE`
      if (person === 'Spencer') await sql`UPDATE food_settings SET spencer_in_town = ${inTown}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ person, inTown })
    }

    if (action === 'saveFamilyInTownDates') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to update in-town dates.')
      const person = clean(request.body?.person, 20)
      const dates: string[] = Array.isArray(request.body?.dates) ? [...new Set<string>(request.body.dates.map((date: unknown) => clean(date, 8)).filter((date: string) => /^\d{8}$/.test(date)))].slice(0, 60) : []
      if (!['Stu', 'Gabby', 'Spencer'].includes(person)) return sendError(response, 400, 'Choose Stu, Gabby, or Spencer.')
      const value = dates.sort().join(',')
      if (person === 'Stu') await sql`UPDATE food_settings SET stu_in_town_dates = ${value}, updated_at = NOW() WHERE singleton = TRUE`
      if (person === 'Gabby') await sql`UPDATE food_settings SET gabby_in_town_dates = ${value}, updated_at = NOW() WHERE singleton = TRUE`
      if (person === 'Spencer') await sql`UPDATE food_settings SET spencer_in_town_dates = ${value}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ person, dates })
    }

    if (action === 'saveFamilyBusyDates') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to update work or away days.')
      const person = clean(request.body?.person, 20)
      const dates: string[] = Array.isArray(request.body?.dates) ? [...new Set<string>(request.body.dates.map((date: unknown) => clean(date, 8)).filter((date: string) => /^\d{8}$/.test(date)))].slice(0, 60) : []
      const startTime = clean(request.body?.startTime, 5)
      const endTime = clean(request.body?.endTime, 5)
      const rangeStart = clean(request.body?.rangeStart, 8)
      const rangeEnd = clean(request.body?.rangeEnd, 8)
      if (!['Stu', 'Gabby', 'Spencer'].includes(person)) return sendError(response, 400, 'Choose Stu, Gabby, or Spencer.')
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) return sendError(response, 400, 'Choose valid starting and ending times.')
      if (!/^\d{8}$/.test(rangeStart) || !/^\d{8}$/.test(rangeEnd) || rangeEnd < rangeStart) return sendError(response, 400, 'Choose a valid calendar range.')
      const tracked = await sql`
        SELECT id, SUBSTRING(event_date, 1, 8) AS day, schedule_source AS "scheduleSource"
        FROM team_events
        WHERE for_who = ${person}
          AND SUBSTRING(event_date, 1, 8) BETWEEN ${rangeStart} AND ${rangeEnd}
          AND (schedule_source = 'family_busy' OR (${person} = 'Stu' AND schedule_source = 'stu_work'))
      `
      const selected = new Set(dates)
      for (const row of tracked) {
        const day = String(row.day)
        if (!selected.has(day)) {
          if (row.scheduleSource === 'stu_work') await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${day}) ON CONFLICT DO NOTHING`
          await sql`DELETE FROM team_events WHERE id = ${String(row.id)}`
        }
      }
      for (const day of dates) {
        const matching = tracked.find((row) => String(row.day) === day && selected.has(day))
        const isoDate = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`
        const dayLabel = new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        const title = person === 'Stu' ? 'Stu at Work' : `${person} Work or Away`
        if (!matching) {
          await sql`INSERT INTO team_events (id, category, for_who, event_date, day_label, event_time, end_time, title, details, location, help_needed, schedule_source, is_schedule_exception) VALUES (${randomUUID()}, 'family', ${person}, ${`${day}T${startTime.replace(':', '')}00`}, ${dayLabel}, ${startTime}, ${endTime}, ${title}, ${`${person} is working.`}, 'Home', 'Spend time with Mary', 'family_busy', TRUE)`
        }
      }
      return response.status(200).json({ saved: dates.length })
    }

    if (action === 'addEvent' || action === 'addEventBatch') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const items: unknown[] = action === 'addEventBatch'
        ? (Array.isArray(request.body?.events) ? request.body.events.slice(0, 52) : [])
        : [request.body?.event]
      const events = items.map((item) => parseEventInput(item as Partial<TeamEventInput> | undefined))
      if (!events.length || events.some((event) => !eventIsValid(event))) return sendError(response, 400, 'Please complete the required schedule details, including an ending time.')
      const savedRows = await Promise.all(events.map((event) => sql`
        INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, location, help_needed, helper, helper_phone, helper_email, repeat_group_id, for_who, schedule_source, is_flexible)
        VALUES (${event.id}, ${event.category}, ${event.date}, ${event.dayLabel}, ${event.time}, ${event.endTime}, ${event.title}, ${event.details}, ${event.location || null}, ${event.helpNeeded}, ${event.helper || null}, ${event.helperPhone || null}, ${event.helperEmail || null}, ${event.repeatGroupId || null}, ${event.forWho}, ${event.scheduleSource || null}, ${event.isFlexible})
        ON CONFLICT (id) DO UPDATE SET
          category = EXCLUDED.category, event_date = EXCLUDED.event_date, day_label = EXCLUDED.day_label,
          event_time = EXCLUDED.event_time, end_time = EXCLUDED.end_time, title = EXCLUDED.title,
          details = EXCLUDED.details, location = EXCLUDED.location, help_needed = EXCLUDED.help_needed,
          helper = EXCLUDED.helper, helper_phone = EXCLUDED.helper_phone, helper_email = EXCLUDED.helper_email,
          repeat_group_id = EXCLUDED.repeat_group_id, for_who = EXCLUDED.for_who, schedule_source = EXCLUDED.schedule_source, is_flexible = EXCLUDED.is_flexible
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, helper_phone AS "helperPhone", helper_email AS "helperEmail",
          repeat_group_id AS "repeatGroupId", for_who AS "forWho", schedule_source AS "scheduleSource", is_flexible AS "isFlexible"
      `))
      const driverNotifications = await Promise.all(events.filter((event) => event.helperEmail).map(notifyAssignedDriver))
      return response.status(201).json({ events: savedRows.flat(), driverEmailSent: driverNotifications.length ? driverNotifications.every(Boolean) : null })
    }

    if (action === 'assignCoverage') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to assign someone.')
      const eventId = clean(request.body?.eventId, 100)
      const helper = clean(request.body?.helper, 120)
      const helperPhone = clean(request.body?.helperPhone, 40)
      const helperEmail = clean(request.body?.helperEmail, 200).toLocaleLowerCase()
      if (!eventId || !helper) return sendError(response, 400, 'Choose someone to add to this time.')
      const rows = await sql`
        UPDATE team_events
        SET helper = ${helper}, helper_phone = ${helperPhone || null}, helper_email = ${helperEmail || null}
        WHERE id = ${eventId}
        RETURNING id
      `
      if (!rows.length) return sendError(response, 404, 'This schedule item is no longer available.')
      return response.status(200).json({ saved: true })
    }

    if (action === 'saveCareTeamMember') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to update the care team.')
      const id = clean(request.body?.member?.id, 100) || randomUUID()
      const name = clean(request.body?.member?.name, 120)
      const phone = clean(request.body?.member?.phone, 40)
      const email = clean(request.body?.member?.email, 200).toLocaleLowerCase()
      const role = clean(request.body?.member?.role, 40) || 'Helper'
      const weekdays = Array.isArray(request.body?.member?.weekdays) ? request.body.member.weekdays.map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6) : []
      const startTime = clean(request.body?.member?.startTime, 5)
      const endTime = clean(request.body?.member?.endTime, 5)
      const autoAssign = Boolean(request.body?.member?.autoAssign)
      if (!name || !weekdays.length || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= startTime) return sendError(response, 400, 'Add a name, at least one day, and valid hours.')
      await sql`
        INSERT INTO care_team (id, name, phone, email, role, weekdays, start_time, end_time, auto_assign)
        VALUES (${id}, ${name}, ${phone}, ${email}, ${role}, ${weekdays.join(',')}, ${startTime}, ${endTime}, ${autoAssign})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email, role = EXCLUDED.role, weekdays = EXCLUDED.weekdays, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, auto_assign = EXCLUDED.auto_assign
      `
      return response.status(200).json({ member: { id, name, phone, email, role, weekdays, startTime, endTime, autoAssign } })
    }

    if (action === 'addSupportContact') {
      const name = clean(request.body?.name, 120)
      const phone = clean(request.body?.phone, 40)
      const email = clean(request.body?.email, 200).toLocaleLowerCase()
      if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return sendError(response, 400, 'Please enter your name, phone number, and email address.')
      const existing = await sql`SELECT id FROM support_contacts WHERE LOWER(email) = ${email} OR phone = ${phone} ORDER BY created_at DESC LIMIT 1`
      const id = existing[0]?.id || randomUUID()
      if (existing.length) {
        await sql`UPDATE support_contacts SET name = ${name}, phone = ${phone}, email = ${email} WHERE id = ${id}`
      } else {
        await sql`INSERT INTO support_contacts (id, name, phone, email) VALUES (${id}, ${name}, ${phone}, ${email})`
      }
      return response.status(201).json({ contact: { id, name, phone, email } })
    }

    if (action === 'updateEvent') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const event = parseEventInput(request.body?.event as Partial<TeamEventInput> | undefined)
      if (!eventIsValid(event)) return sendError(response, 400, 'Please complete the required schedule details, including an ending time.')
      const previousRows = await sql`
        SELECT event_date AS date, schedule_source AS "scheduleSource", helper,
          helper_phone AS "helperPhone", helper_email AS "helperEmail"
        FROM team_events
        WHERE id = ${event.id}
      `
      const previous = previousRows[0]
      const saveContact = async (name: unknown, phone: unknown, email: unknown) => {
        const contactName = clean(name, 120)
        const contactPhone = clean(phone, 40)
        const contactEmail = clean(email, 200).toLocaleLowerCase()
        if (!contactName || (!contactPhone && !contactEmail)) return
        const existing = await sql`
          SELECT id FROM support_contacts
          WHERE (${contactEmail} <> '' AND LOWER(email) = ${contactEmail})
             OR (${contactPhone} <> '' AND phone = ${contactPhone})
          ORDER BY created_at DESC
          LIMIT 1
        `
        if (existing.length) {
          await sql`
            UPDATE support_contacts
            SET name = ${contactName},
              phone = CASE WHEN ${contactPhone} <> '' THEN ${contactPhone} ELSE phone END,
              email = CASE WHEN ${contactEmail} <> '' THEN ${contactEmail} ELSE email END
            WHERE id = ${String(existing[0].id)}
          `
        } else {
          await sql`
            INSERT INTO support_contacts (id, name, phone, email)
            VALUES (${randomUUID()}, ${contactName}, ${contactPhone}, ${contactEmail})
          `
        }
      }
      await saveContact(previous?.helper, previous?.helperPhone, previous?.helperEmail)
      await saveContact(event.helper, event.helperPhone, event.helperEmail)
      const rows = await sql`
        UPDATE team_events
        SET category = ${event.category}, event_date = ${event.date}, day_label = ${event.dayLabel},
          event_time = ${event.time}, end_time = ${event.endTime}, title = ${event.title},
          details = ${event.details}, location = ${event.location || null}, help_needed = ${event.helpNeeded}, for_who = ${event.forWho}, is_flexible = ${event.isFlexible},
          helper = CASE WHEN ${isNoSupport(event.helpNeeded)} THEN NULL ELSE ${event.helper || null} END,
          helper_phone = CASE WHEN ${isNoSupport(event.helpNeeded)} THEN NULL ELSE ${event.helperPhone || null} END,
          helper_email = CASE WHEN ${isNoSupport(event.helpNeeded)} THEN NULL ELSE ${event.helperEmail || null} END,
          is_schedule_exception = CASE WHEN schedule_source = 'stu_work' THEN TRUE ELSE is_schedule_exception END
        WHERE id = ${event.id}
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, helper_phone AS "helperPhone", helper_email AS "helperEmail", repeat_group_id AS "repeatGroupId", for_who AS "forWho",
          schedule_source AS "scheduleSource", is_schedule_exception AS "isScheduleException", is_flexible AS "isFlexible"
      `
      if (!rows.length) return sendError(response, 404, 'This schedule item could not be found.')
      if (previous?.scheduleSource === 'stu_work') {
        const originalDate = String(previous.date).slice(0, 8)
        const updatedDate = event.date.slice(0, 8)
        await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${originalDate}) ON CONFLICT DO NOTHING`
        if (updatedDate !== originalDate) await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${updatedDate}) ON CONFLICT DO NOTHING`
      }
      if (isNoSupport(event.helpNeeded)) await sql`UPDATE support_requests SET status = 'declined', decided_at = NOW() WHERE event_id = ${event.id} AND status = 'pending'`
      if (event.helper) await sql`UPDATE support_requests SET status = 'declined', decided_at = NOW() WHERE event_id = ${event.id} AND status = 'pending'`
      const previousHelperEmail = String(previous?.helperEmail || '').trim().toLocaleLowerCase()
      const currentHelperEmail = String(event.helperEmail || '').trim().toLocaleLowerCase()
      const removalEmailSent = previousHelperEmail && previousHelperEmail !== currentHelperEmail
        ? await notifyAssignmentRemoved(previous as Record<string, unknown>, event)
        : null
      const shouldNotifyDriver = Boolean(event.helperEmail) && String(previous?.helperEmail || '').toLocaleLowerCase() !== event.helperEmail
      const driverEmailSent = shouldNotifyDriver ? await notifyAssignedDriver(event) : null
      return response.status(200).json({ event: rows[0], driverEmailSent, removalEmailSent })
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
          support_requests.requester_phone AS "requesterPhone", support_requests.requester_email AS "requesterEmail",
          support_requests.request_start_time AS "requestStartTime", support_requests.request_end_time AS "requestEndTime", support_requests.request_note AS "requestNote", team_events.title,
          team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded", team_events.details, team_events.location,
          team_events.proposal_type AS "proposalType", team_events.is_flexible AS "isFlexible"
        FROM support_requests
        JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.approval_token = ${token}
      `
      if (!rows.length) return sendError(response, 404, 'This request link is not available.')
      return response.status(200).json({ request: rows[0] })
    }

    if (action === 'approveRequest' || action === 'decideApprovalRequest') {
      const token = clean(request.body?.token, 120)
      const decision = action === 'approveRequest' ? 'approve' : clean(request.body?.decision, 20)
      const declineReason = clean(request.body?.declineReason, 500)
      if (!['approve', 'decline'].includes(decision)) return sendError(response, 400, 'Choose approve or decline.')
      if (decision === 'decline' && !declineReason) return sendError(response, 400, 'Please add a short reason so the person knows what changed.')
      const requests = await sql`
        SELECT support_requests.id, support_requests.event_id AS "eventId", support_requests.requester_name AS "requesterName",
          support_requests.requester_phone AS "requesterPhone", support_requests.requester_email AS "requesterEmail",
          support_requests.request_start_time AS "requestStartTime", support_requests.request_end_time AS "requestEndTime", support_requests.request_note AS "requestNote",
          team_events.title, team_events.event_date AS date, team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded", team_events.details, team_events.location,
          team_events.proposal_type AS "proposalType", team_events.is_flexible AS "isFlexible"
        FROM support_requests JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.approval_token = ${token} AND support_requests.status = 'pending'
      `
      if (!requests.length) return sendError(response, 409, 'This request was already handled or is no longer available.')
      const supportRequest = requests[0]
      if (decision === 'approve') {
        try {
          if (!await approveSupportRequest(supportRequest)) return sendError(response, 409, 'This time already has someone confirmed.')
        } catch (error) {
          return sendError(response, 409, error instanceof Error ? error.message : 'This request could not be approved.')
        }
      }
      await sql`UPDATE support_requests SET status = ${decision === 'approve' ? 'approved' : 'declined'}, decline_reason = ${decision === 'decline' ? declineReason : null}, decided_at = NOW() WHERE id = ${String(supportRequest.id)}`
      const emailSent = await notifySupportDecision(supportRequest, decision as 'approve' | 'decline', declineReason)
      return response.status(200).json({ id: supportRequest.eventId, helper: decision === 'approve' ? supportRequest.requesterName : null, decision, emailSent })
    }

    if (action === 'retryPendingNotifications') {
      const pendingRequests = await sql`
        SELECT support_requests.id, support_requests.approval_token AS "approvalToken",
          support_requests.requester_name AS "requesterName", support_requests.requester_phone AS "requesterPhone",
          support_requests.requester_email AS "requesterEmail",
          support_requests.request_start_time AS "requestStartTime", support_requests.request_end_time AS "requestEndTime", support_requests.request_note AS "requestNote",
          team_events.title, team_events.day_label AS "dayLabel", team_events.event_time AS time,
          team_events.end_time AS "endTime", team_events.help_needed AS "helpNeeded", team_events.details, team_events.location,
          team_events.proposal_type AS "proposalType", team_events.is_flexible AS "isFlexible"
        FROM support_requests
        JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.status = 'pending' AND support_requests.notification_sent_at IS NULL
        ORDER BY support_requests.created_at ASC
        LIMIT 5
      `
      const results = await Promise.all(pendingRequests.map((pendingRequest) => notifySupportRequest(pendingRequest as SupportRequestNotification)))
      return response.status(200).json({ pending: pendingRequests.length, sent: results.filter(Boolean).length })
    }

    if (action === 'proposePlan') {
      const type = clean(request.body?.type, 20)
      const name = clean(request.body?.name, 120)
      const phone = clean(request.body?.phone, 40)
      const email = clean(request.body?.email, 200).toLocaleLowerCase()
      const date = clean(request.body?.date, 10)
      const time = clean(request.body?.time, 5)
      const endTime = clean(request.body?.endTime, 5)
      const submittedDetails = clean(request.body?.details, 1000)
      if (type !== 'food') return sendError(response, 400, 'Only food drop-offs can be requested from the public page.')
      if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return sendError(response, 400, 'Please enter your name, phone number, and email address.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !/^\d{2}:\d{2}$/.test(endTime) || endTime <= time) return sendError(response, 400, 'Choose a date and an ending time that is later than the starting time.')
      if (date < phoenixToday()) return sendError(response, 400, 'Choose today or a future date.')
      if (type === 'food') {
        const dateKey = date.replaceAll('-', '')
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
        const settingRows = await sql`SELECT weekdays, start_time AS "startTime", end_time AS "endTime" FROM food_settings WHERE singleton = TRUE`
        const allowedDays = String(settingRows[0]?.weekdays || '1,3').split(',').map(Number)
        const foodStart = String(settingRows[0]?.startTime || '14:00')
        const foodEnd = String(settingRows[0]?.endTime || '18:00')
        if (!allowedDays.includes(weekday)) return sendError(response, 400, 'Please choose one of the family’s available food drop-off days.')
        if (time < foodStart || endTime > foodEnd) return sendError(response, 400, `Choose a food drop-off time between ${readableTime(foodStart)} and ${readableTime(foodEnd)}.`)
        const reserved = await sql`SELECT id FROM team_events WHERE proposal_type = 'food' AND SUBSTRING(event_date, 1, 8) = ${dateKey} AND (is_proposed = FALSE OR EXISTS (SELECT 1 FROM support_requests WHERE event_id = team_events.id AND status = 'pending')) LIMIT 1`
        if (reserved.length) return sendError(response, 409, 'Someone is already bringing food that day. Please choose another open date.')
        const conflicts = await sql`
          SELECT id FROM team_events
          WHERE for_who = 'Mary' AND proposal_type IS NULL AND is_flexible = FALSE
            AND SUBSTRING(event_date, 1, 8) = ${dateKey} AND event_time < ${endTime} AND end_time > ${time}
          LIMIT 1
        `
        if (conflicts.length) return sendError(response, 409, 'Mary has an appointment during that time. Please choose another time or date.')
      }
      if (type === 'stop_by') {
        const dateKey = date.replaceAll('-', '')
        const conflicts = await sql`
          SELECT team_events.id FROM team_events
          WHERE SUBSTRING(event_date, 1, 8) = ${dateKey}
            AND (
              is_proposed = FALSE
              OR EXISTS (
                SELECT 1 FROM support_requests
                WHERE support_requests.event_id = team_events.id AND support_requests.status = 'pending'
              )
            )
          LIMIT 1
        `
        if (conflicts.length) return sendError(response, 409, 'That day already has something scheduled. Stop By requests are available only on completely open days.')
      }

      const eventId = randomUUID()
      const requestId = randomUUID()
      const approvalToken = randomUUID()
      const eventDate = `${date.replaceAll('-', '')}T${time.replace(':', '')}00`
      const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const title = type === 'food' ? 'Food drop-off' : 'Stop by'
      const details = submittedDetails || (type === 'food' ? 'Food drop-off. Text Mary directly if you have any questions.' : defaultEventDetails)
      const rows = await sql`
        WITH inserted_event AS (
          INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, help_needed, for_who, is_proposed, proposal_type)
          VALUES (${eventId}, 'company', ${eventDate}, ${dayLabel}, ${time}, ${endTime}, ${title}, ${details}, 'No help needed', 'Mary', TRUE, ${type})
          RETURNING id
        )
        INSERT INTO support_requests (id, event_id, requester_name, requester_phone, requester_email, approval_token)
        SELECT ${requestId}, id, ${name}, ${phone}, ${email}, ${approvalToken} FROM inserted_event
        RETURNING id
      `
      if (!rows.length) return sendError(response, 500, 'We could not save this request. Please try again.')
      const emailSent = await notifySupportRequest({ id: requestId, approvalToken, requesterName: name, requesterPhone: phone, requesterEmail: email, title, dayLabel, time, endTime, helpNeeded: 'No help needed', details, proposalType: type })
      return response.status(202).json({ id: requestId, status: 'requested', emailSent })
    }

    if (action === 'claimEvent') {
      const eventId = clean(request.body?.eventId, 80)
      const name = clean(request.body?.name, 120)
      const phone = clean(request.body?.phone, 40)
      const email = clean(request.body?.email, 200).toLocaleLowerCase()
      const requestStartTime = clean(request.body?.startTime, 5)
      const requestEndTime = clean(request.body?.endTime, 5)
      const requestNote = clean(request.body?.note, 1000)
      if (!eventId || !name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return sendError(response, 400, 'Please enter your name, phone number, and email address.')
      const availableEvents = await sql`
        SELECT id, title, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", help_needed AS "helpNeeded", helper, is_flexible AS "isFlexible"
        FROM team_events WHERE id = ${eventId}
      `
      if (!availableEvents.length) return sendError(response, 404, 'This schedule item could not be found.')
      const selectedEvent = availableEvents[0]
      if (isNoSupport(String(selectedEvent.helpNeeded))) return sendError(response, 400, 'This time is marked busy and is not accepting support requests.')
      if (selectedEvent.helper) return sendError(response, 409, 'Someone else has already filled this time.')
      if (!selectedEvent.isFlexible && (!/^\d{2}:\d{2}$/.test(requestStartTime) || !/^\d{2}:\d{2}$/.test(requestEndTime) || requestStartTime < String(selectedEvent.time) || requestEndTime > String(selectedEvent.endTime) || requestEndTime <= requestStartTime)) {
        return sendError(response, 400, 'Choose a time within the open window.')
      }

      const requestId = randomUUID()
      const approvalToken = randomUUID()
      const rows = await sql`
        INSERT INTO support_requests (id, event_id, requester_name, requester_phone, requester_email, approval_token, request_start_time, request_end_time, request_note)
        VALUES (${requestId}, ${eventId}, ${name}, ${phone}, ${email}, ${approvalToken}, ${requestStartTime || null}, ${requestEndTime || null}, ${requestNote})
        ON CONFLICT DO NOTHING
        RETURNING id
      `
      if (!rows.length) return sendError(response, 409, 'Someone has already requested this time. Mary or Stu can approve that request first.')
      const emailSent = await notifySupportRequest({ id: requestId, approvalToken, requesterName: name, requesterPhone: phone, requesterEmail: email, title: selectedEvent.title, dayLabel: selectedEvent.dayLabel, time: selectedEvent.time, endTime: selectedEvent.endTime, helpNeeded: selectedEvent.helpNeeded, isFlexible: selectedEvent.isFlexible, requestStartTime, requestEndTime, requestNote })
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
