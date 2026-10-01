import { useEffect, useState } from 'react'
import {
  CalendarDays, Check, CircleHelp, Clock3, Download, HeartHandshake,
  Home, ListChecks, Pencil, Printer, Trash2, UserRound, Users, X,
} from 'lucide-react'
import './App.css'

type Category = 'appointment' | 'home' | 'dad'
type TeamEvent = { id: string; category: Category; date: string; dayLabel: string; time: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string }
type Availability = { id: string; name: string; phone: string; day: string; time: string; note: string }

const categoryDetails = {
  appointment: { label: 'Mary’s appointment', icon: CalendarDays },
  home: { label: 'Help at home', icon: Home },
  dad: { label: 'Stu’s schedule', icon: UserRound },
}

const availabilityTimes = [
  { value: 'morning', label: 'Morning (8 AM – noon)' },
  { value: 'afternoon', label: 'Afternoon (noon – 5 PM)' },
  { value: 'evening', label: 'Evening (5 PM – 8 PM)' },
  { value: 'anytime', label: 'All day' },
]

const helpChoices = ['Driving or giving a ride', 'Help around the house', 'Bringing a meal', 'Visiting or checking in', 'Anything that is needed']

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

function availabilityMatchesTime(slot: string, eventTime: string) {
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

function matchingAvailability(event: TeamEvent, availability: Availability[]) {
  return availability.filter((entry) => entry.day === event.date.slice(0, 8) && availabilityMatchesTime(entry.time, event.time))
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
  const [filter, setFilter] = useState<'all' | Category>('all')
  const [view, setView] = useState<'details' | 'week'>('details')
  const [availabilityView, setAvailabilityView] = useState<'upcoming' | 'month'>('upcoming')
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signupEvent, setSignupEvent] = useState<TeamEvent | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null)
  const [message, setMessage] = useState('')
  const visibleEvents = teamEvents.filter((event) => filter === 'all' || event.category === filter)
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
      setCloudError('')
    }).catch((error) => {
      if (active) setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    const timer = window.setInterval(() => void refreshData(), 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  async function saveHelper(eventId: string, name: string) {
    try {
      await apiRequest({ action: 'claimEvent', eventId, name })
      setTeamEvents((events) => events.map((event) => event.id === eventId ? { ...event, helper: name } : event))
      setSignupEvent(null)
      setMessage(`Thank you, ${name}. You are signed up to help.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your sign-up. Please try again.')
      await refreshData()
    }
  }
  async function saveAvailability(entries: Omit<Availability, 'id'>[]) {
    try {
      const saved = entries.map((entry) => ({ ...entry, id: crypto.randomUUID() }))
      await apiRequest({ action: 'addAvailabilityBatch', entries: saved })
      setAvailability((items) => [...saved, ...items])
      setShowAvailability(false)
      setMessage(`Thank you, ${entries[0].name}. Your availability was added for ${entries.length} ${entries.length === 1 ? 'date' : 'dates'}.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your availability. Please try again.')
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
  async function saveEvent(event: TeamEvent) {
    try {
      await apiRequest({ action: 'addEvent', event })
      setTeamEvents((events) => [...events, event].sort((a, b) => a.date.localeCompare(b.date)))
      setShowAdd(false)
      setMessage('The new item was added to the shared schedule.')
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save this item. Please try again.')
    }
  }
  function addToCalendar(event: TeamEvent) {
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marys Team//Family Calendar//EN', 'BEGIN:VEVENT', `UID:${event.id}@marys-team`, `DTSTART:${event.date}`, `DTEND:${event.date}`, `SUMMARY:${event.title}`, `DESCRIPTION:${event.details} Help needed: ${event.helpNeeded}`, `LOCATION:${event.location || 'Mary and Dad’s home'}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
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
        <div className="header-actions"><button className="header-add" type="button" onClick={() => setShowAdd(true)}>+ Add something</button><button className="help-button" type="button" onClick={() => setShowHelp(true)}><CircleHelp aria-hidden="true" /> How to use this page</button></div>
      </header>
      <main id="top">
        <section className="welcome" aria-labelledby="page-title">
          <div><p className="eyebrow">Family schedule and help list</p><h1 id="page-title">The Greenbergs’ Schedule</h1><p className="intro">See what’s coming up and choose something if you can help.</p></div>
          <div className="quick-actions" aria-label="Page actions">
            <button className="primary-button" type="button" onClick={() => setShowAdd(true)}>+ Add an appointment or task</button>
            <button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Tell us when you’re free</button>
            <button className="text-button" type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print this page</button>
          </div>
        </section>
        <div className="helper-note"><HeartHandshake aria-hidden="true" /><p><strong>Want to help?</strong> Choose a task and enter your name. No account is needed.</p><button type="button" onClick={() => setShowHelp(true)}>See how it works</button></div>
        {cloudError && <div className="cloud-message error" role="alert"><p><strong>We could not reach the shared schedule.</strong> {cloudError}</p><button type="button" onClick={() => void refreshData(true)}>Try again</button></div>}
        {!cloudError && loading && <div className="cloud-message" role="status"><p><strong>Opening the shared schedule...</strong></p></div>}
        <section className="schedule" aria-labelledby="schedule-title">
          <div className="section-heading">
            <div><p className="eyebrow">Plan together</p><h2 id="schedule-title">Schedule</h2></div>
            <div className="view-toggle" aria-label="Choose schedule view"><button aria-pressed={view === 'details'} className={view === 'details' ? 'active' : ''} type="button" onClick={() => setView('details')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={view === 'week'} className={view === 'week' ? 'active' : ''} type="button" onClick={() => setView('week')}><CalendarDays aria-hidden="true" /> This Month</button></div>
          </div>
          {view === 'details' && <div className="filters" aria-label="Show schedule items by type">
            {([['all', 'Everything'], ['appointment', 'Appointments'], ['home', 'Help at home'], ['dad', 'Stu’s schedule']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} type="button" onClick={() => setFilter(value)}>{label}</button>)}
          </div>}
          {!loading && (view === 'details' ? <div className="event-list">
            {visibleEvents.length ? visibleEvents.map((event) => {
              const CategoryIcon = categoryDetails[event.category].icon
              const helper = helpers[event.id] || event.helper
              const suggestedHelpers = matchingAvailability(event, availability)
              return <article className={`event-card ${event.category}`} id={`event-${event.id}`} key={event.id}>
                <div className="event-date"><span className="category-label"><CategoryIcon aria-hidden="true" /> {categoryDetails[event.category].label}</span><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {eventTimeLabel(event.time)}</strong></div>
                <div className="event-info"><h3>{event.title}</h3><p>{event.details}</p>{event.location && <p className="location">{event.location}</p>}<div className="needed"><ListChecks aria-hidden="true" /><span><small>Help needed</small><strong>{event.helpNeeded}</strong></span></div>{!helper && suggestedHelpers.length > 0 && event.helpNeeded !== 'No help needed, just sharing the schedule' && <div className="suggested-help"><HeartHandshake aria-hidden="true" /><span><small>Suggested helpers available then</small><strong>{suggestedHelpers.map((entry) => entry.name).join(', ')}</strong><em>They still need to choose “I can help.”</em></span></div>}</div>
                <div className="event-actions">
                  {helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Slot filled by</small><strong>{helper}</strong></span></div> : <button className="primary-button" type="button" onClick={() => setSignupEvent(event)}><HeartHandshake aria-hidden="true" /> I can help</button>}
                  <button className="calendar-button" type="button" onClick={() => addToCalendar(event)}><Download aria-hidden="true" /> Add to my calendar</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => setShowAdd(true)} />}
          </div> : <ThirtyDayCalendar events={teamEvents} helpers={helpers} availability={availability} onAdd={() => setShowAdd(true)} onOpen={(eventId) => { setView('details'); setFilter('all'); window.setTimeout(() => document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }} />)}
        </section>
        <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">Who is available</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add my availability</button></div>
          <div className="availability-view-heading"><div className="view-toggle" aria-label="Choose availability view"><button aria-pressed={availabilityView === 'upcoming'} className={availabilityView === 'upcoming' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('upcoming')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={availabilityView === 'month'} className={availabilityView === 'month' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div><p>{availabilityView === 'upcoming' ? 'The next 7 days' : 'The next 30 days'}</p></div>
          {!loading && <div className="availability-list">{visibleAvailability.length ? visibleAvailability.map((entry) => <article key={entry.id}><div className="availability-date"><span>{availabilityDayLabel(entry.day).split(',')[0]}</span><strong>{availabilityDayLabel(entry.day).split(',').slice(1).join(',').trim()}</strong></div><div className="person-icon"><Users aria-hidden="true" /></div><div className="availability-person"><h3>{entry.name}</h3><p><strong>{availabilityTimeLabel(entry.time)}</strong></p><small>{entry.note}</small>{entry.phone && <a className="availability-phone" href={`tel:${entry.phone}`}>{entry.phone}</a>}</div><button className="edit-availability" type="button" onClick={() => setEditingAvailability(entry)} aria-label={`Edit ${entry.name}’s availability for ${availabilityDayLabel(entry.day)}`}><Pencil aria-hidden="true" /> Edit</button></article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability in {availabilityView === 'upcoming' ? 'the next 7 days' : 'the next 30 days'}</h3><p>Friends and family can share when they may be free to help.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add my availability</button></div>}</div>}
        </section>
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Questions? Call or text the family coordinator.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
      {editingAvailability && <EditAvailabilityModal entries={availability.filter((entry) => (phoneKey(editingAvailability.phone) ? phoneKey(entry.phone) === phoneKey(editingAvailability.phone) : entry.name.trim().toLocaleLowerCase() === editingAvailability.name.trim().toLocaleLowerCase()) && allAvailabilityDates.has(entry.day))} initialEntry={editingAvailability} onClose={() => setEditingAvailability(null)} onSave={updateAvailabilities} onRemove={removeAvailabilities} />}
      {showAdd && <AddEventModal onClose={() => setShowAdd(false)} onSave={saveEvent} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
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

function EmptySchedule({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><CalendarDays aria-hidden="true" /><h3>Nothing has been added yet</h3><p>Mary or Stu can add the first appointment or task.</p><button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button></div>
}

function ThirtyDayCalendar({ events, helpers, availability, onAdd, onOpen }: { events: TeamEvent[]; helpers: Record<string, string>; availability: Availability[]; onAdd: () => void; onOpen: (eventId: string) => void }) {
  const days = getThirtyDays()
  const activeDays = days.map((day) => ({
    ...day,
    events: events.filter((event) => event.date.startsWith(day.dateKey)),
    availablePeople: availability.filter((entry) => entry.day === day.dateKey),
  })).filter((day) => day.events.length)
  const lastDay = days.at(-1)?.fullDay
  if (!activeDays.length) return <div className="month-empty"><CalendarDays aria-hidden="true" /><p className="eyebrow">Today through {lastDay}</p><h3>No plans in the next 30 days</h3><p>New appointments and tasks will appear here by date.</p><button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button></div>
  return <div className="week-calendar" aria-label={`Calendar for today through ${lastDay}`}>{activeDays.map(({ shortDay, number, fullDay, dateKey, events: dayEvents, availablePeople }) => <section className="calendar-day has-events" key={dateKey} aria-label={fullDay}><div className="calendar-date"><span>{shortDay}</span><strong>{number}</strong></div><div className="calendar-items">{dayEvents.map((event) => {
    const helper = helpers[event.id] || event.helper
    const matches = availablePeople.filter((entry) => availabilityMatchesTime(entry.time, event.time))
    return <button type="button" key={event.id} onClick={() => onOpen(event.id)}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{eventTimeLabel(event.time)}</small>{helper ? <em>Filled by {helper}</em> : <em>{event.helpNeeded}</em>}{!helper && matches.length > 0 && <em className="availability-match">Suggested: {matches.map((entry) => entry.name).join(', ')} {matches.length === 1 ? 'is' : 'are'} available at this time</em>}</span></button>
  })}</div></section>)}</div>
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="close-button" type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button><h2 id="modal-title">{title}</h2>{children}</section></div>
}
function SignupModal({ event, onClose, onSave }: { event: TeamEvent; onClose: () => void; onSave: (id: string, name: string) => void }) {
  const [name, setName] = useState('')
  return <ModalShell title="Sign up to help" onClose={onClose}><div className="modal-summary"><strong>{event.title}</strong><span>{event.dayLabel} at {eventTimeLabel(event.time)}</span><p>{event.helpNeeded}</p></div><form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(event.id, name.trim()) }}><label htmlFor="helper-name">Your name</label><input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your first and last name" autoFocus required /><p className="form-note">Your name will appear next to this task so others know it is covered.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check aria-hidden="true" /> Yes, sign me up</button></div></form></ModalShell>
}
function AvailabilityModal({ onClose, onSave }: { onClose: () => void; onSave: (entries: Omit<Availability, 'id'>[]) => void }) {
  const days = getThirtyDays()
  const firstDate = days[0].dateKey
  const firstWeekday = new Date(`${firstDate.slice(0, 4)}-${firstDate.slice(4, 6)}-${firstDate.slice(6, 8)}T12:00:00`).getDay()
  const timeOptions = Array.from({ length: 25 }, (_, index) => {
    const minutes = 8 * 60 + index * 30
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

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectionIsValid) return
    onSave(chosenDates.map((day) => ({ name, phone, day, time: timeMode === 'all-day' ? 'anytime' : `${startTime}-${endTime}`, note })))
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
      <div className="availability-mode" aria-label="Choose how to select dates">
        <button type="button" aria-pressed={mode === 'dates'} onClick={() => setMode('dates')}>Pick dates</button>
        <button type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>Date range</button>
        <button type="button" aria-pressed={mode === 'weekly'} onClick={() => setMode('weekly')}>Every week</button>
      </div>
      {mode === 'dates' && <div className="calendar-date-picker">
        <div className="date-picker-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="date-picker-grid" aria-label="Select one or more dates">{Array.from({ length: firstWeekday }, (_, index) => <span className="date-picker-blank" key={`blank-${index}`} aria-hidden="true" />)}{days.map((day) => {
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
      <div className="time-mode" aria-label="Choose all day or specific hours"><button type="button" aria-pressed={timeMode === 'all-day'} onClick={() => setTimeMode('all-day')}>All day</button><button type="button" aria-pressed={timeMode === 'hours'} onClick={() => setTimeMode('hours')}>Choose hours</button></div>
      {timeMode === 'hours' && <div className="field-row"><div><label htmlFor="available-start-time">Available from</label><select id="available-start-time" value={startTime} onChange={(e) => setStartTime(e.target.value)}>{timeOptions.slice(0, -1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label htmlFor="available-end-time">Until</label><select id="available-end-time" value={endTime} onChange={(e) => setEndTime(e.target.value)}>{timeOptions.slice(1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>}
      {timeMode === 'hours' && endTime <= startTime && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <label htmlFor="available-note">What can you help with?</label>
      <select id="available-note" required value={note} onChange={(e) => setNote(e.target.value)}><option value="">Choose one</option>{helpChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!selectionIsValid}><Check aria-hidden="true" /> Add {chosenDates.length || ''} {chosenDates.length === 1 ? 'date' : 'dates'}</button></div>
    </form>
  </ModalShell>
}
function EditAvailabilityModal({ entries, initialEntry, onClose, onSave, onRemove }: { entries: Availability[]; initialEntry: Availability; onClose: () => void; onSave: (entries: Availability[]) => void; onRemove: (entries: Availability[]) => void }) {
  const timeOptions = Array.from({ length: 25 }, (_, index) => {
    const minutes = 8 * 60 + index * 30
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { value, label: eventTimeLabel(value) }
  })
  const range = initialEntry.time.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  const [selectedIds, setSelectedIds] = useState(entries.map((entry) => entry.id))
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
    <p className="modal-intro">Choose the dates to change. The new contact details, hours, and help type will apply to every selected date.</p>
    <form onSubmit={submit}>
      <fieldset className="bulk-date-list"><legend>Which dates do you want to change?</legend>{[...entries].sort((a, b) => a.day.localeCompare(b.day)).map((entry) => <label key={entry.id}><input type="checkbox" checked={selectedIds.includes(entry.id)} onChange={() => setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])} /><span><strong>{availabilityDayLabel(entry.day)}</strong><small>{availabilityTimeLabel(entry.time)}</small></span></label>)}</fieldset>
      <p className="selection-summary"><strong>{selectedEntries.length || 'No'} {selectedEntries.length === 1 ? 'date' : 'dates'} selected</strong></p>
      <label htmlFor="edit-available-name">Your name</label>
      <input id="edit-available-name" required value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      <label htmlFor="edit-available-phone">Your phone number</label>
      <input id="edit-available-phone" type="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" />
      <p className="form-note privacy-note">Your phone number will be visible to anyone who has the link to this page.</p>
      <label>When are you available?</label>
      <div className="time-mode" aria-label="Choose all day or specific hours"><button type="button" aria-pressed={timeMode === 'all-day'} onClick={() => setTimeMode('all-day')}>All day</button><button type="button" aria-pressed={timeMode === 'hours'} onClick={() => setTimeMode('hours')}>Choose hours</button></div>
      {timeMode === 'hours' && <div className="field-row"><div><label htmlFor="edit-available-start-time">Available from</label><select id="edit-available-start-time" value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.slice(0, -1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label htmlFor="edit-available-end-time">Until</label><select id="edit-available-end-time" value={endTime} onChange={(event) => setEndTime(event.target.value)}>{timeOptions.slice(1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>}
      {timeMode === 'hours' && !timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <label htmlFor="edit-available-note">What can you help with?</label>
      <select id="edit-available-note" required value={note} onChange={(event) => setNote(event.target.value)}>{helpChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>
      <div className="remove-area">{confirmRemove ? <div className="remove-confirm" role="alert"><p><strong>Remove {selectedEntries.length === 1 ? 'this date' : `these ${selectedEntries.length} dates`}?</strong><br />The other dates will stay on the list.</p><div><button className="text-button" type="button" onClick={() => setConfirmRemove(false)}>Keep them</button><button className="danger-button" type="button" onClick={() => onRemove(selectedEntries)}><Trash2 aria-hidden="true" /> Yes, remove {selectedEntries.length === 1 ? 'it' : 'them'}</button></div></div> : <button className="remove-button" type="button" onClick={() => setConfirmRemove(true)} disabled={!selectedEntries.length}><Trash2 aria-hidden="true" /> Remove selected {selectedEntries.length === 1 ? 'date' : 'dates'}</button>}</div>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid || !selectedEntries.length}><Check aria-hidden="true" /> Save changes to {selectedEntries.length || 0} {selectedEntries.length === 1 ? 'date' : 'dates'}</button></div>
    </form>
  </ModalShell>
}
function AddEventModal({ onClose, onSave }: { onClose: () => void; onSave: (event: TeamEvent) => void }) {
  const [form, setForm] = useState({ title: '', date: '', time: '', category: 'appointment' as Category, helpNeeded: 'Need a ride', details: '', location: '' })
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = new Date(`${form.date}T12:00:00`)
    const dayLabel = parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const compactDate = form.date.replaceAll('-', '')
    onSave({ id: crypto.randomUUID(), category: form.category, date: `${compactDate}T120000`, dayLabel, time: form.time, title: form.title, details: form.details || 'See Mary or Stu for details.', location: form.location || undefined, helpNeeded: form.helpNeeded })
  }
  return <ModalShell title="Add an appointment or task" onClose={onClose}><p className="modal-intro">Mary or Stu can add something here in about a minute.</p><form onSubmit={submit}><label htmlFor="event-title">What is happening?</label><input id="event-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Example: Mary’s eye appointment" autoFocus /><div className="field-row"><div><label htmlFor="event-date">Date</label><input id="event-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div><div><label htmlFor="event-time">Time</label><input id="event-time" type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div></div><label htmlFor="event-kind">What kind of item is this?</label><select id="event-kind" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}><option value="appointment">Mary’s appointment</option><option value="home">Help at home</option><option value="dad">Stu’s schedule</option></select><label htmlFor="event-help">What help is needed?</label><select id="event-help" value={form.helpNeeded} onChange={(e) => setForm({ ...form, helpNeeded: e.target.value })}><option>Need a ride</option><option>Need help at home</option><option>Need a visit or check-in</option><option>Need someone to bring a meal</option><option>No help needed, just sharing the schedule</option></select><label htmlFor="event-location">Where? <span>(optional)</span></label><input id="event-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Clinic name or address" /><label htmlFor="event-details">Anything else people should know? <span>(optional)</span></label><textarea id="event-details" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Add a short note" /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check aria-hidden="true" /> Add to the schedule</button></div></form></ModalShell>
}
function HelpModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="How to use Mary’s Team" onClose={onClose}><div className="help-list"><div><span>1</span><p><strong>Mary or Stu can add something.</strong> Choose “Add an appointment or task,” fill in the short form, and save it.</p></div><div><span>2</span><p><strong>Look at Upcoming or This Month.</strong> Each item shows the date, time, help needed, and any suggested helpers who are available then.</p></div><div><span>3</span><p><strong>Choose “I can help.”</strong> Type only your name and choose the green sign-up button. The card will say the slot is filled by you.</p></div><div><span>4</span><p><strong>Add or change your availability.</strong> Add your name, phone number, dates, and hours. Use “Edit” later to change several of your dates together or remove selected dates.</p></div></div><button className="primary-button full-button" type="button" onClick={onClose}>Got it</button></ModalShell>
}

export default App
