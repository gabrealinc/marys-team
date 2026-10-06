import { useEffect, useState } from 'react'
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, HeartHandshake,
  Home, ListChecks, Pencil, Repeat2, Trash2, UserRound, Users, Utensils, X,
} from 'lucide-react'
import './App.css'

type Category = 'appointment' | 'company' | 'home' | 'family'
type ForWho = 'Mary' | 'Stu' | 'Gabby' | 'Spencer' | 'Coco' | 'Family'
type PlanType = 'food' | 'stop_by'
type SupportFilter = 'all' | 'ride' | 'mary' | 'home' | 'coco'
type TeamEvent = { id: string; category: Category; forWho: ForWho; date: string; dayLabel: string; time: string; endTime: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string; helperPhone?: string; helperEmail?: string; repeatGroupId?: string; requestPending?: boolean; requesterName?: string; scheduleSource?: string; isScheduleException?: boolean; isFlexible?: boolean; proposalType?: PlanType }
type DriverContact = { name: string; phone: string; email: string }
type Availability = { id: string; name: string; phone: string; day: string; time: string; note: string; editable?: boolean }
type ApprovalRequest = { status: string; requesterName: string; requesterPhone: string; requesterEmail: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type PendingRequest = { id: string; eventId: string; requesterName: string; requesterPhone: string; requesterEmail: string; notificationSentAt?: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type FoodSettings = { weekdays: number[]; startTime: string; endTime: string }
type VisitSettings = { startTime: string; endTime: string }
type FamilyInTown = { Stu: boolean; Gabby: boolean; Spencer: boolean }
type FamilyInTownDates = { Stu: string[]; Gabby: string[]; Spencer: string[] }

const whoDetails = {
  Mary: { label: 'For Mary', icon: HeartHandshake },
  Stu: { label: 'For Stu', icon: UserRound },
  Gabby: { label: 'For Gabby', icon: UserRound },
  Spencer: { label: 'For Spencer', icon: UserRound },
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
const maryAppointmentChoices = ['At Home Appointment', 'Appointment']
const defaultEventDetails = 'Text Mary directly if you have any questions.'
const whoChoices: ForWho[] = ['Mary', 'Stu', 'Gabby', 'Spencer', 'Coco', 'Family']
const weekdayChoices = [
  { value: 0, label: 'Sunday', short: 'Sun' }, { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' }, { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' }, { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
]

function savedHelperContact() {
  try {
    const saved = JSON.parse(window.localStorage.getItem('marys-team-helper-contact') || '{}') as { name?: string; phone?: string; email?: string }
    return { name: saved.name || '', phone: saved.phone || '', email: saved.email || '' }
  } catch {
    return { name: '', phone: '', email: '' }
  }
}

function needsTimeWithMary(forWho: ForWho) {
  return forWho === 'Stu' || forWho === 'Gabby' || forWho === 'Spencer' || forWho === 'Coco'
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
  const isRoutineWorkCoverage = (support.includes('mary') || support.includes('visit') || support.includes('check-in')) && (event.scheduleSource === 'stu_work' || event.title.trim().toLocaleLowerCase() === 'stu at work')
  return isRoutineWorkCoverage ? 2 : 1
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
  return addMinutes(value, 60)
}

function addMinutes(value: string, amount: number) {
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ''
  const total = hours * 60 + minutes + amount
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isNoSupport(value: string) {
  return value === 'No help needed' || value === 'No help needed, just sharing the schedule'
}

function shouldShowEventLocation(event: Pick<TeamEvent, 'location' | 'helpNeeded'>) {
  return Boolean(event.location) && event.helpNeeded !== 'Spend time with Mary'
}

function eventTimeRangeLabel(event: TeamEvent) {
  if (event.isFlexible) return 'Anytime'
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
  return availability.filter((entry) => event.isFlexible || (entry.day === event.date.slice(0, 8) && availabilityMatchesTime(entry.time, event.time, event.endTime)))
}

function availableDriverContacts(date: string, time: string, endTime: string, availability: Availability[], events: TeamEvent[]) {
  const dateKey = date.replaceAll('-', '').slice(0, 8)
  const pastContacts = events.filter((event) => event.helper).map((event) => ({ name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' }))
  const contacts = availability
    .filter((entry) => entry.day === dateKey && availabilityMatchesTime(entry.time, time, endTime))
    .map((entry) => {
      const prior = pastContacts.find((contact) => phoneKey(contact.phone) && phoneKey(contact.phone) === phoneKey(entry.phone)) || pastContacts.find((contact) => contact.name.trim().toLocaleLowerCase() === entry.name.trim().toLocaleLowerCase())
      return { name: entry.name, phone: entry.phone, email: prior?.email || '' }
    })
  return contacts.filter((contact, index) => contacts.findIndex((item) => phoneKey(item.phone) ? phoneKey(item.phone) === phoneKey(contact.phone) : item.name.toLocaleLowerCase() === contact.name.toLocaleLowerCase()) === index)
}

function phoneKey(value: string) {
  return value.replace(/\D/g, '')
}

function localDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nextFoodDate(weekdays = [1, 3]) {
  const date = new Date()
  while (!weekdays.includes(date.getDay())) date.setDate(date.getDate() + 1)
  return localDateInputValue(date)
}

function isCoveredByFamily(event: TeamEvent, events: TeamEvent[], familyInTown: FamilyInTown, familyInTownDates: FamilyInTownDates) {
  const support = event.helpNeeded.toLocaleLowerCase()
  if (!(support.includes('mary') || support.includes('check-in') || support.includes('visit'))) return false
  const dateKey = event.date.slice(0, 8)
  return (Object.keys(familyInTown) as (keyof FamilyInTown)[]).some((person) => {
    if (!familyInTown[person] && !familyInTownDates[person].includes(dateKey)) return false
    return !events.some((busy) => busy.forWho === person && busy.scheduleSource !== 'family_coverage' && !busy.proposalType && !busy.isFlexible && busy.date.slice(0, 8) === dateKey && (event.isFlexible || (busy.time < event.endTime && busy.endTime > event.time)))
  })
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
  const [view, setView] = useState<'help' | 'upcoming' | 'month'>('help')
  const [availabilityView, setAvailabilityView] = useState<'upcoming' | 'month'>('upcoming')
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signupEvent, setSignupEvent] = useState<TeamEvent | null>(null)
  const [viewingEvent, setViewingEvent] = useState<TeamEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<TeamEvent | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showPlanRequest, setShowPlanRequest] = useState<PlanType | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [busyPerson, setBusyPerson] = useState<keyof FamilyInTown | null>(null)
  const [inTownDatesPerson, setInTownDatesPerson] = useState<keyof FamilyInTown | null>(null)
  const [addForWho, setAddForWho] = useState<ForWho>('Mary')
  const [editingAvailability, setEditingAvailability] = useState<Availability | null>(null)
  const [approvalToken, setApprovalToken] = useState(() => new URLSearchParams(window.location.search).get('approve') || '')
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [message, setMessage] = useState('')
  const [organizer, setOrganizer] = useState(false)
  const [showOrganizerLogin, setShowOrganizerLogin] = useState(false)
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [foodSettings, setFoodSettings] = useState<FoodSettings>({ weekdays: [1, 3], startTime: '14:00', endTime: '18:00' })
  const [visitSettings, setVisitSettings] = useState<VisitSettings>({ startTime: '10:00', endTime: '17:00' })
  const [familyInTown, setFamilyInTown] = useState<FamilyInTown>({ Stu: true, Gabby: true, Spencer: false })
  const [familyInTownDates, setFamilyInTownDates] = useState<FamilyInTownDates>({ Stu: [], Gabby: [], Spencer: [] })
  const [upcomingLimit, setUpcomingLimit] = useState(7)
  const [foodReservedDates, setFoodReservedDates] = useState<string[]>([])
  const scheduleDates = new Set(getThirtyDays().map((day) => day.dateKey))
  const visibleEvents = teamEvents
    .filter((event) => event.scheduleSource !== 'family_coverage' && (event.isFlexible || scheduleDates.has(event.date.slice(0, 8))) && (view !== 'help' || (!isNoSupport(event.helpNeeded) && !event.helper && !isCoveredByFamily(event, teamEvents, familyInTown, familyInTownDates) && matchesSupportFilter(event, filter))))
    .sort((a, b) => view === 'help' ? helpNeededPriority(a) - helpNeededPriority(b) || a.date.localeCompare(b.date) : a.date.localeCompare(b.date))
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
      setFoodSettings(data.foodSettings || { weekdays: [1, 3], startTime: '14:00', endTime: '18:00' })
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setFoodReservedDates(Array.isArray(data.foodReservedDates) ? data.foodReservedDates : [])
      setCloudError('')
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void apiRequest().then(async (data) => {
      if (!active) return
      setTeamEvents(data.events)
      setAvailability(data.availability)
      setOrganizer(Boolean(data.organizer))
      setFoodSettings(data.foodSettings || { weekdays: [1, 3], startTime: '14:00', endTime: '18:00' })
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setCloudError('')
      void apiRequest({ action: 'retryPendingNotifications' }).catch(() => undefined)
      if (data.organizer) await loadPendingRequests()
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

  async function decideRequest(requestId: string, decision: 'approve' | 'decline', declineReason = '') {
    try {
      const request = pendingRequests.find((item) => item.id === requestId)
      const result = await apiRequest({ action: 'organizerDecideRequest', requestId, decision, declineReason })
      await Promise.all([refreshData(), loadPendingRequests()])
      const isPlan = Boolean(request?.proposalType)
      setMessage(`${decision === 'approve' ? `The ${isPlan ? 'plan' : 'request'} is approved and confirmed.` : `The ${isPlan ? 'plan' : 'request'} was declined.`}${result.emailSent ? ' The person was emailed.' : ' Please contact them directly because their email could not be sent.'}`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update this request.')
    }
  }

  async function organizerLogout() {
    await apiRequest({ action: 'organizerLogout' })
    setOrganizer(false)
    setPendingRequests([])
    setEditingEvent(null)
    setView('help')
  }

  async function saveFoodSettings(settings: FoodSettings) {
    try {
      const result = await apiRequest({ action: 'saveFoodSettings', ...settings })
      setFoodSettings(result.foodSettings)
      setMessage('Food drop-off days were updated.')
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update food drop-off days.')
      return false
    }
  }

  async function saveVisitSettings(settings: VisitSettings) {
    try {
      const result = await apiRequest({ action: 'saveVisitSettings', ...settings })
      setVisitSettings(result.visitSettings)
      setMessage('Normal visiting hours were updated.')
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update visiting hours.')
      return false
    }
  }

  async function saveFamilyInTown(person: keyof FamilyInTown, inTown: boolean) {
    const previous = familyInTown[person]
    setFamilyInTown((current) => ({ ...current, [person]: inTown }))
    try {
      await apiRequest({ action: 'saveFamilyInTown', person, inTown })
      setMessage(`${person} is now marked ${inTown ? 'In Town' : 'Out of Town'}.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setFamilyInTown((current) => ({ ...current, [person]: previous }))
      setMessage(error instanceof Error ? error.message : 'We could not update who is in town.')
    }
  }

  async function saveFamilyInTownDates(person: keyof FamilyInTown, dates: string[]) {
    try {
      await apiRequest({ action: 'saveFamilyInTownDates', person, dates })
      setFamilyInTownDates((current) => ({ ...current, [person]: dates }))
      setInTownDatesPerson(null)
      setMessage(`${person}’s in-town dates were updated.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update these dates.')
      return false
    }
  }

  async function saveFamilyBusyDates(person: keyof FamilyInTown, dates: string[], startTime: string, endTime: string) {
    const days = getThirtyDays()
    try {
      await apiRequest({ action: 'saveFamilyBusyDates', person, dates, startTime, endTime, rangeStart: days[0].dateKey, rangeEnd: days.at(-1)?.dateKey })
      await refreshData(true)
      setBusyPerson(null)
      setMessage(`${person}’s work or away days were updated.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update these dates.')
      return false
    }
  }

  async function saveHelper(eventId: string, name: string, phone: string, email: string, startTime: string, endTime: string, note: string) {
    try {
      const result = await apiRequest({ action: 'claimEvent', eventId, name, phone, email, startTime, endTime, note })
      setTeamEvents((events) => events.map((event) => event.id === eventId ? result.status === 'requested' ? { ...event, requestPending: true, requesterName: name } : { ...event, helper: name, requestPending: false, requesterName: undefined } : event))
      setSignupEvent(null)
      setMessage(result.status === 'requested' ? `Thank you, ${name}. Your request was submitted.` : `Thank you, ${name}. You are confirmed.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your sign-up. Please try again.')
      await refreshData()
      return false
    }
  }
  async function saveProposedPlan(plan: { type: PlanType; name: string; phone: string; email: string; date: string; time: string; endTime: string; details: string }) {
    try {
      await apiRequest({ action: 'proposePlan', ...plan })
      window.localStorage.setItem('marys-team-helper-contact', JSON.stringify({ name: plan.name, phone: plan.phone, email: plan.email }))
      setShowPlanRequest(null)
      setMessage(`Thank you, ${plan.name}. Your request was submitted.`)
      window.setTimeout(() => setMessage(''), 6000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save your request. Please try again.')
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
      const matchingNeeds = teamEvents.filter((event) => !event.helper && !event.requestPending && !isNoSupport(event.helpNeeded) && entries.some((entry) => entry.day === event.date.slice(0, 8) && (event.isFlexible || availabilityMatchesTime(entry.time, event.time, event.endTime))))
      if (matchingNeeds.length) {
        setView('help')
        setFilter('all')
        window.setTimeout(() => document.getElementById('schedule-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }
      setMessage(matchingNeeds.length ? `Thank you, ${entries[0].name}. We found ${matchingNeeds.length} open ${matchingNeeds.length === 1 ? 'time' : 'times'} that match your availability. Choose one below if it works for you.` : `Thank you, ${entries[0].name}. Your availability was added. The family may call if something comes up, but you are not signed up for anything.`)
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
      setMessage(`${eventsToSave.length === 1 ? 'The new item was added to the shared schedule.' : `${eventsToSave.length} weekly items were added to the shared schedule.`}${result.driverEmailSent === true ? ' The driver was emailed a confirmation.' : result.driverEmailSent === false ? ' The driver was saved, but the confirmation email could not be sent.' : ''}`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save this item. Please try again.')
      return false
    }
  }
  async function updateEvent(event: TeamEvent) {
    try {
      const result = await apiRequest({ action: 'updateEvent', event })
      setTeamEvents((events) => events.map((item) => item.id === event.id ? { ...item, ...result.event, isScheduleException: event.scheduleSource === 'stu_work' ? true : event.isScheduleException, requestPending: isNoSupport(event.helpNeeded) || Boolean(result.event?.helper) ? false : item.requestPending, requesterName: isNoSupport(event.helpNeeded) || Boolean(result.event?.helper) ? undefined : item.requesterName } : item).sort((a, b) => a.date.localeCompare(b.date)))
      setEditingEvent(null)
      setMessage(`The schedule item was updated.${result.driverEmailSent === true ? ' The driver was emailed a confirmation.' : result.driverEmailSent === false ? ' The driver was saved, but the confirmation email could not be sent.' : ''}`)
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
  async function decideApprovalRequest(decision: 'approve' | 'decline', declineReason = '') {
    try {
      const result = await apiRequest({ action: 'decideApprovalRequest', token: approvalToken, decision, declineReason })
      setApprovalRequest(null)
      setApprovalToken('')
      window.history.replaceState({}, '', window.location.pathname)
      await refreshData()
      setMessage(`${decision === 'approve' ? 'Approved. The schedule now shows who is confirmed.' : 'Declined. The time is open again.'}${result.emailSent ? ' The person was emailed.' : ' Please contact them directly because their email could not be sent.'}`)
      window.setTimeout(() => setMessage(''), 6000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update this request.')
    }
  }
  function showSupportNeeded() {
    setView('help')
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
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Mary’s Team home"><span className="brand-mark"><HeartHandshake aria-hidden="true" /></span><span>Mary’s Team</span></a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /><span>Help Needed</span></button>
          <button type="button" onClick={() => setShowPlanRequest('stop_by')}><Users aria-hidden="true" /><span>Stop By</span></button>
          <button type="button" onClick={() => setShowPlanRequest('food')}><Utensils aria-hidden="true" /><span>Bring Food</span></button>
        </nav>
        <div className="header-tools"><button className="family-access-button" type="button" onClick={openEditAndApprove}><Pencil aria-hidden="true" /><span>Edit &amp; Approve</span>{organizer && pendingRequests.length > 0 && <strong aria-label={`${pendingRequests.length} requests waiting`}>{pendingRequests.length}</strong>}</button><button className="help-button" type="button" onClick={() => setShowHelp(true)}><CircleHelp aria-hidden="true" /> <span>How to use this page</span></button></div>
      </header>
      <main id="top">
        <section className="welcome" aria-labelledby="page-title">
          <div><p className="eyebrow">Family schedule and support</p><h1 id="page-title">The Greenbergs’ Schedule</h1><p className="intro">See what’s coming up, spend time together, and support where it fits.</p></div>
          <div className="quick-actions" role="group" aria-label="Page actions">
            <button className="support-button" type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /> Help Needed</button>
            <button className="secondary-button" type="button" onClick={() => setShowPlanRequest('stop_by')}><Users aria-hidden="true" /> Stop By</button>
            <button className="secondary-button" type="button" onClick={() => setShowPlanRequest('food')}><Utensils aria-hidden="true" /> Bring Food</button>
          </div>
        </section>
        <div className="helper-note"><HeartHandshake aria-hidden="true" /><p><strong>New here?</strong> Choose Help Needed, Stop By, or Bring Food. The page will show exactly what is open.</p><button type="button" onClick={() => setShowHelp(true)}>See how it works</button></div>
        {organizer && <OrganizerPanel requests={pendingRequests} events={teamEvents} foodSettings={foodSettings} visitSettings={visitSettings} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveFoodSettings={saveFoodSettings} onSaveVisitSettings={saveVisitSettings} onSaveFamilyInTown={saveFamilyInTown} onEditInTownDates={setInTownDatesPerson} onEditBusyDates={setBusyPerson} onAddSchedule={(forWho) => { setAddForWho(forWho); setShowAdd(true) }} onEditEvent={setEditingEvent} onDecide={decideRequest} onLogout={organizerLogout} />}
        {cloudError && <div className="cloud-message error" role="alert"><p><strong>We could not reach the shared schedule.</strong> {cloudError}</p><button type="button" onClick={() => void refreshData(true)}>Try again</button></div>}
        {!cloudError && loading && <div className="cloud-message" role="status"><p><strong>Opening the shared schedule...</strong></p></div>}
        <section className="schedule" aria-labelledby="schedule-title">
          <div className="section-heading">
            <div><p className="eyebrow">Plan together</p><h2 id="schedule-title">{organizer ? 'Schedule' : 'Help Needed'}</h2></div>
            {organizer && <div className="view-toggle" role="group" aria-label="Choose schedule view"><button aria-pressed={view === 'help'} className={view === 'help' ? 'active' : ''} type="button" onClick={() => setView('help')}><ListChecks aria-hidden="true" /> Help Needed</button><button aria-pressed={view === 'upcoming'} className={view === 'upcoming' ? 'active' : ''} type="button" onClick={() => { setUpcomingLimit(7); setView('upcoming') }}><CalendarDays aria-hidden="true" /> Upcoming</button><button aria-pressed={view === 'month'} className={view === 'month' ? 'active' : ''} type="button" onClick={() => setView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div>}
          </div>
          <p className="schedule-view-note">{view === 'help' ? 'Only open rides, appointments, and times when Mary may be alone.' : view === 'upcoming' ? 'This week, Sunday through Saturday. Choose Show More to see later dates.' : 'See the whole month at a glance. Tap any date to see its details.'}</p>
          {view === 'help' && <div className="filters" role="group" aria-label="Show schedule items by support needed">
            {([['all', 'Everything'], ['ride', 'Rides'], ['mary', 'Spend time with Mary'], ['home', 'Home & errands'], ['coco', 'Coco']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} type="button" onClick={() => setFilter(value)}>{label}</button>)}
          </div>}
          {!loading && (view === 'help' ? <div className="event-list">
            {visibleEvents.length ? visibleEvents.map((event) => {
              const WhoIcon = whoDetails[event.forWho].icon
              const helper = helpers[event.id] || event.helper
              const suggestedHelpers = matchingAvailability(event, availability)
              return <article className={`event-card viewable ${event.category}`} id={`event-${event.id}`} key={event.id} onClick={() => setViewingEvent(event)}>
                <div className="event-date"><span className="category-label"><WhoIcon aria-hidden="true" /> {whoDetails[event.forWho].label}</span><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {eventTimeRangeLabel(event)}</strong>{(event.repeatGroupId || event.scheduleSource === 'stu_work') && <small className="repeat-label"><Repeat2 aria-hidden="true" /> {event.scheduleSource === 'stu_work' ? event.isScheduleException ? 'Different from weekly hours' : 'Weekly work hours' : 'Repeats weekly'}</small>}</div>
                <div className="event-info"><h3>{event.title}</h3><p>{event.details}</p>{shouldShowEventLocation(event) && <p className="location">{event.location}</p>}<span className="card-details-hint">Tap to see details</span>{event.proposalType ? <div className="needed planned-needed">{event.proposalType === 'food' ? <Utensils aria-hidden="true" /> : <Users aria-hidden="true" />}<span><small>Planned</small><strong>{event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by'}</strong></span></div> : <div className={`needed ${isNoSupport(event.helpNeeded) ? 'busy-needed' : ''}`}><ListChecks aria-hidden="true" /><span><small>{isNoSupport(event.helpNeeded) ? 'Busy time' : 'Support requested'}</small><strong>{isNoSupport(event.helpNeeded) ? 'Please do not stop by during this time.' : event.helpNeeded}</strong></span></div>}{!helper && !event.requestPending && suggestedHelpers.length > 0 && !isNoSupport(event.helpNeeded) && <div className="suggested-help"><HeartHandshake aria-hidden="true" /><span><small>{event.isFlexible ? 'People who may be available' : 'People available then'}</small><strong>{suggestedHelpers.map((entry) => entry.name).join(', ')}</strong><em>{event.isFlexible ? 'They may be able to fit this task into their availability.' : 'They can choose this time if it works for them.'}</em></span></div>}</div>
                <div className="event-actions">
                  {event.proposalType && helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : isNoSupport(event.helpNeeded) ? <div className="busy-status"><Clock3 aria-hidden="true" /><span><small>Status</small><strong>Busy</strong></span></div> : helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Request submitted</small><strong>{organizer && event.requesterName ? `Requested by ${event.requesterName}` : 'Waiting for confirmation'}</strong></span></div> : <button className="primary-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setSignupEvent(event) }}><HeartHandshake aria-hidden="true" /> Sign me up!</button>}
                  <button className="edit-event-link" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setViewingEvent(event) }}><Pencil aria-hidden="true" /> {organizer ? 'View or edit details' : 'View details'}</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => organizer ? (setAddForWho('Mary'), setShowAdd(true)) : setShowOrganizerLogin(true)} supportOnly />}
          </div> : view === 'upcoming' ? <div className="upcoming-calendar-wrap"><UpcomingWeekList events={teamEvents.filter((event) => event.scheduleSource !== 'family_coverage')} daysToShow={upcomingLimit} onOpen={(eventId) => { const event = teamEvents.find((item) => item.id === eventId); if (event) setViewingEvent(event) }} />{upcomingLimit < 28 && <button className="secondary-button show-more-button" type="button" onClick={() => setUpcomingLimit((current) => Math.min(28, current + 7))}>Show more dates</button>}</div> : <MonthCalendar events={teamEvents.filter((event) => event.scheduleSource !== 'family_coverage')} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onOpen={(eventId) => { const event = teamEvents.find((item) => item.id === eventId); if (event) setViewingEvent(event) }} />)}
        </section>
        {organizer && <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">Availability</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add availability</button></div>
          <div className="availability-view-heading"><div className="view-toggle" role="group" aria-label="Choose availability view"><button aria-pressed={availabilityView === 'upcoming'} className={availabilityView === 'upcoming' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('upcoming')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={availabilityView === 'month'} className={availabilityView === 'month' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div><p>{availabilityView === 'upcoming' ? 'The next 7 days' : 'The next 30 days'}</p></div>
          {!loading && <div className="availability-list">{visibleAvailability.length ? visibleAvailability.map((entry) => <article className={entry.editable ? 'editable' : ''} key={entry.id} onClick={() => entry.editable && setEditingAvailability(entry)}><div className="availability-date"><span>{availabilityDayLabel(entry.day).split(',')[0]}</span><strong>{availabilityDayLabel(entry.day).split(',').slice(1).join(',').trim()}</strong></div><div className="person-icon"><Users aria-hidden="true" /></div><div className="availability-person"><h3>{entry.name}</h3><p className={`availability-time ${entry.time === 'anytime' ? 'all-day' : ''}`}>{availabilityTimeLabel(entry.time)}</p><p className="availability-help">{entry.note}</p>{entry.phone && <a className="availability-phone" href={`tel:${entry.phone}`} onClick={(clickEvent) => clickEvent.stopPropagation()}><span>Call or text</span> {entry.phone}</a>}</div>{entry.editable && <button className="tap-edit" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setEditingAvailability(entry) }} aria-label={`Edit ${entry.name}’s availability for ${availabilityDayLabel(entry.day)}`}><Pencil aria-hidden="true" /> Edit</button>}</article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability in {availabilityView === 'upcoming' ? 'the next 7 days' : 'the next 30 days'}</h3><p>Share times when the family may call if something comes up. This does not sign anyone up automatically.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add availability</button></div>}</div>}
        </section>}
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Questions? Call or text the family coordinator.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {viewingEvent && <EventDetailsModal event={viewingEvent} organizer={organizer} availability={matchingAvailability(viewingEvent, availability)} onClose={() => setViewingEvent(null)} onEdit={() => { setViewingEvent(null); setEditingEvent(viewingEvent) }} />}
      {editingEvent && <EditEventModal event={editingEvent} availability={availability} events={teamEvents} onClose={() => setEditingEvent(null)} onSave={updateEvent} onRemove={removeEvent} />}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
      {showPlanRequest && <PlanRequestModal type={showPlanRequest} events={teamEvents} foodSettings={foodSettings} visitSettings={visitSettings} foodReservedDates={foodReservedDates} onClose={() => setShowPlanRequest(null)} onSave={saveProposedPlan} />}
      {editingAvailability && <EditAvailabilityModal entries={availability.filter((entry) => (phoneKey(editingAvailability.phone) ? phoneKey(entry.phone) === phoneKey(editingAvailability.phone) : entry.name.trim().toLocaleLowerCase() === editingAvailability.name.trim().toLocaleLowerCase()) && allAvailabilityDates.has(entry.day))} initialEntry={editingAvailability} onClose={() => setEditingAvailability(null)} onSave={updateAvailabilities} onRemove={removeAvailabilities} />}
      {showAdd && <AddEventModal initialForWho={addForWho} availability={availability} events={teamEvents} onClose={() => setShowAdd(false)} onSave={saveEvents} />}
      {busyPerson && <FamilyBusyDatesModal person={busyPerson} events={teamEvents} onClose={() => setBusyPerson(null)} onSave={(dates, startTime, endTime) => saveFamilyBusyDates(busyPerson, dates, startTime, endTime)} />}
      {inTownDatesPerson && <FamilyInTownDatesModal person={inTownDatesPerson} selectedDates={familyInTownDates[inTownDatesPerson]} onClose={() => setInTownDatesPerson(null)} onSave={(dates) => saveFamilyInTownDates(inTownDatesPerson, dates)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {approvalRequest && <ApprovalModal request={approvalRequest} onClose={() => setApprovalRequest(null)} onDecide={decideApprovalRequest} />}
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

function UpcomingWeekList({ events, daysToShow, onOpen }: { events: TeamEvent[]; daysToShow: number; onOpen: (eventId: string) => void }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  const days = Array.from({ length: daysToShow }, (_, index) => {
    const date = new Date(sunday)
    date.setDate(sunday.getDate() + index)
    const dateKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    return {
      date,
      dateKey,
      events: events.filter((event) => !event.isFlexible && event.date.startsWith(dateKey)).sort((a, b) => a.time.localeCompare(b.time)),
    }
  })

  return <div className="week-calendar" role="region" aria-label={`Upcoming schedule for ${daysToShow} days`}>
    {days.map((day) => <section className={`calendar-day ${day.events.length ? 'has-events' : ''}`} key={day.dateKey}>
      <div className="calendar-date">
        <span>{day.date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
        <strong>{day.date.getDate()}</strong>
        <small>{day.date.toLocaleDateString('en-US', { month: 'short' })}</small>
      </div>
      <div className="calendar-items">
        {day.events.length ? day.events.map((event) => <button type="button" key={event.id} onClick={() => onOpen(event.id)}>
          <span className={`calendar-dot ${event.category}`} aria-hidden="true" />
          <span>
            <strong>{event.title}</strong>
            <small>{eventTimeRangeLabel(event)} · {whoDetails[event.forWho].label}</small>
            <em>{event.proposalType ? event.proposalType === 'food' ? event.helper ? `Food from ${event.helper}` : 'Food drop-off requested' : event.helper ? `Stopping by: ${event.helper}` : 'Stop-by request submitted' : isNoSupport(event.helpNeeded) ? 'Busy' : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? 'Request submitted' : event.helpNeeded}</em>
          </span>
        </button>) : <p>No plans.</p>}
      </div>
    </section>)}
  </div>
}

function MonthCalendar({ events, familyInTown, familyInTownDates, onOpen }: { events: TeamEvent[]; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onOpen: (eventId: string) => void }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDateKey, setSelectedDateKey] = useState('')
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay())
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const dateKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    return {
      date,
      dateKey,
      events: events.filter((event) => !event.isFlexible && event.date.startsWith(dateKey)).sort((a, b) => a.time.localeCompare(b.time)),
      inMonth: date.getMonth() === monthDate.getMonth(),
      isToday: date.getTime() === today.getTime(),
    }
  })
  const selectedDay = days.find((day) => day.dateKey === selectedDateKey)
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const changeMonth = (amount: number) => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + amount, 1))
  return <>
    <div className="month-calendar" role="region" aria-label={`${monthLabel} calendar`}>
      <div className="month-calendar-heading">
        <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft aria-hidden="true" /></button>
        <h3>{monthLabel}</h3>
        <button type="button" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="month-weekdays" aria-hidden="true">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="month-grid">{days.map((day) => {
        const label = day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        const openHelp = day.events.some((event) => !isNoSupport(event.helpNeeded) && !event.helper && !event.requestPending && !isCoveredByFamily(event, events, familyInTown, familyInTownDates))
        const appointmentCount = day.events.filter((event) => !event.proposalType && isNoSupport(event.helpNeeded)).length
        const foodCovered = day.events.some((event) => event.proposalType === 'food' && Boolean(event.helper))
        return <button className={`month-cell ${day.inMonth ? '' : 'outside-month'} ${day.isToday ? 'today' : ''} ${day.events.length ? 'has-events' : ''}`} type="button" key={day.dateKey} onClick={() => day.events.length && setSelectedDateKey(day.dateKey)} disabled={!day.events.length} aria-label={`${label}${day.events.length ? `, ${day.events.length} schedule ${day.events.length === 1 ? 'item' : 'items'}` : ', no plans'}`}>
          <span className="month-number">{day.date.getDate()}</span>
          <span className="month-statuses">{openHelp && <span className="month-status help">Help Needed</span>}{appointmentCount > 0 && <span className="month-status appointment">{appointmentCount} {appointmentCount === 1 ? 'Appointment' : 'Appointments'}</span>}{foodCovered && <span className="month-status food">Food Covered</span>}</span>
        </button>
      })}</div>
    </div>
    {selectedDay && <ModalShell title={selectedDay.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} onClose={() => setSelectedDateKey('')}>
      <div className="day-event-list">{selectedDay.events.map((event) => <button type="button" key={event.id} onClick={() => { setSelectedDateKey(''); onOpen(event.id) }}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{eventTimeRangeLabel(event)} · {whoDetails[event.forWho].label}</small><em>{isNoSupport(event.helpNeeded) ? 'Busy' : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? 'Request submitted' : event.helpNeeded}</em></span><ChevronRight aria-hidden="true" /></button>)}</div>
    </ModalShell>}
  </>
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="close-button" type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button><h2 id="modal-title">{title}</h2>{children}</section></div>
}
function EventDetailsModal({ event, organizer, availability, onClose, onEdit }: { event: TeamEvent; organizer: boolean; availability: Availability[]; onClose: () => void; onEdit: () => void }) {
  return <ModalShell title={event.title} onClose={onClose}>
    <div className="event-detail-summary">
      <div><small>Who</small><strong>{whoDetails[event.forWho].label}</strong></div>
      <div><small>When</small><strong>{event.dayLabel}<br />{eventTimeRangeLabel(event)}</strong></div>
      <div><small>{event.proposalType ? 'Plan' : isNoSupport(event.helpNeeded) ? 'Status' : 'Support requested'}</small><strong>{event.proposalType ? event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by' : isNoSupport(event.helpNeeded) ? 'Busy – please do not stop by' : event.helpNeeded}</strong></div>
      {shouldShowEventLocation(event) && <div><small>Where</small><strong>{event.location}</strong></div>}
      <div><small>Details</small><p>{event.details}</p></div>
      {event.helper && <div><small>Confirmed</small><strong>{event.helper}</strong>{(event.helperEmail || event.helperPhone) && <span className="compact-contact">{event.helperEmail && <a href={`mailto:${event.helperEmail}`}>{event.helperEmail}</a>}{event.helperPhone && <a href={`tel:${event.helperPhone}`}>{event.helperPhone}</a>}</span>}</div>}
      {!event.helper && event.requestPending && <div><small>Status</small><strong>Request submitted</strong></div>}
      {organizer && !event.helper && availability.length > 0 && <div><small>People who may be available</small><div className="compact-contact-list">{availability.slice(0, 8).map((entry) => <span key={entry.id}><strong>{entry.name}</strong><small>{event.isFlexible ? `${availabilityDayLabel(entry.day)}, ${availabilityTimeLabel(entry.time)}` : availabilityTimeLabel(entry.time)}</small><a href={`sms:${entry.phone}`}>Text {entry.phone}</a></span>)}</div></div>}
    </div>
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Close</button>{organizer && <button className="primary-button" type="button" onClick={onEdit}><Pencil aria-hidden="true" /> Edit</button>}</div>
  </ModalShell>
}
function OrganizerPanel({ requests, events, foodSettings, visitSettings, familyInTown, familyInTownDates, onSaveFoodSettings, onSaveVisitSettings, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAddSchedule, onEditEvent, onDecide, onLogout }: { requests: PendingRequest[]; events: TeamEvent[]; foodSettings: FoodSettings; visitSettings: VisitSettings; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveFoodSettings: (settings: FoodSettings) => Promise<boolean>; onSaveVisitSettings: (settings: VisitSettings) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAddSchedule: (forWho: ForWho) => void; onEditEvent: (event: TeamEvent) => void; onDecide: (id: string, decision: 'approve' | 'decline', declineReason?: string) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<'requests' | 'work'>('requests')
  const [declining, setDeclining] = useState<PendingRequest | null>(null)
  return <section className="organizer-panel" id="organizer-panel" aria-labelledby="organizer-title">
    <div className="organizer-heading"><div><p className="eyebrow">Private family area</p><h2 id="organizer-title">Edit &amp; Approve</h2></div><button className="text-button" type="button" onClick={onLogout}>Close private access</button></div>
    <div className="organizer-tabs" role="tablist" aria-label="Choose private family area">
      <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} type="button" onClick={() => setTab('requests')}><Check aria-hidden="true" /> Requests{requests.length ? ` (${requests.length})` : ''}</button>
      <button role="tab" aria-selected={tab === 'work'} className={tab === 'work' ? 'active' : ''} type="button" onClick={() => setTab('work')}><Clock3 aria-hidden="true" /> Family Schedule</button>
    </div>
    {tab === 'requests' ? requests.length ? <><p className="organizer-intro">Review support sign-ups, food drop-offs, and stop-by requests below. Contact information stays inside this private family area.</p><div className="organizer-requests">{requests.map((request) => <article key={request.id}><div><strong>{request.requesterName}</strong><span className="compact-contact"><a href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a>{request.requesterEmail && <a href={`mailto:${request.requesterEmail}`}>{request.requesterEmail}</a>}</span><p>{request.proposalType === 'food' ? 'Food drop-off' : request.proposalType === 'stop_by' ? 'Stop by' : request.title}</p><small>{request.isFlexible ? 'Anytime' : `${request.dayLabel}, ${eventTimeLabel(request.requestStartTime || request.time)} – ${eventTimeLabel(request.requestEndTime || request.endTime)}`}{request.proposalType ? request.details ? ` · ${request.details}` : ` · ${request.requestNote || ''}` : ` · ${request.helpNeeded}${request.requestNote ? ` · “${request.requestNote}”` : ''}`}</small></div><div><button className="text-button" type="button" onClick={() => setDeclining(request)}>Decline</button><button className="primary-button" type="button" onClick={() => onDecide(request.id, 'approve')}><Check aria-hidden="true" /> Approve</button></div></article>)}</div></> : <div className="organizer-empty"><Check aria-hidden="true" /><p><strong>No requests are waiting.</strong><br />New requests will appear here even if email is delayed.</p></div> : <FamilyScheduleEditor events={events} foodSettings={foodSettings} visitSettings={visitSettings} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveFood={onSaveFoodSettings} onSaveVisit={onSaveVisitSettings} onSaveFamilyInTown={onSaveFamilyInTown} onEditInTownDates={onEditInTownDates} onEditBusyDates={onEditBusyDates} onAdd={onAddSchedule} onEdit={onEditEvent} />}
    {declining && <DeclineRequestModal name={declining.requesterName} onClose={() => setDeclining(null)} onDecline={(reason) => { onDecide(declining.id, 'decline', reason); setDeclining(null) }} />}
  </section>
}

function DeclineRequestModal({ name, onClose, onDecline }: { name: string; onClose: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <ModalShell title="Decline this request" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onDecline(reason.trim()) }}><p className="modal-intro">Add a short, kind reason for {name}. It will be included in their email when an email address is available.</p><label htmlFor="decline-reason">Reason</label><textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: We no longer need coverage at this time." autoFocus required /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="danger-button" type="submit" disabled={!reason.trim()}>Decline request</button></div></form></ModalShell>
}

function FamilyScheduleEditor({ events, foodSettings, visitSettings, familyInTown, familyInTownDates, onSaveFood, onSaveVisit, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAdd, onEdit }: { events: TeamEvent[]; foodSettings: FoodSettings; visitSettings: VisitSettings; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveFood: (settings: FoodSettings) => Promise<boolean>; onSaveVisit: (settings: VisitSettings) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAdd: (forWho: ForWho) => void; onEdit: (event: TeamEvent) => void }) {
  const [person, setPerson] = useState<ForWho>('Mary')
  const [foodDays, setFoodDays] = useState(foodSettings.weekdays)
  const [foodStart, setFoodStart] = useState(foodSettings.startTime)
  const [foodEnd, setFoodEnd] = useState(foodSettings.endTime)
  const [visitStart, setVisitStart] = useState(visitSettings.startTime)
  const [visitEnd, setVisitEnd] = useState(visitSettings.endTime)
  const profiles: Record<ForWho, string> = {
    Mary: 'Mom · Needs full-time care',
    Stu: 'Husband · Works full time',
    Gabby: 'Daughter · Works remotely',
    Spencer: 'Son · Works full time',
    Coco: 'Dog · Appointments may take a family member away from home',
    Family: 'Shared plans that affect the whole family',
  }
  const todayKey = localDateInputValue().replaceAll('-', '')
  const upcoming = events.filter((event) => event.forWho === person && !event.proposalType && event.date.slice(0, 8) >= todayKey).slice(0, 8)
  const upcomingList = upcoming.length ? <div className="family-schedule-list">{upcoming.map((event) => <button type="button" key={event.id} onClick={() => onEdit(event)}><span><strong>{event.title}</strong><small>{event.dayLabel} · {eventTimeRangeLabel(event)}</small></span><span>{event.helpNeeded}</span><Pencil aria-hidden="true" /></button>)}</div> : <div className="organizer-empty"><CalendarDays aria-hidden="true" /><p><strong>No upcoming items for {person}.</strong><br />Add work, appointments, visits, time away, or personal plans here.</p></div>
  return <div className="work-hours-editor">
    <div className="family-roster" aria-label="Who is in town"><div><strong>Mary</strong><span>Mom · Receiving care</span></div>{(['Stu', 'Gabby', 'Spencer'] as (keyof FamilyInTown)[]).map((name) => <div className="family-presence" key={name}><span><strong>{name}</strong><small>{name === 'Stu' ? 'Husband' : name === 'Gabby' ? 'Daughter' : 'Son'}</small></span><label className="in-town-check"><input type="checkbox" checked={familyInTown[name]} onChange={(event) => void onSaveFamilyInTown(name, event.target.checked)} /><strong>In Town Full Time</strong></label>{!familyInTown[name] && <button type="button" onClick={() => onEditInTownDates(name)}><CalendarDays aria-hidden="true" /> {familyInTownDates[name].length ? `${familyInTownDates[name].length} in-town dates` : 'Choose in-town dates'}</button>}</div>)}</div>
    <div className="family-person-tabs" role="tablist" aria-label="Choose a family member">{(['Mary', 'Stu', 'Gabby', 'Spencer', 'Family'] as ForWho[]).map((name) => <button type="button" role="tab" aria-selected={person === name} className={person === name ? 'active' : ''} onClick={() => setPerson(name)} key={name}>{name}</button>)}</div>
    <div className="family-schedule-heading"><div><h3>{person}’s schedule</h3><p>{profiles[person]}</p></div><div className="family-schedule-actions">{(['Stu', 'Gabby', 'Spencer'] as ForWho[]).includes(person) && <button className="primary-button" type="button" onClick={() => onEditBusyDates(person as keyof FamilyInTown)}><CalendarDays aria-hidden="true" /> Choose work or away days</button>}<button className="secondary-button" type="button" onClick={() => onAdd(person)}>+ Add an appointment or time away</button></div></div>
    {person !== 'Family' && upcomingList}
    {person === 'Mary' && <p className="work-hours-tip"><strong>Mary’s appointments matter.</strong> Home visits, massage, PT, nurses, and outside appointments block conflicting food or visit times automatically.</p>}
    {person === 'Gabby' && <p className="work-hours-tip"><strong>{familyInTown.Gabby ? 'Gabby is in town full time.' : familyInTownDates.Gabby.length ? `${familyInTownDates.Gabby.length} in-town dates selected.` : 'Gabby is currently out of town.'}</strong> When she is in town, block off only the hours when she is working, away, or needs a break.</p>}
    {person === 'Spencer' && <p className="work-hours-tip"><strong>{familyInTown.Spencer ? 'Spencer is in town full time.' : familyInTownDates.Spencer.length ? `${familyInTownDates.Spencer.length} in-town dates selected.` : 'Spencer is currently out of town.'}</strong> When he is in town, block off only his working or away times.</p>}
    {person === 'Family' && <><div className="family-rules"><form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); if (visitEnd > visitStart) await onSaveVisit({ startTime: visitStart, endTime: visitEnd }) }}><h3>Normal visiting hours</h3><p>Friends are welcome to request a Stop By time during these hours. They can still request a different time for the family to approve.</p><div className="field-row"><div><label htmlFor="visit-start">From</label><input id="visit-start" type="time" value={visitStart} onChange={(event) => setVisitStart(event.target.value)} required /></div><div><label htmlFor="visit-end">Until</label><input id="visit-end" type="time" value={visitEnd} onChange={(event) => setVisitEnd(event.target.value)} required /></div></div><div className="form-actions"><button className="primary-button" type="submit" disabled={visitEnd <= visitStart}><Check aria-hidden="true" /> Save visiting hours</button></div></form><form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); if (foodDays.length && foodEnd > foodStart) await onSaveFood({ weekdays: foodDays, startTime: foodStart, endTime: foodEnd }) }}><h3>Food drop-off days</h3><p>Choose the days and hours shown in Bring Food. Filled dates are hidden automatically.</p><fieldset className="weekday-picker"><legend>Available days</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={foodDays.includes(day.value)} onChange={() => setFoodDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value].sort())} /><span aria-hidden="true">{day.short}</span><span className="sr-only">{day.label}</span></label>)}</fieldset><div className="field-row"><div><label htmlFor="food-start">From</label><input id="food-start" type="time" value={foodStart} onChange={(event) => setFoodStart(event.target.value)} required /></div><div><label htmlFor="food-end">Until</label><input id="food-end" type="time" value={foodEnd} onChange={(event) => setFoodEnd(event.target.value)} required /></div></div><div className="form-actions"><button className="primary-button" type="submit" disabled={!foodDays.length || foodEnd <= foodStart}><Check aria-hidden="true" /> Save food days</button></div></form></div><div className="family-schedule-divider" /><div><h3>Upcoming family appointments</h3><p>Open any item below to view or edit it.</p></div>{upcomingList}</>}
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
function SignupModal({ event, onClose, onSave }: { event: TeamEvent; onClose: () => void; onSave: (id: string, name: string, phone: string, email: string, startTime: string, endTime: string, note: string) => Promise<boolean> }) {
  const [contact] = useState(savedHelperContact)
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email)
  const [startTime, setStartTime] = useState(event.isFlexible ? '' : event.time)
  const [endTime, setEndTime] = useState(event.isFlexible ? '' : event.endTime)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const timeIsValid = event.isFlexible || (startTime >= event.time && endTime <= event.endTime && endTime > startTime)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !name.trim() || !phone.trim() || !email.trim() || !timeIsValid) return
    setSaving(true)
    const saved = await onSave(eventId, name.trim(), phone.trim(), email.trim(), startTime, endTime, note.trim())
    if (saved) window.localStorage.setItem('marys-team-helper-contact', JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() }))
    if (!saved) setSaving(false)
  }
  const eventId = event.id
  return <ModalShell title="Tell us when you can come" onClose={onClose}><div className="modal-summary"><strong>{event.title}</strong><span>{event.isFlexible ? 'Anytime' : `${event.dayLabel}, help is welcome anytime from ${eventTimeRangeLabel(event)}`}</span><p>{event.helpNeeded}</p></div><form onSubmit={submit}>{!event.isFlexible && <><p className="form-note"><strong>You do not need to cover the entire window.</strong> Choose the time that actually works for you.</p><div className="field-row"><div><label htmlFor="helper-start">I can arrive at</label><input id="helper-start" type="time" min={event.time} max={event.endTime} value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></div><div><label htmlFor="helper-end">I need to leave at</label><input id="helper-end" type="time" min={event.time} max={event.endTime} value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></div></div>{!timeIsValid && <p className="field-error">Choose a start and end time inside the open window.</p>}</>}<label htmlFor="helper-name">Your name</label><input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your first and last name" autoFocus required /><label htmlFor="helper-phone">Your phone number</label><input id="helper-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" required /><label htmlFor="helper-email">Your email address</label><input id="helper-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /><label htmlFor="helper-note">Note or question <span>(optional)</span></label><textarea id="helper-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: Is 1–4 PM enough coverage, or would another day be more useful?" /><p className="form-note">Your exact time and note will be included with your request. We will email you after it is approved or declined.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !timeIsValid} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Submitting…' : 'Submit this time'}</button></div></form></ModalShell>
}

function PlanRequestModal({ type, events, foodSettings, visitSettings, foodReservedDates, onClose, onSave }: { type: PlanType; events: TeamEvent[]; foodSettings: FoodSettings; visitSettings: VisitSettings; foodReservedDates: string[]; onClose: () => void; onSave: (plan: { type: PlanType; name: string; phone: string; email: string; date: string; time: string; endTime: string; details: string }) => Promise<boolean> }) {
  const [contact] = useState(savedHelperContact)
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email)
  const [date, setDate] = useState(() => type === 'food' ? nextFoodDate(foodSettings.weekdays) : localDateInputValue())
  const [time, setTime] = useState(type === 'food' ? foodSettings.startTime : visitSettings.startTime)
  const [endTime, setEndTime] = useState(type === 'food' ? addMinutes(foodSettings.startTime, 30) : addHour(visitSettings.startTime))
  const [details, setDetails] = useState('')
  const [dropOffPlace, setDropOffPlace] = useState('Front door')
  const [saving, setSaving] = useState(false)
  const timeIsValid = endTime > time
  const compactDate = date.replaceAll('-', '')
  const selectedWeekday = new Date(`${date}T12:00:00`).getDay()
  const foodDayAllowed = type !== 'food' || foodSettings.weekdays.includes(selectedWeekday)
  const foodDateIsTaken = type === 'food' && foodReservedDates.includes(compactDate)
  const maryHasAppointmentThen = type === 'food' && events.some((item) => item.forWho === 'Mary' && !item.proposalType && item.date.slice(0, 8) === compactDate && !item.isFlexible && item.time < endTime && item.endTime > time)
  const foodTimeIsValid = type !== 'food' || (time >= foodSettings.startTime && endTime <= foodSettings.endTime)
  const foodSlotUnavailable = type === 'food' && (!foodDayAllowed || foodDateIsTaken || maryHasAppointmentThen || !foodTimeIsValid)
  const outsideVisitHours = type === 'stop_by' && (time < visitSettings.startTime || endTime > visitSettings.endTime)
  const stopByConflict = type === 'stop_by' && events.some((item) => !item.isFlexible && item.date.slice(0, 8) === compactDate && item.time < endTime && item.endTime > time && (item.forWho === 'Mary' || item.proposalType === 'stop_by'))
  const maryBusyThatDay = events.filter((item) => !item.isFlexible && item.date.slice(0, 8) === compactDate && (item.forWho === 'Mary' || item.proposalType === 'stop_by')).sort((a, b) => a.time.localeCompare(b.time))
  const foodDayNames = foodSettings.weekdays.map((day) => weekdayChoices.find((choice) => choice.value === day)?.label).filter(Boolean).join(' or ')
  const foodCalendarDays = getThirtyDays()
  const foodCalendarBlanks = new Date(`${foodCalendarDays[0].dateKey.slice(0, 4)}-${foodCalendarDays[0].dateKey.slice(4, 6)}-${foodCalendarDays[0].dateKey.slice(6, 8)}T12:00:00`).getDay()

  function changeStartTime(value: string) {
    setTime(value)
    const suggestedEnd = type === 'food' ? addMinutes(value, 30) : addHour(value)
    if (suggestedEnd > value) setEndTime(suggestedEnd)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !timeIsValid || foodSlotUnavailable || stopByConflict) return
    setSaving(true)
    const foodDetails = type === 'food' ? `${details.trim() || 'Food drop-off'} · ${dropOffPlace}` : details.trim()
    const saved = await onSave({ type, name: name.trim(), phone: phone.trim(), email: email.trim(), date, time, endTime, details: foodDetails })
    if (!saved) setSaving(false)
  }

  return <ModalShell title={type === 'food' ? 'Bring food' : 'Request a time to stop by'} onClose={onClose}>
    <p className="modal-intro">{type === 'food' ? `Choose an open ${foodDayNames} between ${eventTimeLabel(foodSettings.startTime)} and ${eventTimeLabel(foodSettings.endTime)}. Filled dates are unavailable.` : `The usual Stop By hours are ${eventTimeLabel(visitSettings.startTime)} – ${eventTimeLabel(visitSettings.endTime)}. Choose the time that works for you.`}</p>
    <form onSubmit={submit}>
      <label htmlFor="plan-name">Your name</label><input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your first and last name" autoComplete="name" autoFocus required />
      <div className="field-row"><div><label htmlFor="plan-phone">Phone number</label><input id="plan-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(602) 555-0123" autoComplete="tel" required /></div><div><label htmlFor="plan-email">Email address</label><input id="plan-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></div></div>
      {type === 'food' ? <><label>Choose an open date</label><div className="calendar-date-picker food-date-picker"><div className="date-picker-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="date-picker-grid">{Array.from({ length: foodCalendarBlanks }, (_, index) => <span className="date-picker-blank" key={`food-blank-${index}`} />)}{foodCalendarDays.map((day) => { const isoDate = `${day.dateKey.slice(0, 4)}-${day.dateKey.slice(4, 6)}-${day.dateKey.slice(6, 8)}`; const weekday = new Date(`${isoDate}T12:00:00`).getDay(); const filled = foodReservedDates.includes(day.dateKey); const allowed = foodSettings.weekdays.includes(weekday) && !filled; const selected = date === isoDate; return <button type="button" key={day.dateKey} disabled={!allowed} aria-pressed={selected} aria-label={`${day.fullDay}${filled ? ', filled' : allowed ? ', open' : ', unavailable'}`} onClick={() => setDate(isoDate)}><span>{day.monthShort}</span><strong>{day.number}</strong>{filled && <small>Filled</small>}</button> })}</div></div></> : <><label htmlFor="plan-date">Date</label><input id="plan-date" type="date" min={localDateInputValue()} value={date} onChange={(event) => setDate(event.target.value)} required /></>}
      {type === 'food' && <div className={`meal-week-status ${foodSlotUnavailable ? 'covered' : ''}`} role="status"><Utensils aria-hidden="true" /><p><strong>{!foodDayAllowed ? `Please choose ${foodDayNames}.` : foodDateIsTaken ? 'Someone is already bringing food that day.' : maryHasAppointmentThen ? 'Mary has an appointment during that time.' : !foodTimeIsValid ? `Choose a time between ${eventTimeLabel(foodSettings.startTime)} and ${eventTimeLabel(foodSettings.endTime)}.` : 'This food drop-off time is open.'}</strong><br />Filled dates and appointment conflicts are blocked automatically.</p></div>}
      <div className="field-row"><div><label htmlFor="plan-time">{type === 'food' ? 'Drop off around' : 'Arrive'}</label><input id="plan-time" type="time" value={time} onChange={(event) => changeStartTime(event.target.value)} required /></div><div><label htmlFor="plan-end-time">{type === 'food' ? 'Until' : 'Leave'}</label><input id="plan-end-time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></div></div>
      {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      {outsideVisitHours && <p className="outside-hours-note" role="status"><strong>Outside normal visiting hours.</strong> You can still send this request for the family to approve.</p>}
      {type === 'stop_by' && maryBusyThatDay.length > 0 && <div className={`meal-week-status ${stopByConflict ? 'covered' : ''}`} role="status"><Clock3 aria-hidden="true" /><p><strong>{stopByConflict ? 'That time is already busy. Please choose another time.' : 'Mary is open during the time you chose.'}</strong><br />Already scheduled that day: {maryBusyThatDay.map((item) => eventTimeRangeLabel(item)).join(', ')}.</p></div>}
      {type === 'food' && <><label htmlFor="drop-off-place">Where will you leave the food?</label><select id="drop-off-place" value={dropOffPlace} onChange={(event) => setDropOffPlace(event.target.value)}><option>Front door</option><option>Back gate by the garage</option><option>I would like to come inside and say hi</option></select><p className="form-note">For a quick drop-off, text the family when you arrive so someone can bring it inside. To visit, choose the last option so the family knows.</p></>}
      <label htmlFor="plan-details">{type === 'food' ? 'What are you bringing? ' : 'Anything Mary and Stu should know? '}<span>(optional)</span></label><textarea id="plan-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder={type === 'food' ? 'Example: Chicken soup and bread' : 'Example: I can keep Mary company and help with small things around the house.'} />
      <p className="form-note privacy-note">This request stays private until Mary or Stu approves it. We will email you after they decide.</p>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !timeIsValid || foodSlotUnavailable || stopByConflict}><Check aria-hidden="true" /> {saving ? 'Sending request…' : 'Send request'}</button></div>
    </form>
  </ModalShell>
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

  return <ModalShell title="Availability" onClose={onClose}>
    <p className="modal-intro">Share times when the family may call if something comes up. This does not sign you up for anything.</p>
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

function FamilyBusyDatesModal({ person, events, onClose, onSave }: { person: keyof FamilyInTown; events: TeamEvent[]; onClose: () => void; onSave: (dates: string[], startTime: string, endTime: string) => Promise<boolean> }) {
  const days = getThirtyDays()
  const first = days[0].dateKey
  const last = days.at(-1)?.dateKey || first
  const blanks = new Date(`${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}T12:00:00`).getDay()
  const tracked = events.filter((event) => event.forWho === person && event.date.slice(0, 8) >= first && event.date.slice(0, 8) <= last && (event.scheduleSource === 'family_busy' || event.scheduleSource === 'stu_work'))
  const [selectedDates, setSelectedDates] = useState(() => [...new Set(tracked.map((event) => event.date.slice(0, 8)))])
  const [saving, setSaving] = useState(false)
  return <ModalShell title={`${person}’s work or away days`} onClose={onClose}><p className="modal-intro">Tap each date {person} will be working or away. Tap a selected date again to remove it.</p><form onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); if (!await onSave(selectedDates, '09:00', '17:00')) setSaving(false) }}><div className="calendar-date-picker"><div className="date-picker-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="date-picker-grid">{Array.from({ length: blanks }, (_, index) => <span className="date-picker-blank" key={`busy-blank-${index}`} />)}{days.map((day) => { const selected = selectedDates.includes(day.dateKey); return <button type="button" key={day.dateKey} aria-pressed={selected} aria-label={`${day.fullDay}${selected ? ', selected' : ''}`} onClick={() => setSelectedDates(selected ? selectedDates.filter((date) => date !== day.dateKey) : [...selectedDates, day.dateKey])}><span>{day.monthShort}</span><strong>{day.number}</strong></button> })}</div></div><p className="form-note"><strong>{selectedDates.length || 'No'} {selectedDates.length === 1 ? 'date' : 'dates'} selected.</strong> Saving will not change the hours or details of dates already on the schedule. Open each newly added date afterward to set its individual hours and details.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : 'Save selected dates'}</button></div></form></ModalShell>
}

function FamilyInTownDatesModal({ person, selectedDates, onClose, onSave }: { person: keyof FamilyInTown; selectedDates: string[]; onClose: () => void; onSave: (dates: string[]) => Promise<boolean> }) {
  const days = getThirtyDays()
  const first = days[0].dateKey
  const blanks = new Date(`${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}T12:00:00`).getDay()
  const [dates, setDates] = useState(selectedDates)
  const [saving, setSaving] = useState(false)
  return <ModalShell title={`${person}’s in-town dates`} onClose={onClose}><p className="modal-intro">Tap each date {person} will be in town. On these days, the app assumes {person} is with Mary unless work or away time is blocked off.</p><form onSubmit={async (event) => { event.preventDefault(); if (saving) return; setSaving(true); if (!await onSave(dates)) setSaving(false) }}><div className="calendar-date-picker"><div className="date-picker-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="date-picker-grid">{Array.from({ length: blanks }, (_, index) => <span className="date-picker-blank" key={`town-blank-${index}`} />)}{days.map((day) => { const selected = dates.includes(day.dateKey); return <button type="button" key={day.dateKey} aria-pressed={selected} aria-label={`${day.fullDay}${selected ? ', in town' : ', out of town'}`} onClick={() => setDates(selected ? dates.filter((date) => date !== day.dateKey) : [...dates, day.dateKey])}><span>{day.monthShort}</span><strong>{day.number}</strong></button> })}</div></div><p className="form-note"><strong>{dates.length || 'No'} in-town {dates.length === 1 ? 'date' : 'dates'} selected.</strong> All other dates are treated as out of town.</p><div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : 'Save in-town dates'}</button></div></form></ModalShell>
}

function DriverFields({ contacts, driver, onChange }: { contacts: DriverContact[]; driver: DriverContact; onChange: (driver: DriverContact) => void }) {
  const currentContact = contacts.findIndex((contact) => contact.name === driver.name && phoneKey(contact.phone) === phoneKey(driver.phone))
  const [choice, setChoice] = useState(driver.name ? currentContact >= 0 ? `contact:${currentContact}` : 'manual' : 'open')
  function choose(value: string) {
    setChoice(value)
    if (value === 'open') onChange({ name: '', phone: '', email: '' })
    else if (value.startsWith('contact:')) onChange(contacts[Number(value.split(':')[1])] || { name: '', phone: '', email: '' })
    else onChange({ name: '', phone: '', email: '' })
  }
  return <div className="driver-fields">
    <label htmlFor="ride-driver">Who is driving?</label>
    <select id="ride-driver" value={choice} onChange={(event) => choose(event.target.value)}>
      <option value="open">Still need a driver</option>
      {contacts.map((contact, index) => <option value={`contact:${index}`} key={`${contact.name}-${contact.phone}`}>{contact.name} · available then</option>)}
      <option value="manual">Someone else has agreed</option>
    </select>
    {choice !== 'open' && <><div className="field-row"><div><label htmlFor="driver-name">Driver’s name</label><input id="driver-name" required value={driver.name} onChange={(event) => onChange({ ...driver, name: event.target.value })} /></div><div><label htmlFor="driver-phone">Phone number</label><input id="driver-phone" type="tel" required value={driver.phone} onChange={(event) => onChange({ ...driver, phone: event.target.value })} autoComplete="tel" /></div></div><label htmlFor="driver-email">Email address</label><input id="driver-email" type="email" required value={driver.email} onChange={(event) => onChange({ ...driver, email: event.target.value })} autoComplete="email" placeholder="Needed to send confirmation" /><p className="form-note">This person will receive a confirmation email with the appointment details and destination.</p></>}
  </div>
}

function AddEventModal({ initialForWho, availability, events, onClose, onSave }: { initialForWho: ForWho; availability: Availability[]; events: TeamEvent[]; onClose: () => void; onSave: (events: TeamEvent[]) => Promise<boolean> }) {
  const [form, setForm] = useState(() => ({ title: initialForWho === 'Mary' ? 'At Home Appointment' : '', date: localDateInputValue(), time: '12:00', endTime: '13:00', forWho: initialForWho, helpNeeded: initialForWho === 'Mary' ? 'No help needed' : needsTimeWithMary(initialForWho) ? 'Spend time with Mary' : 'Need a ride', details: '', locationChoice: initialForWho === 'Mary' ? 'home' : 'location', location: '', helper: '', helperPhone: '', helperEmail: '', isFlexible: false }))
  const [repeats, setRepeats] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repeatThrough, setRepeatThrough] = useState(() => {
    const repeatDefault = new Date()
    repeatDefault.setDate(repeatDefault.getDate() + 28)
    return repeatDefault.toISOString().slice(0, 10)
  })
  const timeIsValid = form.isFlexible || form.endTime > form.time
  const hideLocation = form.helpNeeded === 'Spend time with Mary'

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
    const events = dates.map((date) => ({ id: crypto.randomUUID(), category: form.forWho === 'Mary' ? 'appointment' as const : 'family' as const, forWho: form.forWho, date: compactEventDate(date, form.isFlexible ? '00:00' : form.time), dayLabel: form.isFlexible ? 'Anytime' : dayLabelForDate(date), time: form.isFlexible ? 'anytime' : form.time, endTime: form.isFlexible ? 'anytime' : form.endTime, title: form.title, details: form.details.trim() || defaultEventDetails, location: hideLocation ? undefined : form.locationChoice === 'home' ? 'Home' : form.location || undefined, helpNeeded: form.helpNeeded, helper: form.helpNeeded === 'Need a ride' ? form.helper || undefined : undefined, helperPhone: form.helpNeeded === 'Need a ride' ? form.helperPhone || undefined : undefined, helperEmail: form.helpNeeded === 'Need a ride' ? form.helperEmail || undefined : undefined, repeatGroupId: form.isFlexible ? undefined : repeatGroupId, isFlexible: form.isFlexible }))
    setSaving(true)
    const saved = await onSave(events)
    if (!saved) setSaving(false)
  }

  return <ModalShell title="Add an appointment or task" onClose={onClose}><p className="modal-intro">Add one item or repeat it every week.</p><form onSubmit={submit}>
    <label htmlFor="event-title">What is happening?</label>{form.forWho === 'Mary' ? <select id="event-title" required value={form.title} onChange={(event) => { const title = event.target.value; setForm({ ...form, title, locationChoice: title === 'At Home Appointment' ? 'home' : 'location', helpNeeded: title === 'At Home Appointment' ? 'No help needed' : 'Need a ride' }) }} autoFocus>{maryAppointmentChoices.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input id="event-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Example: Stu at work" autoFocus />}
    <div className="field-row"><div><label htmlFor="event-date">{form.isFlexible ? 'Available starting' : 'Date'}</label><input id="event-date" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div><div><label htmlFor="event-for-who">Who is this for?</label><select id="event-for-who" value={form.forWho} onChange={(event) => { const forWho = event.target.value as ForWho; setForm({ ...form, forWho, title: forWho === 'Mary' ? 'At Home Appointment' : form.title === 'At Home Appointment' || form.title === 'Appointment' ? '' : form.title, locationChoice: forWho === 'Mary' ? 'home' : form.locationChoice, helpNeeded: forWho === 'Mary' ? 'No help needed' : needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <label className="repeat-toggle"><input type="checkbox" checked={form.isFlexible} onChange={(event) => setForm({ ...form, isFlexible: event.target.checked })} /><span><Clock3 aria-hidden="true" /><strong>Anytime task</strong><small>Use this for something that needs to be done but has no set appointment time.</small></span></label>
    {!form.isFlexible && <div className="field-row"><div><label htmlFor="event-time">Starts</label><input id="event-time" type="time" required value={form.time} onChange={(event) => changeStartTime(event.target.value)} /></div><div><label htmlFor="event-end-time">Ends</label><input id="event-end-time" type="time" required value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></div>}
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    {!form.isFlexible && <label className="repeat-toggle"><input type="checkbox" checked={repeats} onChange={(event) => setRepeats(event.target.checked)} /><span><Repeat2 aria-hidden="true" /><strong>Repeat every week</strong><small>Add this on the same weekday each week.</small></span></label>}
    {!form.isFlexible && repeats && <><label htmlFor="repeat-through">Repeat through</label><input id="repeat-through" type="date" min={form.date} value={repeatThrough < form.date ? form.date : repeatThrough} onChange={(event) => setRepeatThrough(event.target.value)} /></>}
    <label htmlFor="event-help">What support is needed?</label><select id="event-help" value={form.helpNeeded} onChange={(event) => setForm({ ...form, helpNeeded: event.target.value })}>{supportChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    {form.helpNeeded === 'Need a ride' && !form.isFlexible && <DriverFields contacts={availableDriverContacts(form.date, form.time, form.endTime, availability, events)} driver={{ name: form.helper, phone: form.helperPhone, email: form.helperEmail }} onChange={(driver) => setForm({ ...form, helper: driver.name, helperPhone: driver.phone, helperEmail: driver.email })} />}
    {!hideLocation && <><label htmlFor="event-location-choice">Where?</label><select id="event-location-choice" value={form.locationChoice} onChange={(event) => { const locationChoice = event.target.value; setForm({ ...form, locationChoice, title: form.forWho === 'Mary' ? locationChoice === 'home' ? 'At Home Appointment' : 'Appointment' : form.title, helpNeeded: form.forWho === 'Mary' ? locationChoice === 'home' ? 'No help needed' : 'Need a ride' : form.helpNeeded }) }}><option value="home">Home</option><option value="location">Location</option></select>{form.locationChoice === 'location' && <><label htmlFor="event-location">Location name or address</label><input id="event-location" required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Example: Mayo Clinic, 13400 E Shea Blvd" /></>}</>}
    <label htmlFor="event-details">Details {form.forWho !== 'Mary' && <span>(optional)</span>}</label><textarea id="event-details" required={form.forWho === 'Mary'} value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} placeholder={form.forWho === 'Mary' ? 'Example: Stretch with Cara' : defaultEventDetails} />
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid || saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : repeats ? 'Add weekly schedule' : 'Add to the schedule'}</button></div>
  </form></ModalShell>
}

function EditEventModal({ event, availability, events, onClose, onSave, onRemove }: { event: TeamEvent; availability: Availability[]; events: TeamEvent[]; onClose: () => void; onSave: (event: TeamEvent) => void; onRemove: (eventId: string) => void }) {
  const date = `${event.date.slice(0, 4)}-${event.date.slice(4, 6)}-${event.date.slice(6, 8)}`
  const isMaryAppointment = event.forWho === 'Mary' && event.category === 'appointment'
  const originalTitleIsStandard = maryAppointmentChoices.includes(event.title)
  const startsAtHome = event.location?.trim().toLocaleLowerCase() === 'home' || event.title.toLocaleLowerCase().includes('at home')
  const [form, setForm] = useState({ ...event, title: isMaryAppointment ? startsAtHome ? 'At Home Appointment' : 'Appointment' : event.title, details: isMaryAppointment && !originalTitleIsStandard && event.details === defaultEventDetails ? event.title : event.details, locationChoice: startsAtHome ? 'home' : 'location', location: startsAtHome ? '' : event.location || '', helper: event.helper || '', helperPhone: event.helperPhone || '', helperEmail: event.helperEmail || '', date, endTime: event.endTime || addHour(event.time), helpNeeded: isNoSupport(event.helpNeeded) ? 'No help needed' : event.helpNeeded })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const timeIsValid = form.isFlexible || form.endTime > form.time
  const hideLocation = form.helpNeeded === 'Spend time with Mary'

  function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    if (!timeIsValid) return
    onSave({ ...event, ...form, category: form.forWho === 'Mary' ? 'appointment' : 'family', date: compactEventDate(form.date, form.isFlexible ? '00:00' : form.time), dayLabel: form.isFlexible ? 'Anytime' : dayLabelForDate(form.date), time: form.isFlexible ? 'anytime' : form.time, endTime: form.isFlexible ? 'anytime' : form.endTime, details: form.details.trim() || defaultEventDetails, location: hideLocation ? undefined : form.locationChoice === 'home' ? 'Home' : form.location || undefined, helper: form.helpNeeded === 'Need a ride' ? form.helper || undefined : undefined, helperPhone: form.helpNeeded === 'Need a ride' ? form.helperPhone || undefined : undefined, helperEmail: form.helpNeeded === 'Need a ride' ? form.helperEmail || undefined : undefined })
  }

  return <ModalShell title="View or edit schedule" onClose={onClose}><p className="modal-intro">Click any box below to make a change.{event.repeatGroupId || event.scheduleSource === 'stu_work' ? ' This changes this date only.' : ''}</p><form onSubmit={submit}>
    <label htmlFor="edit-event-title">What is happening?</label>{form.forWho === 'Mary' && event.category === 'appointment' ? <select id="edit-event-title" required value={form.title} onChange={(changeEvent) => { const title = changeEvent.target.value; setForm({ ...form, title, locationChoice: title === 'At Home Appointment' ? 'home' : form.locationChoice }) }} autoFocus>{maryAppointmentChoices.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input id="edit-event-title" required value={form.title} onChange={(changeEvent) => setForm({ ...form, title: changeEvent.target.value })} autoFocus />}
    <div className="field-row"><div><label htmlFor="edit-event-date">{form.isFlexible ? 'Available starting' : 'Date'}</label><input id="edit-event-date" type="date" required value={form.date} onChange={(changeEvent) => setForm({ ...form, date: changeEvent.target.value })} /></div><div><label htmlFor="edit-event-for-who">Who is this for?</label><select id="edit-event-for-who" value={form.forWho} onChange={(changeEvent) => { const forWho = changeEvent.target.value as ForWho; setForm({ ...form, forWho, helpNeeded: needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <label className="repeat-toggle"><input type="checkbox" checked={Boolean(form.isFlexible)} onChange={(changeEvent) => setForm({ ...form, isFlexible: changeEvent.target.checked, time: changeEvent.target.checked ? 'anytime' : '12:00', endTime: changeEvent.target.checked ? 'anytime' : '13:00', dayLabel: changeEvent.target.checked ? 'Anytime' : form.dayLabel })} /><span><Clock3 aria-hidden="true" /><strong>Anytime task</strong><small>Use this for something that needs doing but has no set appointment time.</small></span></label>
    {!form.isFlexible && <div className="field-row"><div><label htmlFor="edit-event-time">Starts</label><input id="edit-event-time" type="time" required value={form.time} onChange={(changeEvent) => setForm({ ...form, time: changeEvent.target.value, endTime: addHour(changeEvent.target.value) })} /></div><div><label htmlFor="edit-event-end-time">Ends</label><input id="edit-event-end-time" type="time" required value={form.endTime} onChange={(changeEvent) => setForm({ ...form, endTime: changeEvent.target.value })} /></div></div>}
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    <label htmlFor="edit-event-help">What support is needed?</label><select id="edit-event-help" value={form.helpNeeded} onChange={(changeEvent) => setForm({ ...form, helpNeeded: changeEvent.target.value })}>{supportChoices.map((choice) => <option key={choice}>{choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    {form.helpNeeded === 'Need a ride' && !form.isFlexible && <DriverFields contacts={availableDriverContacts(form.date, form.time, form.endTime, availability, events)} driver={{ name: form.helper, phone: form.helperPhone, email: form.helperEmail }} onChange={(driver) => setForm({ ...form, helper: driver.name, helperPhone: driver.phone, helperEmail: driver.email })} />}
    {!hideLocation && <><label htmlFor="edit-event-location-choice">Where?</label><select id="edit-event-location-choice" value={form.locationChoice} onChange={(changeEvent) => { const locationChoice = changeEvent.target.value; setForm({ ...form, locationChoice, title: form.forWho === 'Mary' && event.category === 'appointment' ? locationChoice === 'home' ? 'At Home Appointment' : 'Appointment' : form.title }) }}><option value="home">Home</option><option value="location">Location</option></select>{form.locationChoice === 'location' && <><label htmlFor="edit-event-location">Location name or address</label><input id="edit-event-location" required value={form.location || ''} onChange={(changeEvent) => setForm({ ...form, location: changeEvent.target.value })} /></>}</>}
    <label htmlFor="edit-event-details">Details {!(form.forWho === 'Mary' && event.category === 'appointment') && <span>(optional)</span>}</label><textarea id="edit-event-details" required={form.forWho === 'Mary' && event.category === 'appointment'} value={form.details} onChange={(changeEvent) => setForm({ ...form, details: changeEvent.target.value })} placeholder={form.forWho === 'Mary' && event.category === 'appointment' ? 'Example: Stretch with Cara' : defaultEventDetails} />
    <div className="remove-area">{confirmRemove ? <div className="remove-confirm" role="alert"><p><strong>Remove this schedule item?</strong></p><div><button className="text-button" type="button" onClick={() => setConfirmRemove(false)}>Keep it</button><button className="danger-button" type="button" onClick={() => onRemove(event.id)}><Trash2 aria-hidden="true" /> Yes, remove it</button></div></div> : <button className="remove-button" type="button" onClick={() => setConfirmRemove(true)}><Trash2 aria-hidden="true" /> Remove this item</button>}</div>
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid}><Check aria-hidden="true" /> Save changes</button></div>
  </form></ModalShell>
}

function ApprovalModal({ request, onClose, onDecide }: { request: ApprovalRequest; onClose: () => void; onDecide: (decision: 'approve' | 'decline', declineReason?: string) => void }) {
  const pending = request.status === 'pending'
  const isPlan = Boolean(request.proposalType)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  return <ModalShell title={pending ? `Review ${isPlan ? 'proposed plan' : 'support request'}` : 'Request already handled'} onClose={onClose}><div className="modal-summary"><strong>{request.requesterName}</strong><span className="compact-contact"><a href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a>{request.requesterEmail && <a href={`mailto:${request.requesterEmail}`}>{request.requesterEmail}</a>}</span><p>{request.proposalType === 'food' ? 'Food drop-off' : request.proposalType === 'stop_by' ? 'Stop by' : request.title}</p></div><p className="modal-intro">{request.isFlexible ? 'Anytime' : `${request.dayLabel}, ${eventTimeLabel(request.requestStartTime || request.time)} – ${eventTimeLabel(request.requestEndTime || request.endTime)}`}<br />{isPlan ? request.details || 'No additional details.' : request.helpNeeded}{request.requestNote && <><br /><strong>Note or question:</strong> {request.requestNote}</>}</p>{pending ? declining ? <form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onDecide('decline', reason.trim()) }}><label htmlFor="email-decline-reason">Reason</label><textarea id="email-decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: That time does not work for us, but please try another day." autoFocus required /><div className="form-actions"><button className="text-button" type="button" onClick={() => setDeclining(false)}>Back</button><button className="danger-button" type="submit" disabled={!reason.trim()}>Decline and email</button></div></form> : <><p>Approve this {isPlan ? 'plan' : 'person'} for the schedule? It will appear on the shared calendar and they will receive an email.</p><div className="form-actions"><button className="text-button" type="button" onClick={() => setDeclining(true)}>Decline</button><button className="primary-button" type="button" onClick={() => onDecide('approve')}><Check aria-hidden="true" /> Approve {isPlan ? 'plan' : 'request'}</button></div></> : <button className="primary-button full-button" type="button" onClick={onClose}>Close</button>}</ModalShell>
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="How to use Mary’s Team" onClose={onClose}><div className="help-list"><div><span>1</span><p><strong>Help Needed.</strong> Choose an open ride, visit, errand, or other specific need.</p></div><div><span>2</span><p><strong>Stop By.</strong> Choose a time when Mary is free. Busy times are blocked automatically.</p></div><div><span>3</span><p><strong>Bring Food.</strong> Choose one of the open food drop-off dates shown on the calendar.</p></div><div><span>4</span><p><strong>Wait for confirmation.</strong> Stop-by and food requests stay private until Mary or Stu approves them.</p></div></div><button className="primary-button full-button" type="button" onClick={onClose}>Got it</button></ModalShell>
}

export default App
