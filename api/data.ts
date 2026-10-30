import { neon } from '@neondatabase/serverless'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { sendTeamNotification } from '../lib/email.js'
import { queueNotification, processOutbox, notificationSummary, supersedeNotifications, supersedeEventEmails } from '../lib/outbox.js'
import { scheduleEmailJob } from '../lib/email-queue.js'
import { saveTemplate, previewTemplate, applyTemplate } from '../lib/templates.js'
import { publicSchedule } from '../lib/public-schedule.js'
import type { TeamEvent as ScheduleEvent, CareTeamMember as ScheduleCareTeam } from '../lib/schedule.js'
import { defaultVisitorPreferences, signupVisitorPreferences, nurseOnDate, nameKey } from '../lib/care.js'

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
  helperPersonId?: string
  forWho: string
  repeatGroupId?: string
  scheduleSource?: string
  isFlexible?: boolean
}

type AvailabilityInput = {
  id: string
  name: string
  phone: string
  email?: string
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
type FoodPreferenceType = 'restaurant' | 'homemade' | 'grocery'
type FoodPreference = { id: string; type: FoodPreferenceType; name: string; items: string[]; note: string }
type FoodPreferences = { overview: string; avoid: string; suggestions: FoodPreference[] }
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


function clean(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

const defaultFoodPreferences: FoodPreferences = {
  overview: 'Meals are for two people. We generally enjoy whole foods with a protein, vegetables, and a grain. Chicken is our first choice. Steak or beef is welcome when it fits the dish.',
  avoid: 'No pork.',
  suggestions: [{ id: 'mendocino-farms', type: 'restaurant', name: 'Mendocino Farms', items: [], note: '' }],
}

function parseFoodSuggestions(value: unknown): FoodPreference[] {
  try {
    const parsed = JSON.parse(String(value || '[]'))
    if (!Array.isArray(parsed)) return defaultFoodPreferences.suggestions
    return parsed.map((entry) => ({
      id: clean(entry?.id, 100) || randomUUID(),
      type: ['restaurant', 'homemade', 'grocery'].includes(entry?.type) ? entry.type as FoodPreferenceType : 'homemade',
      name: clean(entry?.name, 160),
      items: Array.isArray(entry?.items) ? entry.items.map((item: unknown) => clean(item, 160)).filter(Boolean).slice(0, 20) : [],
      note: clean(entry?.note, 300),
    })).filter((entry) => entry.name).slice(0, 30)
  } catch {
    return defaultFoodPreferences.suggestions
  }
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
  return value === 'Group event' || value === 'No help needed' || value === 'No help needed, just sharing the schedule'
}

const defaultEventDetails = 'Please sign up through this website and wait for confirmation. No social visits or drop-ins. Thank you for respecting any schedule changes.'

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
    helperPersonId: clean(item?.helperPersonId, 100),
    forWho,
    repeatGroupId: clean(item?.repeatGroupId, 80),
    scheduleSource: clean(item?.scheduleSource, 40),
    isFlexible: Boolean(item?.isFlexible),
  }
}

function eventIsValid(event: ReturnType<typeof parseEventInput>) {
  const validTime = event.isFlexible ? event.time === 'anytime' && event.endTime === 'anytime' : event.endTime > event.time
  const validDriver = !event.helperEmail || /^\S+@\S+\.\S+$/.test(event.helperEmail)
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
    const sql = database()
    await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS food_blocked_dates TEXT NOT NULL DEFAULT ''`
    const isOrganizer = organizerAuthorized(request)
    const privateSettings = await sql`SELECT home_address AS address FROM food_settings WHERE singleton = TRUE`
    const familyHomeAddress = String(privateSettings[0]?.address || process.env.HOME_ADDRESS || '').trim()

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
      await queueNotification(sql, key, details, recipients)
      return processOutbox(sql, key)
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

    async function notifySupportDecision(supportRequest: Record<string, unknown>, decision: 'approve' | 'decline', declineReason = '') {
      await supersedeNotifications(sql, `request:${String(supportRequest.id)}`)
      if (decision === 'decline') await supersedeNotifications(sql, `decision:${String(supportRequest.id)}:approve`)
      const email = String(supportRequest.requesterEmail || '')
      if (!email) return false
      const approved = decision === 'approve'
      const proposalType = String(supportRequest.proposalType || '')
      const isPlan = proposalType === 'food' || proposalType === 'stop_by'
      const savedLocation = String(supportRequest.location || '')
      const approvedLocation = proposalType === 'food' || savedLocation.toLocaleLowerCase() === 'home'
        ? (familyHomeAddress || 'Mary and Stu’s home')
        : savedLocation
      if (!approved) {
        const name = String(supportRequest.requesterName || '').trim()
        return notifyOnce(`decision:${String(supportRequest.id)}:${decision}`, {
          subject: "Mary's Team: Mary's schedule has changed",
          heading: "Mary's schedule has changed",
          intro: `${name ? `${name}, ` : ''}Mary no longer needs help at the scheduled time below. Thank you so much for your support. ${declineReason ? `Reason: ${declineReason} ` : ''}Please do not come to the home for this cancelled time; Mary is not receiving visitors. New practical support opportunities will appear on the website. If you would still like to help, please share Mary’s GoFundMe with friends and family.`,
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
        intro: `Thank you for being part of Mary’s Team. The family approved your ${proposalType === 'food' ? 'food drop-off. Please leave the food at your selected drop-off location; this does not include a social visit' : 'practical support request. Please provide only the agreed support'}. Please respect any later changes or cancellations.`,
        rows: [
          { label: 'Schedule item', value: String(supportRequest.title) },
          { label: 'When', value: Boolean(supportRequest.isFlexible) ? 'Anytime' : `${String(supportRequest.dayLabel)} from ${readableTime(String(supportRequest.requestStartTime || supportRequest.time))} to ${readableTime(String(supportRequest.requestEndTime || supportRequest.endTime))}` },
          ...(approvedLocation ? [{ label: 'Where', value: approvedLocation }] : []),
          ...(familyHomeAddress && approvedLocation !== familyHomeAddress ? [{ label: 'Home / pickup address (private)', value: familyHomeAddress }] : []),
          ...(isPlan ? [{ label: 'Details', value: String(supportRequest.details || 'No additional details.') }] : [{ label: 'Support requested', value: String(supportRequest.helpNeeded) }]),
          { label: 'Mary', value: 'mary@hcttravel.com' },
          { label: 'Stu', value: 'ancalaeyes@aol.com' },
        ],
        actionUrl: `https://marys-team.vercel.app/api/data?calendar=${encodeURIComponent(String(supportRequest.eventId))}`,
        actionLabel: 'Add to my calendar',
      }, [email])
    }

    async function closePendingForEvent(eventId: string, reason: string, confirmedEmail = '') {
      const pending = await sql`SELECT r.id, r.event_id AS "eventId", r.requester_name AS "requesterName", r.requester_phone AS "requesterPhone", r.requester_email AS "requesterEmail", r.request_start_time AS "requestStartTime", r.request_end_time AS "requestEndTime", e.title, e.day_label AS "dayLabel", e.event_time AS time, e.end_time AS "endTime", e.is_flexible AS "isFlexible", e.proposal_type AS "proposalType" FROM support_requests r JOIN team_events e ON e.id = r.event_id WHERE r.event_id = ${eventId} AND r.status = 'pending'`
      await sql`UPDATE support_requests SET status = CASE WHEN ${confirmedEmail} <> '' AND LOWER(requester_email) = ${confirmedEmail} THEN 'approved' ELSE 'declined' END, decided_at = NOW() WHERE event_id = ${eventId} AND status = 'pending'`
      await Promise.all(pending.filter((row) => String(row.requesterEmail || '').toLowerCase() !== confirmedEmail).map((row) => notifySupportDecision(row, 'decline', reason)))
    }

    async function notifyAssignedDriver(event: ReturnType<typeof parseEventInput>, changed = false) {
      if (!event.helper || !event.helperEmail) return false
      const isRide = event.helpNeeded === 'Need a ride'
      const destination = event.location.toLocaleLowerCase() === 'home'
        ? (familyHomeAddress || 'Mary and Stu’s home')
        : event.location
      const version = createHmac('sha256', 'schedule-version').update(JSON.stringify([event.date, event.time, event.endTime, event.title, event.details, event.location, event.helpNeeded])).digest('hex').slice(0, 20)
      const key = `assignment:${event.id}:${event.helperEmail}:${version}`
      await supersedeNotifications(sql, `assignment:${event.id}:`, key)
      await supersedeEventEmails(sql, event.id, key)
      return notifyOnce(key, {
        subject: changed ? `Mary’s Team: your scheduled help has changed — ${event.title}` : `Mary's Team: you are confirmed for ${event.title}`,
        heading: changed ? 'Your scheduled help has changed' : isRide ? 'You are confirmed as the driver' : 'You are confirmed',
        intro: changed ? 'Please use the updated time, location, and details below. This replaces the previous schedule. Any later cancellation will also arrive by email.' : isRide ? `Thank you, ${event.helper}. The family has added you as the confirmed driver for this appointment.` : `Thank you, ${event.helper}. The family has added you to the schedule.`,
        rows: [
          { label: isRide ? 'Appointment' : 'Schedule item', value: event.title },
          { label: 'Details', value: event.details },
          { label: 'When', value: `${event.dayLabel} from ${readableTime(event.time)} to ${readableTime(event.endTime)}` },
          ...(!isRide ? [{ label: 'Support', value: event.helpNeeded }] : []),
          ...(destination ? [{ label: 'Where', value: destination }] : []),
          ...(familyHomeAddress && destination !== familyHomeAddress ? [{ label: 'Home / pickup address (private)', value: familyHomeAddress }] : []),
          { label: 'Mary', value: 'mary@hcttravel.com' },
          { label: 'Stu', value: 'ancalaeyes@aol.com' },
        ],
        actionUrl: `https://marys-team.vercel.app/api/data?calendar=${encodeURIComponent(event.id)}`,
        actionLabel: 'Add to my calendar',
      }, [event.helperEmail])
    }

    async function notifyAssignmentRemoved(previous: Record<string, unknown>, event: ReturnType<typeof parseEventInput>) {
      await supersedeNotifications(sql, `assignment:${event.id}:`)
      await supersedeEventEmails(sql, event.id)
      const email = String(previous.helperEmail || '').trim().toLocaleLowerCase()
      if (!email) return false
      const name = String(previous.helper || '').trim()
      return notifyOnce(`assignment-removed:${event.id}:${email}:${event.date}:${event.time}:${event.endTime}`, {
        subject: "Mary's Team: Mary's schedule has changed",
        heading: "Mary's schedule has changed",
        intro: `${name ? `${name}, ` : ''}Mary no longer needs help at the scheduled time below. Thank you so much for your support. Please do not come to the home for this cancelled time; Mary is not receiving visitors. New practical support opportunities will appear on the website. If you would still like to help, please share Mary’s GoFundMe with friends and family.`,
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
      const matchReservations = await Promise.all(matches.map(async (match) => {
        const key = `match:${match.entry.id}:${match.event.id}`
        return { key, reserved: await reserveNotification(key) }
      }))
      const reservedKeys = matchReservations.filter((result) => result.reserved).map((result) => result.key)
      const person = entries[0]
      const dates = entries.map((entry) => readableDay(entry.day))
      const shownDates = dates.slice(0, 10).join(', ') + (dates.length > 10 ? `, plus ${dates.length - 10} more` : '')

      try {
        const sent = await notifyOnce(availabilityKey, {
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
        const sent = await notifyOnce(`matches:${reservedKeys.join(':')}`, {
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
          WHERE id = ${calendarId} AND is_proposed = FALSE AND (${isOrganizer} OR help_needed = 'Group event' OR COALESCE(helper, '') <> '' OR help_needed NOT IN ('No help needed', 'No help needed, just sharing the schedule'))
          LIMIT 1
        `
        if (!rows.length) return sendError(response, 404, 'This calendar item is no longer available.')
        const event = rows[0]
        if (!isOrganizer && String(event.helpNeeded) !== 'Group event') {
          event.title = 'Confirmed care commitment'
          event.details = 'Use your confirmation email for the location and private instructions.'
          event.location = 'Private address is in your confirmation email'
          event.helpNeeded = ''
        }
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
          `LOCATION:${calendarText((String(event.location || '').toLocaleLowerCase() === 'home' || Boolean(familyHomeAddress && String(event.location || '').toLowerCase().includes(familyHomeAddress.toLowerCase()))) ? (isOrganizer ? familyHomeAddress || 'Home' : 'Private address is in your confirmation email') : event.location || '')}`,
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
          helper, helper_person_id AS "helperPersonId", helper_phone AS "helperPhone", helper_email AS "helperEmail", repeat_group_id AS "repeatGroupId",
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
        WHERE (is_proposed = FALSE OR pending.id IS NOT NULL) AND (is_flexible = TRUE OR SUBSTRING(event_date, 1, 8) BETWEEN ${new Date(new Date(`${phoenixToday()}T12:00:00Z`).getTime() - 35 * 86400000).toISOString().slice(0, 10).replaceAll('-', '')} AND ${upcomingWorkDates(92).at(-1)!.dateKey})
        ORDER BY event_date ASC, team_events.created_at ASC
      `
      const availability = await sql`
        SELECT id, person_id AS "personId", name, phone, email, available_day AS day, available_time AS time, note, owner_key_hash AS "ownerKeyHash"
        FROM availability WHERE (${isOrganizer} OR owner_key_hash = ${helperOwner}) AND available_day >= ${phoenixToday().replaceAll('-', '')}
        ORDER BY created_at DESC
      `
      const foodRows = await sql`
        SELECT DISTINCT SUBSTRING(event_date, 1, 8) AS date
        FROM team_events
        WHERE proposal_type = 'food' AND (COALESCE(helper, '') <> '' OR EXISTS (
          SELECT 1 FROM support_requests WHERE event_id = team_events.id AND status = 'pending'
        ))
      `
      const foodReservedDates = foodRows.map((row) => String(row.date))
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
      const foodRowsSettings = await sql`SELECT weekdays, start_time AS "startTime", end_time AS "endTime", visit_start_time AS "visitStartTime", visit_end_time AS "visitEndTime", stu_in_town AS "stuInTown", gabby_in_town AS "gabbyInTown", spencer_in_town AS "spencerInTown", stu_in_town_dates AS "stuInTownDates", gabby_in_town_dates AS "gabbyInTownDates", spencer_in_town_dates AS "spencerInTownDates", visitor_preferences AS "visitorPreferences", food_overview AS "foodOverview", food_avoid AS "foodAvoid", food_suggestions AS "foodSuggestions", food_blocked_dates AS "foodBlockedDates" FROM food_settings WHERE singleton = TRUE`
      const foodSettings: FoodSettings = foodRowsSettings.length ? {
        weekdays: String(foodRowsSettings[0].weekdays).split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        startTime: String(foodRowsSettings[0].startTime),
        endTime: String(foodRowsSettings[0].endTime),
      } : { weekdays: [1, 3], startTime: '14:00', endTime: '18:00' }
      const visitSettings: VisitSettings = { startTime: String(foodRowsSettings[0]?.visitStartTime || '10:00'), endTime: String(foodRowsSettings[0]?.visitEndTime || '17:00') }
      const foodPreferences: FoodPreferences = {
        overview: String(foodRowsSettings[0]?.foodOverview || defaultFoodPreferences.overview),
        avoid: String(foodRowsSettings[0]?.foodAvoid || defaultFoodPreferences.avoid),
        suggestions: parseFoodSuggestions(foodRowsSettings[0]?.foodSuggestions),
      }
      const familyInTown: FamilyInTown = { Stu: Boolean(foodRowsSettings[0]?.stuInTown ?? true), Gabby: Boolean(foodRowsSettings[0]?.gabbyInTown ?? true), Spencer: Boolean(foodRowsSettings[0]?.spencerInTown ?? false) }
      const parseDates = (value: unknown) => String(value || '').split(',').filter((date) => /^\d{8}$/.test(date))
      const familyInTownDates: FamilyInTownDates = { Stu: parseDates(foodRowsSettings[0]?.stuInTownDates), Gabby: parseDates(foodRowsSettings[0]?.gabbyInTownDates), Spencer: parseDates(foodRowsSettings[0]?.spencerInTownDates) }
      const careRows = await sql`SELECT id, person_id AS "personId", name, phone, email, role, weekdays, start_time AS "startTime", end_time AS "endTime", auto_assign AS "autoAssign" FROM care_team ORDER BY name ASC`
      const careTeam = careRows.map((row) => ({ ...row, weekdays: String(row.weekdays || '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6), phone: isOrganizer ? row.phone : '', email: isOrganizer ? row.email : '' })) as CareTeamMember[]
      const nurseEvents: Record<string, unknown>[] = []
      const firstDay = phoenixToday()
      for (let offset = 0; offset < 62; offset++) {
        const date = new Date(`${firstDay}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset)
        const key = date.toISOString().slice(0, 10).replaceAll('-', '')
        for (const nurse of careTeam.filter((member) => nurseOnDate(member, key))) {
          nurseEvents.push({ id: `nurse:${nurse.id}:${key}`, category: 'appointment', forWho: 'Mary', date: `${key}T${nurse.startTime.replace(':', '')}00`, dayLabel: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }), time: nurse.startTime, endTime: nurse.endTime, title: 'Nurse with Mary', details: 'Care is covered during this time. No visitors or drop-ins, please.', helpNeeded: 'No help needed', helper: nurse.name, helperPersonId: (nurse as CareTeamMember & { personId?: string }).personId, scheduleSource: 'nurse_coverage' })
        }
      }
      const templates = isOrganizer ? await sql`SELECT id, name, items FROM schedule_templates ORDER BY name` : []
      const notifications = isOrganizer ? await notificationSummary(sql) : []
      const supportContacts = isOrganizer ? await sql`SELECT id, id AS "personId", name, phone, email, 'contact_list' AS source, CASE WHEN 'mary greenberg' = ANY(alias_keys) THEN 'Mary' WHEN 'stu greenberg' = ANY(alias_keys) THEN 'Stu' WHEN 'gabby greenberg' = ANY(alias_keys) THEN 'Gabby' WHEN 'spencer greenberg' = ANY(alias_keys) THEN 'Spencer' ELSE NULL END AS "familyKey" FROM directory_people ORDER BY name ASC` : []
      const allEvents = [...events.map((event) => {
        const nurse = careTeam.find((member) => member.role === 'Nurse' && String(event.helper || '').trim().toLowerCase() === member.name.trim().toLowerCase())
        return nurse && !String(event.helpNeeded).toLowerCase().includes('ride') ? { ...event, title: 'Nurse with Mary', details: 'Care is covered during this time.', helpNeeded: 'No help needed', forWho: 'Mary' } : event
      }), ...nurseEvents] as ScheduleEvent[]
      return response.status(200).json({
        events: isOrganizer ? allEvents : publicSchedule(allEvents, careTeam as ScheduleCareTeam[], familyInTown, familyInTownDates),
        visitorPreferences: signupVisitorPreferences(String(foodRowsSettings[0]?.visitorPreferences ?? defaultVisitorPreferences)),
        ...(isOrganizer ? { homeAddress: familyHomeAddress, stuWorkDefaults, visitSettings, familyInTown, familyInTownDates, careTeam, supportContacts, templates, notifications } : {}),
        availability: publicAvailability, organizer: isOrganizer, foodSettings, foodPreferences, foodReservedDates, foodBlockedDates: parseDates(foodRowsSettings[0]?.foodBlockedDates),
      })
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
          support_requests.person_id AS "personId", support_requests.requester_name AS "requesterName", support_requests.requester_phone AS "requesterPhone",
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
        SELECT support_requests.id, support_requests.event_id AS "eventId", support_requests.person_id AS "personId", support_requests.requester_name AS "requesterName",
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

    if (action === 'offerDifferentFoodDates') {
      if (!isOrganizer) return sendError(response, 401, 'Organizer access is required.')
      const requestId = clean(request.body?.requestId, 80)
      const rawDates: unknown[] = Array.isArray(request.body?.dates) ? request.body.dates : []
      const dates = [...new Set(rawDates.map((value: unknown) => clean(value, 8)).filter((date: string) => /^\d{8}$/.test(date)))].sort().slice(0, 5)
      const note = clean(request.body?.note, 500)
      if (!requestId || !dates.length) return sendError(response, 400, 'Choose at least one open food date.')
      const requests = await sql`
        SELECT support_requests.id, support_requests.event_id AS "eventId", support_requests.requester_name AS "requesterName",
          support_requests.requester_email AS "requesterEmail", team_events.day_label AS "dayLabel",
          team_events.proposal_type AS "proposalType"
        FROM support_requests JOIN team_events ON team_events.id = support_requests.event_id
        WHERE support_requests.id = ${requestId} AND support_requests.status = 'pending'
      `
      if (!requests.length) return sendError(response, 409, 'This request was already handled.')
      const supportRequest = requests[0]
      if (String(supportRequest.proposalType) !== 'food') return sendError(response, 400, 'Different dates can only be offered for food requests.')
      const email = String(supportRequest.requesterEmail || '').trim()
      if (!email) return sendError(response, 400, 'This person does not have an email address saved.')
      await sql`UPDATE support_requests SET status = 'declined', decline_reason = 'The family offered different food drop-off dates.', decided_at = NOW() WHERE id = ${requestId}`
      await supersedeNotifications(sql, `request:${requestId}`)
      const dateLabels = dates.map((date) => new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }))
      const name = String(supportRequest.requesterName || '').trim()
      const emailSent = await notifyOnce(`decision:${requestId}:alternate-food-dates`, {
        subject: "Mary's Team: different food drop-off dates are open",
        heading: 'Could you choose a different food drop-off date?',
        intro: `${name ? `${name}, ` : ''}thank you for offering to bring food. The family does not need food on ${String(supportRequest.dayLabel)}, but the dates below are currently open. Please return to Mary’s Team and choose whichever date works best for you.${note ? ` ${note}` : ''}`,
        rows: dateLabels.map((label, index) => ({ label: index === 0 ? 'Open dates' : '', value: label })),
        actionUrl: 'https://marys-team.vercel.app/?food=1',
        actionLabel: 'Choose a different food date',
      }, [email])
      return response.status(200).json({ id: requestId, dates, emailSent })
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

    if (action === 'saveFoodBlockedDates') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to change food drop-off dates.')
      const rawDates: unknown[] = Array.isArray(request.body?.dates) ? request.body.dates : []
      const dates = [...new Set(rawDates.map((value: unknown) => clean(value, 8)).filter((date: string) => /^\d{8}$/.test(date)))].sort().slice(0, 180)
      await sql`UPDATE food_settings SET food_blocked_dates = ${dates.join(',')}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ foodBlockedDates: dates })
    }

    if (action === 'saveFoodPreferences') {
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to change food preferences.')
      const overview = clean(request.body?.overview, 1200)
      const avoid = clean(request.body?.avoid, 800)
      const rawSuggestions: unknown[] = Array.isArray(request.body?.suggestions) ? request.body.suggestions : []
      const suggestions: FoodPreference[] = rawSuggestions.map((entry) => {
        const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        return {
          id: clean(value.id, 100) || randomUUID(),
          type: ['restaurant', 'homemade', 'grocery'].includes(String(value.type)) ? value.type as FoodPreferenceType : 'homemade',
          name: clean(value.name, 160),
          items: Array.isArray(value.items) ? value.items.map((item: unknown) => clean(item, 160)).filter(Boolean).slice(0, 20) : [],
          note: clean(value.note, 300),
        }
      }).filter((entry) => entry.name).slice(0, 30)
      if (!overview) return sendError(response, 400, 'Add a short description of what food works well.')
      await sql`UPDATE food_settings SET food_overview = ${overview}, food_avoid = ${avoid}, food_suggestions = ${JSON.stringify(suggestions)}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ foodPreferences: { overview, avoid, suggestions } })
    }

    if (action === 'saveHomeAddress') {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required to edit the private address.')
      const address = clean(request.body?.address, 500)
      if (!address) return sendError(response, 400, 'Please enter the private home address.')
      await sql`UPDATE food_settings SET home_address = ${address}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ homeAddress: address })
    }
    if (action === 'saveVisitorPreferences') {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required.')
      const text = clean(request.body?.text, 4000)
      if (!text) return sendError(response, 400, 'Please enter visitor preferences.')
      await sql`UPDATE food_settings SET visitor_preferences = ${text}, updated_at = NOW() WHERE singleton = TRUE`
      return response.status(200).json({ visitorPreferences: text })
    }
    if (['saveScheduleTemplate', 'previewScheduleTemplate', 'applyScheduleTemplate'].includes(action)) {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required.')
      const id = clean(request.body?.id, 100) || randomUUID()
      const weekOf = clean(request.body?.weekOf, 10)
      const selectedIds: string[] = Array.isArray(request.body?.selectedIds) ? request.body.selectedIds.map((value: unknown) => clean(value, 100)).slice(0, 100) : []
      try {
        if (action === 'saveScheduleTemplate') {
          const name = clean(request.body?.name, 100)
          if (!name || !selectedIds.length) return sendError(response, 400, 'Name the routine and select the items to save.')
          return response.status(201).json({ template: await saveTemplate(sql, id, name, selectedIds) })
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || weekOf < phoenixToday()) return sendError(response, 400, 'Choose a future week starting on Monday.')
        if (action === 'previewScheduleTemplate') return response.status(200).json({ items: await previewTemplate(sql, id, weekOf) })
        return response.status(201).json({ added: (await applyTemplate(sql, id, weekOf, selectedIds)).length })
      } catch (error) { return sendError(response, 400, error instanceof Error ? error.message : 'The routine could not be saved.') }
    }
    if (action === 'savePerson') {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required to edit people.')
      const contact = request.body?.contact || {}
      const name = clean(contact.name, 120), phone = clean(contact.phone, 40), email = clean(contact.email, 200).toLowerCase()
      if (!name || (email && !/^\S+@\S+\.\S+$/.test(email))) return sendError(response, 400, 'Enter a name and a valid email, if provided.')
      const personId = clean(contact.personId, 100)
      const originals = (Array.isArray(request.body?.originals) ? request.body.originals : []).slice(0, 100)
      const names = (originals.length ? originals : [{ name }]).map((item: { name?: string }) => clean(item.name, 120).toLowerCase()).filter(Boolean)
      await sql`
        WITH person AS (
          UPDATE directory_people SET name = ${name}, phone = ${phone}, email = ${email}, alias_keys = ARRAY(SELECT DISTINCT unnest(alias_keys || ARRAY[${nameKey(name)}]::text[]))
          WHERE id = ${personId} OR (${personId} = '' AND LOWER(TRIM(name)) = ANY(${names}::text[])) RETURNING id
        ), contacts AS (
          UPDATE support_contacts SET name = ${name}, phone = ${phone}, email = ${email}
          WHERE person_id IN (SELECT id FROM person) OR (${personId} = '' AND LOWER(TRIM(name)) = ANY(${names}::text[])) RETURNING id
        ), care AS (
          UPDATE care_team SET name = ${name}, phone = ${phone}, email = ${email}
          WHERE person_id IN (SELECT id FROM person) OR (${personId} = '' AND LOWER(TRIM(name)) = ANY(${names}::text[])) RETURNING id
        ), events AS (
          UPDATE team_events SET helper = ${name}, helper_phone = ${phone}, helper_email = ${email}
          WHERE helper_person_id IN (SELECT id FROM person) OR (${personId} = '' AND LOWER(TRIM(helper)) = ANY(${names}::text[])) RETURNING id
        ), requests AS (
          UPDATE support_requests SET requester_name = ${name}, requester_phone = ${phone}, requester_email = ${email}
          WHERE person_id IN (SELECT id FROM person) OR (${personId} = '' AND LOWER(TRIM(requester_name)) = ANY(${names}::text[])) RETURNING id
        ), available AS (
          UPDATE availability SET name = ${name}, phone = ${phone}, email = ${email}
          WHERE person_id IN (SELECT id FROM person) OR (${personId} = '' AND LOWER(TRIM(name)) = ANY(${names}::text[])) RETURNING id
        )
        INSERT INTO support_contacts (id, name, phone, email)
        SELECT ${randomUUID()}, ${name}, ${phone}, ${email} WHERE NOT EXISTS (SELECT 1 FROM contacts)
      `
      return response.status(200).json({ saved: true })
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
      if (!isOrganizer) return sendError(response, 401, 'Family PIN access is required to update a family calendar.')
      const person = clean(request.body?.person, 20)
      const rangeStart = clean(request.body?.rangeStart, 8)
      const rangeEnd = clean(request.body?.rangeEnd, 8)
      if (!['Stu', 'Gabby', 'Spencer'].includes(person)) return sendError(response, 400, 'Choose Stu, Gabby, or Spencer.')
      if (!/^\d{8}$/.test(rangeStart) || !/^\d{8}$/.test(rangeEnd) || rangeEnd < rangeStart) return sendError(response, 400, 'Choose a valid calendar range.')
      const rawEntries: unknown[] = Array.isArray(request.body?.entries) ? request.body.entries : []
      const entries = rawEntries.map((item) => {
        const value = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return {
          date: clean(value.date, 8),
          kind: ['Work', 'Appointment', 'Away'].includes(String(value.kind)) ? String(value.kind) : 'Work',
          startTime: clean(value.startTime, 5),
          endTime: clean(value.endTime, 5),
        }
      }).filter((entry) => /^\d{8}$/.test(entry.date) && entry.date >= rangeStart && entry.date <= rangeEnd && /^\d{2}:\d{2}$/.test(entry.startTime) && /^\d{2}:\d{2}$/.test(entry.endTime) && entry.endTime > entry.startTime).slice(0, 60)
      if (entries.length !== rawEntries.length) return sendError(response, 400, 'Check every selected date and time.')
      const tracked = await sql`
        SELECT id, SUBSTRING(event_date, 1, 8) AS day, schedule_source AS "scheduleSource"
        FROM team_events
        WHERE for_who = ${person}
          AND SUBSTRING(event_date, 1, 8) BETWEEN ${rangeStart} AND ${rangeEnd}
          AND schedule_source IN ('family_busy', 'family_work', 'stu_work')
        ORDER BY created_at
      `
      const byDate = new Map(entries.map((entry) => [entry.date, entry]))
      for (const row of tracked) {
        const day = String(row.day)
        if (!byDate.has(day)) {
          if (String(row.scheduleSource) === 'stu_work' && person === 'Stu') await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${day}) ON CONFLICT DO NOTHING`
          await sql`DELETE FROM team_events WHERE id = ${String(row.id)}`
        }
      }
      for (const entry of entries) {
        const isoDate = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`
        const dayLabel = new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        const title = entry.kind === 'Work' ? `${person} Work` : entry.kind === 'Appointment' ? `${person} Appointment` : `${person} Away`
        const eventDate = `${entry.date}T${entry.startTime.replace(':', '')}00`
        const existing = tracked.find((row) => String(row.day) === entry.date)
        if (person === 'Stu') await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${entry.date}) ON CONFLICT DO NOTHING`
        if (existing) {
          await sql`UPDATE team_events SET event_date = ${eventDate}, day_label = ${dayLabel}, event_time = ${entry.startTime}, end_time = ${entry.endTime}, title = ${title}, details = ${`${person} is unavailable.`}, help_needed = 'Spend time with Mary', schedule_source = 'family_busy', is_schedule_exception = TRUE WHERE id = ${String(existing.id)}`
          const extras = tracked.filter((row) => String(row.day) === entry.date && String(row.id) !== String(existing.id))
          for (const extra of extras) await sql`DELETE FROM team_events WHERE id = ${String(extra.id)}`
        } else {
          await sql`INSERT INTO team_events (id, category, for_who, event_date, day_label, event_time, end_time, title, details, location, help_needed, schedule_source, is_schedule_exception) VALUES (${randomUUID()}, 'family', ${person}, ${eventDate}, ${dayLabel}, ${entry.startTime}, ${entry.endTime}, ${title}, ${`${person} is unavailable.`}, 'Home', 'Spend time with Mary', 'family_busy', TRUE)`
        }
      }
      return response.status(200).json({ saved: entries.length })
    }

    if (action === 'addEvent' || action === 'addEventBatch') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const items: unknown[] = action === 'addEventBatch'
        ? (Array.isArray(request.body?.events) ? request.body.events.slice(0, 52) : [])
        : [request.body?.event]
      const events = items.map((item) => parseEventInput(item as Partial<TeamEventInput> | undefined))
      if (!events.length || events.some((event) => !eventIsValid(event))) return sendError(response, 400, 'Please complete the required schedule details, including an ending time.')
      const savedRows = await Promise.all(events.map((event) => sql`
        INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, location, help_needed, helper, helper_phone, helper_email, helper_person_id, repeat_group_id, for_who, schedule_source, is_flexible)
        VALUES (${event.id}, ${event.category}, ${event.date}, ${event.dayLabel}, ${event.time}, ${event.endTime}, ${event.title}, ${event.details}, ${event.location || null}, ${event.helpNeeded}, ${event.helper || null}, ${event.helperPhone || null}, ${event.helperEmail || null}, ${event.helperPersonId || null}, ${event.repeatGroupId || null}, ${event.forWho}, ${event.scheduleSource || null}, ${event.isFlexible})
        ON CONFLICT (id) DO UPDATE SET
          category = EXCLUDED.category, event_date = EXCLUDED.event_date, day_label = EXCLUDED.day_label,
          event_time = EXCLUDED.event_time, end_time = EXCLUDED.end_time, title = EXCLUDED.title,
          details = EXCLUDED.details, location = EXCLUDED.location, help_needed = EXCLUDED.help_needed,
          helper_person_id = EXCLUDED.helper_person_id, helper = EXCLUDED.helper, helper_phone = EXCLUDED.helper_phone, helper_email = EXCLUDED.helper_email,
          repeat_group_id = EXCLUDED.repeat_group_id, for_who = EXCLUDED.for_who, schedule_source = EXCLUDED.schedule_source, is_flexible = EXCLUDED.is_flexible
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, helper_person_id AS "helperPersonId", helper_phone AS "helperPhone", helper_email AS "helperEmail",
          repeat_group_id AS "repeatGroupId", for_who AS "forWho", schedule_source AS "scheduleSource", is_flexible AS "isFlexible"
      `))
      const driverNotifications = await Promise.all(events.filter((event) => event.helperEmail).map((event) => notifyAssignedDriver(event)))
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
        SET helper_person_id = NULL, helper = ${helper}, helper_phone = ${helperPhone || null}, helper_email = ${helperEmail || null}
        WHERE id = ${eventId}
        RETURNING id, category, for_who AS "forWho", event_date AS date, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", title, details, location, help_needed AS "helpNeeded", helper, helper_phone AS "helperPhone", helper_email AS "helperEmail"
      `
      if (!rows.length) return sendError(response, 404, 'This schedule item is no longer available.')
      const emailSent = helperEmail ? await notifyAssignedDriver(parseEventInput(rows[0] as Partial<TeamEventInput>)) : null
      return response.status(200).json({ saved: true, emailSent })
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

    if (action === 'deleteSupportContact') {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required to remove a saved contact.')
      const personId = clean(request.body?.personId, 100)
      if (!personId) return sendError(response, 400, 'Choose a saved contact to remove.')
      const people = await sql`SELECT id, alias_keys AS aliases FROM directory_people WHERE id = ${personId}`
      if (!people.length) return sendError(response, 404, 'That saved contact was not found.')
      const protectedFamily = ['mary greenberg', 'stu greenberg', 'gabby greenberg', 'spencer greenberg']
      if ((people[0].aliases || []).some((alias: string) => protectedFamily.includes(String(alias)))) return sendError(response, 400, 'Family contacts cannot be removed.')
      await sql`DELETE FROM support_contacts WHERE person_id = ${personId}`
      await sql`DELETE FROM directory_people
        WHERE id = ${personId}
          AND NOT EXISTS (SELECT 1 FROM support_contacts WHERE person_id = ${personId})
          AND NOT EXISTS (SELECT 1 FROM care_team WHERE person_id = ${personId})
          AND NOT EXISTS (SELECT 1 FROM team_events WHERE helper_person_id = ${personId})
          AND NOT EXISTS (SELECT 1 FROM support_requests WHERE person_id = ${personId})
          AND NOT EXISTS (SELECT 1 FROM availability WHERE person_id = ${personId})`
      return response.status(200).json({ removed: true, personId })
    }

    if (action === 'addSupportContact') {
      const name = clean(request.body?.name, 120)
      const phone = clean(request.body?.phone, 40)
      const email = clean(request.body?.email, 200).toLocaleLowerCase()
      if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email)) return sendError(response, 400, 'Please enter your name, phone number, and email address.')
      const existing = await sql`SELECT id FROM support_contacts WHERE LOWER(TRIM(name)) = LOWER(${name}) ORDER BY created_at DESC LIMIT 1`
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
        SELECT id, proposal_type AS "proposalType", category, for_who AS "forWho", event_date AS date, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", title, details, location, help_needed AS "helpNeeded", is_flexible AS "isFlexible", schedule_source AS "scheduleSource", helper,
          helper_phone AS "helperPhone", helper_email AS "helperEmail"
        FROM team_events
        WHERE id = ${event.id}
      `
      const previous = previousRows[0]
      const clearAssigned = isNoSupport(event.helpNeeded) && previous?.proposalType !== 'food'
      const saveContact = async (name: unknown, phone: unknown, email: unknown) => {
        const contactName = clean(name, 120)
        const contactPhone = clean(phone, 40)
        const contactEmail = clean(email, 200).toLocaleLowerCase()
        if (!contactName || (!contactPhone && !contactEmail)) return
        const existing = await sql`
          SELECT id FROM support_contacts
          WHERE LOWER(TRIM(name)) = LOWER(${contactName})
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
      const changedPendingTime = ['date', 'time', 'endTime'].some((key) => String(previous?.[key] || '') !== String(event[key as keyof typeof event] || ''))
      if (clearAssigned || event.helper || changedPendingTime) await closePendingForEvent(event.id, 'The schedule has changed, so this requested time is no longer available.', clearAssigned ? '' : event.helperEmail)
      const rows = await sql`
        UPDATE team_events
        SET helper_person_id = ${clearAssigned ? null : event.helperPersonId || null}, category = ${event.category}, event_date = ${event.date}, day_label = ${event.dayLabel},
          event_time = ${event.time}, end_time = ${event.endTime}, title = ${event.title},
          details = ${event.details}, location = ${event.location || null}, help_needed = ${event.helpNeeded}, for_who = ${event.forWho}, is_flexible = ${event.isFlexible},
          helper = CASE WHEN ${clearAssigned} THEN NULL ELSE ${event.helper || null} END,
          helper_phone = CASE WHEN ${clearAssigned} THEN NULL ELSE ${event.helperPhone || null} END,
          helper_email = CASE WHEN ${clearAssigned} THEN NULL ELSE ${event.helperEmail || null} END,
          is_schedule_exception = CASE WHEN schedule_source = 'stu_work' THEN TRUE ELSE is_schedule_exception END
        WHERE id = ${event.id}
        RETURNING id, category, event_date AS date, day_label AS "dayLabel",
          event_time AS time, end_time AS "endTime", title, details, location,
          help_needed AS "helpNeeded", helper, helper_person_id AS "helperPersonId", helper_phone AS "helperPhone", helper_email AS "helperEmail", repeat_group_id AS "repeatGroupId", for_who AS "forWho",
          schedule_source AS "scheduleSource", is_schedule_exception AS "isScheduleException", is_flexible AS "isFlexible"
      `
      if (!rows.length) return sendError(response, 404, 'This schedule item could not be found.')
      if (previous?.scheduleSource === 'stu_work') {
        const originalDate = String(previous.date).slice(0, 8)
        const updatedDate = event.date.slice(0, 8)
        await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${originalDate}) ON CONFLICT DO NOTHING`
        if (updatedDate !== originalDate) await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${updatedDate}) ON CONFLICT DO NOTHING`
      }

      const previousHelperEmail = String(previous?.helperEmail || '').trim().toLocaleLowerCase()
      const currentHelperEmail = String(event.helperEmail || '').trim().toLocaleLowerCase()
      const removalEmailSent = previousHelperEmail && previousHelperEmail !== currentHelperEmail
        ? await notifyAssignmentRemoved(previous as Record<string, unknown>, parseEventInput(previous as Partial<TeamEventInput>))
        : null
      const scheduleChanged = ['date', 'time', 'endTime', 'title', 'details', 'location', 'helpNeeded'].some((key) => String(previous?.[key] || '') !== String(event[key as keyof typeof event] || ''))
      const shouldNotifyDriver = Boolean(event.helperEmail) && (previousHelperEmail !== currentHelperEmail || scheduleChanged)
      const driverEmailSent = shouldNotifyDriver ? await notifyAssignedDriver(event, previousHelperEmail === currentHelperEmail && scheduleChanged) : null
      return response.status(200).json({ event: rows[0], driverEmailSent, removalEmailSent })
    }

    if (action === 'deleteEvent') {
      if (!isOrganizer) return sendError(response, 401, 'Mary or Stu must open Organizer access before changing the schedule.')
      const eventId = clean(request.body?.eventId, 80)
      if (!eventId) return sendError(response, 400, 'Choose the schedule item to remove.')
      const previousRows = await sql`SELECT id, category, for_who AS "forWho", event_date AS date, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", title, details, location, help_needed AS "helpNeeded", is_flexible AS "isFlexible", schedule_source AS "scheduleSource", helper, helper_phone AS "helperPhone", helper_email AS "helperEmail" FROM team_events WHERE id = ${eventId}`
      if (previousRows[0]?.scheduleSource === 'stu_work') {
        await sql`INSERT INTO stu_work_exceptions (work_date) VALUES (${String(previousRows[0].date).slice(0, 8)}) ON CONFLICT DO NOTHING`
      }
      await closePendingForEvent(eventId, 'This scheduled time has been cancelled. Please do not come to the home.')
      const rows = await sql`DELETE FROM team_events WHERE id = ${eventId} RETURNING id`
      if (!rows.length) return sendError(response, 404, 'This schedule item was already removed.')
      const cancellationEmailSent = previousRows[0]?.helperEmail ? await notifyAssignmentRemoved(previousRows[0], parseEventInput(previousRows[0] as Partial<TeamEventInput>)) : null
      return response.status(200).json({ id: eventId, cancellationEmailSent })
    }

    if (action === 'getApprovalRequest') {
      const token = clean(request.body?.token, 120)
      const rows = await sql`
        SELECT support_requests.id, support_requests.status, support_requests.person_id AS "personId", support_requests.requester_name AS "requesterName",
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
        SELECT support_requests.id, support_requests.event_id AS "eventId", support_requests.person_id AS "personId", support_requests.requester_name AS "requesterName",
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
      if (!isOrganizer) return sendError(response, 401, 'Family access is required.')
      await processOutbox(sql)
      return response.status(200).json({ notifications: await notificationSummary(sql) })
    }
    if (action === 'retryNotification') {
      if (!isOrganizer) return sendError(response, 401, 'Family access is required.')
      const id = clean(request.body?.id, 100)
      const jobs = await sql`UPDATE email_outbox SET status = 'queued', attempts = 0, next_attempt_at = NOW(), last_error = NULL
        WHERE id = ${id} AND recipient <> '' AND status IN ('failed', 'bounced', 'retry') RETURNING notification_key`
      if (!jobs.length) return sendError(response, 409, 'This message is not waiting for retry.')
      await scheduleEmailJob(sql, id)
      await processOutbox(sql, String(jobs[0].notification_key))
      return response.status(200).json({ notifications: await notificationSummary(sql) })
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
        const reserved = await sql`SELECT id FROM team_events WHERE proposal_type = 'food' AND SUBSTRING(event_date, 1, 8) = ${dateKey} AND (COALESCE(helper, '') <> '' OR EXISTS (SELECT 1 FROM support_requests WHERE event_id = team_events.id AND status = 'pending')) LIMIT 1`
        if (reserved.length) return sendError(response, 409, 'Someone is already bringing food that day. Please choose another open date.')
        const conflicts = await sql`
          SELECT id FROM team_events
          WHERE for_who = 'Mary' AND proposal_type IS NULL AND is_flexible = FALSE
            AND SUBSTRING(event_date, 1, 8) = ${dateKey} AND event_time < ${endTime} AND end_time > ${time}
          LIMIT 1
        `
        if (conflicts.length) return sendError(response, 409, 'Mary has an appointment during that time. Please choose another time or date.')
      }

      const eventId = randomUUID()
      const requestId = randomUUID()
      const approvalToken = randomUUID()
      const eventDate = `${date.replaceAll('-', '')}T${time.replace(':', '')}00`
      const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const title = type === 'food' ? 'Food drop-off' : 'Stop by'
      const details = submittedDetails || 'Brief food drop-off only; no social visit. Please follow the confirmation email instructions.'
      const rows = await sql`
        WITH reserved AS (
          INSERT INTO food_reservations (food_date, event_id) VALUES (${date.replaceAll('-', '')}, ${eventId}) ON CONFLICT DO NOTHING RETURNING event_id
        ), inserted_event AS (
          INSERT INTO team_events (id, category, event_date, day_label, event_time, end_time, title, details, help_needed, for_who, is_proposed, proposal_type)
          SELECT ${eventId}, 'company', ${eventDate}, ${dayLabel}, ${time}, ${endTime}, ${title}, ${details}, 'No help needed', 'Mary', TRUE, ${type} FROM reserved
          RETURNING id
        )
        INSERT INTO support_requests (id, event_id, requester_name, requester_phone, requester_email, approval_token)
        SELECT ${requestId}, id, ${name}, ${phone}, ${email}, ${approvalToken} FROM inserted_event
        RETURNING id
      `
      if (!rows.length) return sendError(response, 409, 'Someone has already reserved this food date. Please choose another open date.')
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
        SELECT id, title, day_label AS "dayLabel", event_time AS time, end_time AS "endTime", help_needed AS "helpNeeded", helper, event_date AS date, is_flexible AS "isFlexible"
        FROM team_events WHERE id = ${eventId}
      `
      if (!availableEvents.length) return sendError(response, 404, 'This schedule item could not be found.')
      const selectedEvent = availableEvents[0]
      if (isNoSupport(String(selectedEvent.helpNeeded))) return sendError(response, 400, 'This time is not accepting support requests.')
      if (selectedEvent.helper) return sendError(response, 409, 'Someone else has already filled this time.')
      if (!selectedEvent.isFlexible && (!/^\d{2}:\d{2}$/.test(requestStartTime) || !/^\d{2}:\d{2}$/.test(requestEndTime) || requestStartTime < String(selectedEvent.time) || requestEndTime > String(selectedEvent.endTime) || requestEndTime <= requestStartTime)) {
        return sendError(response, 400, 'Choose a time within the open window.')
      }

      if (String(selectedEvent.helpNeeded).toLowerCase().includes('ride') && (requestStartTime !== selectedEvent.time || requestEndTime !== selectedEvent.endTime)) return sendError(response, 400, 'Appointment helpers must stay for the entire scheduled time.')
      if (!selectedEvent.isFlexible && !String(selectedEvent.helpNeeded).toLowerCase().includes('ride')) {
        const nurses = await sql`SELECT id, name, role, weekdays, start_time AS "startTime", end_time AS "endTime", auto_assign AS "autoAssign" FROM care_team WHERE role = 'Nurse' AND auto_assign = TRUE`
        const covered = nurses.some((row) => nurseOnDate({ ...row, weekdays: String(row.weekdays).split(',').map(Number) } as CareTeamMember, String(selectedEvent.date).slice(0, 8)) && requestStartTime < String(row.endTime) && requestEndTime > String(row.startTime))
        if (covered) return sendError(response, 409, 'Mary has nurse care during this time and is not receiving visitors. Please choose another open task.')
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
        email: clean(item.email, 200).toLowerCase(),
        day: clean(item.day, 120),
        time: clean(item.time, 120),
        note: clean(item.note, 500),
      }))
      if (!entries.length || entries.some((entry) => !entry.id || !entry.name || !entry.phone || !entry.day || !entry.time || !entry.note || (!isOrganizer && !/^\S+@\S+\.\S+$/.test(entry.email || '')))) {
        return sendError(response, 400, 'Please complete your name, phone number, dates, times, and kind of help.')
      }
      const savedRows = await Promise.all(entries.map((entry) => sql`
        INSERT INTO availability (id, name, phone, email, available_day, available_time, note, owner_key_hash)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.email || ''}, ${entry.day}, ${entry.time}, ${entry.note}, ${ownerKeyHash})
        RETURNING id, name, phone, email, available_day AS day, available_time AS time, note
      `))
      const offerEmail = entries[0]?.email || ''
      if (offerEmail) await notifyOnce(`availability-offer:${entries.map((entry) => entry.id).join(':')}`, { subject: "Mary’s Team: availability received — not a booking", heading: 'Your availability was received', intro: 'Thank you for offering your time. This is not a confirmed assignment. The family will email you if they schedule specific help. Please do not come unless you receive a confirmation.', rows: entries.map((entry) => ({ label: entry.day, value: readableAvailabilityTime(entry.time) })), actionUrl: 'https://marys-team.vercel.app/', actionLabel: 'View open help requests' }, [offerEmail])
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
        email: clean(item?.email, 200).toLowerCase(),
        day: clean(item?.day, 120),
        time: clean(item?.time, 120),
        note: clean(item?.note, 500),
      }
      if (!entry.id || !entry.name || !entry.phone || !entry.day || !entry.time || (!isOrganizer && !/^\S+@\S+\.\S+$/.test(entry.email || ''))) {
        return sendError(response, 400, 'Please add your name, phone number, day, and time.')
      }
      const [saved] = await sql`
        INSERT INTO availability (id, name, phone, email, available_day, available_time, note, owner_key_hash)
        VALUES (${entry.id}, ${entry.name}, ${entry.phone}, ${entry.email || ''}, ${entry.day}, ${entry.time}, ${entry.note}, ${ownerKeyHash})
        RETURNING id, name, phone, email, available_day AS day, available_time AS time, note
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
        email: clean(item?.email, 200).toLowerCase(),
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
        SET person_id = NULL, name = ${entry.name}, phone = ${entry.phone}, email = ${entry.email || ''}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note},
          owner_key_hash = COALESCE(owner_key_hash, ${ownerKeyHash})
        WHERE id = ${entry.id}
        RETURNING id, name, phone, email, available_day AS day, available_time AS time, note
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
        email: clean(item.email, 200).toLowerCase(),
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
        SET person_id = NULL, name = ${entry.name}, phone = ${entry.phone}, email = ${entry.email || ''}, available_day = ${entry.day}, available_time = ${entry.time}, note = ${entry.note},
          owner_key_hash = COALESCE(owner_key_hash, ${ownerKeyHash})
        WHERE id = ${entry.id}
        RETURNING id, name, phone, email, available_day AS day, available_time AS time, note
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
    if ((error as { code?: string }).code === '23505') return sendError(response, 409, 'This time or food date is already reserved. Refresh and choose another open slot.')
    console.error(error)
    return sendError(response, 500, 'The shared schedule could not be reached. Please try again in a moment.')
  }
}

