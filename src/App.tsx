import { useEffect, useState } from 'react'
import {
  CalendarDays, Check, CircleHelp, Clock3, Download, HeartHandshake,
  Home, ListChecks, Printer, UserRound, Users, X,
} from 'lucide-react'
import './App.css'

type Category = 'appointment' | 'home' | 'dad'
type TeamEvent = { id: string; category: Category; date: string; dayLabel: string; time: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string }
type Availability = { id: string; name: string; day: string; time: string; note: string }

const categoryDetails = {
  appointment: { label: 'Mary’s appointment', icon: CalendarDays },
  home: { label: 'Help at home', icon: Home },
  dad: { label: 'Stu’s schedule', icon: UserRound },
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
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signupEvent, setSignupEvent] = useState<TeamEvent | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [message, setMessage] = useState('')
  const visibleEvents = teamEvents.filter((event) => filter === 'all' || event.category === filter)
  const helpers = Object.fromEntries(teamEvents.filter((event) => event.helper).map((event) => [event.id, event.helper as string]))

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
  async function saveAvailability(entry: Omit<Availability, 'id'>) {
    try {
      const saved = { ...entry, id: crypto.randomUUID() }
      await apiRequest({ action: 'addAvailability', entry: saved })
      setAvailability((items) => [saved, ...items])
      setShowAvailability(false)
      setMessage(`Thank you, ${entry.name}. Your available time was added.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your availability. Please try again.')
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
          <div><p className="eyebrow">Family schedule and help list</p><h1 id="page-title">Mary and Stu’s week</h1><p className="intro">See what’s coming up and choose something if you can help.</p></div>
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
              return <article className={`event-card ${event.category}`} id={`event-${event.id}`} key={event.id}>
                <div className="event-date"><span className="category-label"><CategoryIcon aria-hidden="true" /> {categoryDetails[event.category].label}</span><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {event.time}</strong></div>
                <div className="event-info"><h3>{event.title}</h3><p>{event.details}</p>{event.location && <p className="location">{event.location}</p>}<div className="needed"><ListChecks aria-hidden="true" /><span><small>Help needed</small><strong>{event.helpNeeded}</strong></span></div></div>
                <div className="event-actions">
                  {helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Slot filled by</small><strong>{helper}</strong></span></div> : <button className="primary-button" type="button" onClick={() => setSignupEvent(event)}><HeartHandshake aria-hidden="true" /> I can help</button>}
                  <button className="calendar-button" type="button" onClick={() => addToCalendar(event)}><Download aria-hidden="true" /> Add to my calendar</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => setShowAdd(true)} />}
          </div> : <ThirtyDayCalendar events={teamEvents} helpers={helpers} onAdd={() => setShowAdd(true)} onOpen={(eventId) => { setView('details'); setFilter('all'); window.setTimeout(() => document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }} />)}
        </section>
        <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">Who is available</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add my availability</button></div>
          {!loading && <div className="availability-list">{availability.length ? availability.map((entry) => <article key={entry.id}><div className="person-icon"><Users aria-hidden="true" /></div><div><h3>{entry.name}</h3><p><strong>{entry.day}</strong> · {entry.time}</p><small>{entry.note}</small></div></article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability has been added yet</h3><p>Friends and family can share when they may be free to help.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add my availability</button></div>}</div>}
        </section>
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Questions? Call or text the family coordinator.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
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
      number: date.toLocaleDateString('en-US', { day: 'numeric' }),
      fullDay: date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      dateKey: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    }
  })
}

function EmptySchedule({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><CalendarDays aria-hidden="true" /><h3>Nothing has been added yet</h3><p>Mary or Stu can add the first appointment or task.</p><button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button></div>
}

function ThirtyDayCalendar({ events, helpers, onAdd, onOpen }: { events: TeamEvent[]; helpers: Record<string, string>; onAdd: () => void; onOpen: (eventId: string) => void }) {
  const days = getThirtyDays()
  const daysWithEvents = days.map((day) => ({ ...day, events: events.filter((event) => event.date.startsWith(day.dateKey)) })).filter((day) => day.events.length)
  const lastDay = days.at(-1)?.fullDay
  if (!daysWithEvents.length) return <div className="month-empty"><CalendarDays aria-hidden="true" /><p className="eyebrow">Today through {lastDay}</p><h3>No plans in the next 30 days</h3><p>New appointments and tasks will appear here by date.</p><button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button></div>
  return <div className="week-calendar" aria-label={`Calendar for today through ${lastDay}`}>{daysWithEvents.map(({ shortDay, number, fullDay, dateKey, events: dayEvents }) => <section className="calendar-day has-events" key={dateKey} aria-label={fullDay}><div className="calendar-date"><span>{shortDay}</span><strong>{number}</strong></div><div className="calendar-items">{dayEvents.map((event) => { const helper = helpers[event.id] || event.helper; return <button type="button" key={event.id} onClick={() => onOpen(event.id)}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{event.time}</small>{helper ? <em>Filled by {helper}</em> : <em>{event.helpNeeded}</em>}</span></button> })}</div></section>)}</div>
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
  return <ModalShell title="Sign up to help" onClose={onClose}><div className="modal-summary"><strong>{event.title}</strong><span>{event.dayLabel} at {event.time}</span><p>{event.helpNeeded}</p></div><form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(event.id, name.trim()) }}><label htmlFor="helper-name">Your name</label><input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your first and last name" autoFocus required /><p className="form-note">Your name will appear next to this task so others know it is covered.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check aria-hidden="true" /> Yes, sign me up</button></div></form></ModalShell>
}
function AvailabilityModal({ onClose, onSave }: { onClose: () => void; onSave: (entry: Omit<Availability, 'id'>) => void }) {
  const [form, setForm] = useState({ name: '', day: '', time: '', note: '' })
  return <ModalShell title="Add my availability" onClose={onClose}><p className="modal-intro">Add a day and time when you may be able to help. You are not signing up for a specific task yet.</p><form onSubmit={(e) => { e.preventDefault(); onSave(form) }}><label htmlFor="available-name">Your name</label><input id="available-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" autoFocus /><div className="field-row"><div><label htmlFor="available-day">Day or date</label><input id="available-day" required value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} placeholder="Example: Saturday" /></div><div><label htmlFor="available-time">Time</label><input id="available-time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="Example: After 2 PM" /></div></div><label htmlFor="available-note">What can you help with? <span>(optional)</span></label><textarea id="available-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Example: I can drive or bring dinner." /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check aria-hidden="true" /> Add my availability</button></div></form></ModalShell>
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
  return <ModalShell title="Add an appointment or task" onClose={onClose}><p className="modal-intro">Mary or Stu can add something here in about a minute.</p><form onSubmit={submit}><label htmlFor="event-title">What is happening?</label><input id="event-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Example: Mary’s eye appointment" autoFocus /><div className="field-row"><div><label htmlFor="event-date">Date</label><input id="event-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div><div><label htmlFor="event-time">Time</label><input id="event-time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="Example: 10:30 AM" /></div></div><label htmlFor="event-kind">What kind of item is this?</label><select id="event-kind" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}><option value="appointment">Mary’s appointment</option><option value="home">Help at home</option><option value="dad">Stu’s schedule</option></select><label htmlFor="event-help">What help is needed?</label><select id="event-help" value={form.helpNeeded} onChange={(e) => setForm({ ...form, helpNeeded: e.target.value })}><option>Need a ride</option><option>Need help at home</option><option>Need a visit or check-in</option><option>Need someone to bring a meal</option><option>No help needed, just sharing the schedule</option></select><label htmlFor="event-location">Where? <span>(optional)</span></label><input id="event-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Clinic name or address" /><label htmlFor="event-details">Anything else people should know? <span>(optional)</span></label><textarea id="event-details" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Add a short note" /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check aria-hidden="true" /> Add to the schedule</button></div></form></ModalShell>
}
function HelpModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="How to use Mary’s Team" onClose={onClose}><div className="help-list"><div><span>1</span><p><strong>Mary or Stu can add something.</strong> Choose “Add an appointment or task,” fill in the short form, and save it.</p></div><div><span>2</span><p><strong>Look at Upcoming or This Month.</strong> Each item shows the date, time, and kind of help that is needed.</p></div><div><span>3</span><p><strong>Choose “I can help.”</strong> Type only your name and choose the green sign-up button. The card will say the slot is filled by you.</p></div><div><span>4</span><p><strong>Add your availability.</strong> Share a day and time when you may be free, even if you have not chosen a task yet.</p></div></div><button className="primary-button full-button" type="button" onClick={onClose}>Got it</button></ModalShell>
}

export default App
