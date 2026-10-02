import { useEffect, useState } from 'react'
import {
  CalendarDays, Check, CircleHelp, Clock3, Download, HeartHandshake,
  Home, ListChecks, Pencil, Repeat2, Trash2, UserRound, Users, X,
} from 'lucide-react'
import './App.css'

type Category = 'appointment' | 'company' | 'home' | 'family'
type ForWho = 'Mary' | 'Stu' | 'Coco' | 'Family'
type SupportFilter = 'all' | 'ride' | 'mary' | 'home' | 'coco'
type TeamEvent = { id: string; category: Category; forWho: ForWho; date: string; dayLabel: string; time: string; endTime: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string; repeatGroupId?: string; requestPending?: boolean; requesterName?: string; scheduleSource?: string; isScheduleException?: boolean }
type Availability = { id: string; name: string; phone: string; day: string; time: string; note: string; editable?: boolean }
type ApprovalRequest = { status: string; requesterName: string; requesterPhone: string; title: string; dayLabel: string; time: string; endTime: string; helpNeeded: string }
type PendingRequest = { id: string; eventId: string; requesterName: string; requesterPhone: string; notificationSentAt?: string; title: string; dayLabel: string; time: string; endTime: string; helpNeeded: string }
type StuWorkDefaults = { weekdays: number[]; startTime: string; endTime: string }

const whoDetails = {
  Mary: { label: 'For Mary', icon: HeartHandshake },
  Stu: { label: 'For Stu', icon: UserRound },
  Coco: { label: 'For Coco', icon: Home },
  Family: { label: 'For the family', icon: Users },
}

const availabilityTimes = [
  { value: 'morning', label: 'Morning (8 AM – noon)' },
  { value: 'afternoon', label: 'Afternoon (noon – 5 PM)' },
  { value: 'evening', label: 'Evening (5 PM – 8 PM)' },
  { value: 'anytime', label: 'All day' },
]

const helpChoices = ['Driving or giving a ride', 'Company or a friendly check-in', 'Home projects or errands', 'Bringing a meal', 'Pet care or errands', 'Anything that would be useful']
const supportChoices = ['Need a ride', 'Spend time with Mary', 'Support at home or with an errand', 'Help with Coco', 'No help needed']
const defaultEventDetails = 'Text Mary directly if you have any questions.'
const whoChoices: ForWho[] = ['Mary', 'Stu', 'Coco', 'Family']
const weekdayChoices = [
  { value: 0, label: 'Sunday', short: 'Sun' }, { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' }, { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' }, { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
]

function needsTimeWithMary(forWho: ForWho) {
  return forWho === 'Stu' || forWho === 'Coco'
}

function matchesSupportFilter(event: TeamEvent, filter: SupportFilter) {
  if (filter === 'all') return true
  const support = event.helpNeeded.toLocaleLowerCase()
  if (filter === 'ride') return support.includes('ride')
  if (filter === 'mary') return support.includes('mary') || support.includes('visit') || support.includes('check-in')
  if (filter === 'home') return support.includes('home') || support.includes('errand') || support.includes('meal')
  return support.includes('coco') || support.includes('pet')
}

function helpNeededPriority(event: TeamEvent) {
  const support = event.helpNeeded.toLocaleLowerCase()
  if (support.includes('ride') || support.includes('driv')) return 0
  if (!support.includes('mary') && !support.includes('visit') && !support.includes('check-in')) return 1
  if (event.scheduleSource !== 'stu_work') return 2
  return 3
}

function availabilityTimeLabel(value: string) {
  const range = value.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  if (range) return `${eventTimeLabel(range[1])} – ${eventTimeLabel(range[2])}`
  return availabilityTimes.find((option) => option.value === value)?.label || value
}

function availabilityDayLabel(value: string) {
  if (!/^\d{8}$/.test(value)) return value
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T12:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function eventTimeLabel(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return value
  const [hours, minutes] = value.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function addHour(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ''
  const total = hours * 60 + minutes + 60
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isNoSupport(value: string) {
  return value === 'No help needed' || value === 'No help needed, just sharing the schedule'
}

function eventTimeRangeLabel(event: TeamEvent) {
  return `${eventTimeLabel(event.time)} – ${eventTimeLabel(event.endTime || addHour(event.time))}`
}

function availabilityMatchesTime(slot: string, eventTime: string, eventEndTime?: string) {
  if (slot === 'anytime') return true
  let minutes: number | null = null
  const time24 = eventTime.match(/^(\d{1,2}):(\d{2})$/)
  const time12 = eventTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (time24) minutes = Number(time24[1]) * 60 + Number(time24[2])
  if (time12) {
    let hours = Number(time12[1]) % 12
    if (time12[3].toUpperCase() === 'PM') hours += 12
    minutes = hours * 60 + Number(time12[2] || 0)
  }
  if (minutes === null) return false
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

function matchingAvailability(event: TeamEvent, availability: Availability[]) {
  if (isNoSupport(event.helpNeeded)) return []
  return availability.filter((entry) => entry.day === event.date.slice(0, 8) && availabilityMatchesTime(entry.time, event.time, event.endTime))
}

function phoneKey(value: string) {
  return value.replace(/\D/g, '')
}


async function apiRequest(body?: unknown) {
  const response = await fetch('/api/data', body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The shared schedule could not be reached.')
  return data
}

function App() {
  const [teamEvents, setTeamEvents] = useState<TeamEvent[]>([])
  const [filter, setFilter] = useState<SupportFilter>('all')
  const [view, setView] = useState<'upcoming' | 'month' | 'week'>('upcoming')
  const [availabilityView, setAvailabilityView] = useState<'upcoming' | 'month'>('upcoming')
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signupEvent, setSignupEvent] = useState<TeamEvent | null>(null)
  const [viewingEvent, setViewingEvent] = useState<TeamEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<TeamEvent | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null)
  const [approvalToken, setApprovalToken] = useState(() => new URLSearchParams(window.location.search).get('approve') || '')
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [message, setMessage] = useState('')
  const [organizer, setOrganizer] = useState(false)
  const [showOrganizerLogin, setShowOrganizerLogin] = useState(false)
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [stuWorkDefaults, setStuWorkDefaults] = useState<StuWorkDefaults | null>(null)
  const scheduleDates = new Set(getThirtyDays().map((day) => day.dateKey))
  const visibleEvents = teamEvents
    .filter((event) => scheduleDates.has(event.date.slice(0, 8)) && (view === 'month' || (!isNoSupport(event.helpNeeded) && !event.helper && matchesSupportFilter(event, filter))))
    .sort((a, b) => view === 'upcoming' ? helpNeededPriority(a) - helpNeededPriority(b) || a.date.localeCompare(b.date) : a.date.localeCompare(b.date))
  const helpers = Object.fromEntries(teamEvents.filter((event) => event.helper).map((event) => [event.id, event.helper as string]))
  const availabilityDays = getThirtyDays()
  const allAvailabilityDates = new Set(availabilityDays.map((day) => day.dateKey))
  const visibleAvailabilityDates = new Set((availabilityView === 'upcoming' ? availabilityDays.slice(0, 7) : availabilityDays).map((day) => day.dateKey))
  const visibleAvailability = availability.filter((entry) => visibleAvailabilityDates.has(entry.day)).sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time) || a.name.localeCompare(b.name))

  async function refreshData(showLoading = false) {
    if (showLoading) setLoading(true)
    try {
      const data = await apiRequest()
      setTeamEvents(data.events)
      setAvailability(data.availability)
      setOrganizer(Boolean(data.organizer))
      setStuWorkDefaults(data.stuWorkDefaults || null)
      setCloudError('')
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void apiRequest().then((data) => {
      if (!active) return
      setTeamEvents(data.events)
      setAvailability(data.availability)
      setOrganizer(Boolean(data.organizer))
      setStuWorkDefaults(data.stuWorkDefaults || null)
      setCloudError('')
      void apiRequest({ action: 'retryPendingNotifications' }).catch(() => undefined)
      if (data.organizer) void loadPendingRequests()
    }).catch((error) => {
      if (active) setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    const timer = window.setInterval(() => void refreshData(), 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!approvalToken) return
    void apiRequest({ action: 'getApprovalRequest', token: approvalToken }).then((data) => setApprovalRequest(data.request)).catch((error) => setMessage(error instanceof Error ? error.message : 'This approval link is not available.'))
  }, [approvalToken])

  async function loadPendingRequests() {
    try {
      const data = await apiRequest({ action: 'getPendingRequests' })
      setPendingRequests(data.requests)
    } catch {
      setPendingRequests([])
    }
  }

  async function organizerLogin(pin: string) {
    await apiRequest({ action: 'organizerLogin', pin })
    setOrganizer(true)
    setShowOrganizerLogin(false)
    await Promise.all([refreshData(), loadPendingRequests()])
    setMessage('Organizer access is open on this device.')
    window.setTimeout(() => setMessage(''), 5000)
  }

  async function decideRequest(requestId: string, decision: 'approve' | 'decline') {
    try {
      await apiRequest({ action: 'organizerDecideRequest', requestId, decision })
      await Promise.all([refreshData(), loadPendingRequests()])
      setMessage(decision === 'approve' ? 'The request is approved and confirmed.' : 'The request was declined and the time is open again.')
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update this request.')
    }
  }

  async function organizerLogout() {
    await apiRequest({ action: 'organizerLogout' })
    setOrganizer(false)
    setPendingRequests([])
    setStuWorkDefaults(null)
    setEditingEvent(null)
  }

  async function saveStuWorkHours(defaults: StuWorkDefaults) {
    try {
      await apiRequest({ action: 'saveStuWorkHours', ...defaults })
      setStuWorkDefaults(defaults)
      await refreshData()
      setMessage('Stu’s weekly work hours were saved and the schedule was updated.')
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save Stu’s work hours. Please try again.')
      return false
    }
  }

  async function saveHelper(eventId: string, name: string, phone: string) {
    try {
      const result = await apiRequest({ action: 'claimEvent', eventId, name, phone })
      setTeamEvents((events) => events.map((event) => event.id === eventId ? result.status === 'requested' ? { ...event, requestPending: true, requesterName: name } : { ...event, helper: name, requestPending: false, requesterName: undefined } : event))
      setSignupEvent(null)
      setMessage(result.status === 'requested' ? result.emailSent ? `Thank you, ${name}. Your request was saved and Mary and Stu were emailed for approval.` : `Thank you, ${name}. Your request is saved and waiting for Mary or Stu to approve it.` : `Thank you, ${name}. You are confirmed.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your sign-up. Please try again.')
      await refreshData()
      return false
    }
  }
  async function saveAvailability(entries: Omit<Availability, 'id'>[]) {
    try {
      const saved = entries.map((entry) => ({ ...entry, id: crypto.randomUUID() }))
      const result = await apiRequest({ action: 'addAvailabilityBatch', entries: saved })
      const addedEntries = Array.isArray(result.entries) ? result.entries : saved.map((entry) => ({ ...entry, editable: true }))
      setAvailability((items) => [...addedEntries, ...items])
      setShowAvailability(false)
      setMessage(`Thank you, ${entries[0].name}. Your availability was added. You can edit it later from this device.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your availability. Please try again.')
      return false
    }
  }
  async function updateAvailabilities(entries: Availability[]) {
    try {
      await apiRequest({ action: 'updateAvailabilityBatch', entries })
      const updates = new Map(entries.map((entry) => [entry.id, entry]))
      setAvailability((items) => items.map((item) => updates.get(item.id) || item))
      setEditingAvailability(null)
      setMessage(`${entries.length} ${entries.length === 1 ? 'date was' : 'dates were'} updated.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update your availability. Please try again.')
    }
  }
  async function removeAvailabilities(entries: Availability[]) {
    try {
      await apiRequest({ action: 'deleteAvailabilityBatch', availabilityIds: entries.map((entry) => entry.id) })
      const removedIds = new Set(entries.map((entry) => entry.id))
      setAvailability((items) => items.filter((item) => !removedIds.has(item.id)))
      setEditingAvailability(null)
      setMessage(`${entries.length} availability ${entries.length === 1 ? 'date was' : 'dates were'} removed.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not remove your availability. Please try again.')
    }
  }
  async function saveEvents(eventsToSave: TeamEvent[]) {
    try {
      const result = await apiRequest({ action: 'addEventBatch', events: eventsToSave })
      const savedEvents = Array.isArray(result.events) && result.events.length ? result.events : eventsToSave
      setTeamEvents((events) => {
        const savedIds = new Set(savedEvents.map((event: TeamEvent) => event.id))
        return [...events.filter((event) => !savedIds.has(event.id)), ...savedEvents].sort((a, b) => a.date.localeCompare(b.date))
      })
      setShowAdd(false)
      setMessage(eventsToSave.length === 1 ? 'The new item was added to the shared schedule.' : `${eventsToSave.length} weekly items were added to the shared schedule.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save this item. Please try again.')
      return false
    }
  }
  async function updateEvent(event: TeamEvent) {
    try {
      await apiRequest({ action: 'updateEvent', event })
      setTeamEvents((events) => events.map((item) => item.id === event.id ? { ...event, isScheduleException: event.scheduleSource === 'stu_work' ? true : event.isScheduleException, helper: isNoSupport(event.helpNeeded) ? undefined : item.helper, requestPending: isNoSupport(event.helpNeeded) ? false : item.requestPending, requesterName: isNoSupport(event.helpNeeded) ? undefined : item.requesterName } : item).sort((a, b) => a.date.localeCompare(b.date)))
      setEditingEvent(null)
      setMessage('The schedule item was updated.')
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update this item. Please try again.')
    }
  }
  async function removeEvent(eventId: string) {
    try {
      await apiRequest({ action: 'deleteEvent', eventId })
      setTeamEvents((events) => events.filter((event) => event.id !== eventId))
      setEditingEvent(null)
      setMessage('The schedule item was removed.')
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not remove this item. Please try again.')
    }
  }
  async function approveSupportRequest() {
    try {
      await apiRequest({ action: 'approveRequest', token: approvalToken })
      setApprovalRequest(null)
      setApprovalToken('')
      window.history.replaceState({}, '', window.location.pathname)
      await refreshData()
      setMessage('Approved. The schedule now shows who is confirmed.')
      window.setTimeout(() => setMessage(''), 6000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not approve this request.')
    }
  }
  function showSupportNeeded() {
    setView('upcoming')
    setFilter('all')
    window.setTimeout(() => document.getElementById('schedule-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  function openEditAndApprove() {
    if (!organizer) {
      setShowOrganizerLogin(true)
      return
    }
    document.getElementById('organizer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function addToCalendar(event: TeamEvent) {
    const dateKey = event.date.slice(0, 8)
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marys Team//Family Calendar//EN', 'BEGIN:VEVENT', `UID:${event.id}@marys-team`, `DTSTART:${dateKey}T${event.time.replace(':', '')}00`, `DTEND:${dateKey}T${(event.endTime || addHour(event.time)).replace(':', '')}00`, `SUMMARY:${event.title}`, `DESCRIPTION:${event.details} Support: ${event.helpNeeded}`, `LOCATION:${event.location || 'Mary and Stu’s home'}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${event.id}.ics`
    link.click()
    URL.revokeObjectURL(url)
    setMessage('The calendar item was downloaded. Open it to add it to your calendar.')
    window.setTimeout(() => setMessage(''), 6000)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Mary’s Team home"><span className="brand-mark"><HeartHandshake aria-hidden="true" /></span><span>Mary’s Team</span></a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /><span>Help Needed</span></button>
          <button type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /><span>Add Availability</span></button>
          <button type="button" onClick={openEditAndApprove}><Pencil aria-hidden="true" /><span>Edit &amp; Approve</span>{organizer && pendingRequests.length > 0 && <strong aria-label={`${pendingRequests.length} requests waiting`}>{pendingRequests.length}</strong>}</button>
        </nav>
        <button className="help-button" type="button" onClick={() => setShowHelp(true)}><CircleHelp aria-hidden="true" /> <span>How to use this page</span></button>
      </header>
      <main id="top">
        <section className="welcome" aria-labelledby="page-title">
          <div><p className="eyebrow">Family schedule and support</p><h1 id="page-title">The Greenbergs’ Schedule</h1><p className="intro">See what’s coming up, spend time together, and support where it fits.</p></div>
          <div className="quick-actions" role="group" aria-label="Page actions">
            <button className="support-button" type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /> See where support is needed</button>
            <button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Tell us when you’re free</button>
            {organizer ? <button className="primary-button" type="button" onClick={() => setShowAdd(true)}>+ Add an appointment or task</button> : <button className="primary-button" type="button" onClick={openEditAndApprove}><Pencil aria-hidden="true" /> Edit &amp; Approve</button>}
          </div>
        </section>
        <div className="helper-note"><HeartHandshake aria-hidden="true" /><p><strong>New here?</strong> Start with <button type="button" onClick={showSupportNeeded}>Help Needed</button> to choose a time, or <button type="button" onClick={() => setShowAvailability(true)}>Add Availability</button> to share when you’re free.</p><button type="button" onClick={() => setShowHelp(true)}>See how it works</button></div>
        {organizer && <OrganizerPanel requests={pendingRequests} stuWorkDefaults={stuWorkDefaults} onSaveStuWorkHours={saveStuWorkHours} onDecide={decideRequest} onLogout={organizerLogout} />}
        {cloudError && <div className="cloud-message error" role="alert"><p><strong>We could not reach the shared schedule.</strong> {cloudError}</p><button type="button" onClick={() => void refreshData(true)}>Try again</button></div>}
        {!cloudError && loading && <div className="cloud-message" role="status"><p><strong>Opening the shared schedule...</strong></p></div>}
        <section className="schedule" aria-labelledby="schedule-title">
          <div className="section-heading">
            <div><p className="eyebrow">Plan together</p><h2 id="schedule-title">Schedule</h2></div>
            <div className="view-toggle" role="group" aria-label="Choose schedule view"><button aria-pressed={view === 'upcoming'} className={view === 'upcoming' ? 'active' : ''} type="button" onClick={() => setView('upcoming')}><ListChecks aria-hidden="true" /> Help Needed</button><button aria-pressed={view === 'week'} className={view === 'week' ? 'active' : ''} type="button" onClick={() => setView('week')}><CalendarDays aria-hidden="true" /> This Week</button><button aria-pressed={view === 'month'} className={view === 'month' ? 'active' : ''} type="button" onClick={() => setView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div>
          </div>
          <p className="schedule-view-note">{view === 'upcoming' ? 'Rides and specific needs are shown first, followed by time with Mary.' : view === 'month' ? 'Every schedule item for the next 30 days.' : 'A simple calendar for the next 7 days.'}</p>
          {view === 'upcoming' && <div className="filters" role="group" aria-label="Show schedule items by support needed">
            {([['all', 'Everything'], ['ride', 'Rides'], ['mary', 'Spend time with Mary'], ['home', 'Home & errands'], ['coco', 'Coco']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} type="button" onClick={() => setFilter(value)}>{label}</button>)}
          </div>}
          {!loading && (view !== 'week' ? <div className="event-list">
            {visibleEvents.length ? visibleEvents.map((event) => {
              const WhoIcon = whoDetails[event.forWho].icon
              const helper = helpers[event.id] || event.helper
              const suggestedHelpers = matchingAvailability(event, availability)
              return <article className={`event-card viewable ${event.category}`} id={`event-${event.id}`} key={event.id} onClick={() => setViewingEvent(event)}>
                <div className="event-date"><span className="category-label"><WhoIcon aria-hidden="true" /> {whoDetails[event.forWho].label}</span><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {eventTimeRangeLabel(event)}</strong>{(event.repeatGroupId || event.scheduleSource === 'stu_work') && <small className="repeat-label"><Repeat2 aria-hidden="true" /> {event.scheduleSource === 'stu_work' ? event.isScheduleException ? 'Different from weekly hours' : 'Weekly work hours' : 'Repeats weekly'}</small>}</div>
                <div className="event-info"><h3>{event.title}</h3><p>{event.details}</p>{event.location && <p className="location">{event.location}</p>}<span className="card-details-hint">Tap to see details</span><div className={`needed ${isNoSupport(event.helpNeeded) ? 'busy-needed' : ''}`}><ListChecks aria-hidden="true" /><span><small>{isNoSupport(event.helpNeeded) ? 'Busy time' : 'Support requested'}</small><strong>{isNoSupport(event.helpNeeded) ? 'Please do not stop by during this time.' : event.helpNeeded}</strong></span></div>{!helper && !event.requestPending && suggestedHelpers.length > 0 && !isNoSupport(event.helpNeeded) && <div className="suggested-help"><HeartHandshake aria-hidden="true" /><span><small>People available then</small><strong>{suggestedHelpers.map((entry) => entry.name).join(', ')}</strong><em>They can choose this time if it works for them.</em></span></div>}</div>
                <div className="event-actions">
                  {isNoSupport(event.helpNeeded) ? <div className="busy-status"><Clock3 aria-hidden="true" /><span><small>Status</small><strong>Busy</strong></span></div> : helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Awaiting approval</small><strong>{organizer && event.requesterName ? `Requested by ${event.requesterName}` : 'Request waiting for Mary or Stu'}</strong></span></div> : <button className="primary-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setSignupEvent(event) }}><HeartHandshake aria-hidden="true" /> Sign me up!</button>}
                  <button className="calendar-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); addToCalendar(event) }}><Download aria-hidden="true" /> Add to my calendar</button>
                  <button className="edit-event-link" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setViewingEvent(event) }}><Pencil aria-hidden="true" /> {organizer ? 'View or edit details' : 'View details'}</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => organizer ? setShowAdd(true) : setShowOrganizerLogin(true)} supportOnly={view === 'upcoming'} />}
          </div> : <WeekCalendar events={teamEvents} helpers={helpers} availability={availability} onOpen={(eventId) => { const event = teamEvents.find((item) => item.id === eventId); if (event) setViewingEvent(event) }} />)}
        </section>
        <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">Who is available</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add my availability</button></div>
          <div className="availability-view-heading"><div className="view-toggle" role="group" aria-label="Choose availability view"><button aria-pressed={availabilityView === 'upcoming'} className={availabilityView === 'upcoming' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('upcoming')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={availabilityView === 'month'} className={availabilityView === 'month' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div><p>{availabilityView === 'upcoming' ? 'The next 7 days' : 'The next 30 days'}</p></div>
          {!loading && <div className="availability-list">{visibleAvailability.length ? visibleAvailability.map((entry) => <article className={entry.editable ? 'editable' : ''} key={entry.id} onClick={() => entry.editable && setEditingAvailability(entry)}><div className="availability-date"><span>{availabilityDayLabel(entry.day).split(',')[0]}</span><strong>{availabilityDayLabel(entry.day).split(',').slice(1).join(',').trim()}</strong></div><div className="person-icon"><Users aria-hidden="true" /></div><div className="availability-person"><h3>{entry.name}</h3><p className={`availability-time ${entry.time === 'anytime' ? 'all-day' : ''}`}>{availabilityTimeLabel(entry.time)}</p><p className="availability-help">{entry.note}</p>{entry.phone && <a className="availability-phone" href={`tel:${entry.phone}`} onClick={(clickEvent) => clickEvent.stopPropagation()}><span>Call or text</span> {entry.phone}</a>}</div>{entry.editable && <button className="tap-edit" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setEditingAvailability(entry) }} aria-label={`Edit ${entry.name}’s availability for ${availabilityDayLabel(entry.day)}`}><Pencil aria-hidden="true" /> Edit</button>}</article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability in {availabilityView === 'upcoming' ? 'the next 7 days' : 'the next 30 days'}</h3><p>Friends and family can share when they may be free to support or spend time together.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add my availability</button></div>}</div>}
        </section>
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Questions? Call or text the family coordinator.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {viewingEvent && <EventDetailsModal event={viewingEvent} organizer={organizer} onClose={() => setViewingEvent(null)} onEdit={() => { setViewingEvent(null); setEditingEvent(viewingEvent) }} />}
      {editingEvent && <EditEventModal event={editingEvent} onClose={() => setEditingEvent(null)} onSave={updateEvent} onRemove={removeEvent} />}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
      {editingAvailability && <EditAvailabilityModal entries={availability.filter((entry) => (phoneKey(editingAvailability.phone) ? phoneKey(entry.phone) === phoneKey(editingAvailability.phone) : entry.name.trim().toLocaleLowerCase() === editingAvailability.name.trim().toLocaleLowerCase()) && allAvailabilityDates.has(entry.day))} initialEntry={editingAvailability} onClose={() => setEditingAvailability(null)} onSave={updateAvailabilities} onRemove={removeAvailabilities} />}
      {showAdd && <AddEventModal onClose={() => setShowAdd(false)} onSave={saveEvents} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {approvalRequest && <ApprovalModal request={approvalRequest} onClose={() => setApprovalRequest(null)} onApprove={approveSupportRequest} />}
      {showOrganizerLogin && <OrganizerLoginModal onClose={() => setShowOrganizerLogin(false)} onLogin={organizerLogin} />}
    </div>
  )
}

function getThirtyDays() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      shortDay: date.toLocaleDateString('en-US', { weekday: 'short' }),
      monthShort: date.toLocaleDateString('en-US', { month: 'short' }),
      number: date.toLocaleDateString('en-US', { day: 'numeric' }),
      fullDay: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      dateKey: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    }
  })
}

function EmptySchedule({ onAdd, supportOnly = false }: { onAdd: () => void; supportOnly?: boolean }) {
  return <div className="empty-state"><CalendarDays aria-hidden="true" /><h3>{supportOnly ? 'No open support is needed right now' : 'Nothing has been added yet'}</h3><p>{supportOnly ? 'This is good news. Check This Month to see the full family schedule.' : 'Mary or Stu can add the first appointment or task.'}</p>{!supportOnly && <button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button>}</div>
}

function WeekCalendar({ events, helpers, availability, onOpen }: { events: TeamEvent[]; helpers: Record<string, string>; availability: Availability[]; onOpen?: (eventId: string) => void }) {
  const days = getThirtyDays().slice(0, 7)
  const weekDays = days.map((day) => ({
    ...day,
    events: events.filter((event) => event.date.startsWith(day.dateKey)),
    availablePeople: availability.filter((entry) => entry.day === day.dateKey),
  }))
  const lastDay = days.at(-1)?.fullDay
  return <div className="week-calendar" role="region" aria-label={`Calendar for today through ${lastDay}`}>{weekDays.map(({ shortDay, number, fullDay, dateKey, events: dayEvents, availablePeople }) => <section className={`calendar-day ${dayEvents.length ? 'has-events' : ''}`} key={dateKey} aria-label={fullDay}><div className="calendar-date"><span>{shortDay}</span><strong>{number}</strong></div><div className="calendar-items">{dayEvents.length ? dayEvents.map((event) => {
    const helper = helpers[event.id] || event.helper
    const matches = isNoSupport(event.helpNeeded) ? [] : availablePeople.filter((entry) => availabilityMatchesTime(entry.time, event.time, event.endTime))
    return <button type="button" key={event.id} disabled={!onOpen} onClick={() => onOpen?.(event.id)}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{eventTimeRangeLabel(event)}</small>{isNoSupport(event.helpNeeded) ? <em>Busy</em> : helper ? <em>Confirmed with {helper}</em> : event.requestPending ? <em>Request waiting for approval</em> : <em>{event.helpNeeded}</em>}{!helper && !event.requestPending && matches.length > 0 && <em className="availability-match">Available then: {matches.map((entry) => entry.name).join(', ')}</em>}</span></button>
  }) : <p>No plans.</p>}</div></section>)}</div>
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="close-button" type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button><h2 id="modal-title">{title}</h2>{children}</section></div>
}
function EventDetailsModal({ event, organizer, onClose, onEdit }: { event: TeamEvent; organizer: boolean; onClose: () => void; onEdit: () => void }) {
  return <ModalShell title={event.title} onClose={onClose}>
    <div className="event-detail-summary">
      <div><small>Who</small><strong>{whoDetails[event.forWho].label}</strong></div>
      <div><small>When</small><strong>{event.dayLabel}<br />{eventTimeRangeLabel(event)}</strong></div>
      <div><small>{isNoSupport(event.helpNeeded) ? 'Status' : 'Support requested'}</small><strong>{isNoSupport(event.helpNeeded) ? 'Busy – please do not stop by' : event.helpNeeded}</strong></div>
      {event.location && <div><small>Where</small><strong>{event.location}</strong></div>}
      <div><small>Details</small><p>{event.details}</p></div>
      {event.helper && <div><small>Confirmed</small><strong>{event.helper}</strong></div>}
      {!event.helper && event.requestPending && <div><small>Status</small><strong>Waiting for Mary or Stu to approve a request</strong></div>}
    </div>
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Close</button>{organizer && <button className="primary-button" type="button" onClick={onEdit}><Pencil aria-hidden="true" /> Edit</button>}</div>
  </ModalShell>
}
function OrganizerPanel({ requests, stuWorkDefaults, onSaveStuWorkHours, onDecide, onLogout }: { requests: PendingRequest[]; stuWorkDefaults: StuWorkDefaults | null; onSaveStuWorkHours: (defaults: StuWorkDefaults) => Promise<boolean>; onDecide: (id: string, decision: 'approve' | 'decline') => void; onLogout: () => void }) {
  const [tab, setTab] = useState<'requests' | 'work'>('requests')
  const workKey = stuWorkDefaults ? `${stuWorkDefaults.weekdays.join(',')}-${stuWorkDefaults.startTime}-${stuWorkDefaults.endTime}` : 'new'
  return <section className="organizer-panel" id="organizer-panel" aria-labelledby="organizer-title">
    <div className="organizer-heading"><div><p className="eyebrow">Private family area</p><h2 id="organizer-title">Edit &amp; Approve</h2></div><button className="text-button" type="button" onClick={onLogout}>Close private access</button></div>
    <div className="organizer-tabs" role="tablist" aria-label="Choose private family area">
      <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} type="button" onClick={() => setTab('requests')}><Check aria-hidden="true" /> Requests{requests.length ? ` (${requests.length})` : ''}</button>
      <button role="tab" aria-selected={tab === 'work'} className={tab === 'work' ? 'active' : ''} type="button" onClick={() => setTab('work')}><Clock3 aria-hidden="true" /> Stu’s Work Hours</button>
    </div>
    {tab === 'requests' ? requests.length ? <><p className="organizer-intro">Review each request below. These names and phone numbers are only visible after entering the family PIN.</p><div className="organizer-requests">{requests.map((request) => <article key={request.id}><div><strong>{request.requesterName}</strong><a href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a><p>{request.title}</p><small>{request.dayLabel}, {eventTimeLabel(request.time)} – {eventTimeLabel(request.endTime)} · {request.helpNeeded}</small></div><div><button className="text-button" type="button" onClick={() => onDecide(request.id, 'decline')}>Decline</button><button className="primary-button" type="button" onClick={() => onDecide(request.id, 'approve')}><Check aria-hidden="true" /> Approve</button></div></article>)}</div></> : <div className="organizer-empty"><Check aria-hidden="true" /><p><strong>No requests are waiting.</strong><br />New requests will appear here even if email is delayed.</p></div> : <StuWorkHoursEditor key={workKey} defaults={stuWorkDefaults} onSave={onSaveStuWorkHours} />}
  </section>
}

function StuWorkHoursEditor({ defaults, onSave }: { defaults: StuWorkDefaults | null; onSave: (defaults: StuWorkDefaults) => Promise<boolean> }) {
  const [weekdays, setWeekdays] = useState(defaults?.weekdays || [1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState(defaults?.startTime || '09:00')
  const [endTime, setEndTime] = useState(defaults?.endTime || '17:00')
  const [saving, setSaving] = useState(false)
  const timeIsValid = endTime > startTime

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!timeIsValid || saving) return
    setSaving(true)
    const saved = await onSave({ weekdays, startTime, endTime })
    setSaving(false)
    if (!saved) return
  }

  return <div className="work-hours-editor">
    <div><h3>Weekly default</h3><p>Choose Stu’s normal workdays and hours. This fills the upcoming schedule for the next 90 days.</p></div>
    <form onSubmit={submit}>
      <fieldset className="weekday-picker"><legend>Which days does Stu normally work?</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => setWeekdays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value].sort())} /><span aria-hidden="true">{day.short}</span><span className="sr-only">{day.label}</span></label>)}</fieldset>
      <div className="field-row"><div><label htmlFor="stu-work-start">Usually starts</label><input id="stu-work-start" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div><div><label htmlFor="stu-work-end">Usually ends</label><input id="stu-work-end" type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div></div>
      {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <p className="work-hours-tip"><strong>Different hours one day?</strong> Open that work entry in This Week or This Month and choose Edit. That date will stay separate when the weekly default changes.</p>
      {!weekdays.length && <p className="work-hours-tip"><strong>No days selected.</strong> Saving will remove the regular work entries. Individually changed days will stay.</p>}
      <div className="form-actions"><button className="primary-button" type="submit" disabled={!timeIsValid || saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : 'Save weekly hours'}</button></div>
    </form>
  </div>
}

function OrganizerLoginModal({ onClose, onLogin }: { onClose: () => void; onLogin: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await onLogin(pin) } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'Organizer access could not be opened.'); setSaving(false) }
  }
  return <ModalShell title="Edit & Approve" onClose={onClose}><p className="modal-intro">Enter the family PIN to edit the schedule or approve requests.</p><form onSubmit={submit}><label htmlFor="organizer-pin">Family PIN</label><input id="organizer-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))} autoFocus required />{error && <p className="field-error" role="alert">{error}</p>}<div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving || pin.length < 4}>{saving ? 'Opening…' : 'Open Edit & Approve'}</button></div></form></ModalShell>
}
function SignupModal({ event, onClose, onSave }: { event: TeamEvent; onClose: () => void; onSave: (id: string, name: string, phone: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !name.trim() || !phone.trim()) return
    setSaving(true)
    const saved = await onSave(eventId, name.trim(), phone.trim())
    if (!saved) setSaving(false)
  }
  const eventId = event.id
  return <ModalShell title="Sign me up!" onClose={onClose}><div className="modal-summary"><strong>{event.title}</strong><span>{event.dayLabel}, {eventTimeRangeLabel(event)}</span><p>{event.helpNeeded}</p></div><form onSubmit={submit}><label htmlFor="helper-name">Your name</label><input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your first and last name" autoFocus required /><label htmlFor="helper-phone">Your phone number</label><input id="helper-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" required /><p className="form-note">Mary and Stu will receive your request and contact information. This time is not confirmed until one of them approves it.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving request…' : 'Sign me up!'}</button></div></form></ModalShell>
}
function AvailabilityModal({ onClose, onSave }: { onClose: () => void; onSave: (entries: Omit<Availability, 'id'>[]) => Promise<boolean> }) {
  const days = getThirtyDays()
  const firstDate = days[0].dateKey
  const firstWeekday = new Date(`${firstDate.slice(0, 4)}-${firstDate.slice(4, 6)}-${firstDate.slice(6, 8)}T12:00:00`).getDay()
  const timeOptions = Array.from({ length: 37 }, (_, index) => {
    const minutes = 6 * 60 + index * 30
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { value, label: eventTimeLabel(value) }
  })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [mode, setMode] = useState<'dates' | 'range' | 'weekly'>('dates')
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [rangeStart, setRangeStart] = useState(days[0].dateKey)
  const [rangeEnd, setRangeEnd] = useState(days[Math.min(13, days.length - 1)].dateKey)
  const [weekday, setWeekday] = useState('2')
  const [timeMode, setTimeMode] = useState<'hours' | 'all-day'>('hours')
  const [startTime, setStartTime] = useState('12:00')
  const [endTime, setEndTime] = useState('15:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function datesForSelection() {
    if (mode === 'dates') return selectedDates
    const inRange = days.filter((day) => day.dateKey >= rangeStart && day.dateKey <= rangeEnd)
    if (mode === 'range') return inRange.map((day) => day.dateKey)
    return inRange.filter((day) => {
      const parsed = new Date(`${day.dateKey.slice(0, 4)}-${day.dateKey.slice(4, 6)}-${day.dateKey.slice(6, 8)}T12:00:00`)
      return parsed.getDay() === Number(weekday)
    }).map((day) => day.dateKey)
  }

  const chosenDates = datesForSelection()
  const selectionIsValid = chosenDates.length > 0 && (timeMode === 'all-day' || endTime > startTime)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectionIsValid || saving) return
    setSaving(true)
    const saved = await onSave(chosenDates.map((day) => ({ name, phone, day, time: timeMode === 'all-day' ? 'anytime' : `${startTime}-${endTime}`, note })))
    if (!saved) setSaving(false)
  }

  return <ModalShell title="Add my availability" onClose={onClose}>
    <p className="modal-intro">Choose several dates, a date range, or a repeating weekday. Your availability will appear in “This Month.”</p>
    <form onSubmit={submit}>
      <label htmlFor="available-name">Your name</label>
      <input id="available-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first and last name" autoFocus />
      <label htmlFor="available-phone">Your phone number</label>
      <input id="available-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" />
      <p className="form-note privacy-note">Your phone number will be visible to anyone who has the link to this page.</p>
      <label>Which dates?</label>
      <div className="availability-mode" role="group" aria-label="Choose how to select dates">
        <button type="button" aria-pressed={mode === 'dates'} onClick={() => setMode('dates')}>Pick dates</button>
        <button type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>Date range</button>
        <button type="button" aria-pressed={mode === 'weekly'} onClick={() => setMode('weekly')}>Every week</button>
      </div>
      {mode === 'dates' && <div className="calendar-date-picker">
        <div className="date-picker-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="date-picker-grid" role="group" aria-label="Select one or more dates">{Array.from({ length: firstWeekday }, (_, index) => <span className="date-picker-blank" key={`blank-${index}`} aria-hidden="true" />)}{days.map((day) => {
          const selected = selectedDates.includes(day.dateKey)
          return <button type="button" key={day.dateKey} aria-label={day.fullDay} aria-pressed={selected} onClick={() => setSelectedDates(selected ? selectedDates.filter((date) => date !== day.dateKey) : [...selectedDates, day.dateKey])}><span>{day.monthShort}</span><strong>{day.number}</strong></button>
        })}</div>
      </div>}
      {(mode === 'range' || mode === 'weekly') && <div className="range-fields">
        {mode === 'weekly' && <div><label htmlFor="available-weekday">Repeat on</label><select id="available-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}><option value="0">Every Sunday</option><option value="1">Every Monday</option><option value="2">Every Tuesday</option><option value="3">Every Wednesday</option><option value="4">Every Thursday</option><option value="5">Every Friday</option><option value="6">Every Saturday</option></select></div>}
        <div><label htmlFor="available-start-date">Starting</label><select id="available-start-date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)}>{days.map((day) => <option key={day.dateKey} value={day.dateKey}>{day.fullDay}</option>)}</select></div>
        <div><label htmlFor="available-end-date">Through</label><select id="available-end-date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)}>{days.map((day) => <option key={day.dateKey} value={day.dateKey}>{day.fullDay}</option>)}</select></div>
      </div>}
      <p className="selection-summary"><strong>{chosenDates.length || 'No'} {chosenDates.length === 1 ? 'date' : 'dates'} selected</strong>{mode === 'dates' && !chosenDates.length ? ' – choose at least one date above.' : ''}</p>
      <label>When are you available?</label>
      <div className="time-mode" role="group" aria-label="Choose all day or specific hours"><button type="button" aria-pressed={timeMode === 'all-day'} onClick={() => setTimeMode('all-day')}>All day</button><button type="button" aria-pressed={timeMode === 'hours'} onClick={() => setTimeMode('hours')}>Choose hours</button></div>
      {timeMode === 'hours' && <div className="field-row"><div><label htmlFor="available-start-time">Available from</label><select id="available-start-time" value={startTime} onChange={(e) => setStartTime(e.target.value)}>{timeOptions.slice(0, -1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label htmlFor="available-end-time">Until</label><select id="available-end-time" value={endTime} onChange={(e) => setEndTime(e.target.value)}>{timeOptions.slice(1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>}
      {timeMode === 'hours' && endTime <= startTime && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <label htmlFor="available-note">What are you comfortable supporting?</label>
      <select id="available-note" required value={note} onChange={(e) => setNote(e.target.value)}><option value="">Choose one</option>{helpChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!selectionIsValid || saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : <>Add {chosenDates.length || ''} {chosenDates.length === 1 ? 'date' : 'dates'}</>}</button></div>
    </form>
  </ModalShell>
}
function EditAvailabilityModal({ entries, initialEntry, onClose, onSave, onRemove }: { entries: Availability[]; initialEntry: Availability; onClose: () => void; onSave: (entries: Availability[]) => void; onRemove: (entries: Availability[]) => void }) {
  const timeOptions = Array.from({ length: 37 }, (_, index) => {
    const minutes = 6 * 60 + index * 30
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { value, label: eventTimeLabel(value) }
  })
  const range = initialEntry.time.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  const [selectedIds, setSelectedIds] = useState([initialEntry.id])
  const [name, setName] = useState(initialEntry.name)
  const [phone, setPhone] = useState(initialEntry.phone || '')
  const [timeMode, setTimeMode] = useState<'hours' | 'all-day'>(initialEntry.time === 'anytime' ? 'all-day' : 'hours')
  const [startTime, setStartTime] = useState(range?.[1] || '12:00')
  const [endTime, setEndTime] = useState(range?.[2] || '15:00')
  const [note, setNote] = useState(initialEntry.note)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const timeIsValid = timeMode === 'all-day' || endTime > startTime
  const selectedEntries = entries.filter((entry) => selectedIds.includes(entry.id))

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!timeIsValid || !selectedEntries.length) return
    onSave(selectedEntries.map((entry) => ({ ...entry, name: name.trim(), phone: phone.trim(), time: timeMode === 'all-day' ? 'anytime' : `${startTime}-${endTime}`, note })))
  }

  return <ModalShell title="Edit availability" onClose={onClose}>
    <p className="modal-intro">Choose the dates to change. The new contact details, hours, and support type will apply to every selected date.</p>
    <form onSubmit={submit}>
      <fieldset className="bulk-date-list"><legend>Which dates do you want to change?</legend><div className="bulk-date-actions"><button type="button" onClick={() => setSelectedIds(entries.map((entry) => entry.id))}>Select all {entries.length} dates</button><button type="button" onClick={() => setSelectedIds([initialEntry.id])}>Only {availabilityDayLabel(initialEntry.day)}</button></div>{[...entries].sort((a, b) => a.day.localeCompare(b.day)).map((entry) => <label key={entry.id}><input type="checkbox" checked={selectedIds.includes(entry.id)} onChange={() => setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])} /><span><strong>{availabilityDayLabel(entry.day)}</strong><small>{availabilityTimeLabel(entry.time)}</small></span></label>)}</fieldset>
      <p className="selection-summary"><strong>{selectedEntries.length || 'No'} {selectedEntries.length === 1 ? 'date' : 'dates'} selected</strong></p>
      <label htmlFor="edit-available-name">Your name</label>
      <input id="edit-available-name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      <label htmlFor="edit-available-phone">Your phone number</label>
      <input id="edit-available-phone" type="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" />
      <p className="form-note privacy-note">Your phone number will be visible to anyone who has the link to this page.</p>
      <label>When are you available?</label>
      <div className="time-mode" role="group" aria-label="Choose all day or specific hours"><button type="button" aria-pressed={timeMode === 'all-day'} onClick={() => setTimeMode('all-day')}>All day</button><button type="button" aria-pressed={timeMode === 'hours'} onClick={() => setTimeMode('hours')}>Choose hours</button></div>
      {timeMode === 'hours' && <div className="field-row"><div><label htmlFor="edit-available-start-time">Available from</label><select id="edit-available-start-time" value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.slice(0, -1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label htmlFor="edit-available-end-time">Until</label><select id="edit-available-end-time" value={endTime} onChange={(event) => setEndTime(event.target.value)}>{timeOptions.slice(1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>}
      {timeMode === 'hours' && !timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <label htmlFor="edit-available-note">What are you comfortable supporting?</label>
      <select id="edit-available-note" required value={note} onChange={(event) => setNote(event.target.value)}>{helpChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>
      <div className="remove-area">{confirmRemove ? <div className="remove-confirm" role="alert"><p><strong>Remove {selectedEntries.length === 1 ? 'this date' : `these ${selectedEntries.length} dates`}?</strong><br />The other dates will stay on the list.</p><div><button className="text-button" type="button" onClick={() => setConfirmRemove(false)}>Keep them</button><button className="danger-button" type="button" onClick={() => onRemove(selectedEntries)}><Trash2 aria-hidden="true" /> Yes, remove {selectedEntries.length === 1 ? 'it' : 'them'}</button></div></div> : <button className="remove-button" type="button" onClick={() => setConfirmRemove(true)} disabled={!selectedEntries.length}><Trash2 aria-hidden="true" /> Remove selected {selectedEntries.length === 1 ? 'date' : 'dates'}</button>}</div>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid || !selectedEntries.length}><Check aria-hidden="true" /> Save changes to {selectedEntries.length || 0} {selectedEntries.length === 1 ? 'date' : 'dates'}</button></div>
    </form>
  </ModalShell>
}
function dayLabelForDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function compactEventDate(date: string, time: string) {
  return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`
}

function AddEventModal({ onClose, onSave }: { onClose: () => void; onSave: (events: TeamEvent[]) => Promise<boolean> }) {
  const [form, setForm] = useState(() => ({ title: '', date: new Date().toISOString().slice(0, 10), time: '12:00', endTime: '13:00', forWho: 'Mary' as ForWho, helpNeeded: 'Need a ride', details: '', location: '' }))
  const [repeats, setRepeats] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repeatThrough, setRepeatThrough] = useState(() => {
    const repeatDefault = new Date()
    repeatDefault.setDate(repeatDefault.getDate() + 28)
    return repeatDefault.toISOString().slice(0, 10)
  })
  const timeIsValid = form.endTime > form.time

  function changeStartTime(time: string) {
    const endTime = addHour(time)
    setForm((current) => ({ ...current, time, endTime: endTime > time ? endTime : current.endTime }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!timeIsValid || saving) return
    const dates: string[] = []
    const cursor = new Date(`${form.date}T12:00:00`)
    const finalDate = new Date(`${repeats ? (repeatThrough < form.date ? form.date : repeatThrough) : form.date}T12:00:00`)
    while (cursor <= finalDate && dates.length < 52) {
      dates.push(cursor.toISOString().slice(0, 10))
      cursor.setDate(cursor.getDate() + 7)
    }
    const repeatGroupId = repeats ? crypto.randomUUID() : undefined
    const events = dates.map((date) => ({ id: crypto.randomUUID(), category: form.forWho === 'Mary' ? 'appointment' as const : 'family' as const, forWho: form.forWho, date: compactEventDate(date, form.time), dayLabel: dayLabelForDate(date), time: form.time, endTime: form.endTime, title: form.title, details: form.details.trim() || defaultEventDetails, location: form.location || undefined, helpNeeded: form.helpNeeded, repeatGroupId }))
    setSaving(true)
    const saved = await onSave(events)
    if (!saved) setSaving(false)
  }

  return <ModalShell title="Add an appointment or task" onClose={onClose}><p className="modal-intro">Add one item or repeat it every week.</p><form onSubmit={submit}>
    <label htmlFor="event-title">What is happening?</label><input id="event-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Example: Mary’s eye appointment" autoFocus />
    <div className="field-row"><div><label htmlFor="event-date">Date</label><input id="event-date" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div><div><label htmlFor="event-for-who">Who is this for?</label><select id="event-for-who" value={form.forWho} onChange={(event) => { const forWho = event.target.value as ForWho; setForm({ ...form, forWho, helpNeeded: needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <div className="field-row"><div><label htmlFor="event-time">Starts</label><input id="event-time" type="time" required value={form.time} onChange={(event) => changeStartTime(event.target.value)} /></div><div><label htmlFor="event-end-time">Ends</label><input id="event-end-time" type="time" required value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></div>
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    <label className="repeat-toggle"><input type="checkbox" checked={repeats} onChange={(event) => setRepeats(event.target.checked)} /><span><Repeat2 aria-hidden="true" /><strong>Repeat every week</strong><small>Add this on the same weekday each week.</small></span></label>
    {repeats && <><label htmlFor="repeat-through">Repeat through</label><input id="repeat-through" type="date" min={form.date} value={repeatThrough < form.date ? form.date : repeatThrough} onChange={(event) => setRepeatThrough(event.target.value)} /></>}
    <label htmlFor="event-help">What support is needed?</label><select id="event-help" value={form.helpNeeded} onChange={(event) => setForm({ ...form, helpNeeded: event.target.value })}>{supportChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    <label htmlFor="event-location">Where? <span>(optional)</span></label><input id="event-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Clinic name, home, or address" />
    <label htmlFor="event-details">Anything else people should know? <span>(optional)</span></label><textarea id="event-details" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} placeholder={defaultEventDetails} />
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid || saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : repeats ? 'Add weekly schedule' : 'Add to the schedule'}</button></div>
  </form></ModalShell>
}

function EditEventModal({ event, onClose, onSave, onRemove }: { event: TeamEvent; onClose: () => void; onSave: (event: TeamEvent) => void; onRemove: (eventId: string) => void }) {
  const date = `${event.date.slice(0, 4)}-${event.date.slice(4, 6)}-${event.date.slice(6, 8)}`
  const [form, setForm] = useState({ ...event, date, endTime: event.endTime || addHour(event.time), helpNeeded: isNoSupport(event.helpNeeded) ? 'No help needed' : event.helpNeeded })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const timeIsValid = form.endTime > form.time

  function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    if (!timeIsValid) return
    onSave({ ...event, ...form, category: form.forWho === 'Mary' ? 'appointment' : 'family', date: compactEventDate(form.date, form.time), dayLabel: dayLabelForDate(form.date), details: form.details.trim() || defaultEventDetails, location: form.location || undefined })
  }

  return <ModalShell title="View or edit schedule" onClose={onClose}><p className="modal-intro">Click any box below to make a change.{event.repeatGroupId || event.scheduleSource === 'stu_work' ? ' This changes this date only.' : ''}</p><form onSubmit={submit}>
    <label htmlFor="edit-event-title">What is happening?</label><input id="edit-event-title" required value={form.title} onChange={(changeEvent) => setForm({ ...form, title: changeEvent.target.value })} autoFocus />
    <div className="field-row"><div><label htmlFor="edit-event-date">Date</label><input id="edit-event-date" type="date" required value={form.date} onChange={(changeEvent) => setForm({ ...form, date: changeEvent.target.value })} /></div><div><label htmlFor="edit-event-for-who">Who is this for?</label><select id="edit-event-for-who" value={form.forWho} onChange={(changeEvent) => { const forWho = changeEvent.target.value as ForWho; setForm({ ...form, forWho, helpNeeded: needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <div className="field-row"><div><label htmlFor="edit-event-time">Starts</label><input id="edit-event-time" type="time" required value={form.time} onChange={(changeEvent) => setForm({ ...form, time: changeEvent.target.value, endTime: addHour(changeEvent.target.value) })} /></div><div><label htmlFor="edit-event-end-time">Ends</label><input id="edit-event-end-time" type="time" required value={form.endTime} onChange={(changeEvent) => setForm({ ...form, endTime: changeEvent.target.value })} /></div></div>
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    <label htmlFor="edit-event-help">What support is needed?</label><select id="edit-event-help" value={form.helpNeeded} onChange={(changeEvent) => setForm({ ...form, helpNeeded: changeEvent.target.value })}>{supportChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    <label htmlFor="edit-event-location">Where? <span>(optional)</span></label><input id="edit-event-location" value={form.location || ''} onChange={(changeEvent) => setForm({ ...form, location: changeEvent.target.value })} />
    <label htmlFor="edit-event-details">Details <span>(optional)</span></label><textarea id="edit-event-details" value={form.details} onChange={(changeEvent) => setForm({ ...form, details: changeEvent.target.value })} />
    <div className="remove-area">{confirmRemove ? <div className="remove-confirm" role="alert"><p><strong>Remove this schedule item?</strong></p><div><button className="text-button" type="button" onClick={() => setConfirmRemove(false)}>Keep it</button><button className="danger-button" type="button" onClick={() => onRemove(event.id)}><Trash2 aria-hidden="true" /> Yes, remove it</button></div></div> : <button className="remove-button" type="button" onClick={() => setConfirmRemove(true)}><Trash2 aria-hidden="true" /> Remove this item</button>}</div>
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid}><Check aria-hidden="true" /> Save changes</button></div>
  </form></ModalShell>
}

function ApprovalModal({ request, onClose, onApprove }: { request: ApprovalRequest; onClose: () => void; onApprove: () => void }) {
  const pending = request.status === 'pending'
  return <ModalShell title={pending ? 'Approve support request' : 'Request already handled'} onClose={onClose}><div className="modal-summary"><strong>{request.requesterName}</strong><span>{request.requesterPhone}</span><p>{request.title}</p></div><p className="modal-intro">{request.dayLabel}, {eventTimeLabel(request.time)} – {eventTimeLabel(request.endTime)}<br />{request.helpNeeded}</p>{pending ? <><p>Approve this person for the schedule? Their name will appear as confirmed.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Not now</button><button className="primary-button" type="button" onClick={onApprove}><Check aria-hidden="true" /> Approve request</button></div></> : <button className="primary-button full-button" type="button" onClick={onClose}>Close</button>}</ModalShell>
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="How to use Mary’s Team" onClose={onClose}><div className="help-list"><div><span>1</span><p><strong>See where support is needed.</strong> Choose Help Needed at the top to see open rides, time with Mary, errands, Coco care, and other support times.</p></div><div><span>2</span><p><strong>Share when you are free.</strong> Choose Add Availability and enter your dates and hours. You can edit your own availability later from the same phone or browser.</p></div><div><span>3</span><p><strong>Request an open time.</strong> Choose a time that works for you. Your request will wait for family approval.</p></div><div><span>4</span><p><strong>Edit or approve.</strong> The family can use Edit &amp; Approve with their private PIN to change the schedule and review requests.</p></div></div><button className="primary-button full-button" type="button" onClick={onClose}>Got it</button></ModalShell>
}

export default App
