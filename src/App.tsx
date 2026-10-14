import { useEffect, useState } from 'react'
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, HeartHandshake,
  ListChecks, Pencil, Repeat2, Trash2, Users, Utensils, X,
} from 'lucide-react'
import './App.css'

type Category = 'appointment' | 'company' | 'home' | 'family'
type ForWho = 'Mary' | 'Stu' | 'Gabby' | 'Spencer' | 'Coco' | 'Family'
type PlanType = 'food' | 'stop_by'
type TeamEvent = { id: string; category: Category; forWho: ForWho; date: string; dayLabel: string; time: string; endTime: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string; helperPhone?: string; helperEmail?: string; repeatGroupId?: string; requestPending?: boolean; requesterName?: string; scheduleSource?: string; isScheduleException?: boolean; isFlexible?: boolean; proposalType?: PlanType; isCalculatedCoverage?: boolean; publicAction?: PlanType }
type DriverContact = { name: string; phone: string; email: string }
type Availability = { id: string; name: string; phone: string; day: string; time: string; note: string; editable?: boolean }
type ApprovalRequest = { status: string; requesterName: string; requesterPhone: string; requesterEmail: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type PendingRequest = { id: string; eventId: string; requesterName: string; requesterPhone: string; requesterEmail: string; notificationSentAt?: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type FoodSettings = { weekdays: number[]; startTime: string; endTime: string }
type FoodPreferenceType = 'restaurant' | 'homemade' | 'grocery'
type FoodPreference = { id: string; type: FoodPreferenceType; name: string; items: string[]; note: string }
type FoodPreferences = { overview: string; avoid: string; suggestions: FoodPreference[] }
type VisitSettings = { startTime: string; endTime: string }
type FamilyInTown = { Stu: boolean; Gabby: boolean; Spencer: boolean }
type FamilyInTownDates = { Stu: string[]; Gabby: string[]; Spencer: string[] }
type CareTeamMember = { id: string; name: string; phone: string; email: string; role: 'Nurse' | 'Helper'; weekdays: number[]; startTime: string; endTime: string; autoAssign: boolean }
type SupportContact = { id: string; name: string; phone: string; email: string; source?: 'contact_list' | 'request' }

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
const defaultFoodPreferences: FoodPreferences = {
  overview: 'Meals are for two people. We generally enjoy whole foods with a protein, vegetables, and a grain. Chicken is our first choice. Steak or beef is welcome when it fits the dish.',
  avoid: 'No pork.',
  suggestions: [{ id: 'mendocino-farms', type: 'restaurant', name: 'Mendocino Farms', items: [''], note: '' }],
}

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

function eventDisplayTitle(event: TeamEvent) {
  return event.helpNeeded === 'Spend time with Mary' && needsTimeWithMary(event.forWho) ? 'Spend time with Mary' : event.title
}

function eventDisplayDetails(event: TeamEvent) {
  if (event.helpNeeded === 'Spend time with Mary' && needsTimeWithMary(event.forWho)) {
    return event.details || `${event.forWho} is working.`
  }
  return event.details
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

function confirmedContacts(events: TeamEvent[]) {
  return events.filter((event) => event.helper).map((event) => ({ name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' })).filter((contact, index, contacts) => contacts.findIndex((item) => item.name.trim().toLocaleLowerCase() === contact.name.trim().toLocaleLowerCase()) === index).sort((a, b) => a.name.localeCompare(b.name))
}

function knownContacts(events: TeamEvent[], availability: Availability[], extraContacts: DriverContact[] = []) {
  const contacts = [...confirmedContacts(events)]
  for (const entry of [...availability.map(({ name, phone }) => ({ name, phone, email: '' })), ...extraContacts]) {
    const existing = contacts.find((contact) => phoneKey(contact.phone) && phoneKey(contact.phone) === phoneKey(entry.phone))
      || contacts.find((contact) => contact.name.trim().toLocaleLowerCase() === entry.name.trim().toLocaleLowerCase())
    if (existing) {
      if (!existing.phone) existing.phone = entry.phone
      if (!existing.email) existing.email = entry.email
    } else {
      contacts.push({ name: entry.name, phone: entry.phone, email: entry.email })
    }
  }
  return contacts.sort((a, b) => a.name.localeCompare(b.name))
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

function buildHelpNeededEvents(events: TeamEvent[], familyInTown: FamilyInTown, familyInTownDates: FamilyInTownDates) {
  const caregiverNames = Object.keys(familyInTown) as (keyof FamilyInTown)[]
  const caregiverBusy = events.filter((event) => caregiverNames.includes(event.forWho as keyof FamilyInTown) && event.helpNeeded === 'Spend time with Mary' && !event.proposalType && !event.isFlexible)
  const directNeeds = events.filter((event) => event.scheduleSource !== 'family_coverage' && (!caregiverNames.includes(event.forWho as keyof FamilyInTown) || event.helpNeeded !== 'Spend time with Mary') && !isNoSupport(event.helpNeeded))
  const dateKeys = [...new Set(caregiverBusy.map((event) => event.date.slice(0, 8)))]
  const uncovered: TeamEvent[] = []

  for (const dateKey of dateKeys) {
    const present = caregiverNames.filter((person) => familyInTown[person] || familyInTownDates[person].includes(dateKey))
    if (!present.length) continue
    const dayBusy = caregiverBusy.filter((event) => event.date.startsWith(dateKey) && present.includes(event.forWho as keyof FamilyInTown))
    const boundaries = [...new Set(dayBusy.flatMap((event) => [event.time, event.endTime]))].sort()
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const time = boundaries[index]
      const endTime = boundaries[index + 1]
      const coveringEvents = dayBusy.filter((event) => event.time <= time && event.endTime >= endTime)
      if (!present.every((person) => coveringEvents.some((event) => event.forWho === person))) continue
      const representative = coveringEvents.find((event) => event.helper)
        || coveringEvents.find((event) => event.requestPending)
        || coveringEvents.find((event) => event.time === time && event.endTime === endTime)
        || coveringEvents.find((event) => event.time === time)
        || coveringEvents.find((event) => event.endTime === endTime)
        || coveringEvents[coveringEvents.length - 1]
      const names = present.filter((person) => coveringEvents.some((event) => event.forWho === person))
      uncovered.push({
        ...representative,
        date: `${dateKey}T${time.replace(':', '')}00`,
        time,
        endTime,
        title: 'Spend time with Mary',
        details: `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} working.`,
        forWho: names.length === 1 ? names[0] : 'Family',
        isCalculatedCoverage: true,
      })
    }
  }

  return [...directNeeds, ...uncovered]
}

function buildPublicScheduleEvents(events: TeamEvent[], helpNeededEvents: TeamEvent[]) {
  const marySupport = helpNeededEvents
    .filter((event) => event.forWho === 'Mary' || event.isCalculatedCoverage || event.helpNeeded === 'Spend time with Mary')
    .map((event) => event.helpNeeded === 'Spend time with Mary' && event.forWho !== 'Mary'
      ? { ...event, title: 'Spend time with Mary', forWho: 'Mary' as const }
      : event)
  return [
    ...marySupport,
    ...events.filter((event) => event.proposalType === 'food' && (event.helper || event.requestPending)),
    ...events.filter((event) => event.forWho === 'Mary' && !event.proposalType && isNoSupport(event.helpNeeded) && !event.isFlexible),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.endTime.localeCompare(b.endTime))
}

function applyCareTeamAssignments(events: TeamEvent[], careTeam: CareTeamMember[]) {
  return events.map((event) => {
    if (event.helper || event.requestPending || event.isFlexible || isNoSupport(event.helpNeeded) || event.helpNeeded.toLocaleLowerCase().includes('ride')) return event
    const dateKey = event.date.slice(0, 8)
    const weekday = new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T12:00:00`).getDay()
    const member = careTeam.find((person) => person.autoAssign && person.weekdays.includes(weekday) && event.time >= person.startTime && event.endTime <= person.endTime)
    return member ? { ...event, helper: member.name, helperPhone: member.phone, helperEmail: member.email } : event
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
  const [view, setView] = useState<'help' | 'upcoming' | 'month'>('help')
  const [availabilityView, setAvailabilityView] = useState<'upcoming' | 'month'>('upcoming')
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signupEvent, setSignupEvent] = useState<TeamEvent | null>(null)
  const [viewingEvent, setViewingEvent] = useState<TeamEvent | null>(null)
  const [assigningEvent, setAssigningEvent] = useState<TeamEvent | null>(null)
  const [editingEvent, setEditingEvent] = useState<TeamEvent | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showPlanRequest, setShowPlanRequest] = useState<PlanType | null>(null)
  const [planRequestWindow, setPlanRequestWindow] = useState<TeamEvent | null>(null)
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
  const [foodPreferences, setFoodPreferences] = useState<FoodPreferences>(defaultFoodPreferences)
  const [visitSettings, setVisitSettings] = useState<VisitSettings>({ startTime: '10:00', endTime: '17:00' })
  const [familyInTown, setFamilyInTown] = useState<FamilyInTown>({ Stu: true, Gabby: true, Spencer: false })
  const [familyInTownDates, setFamilyInTownDates] = useState<FamilyInTownDates>({ Stu: [], Gabby: [], Spencer: [] })
  const [foodReservedDates, setFoodReservedDates] = useState<string[]>([])
  const [careTeam, setCareTeam] = useState<CareTeamMember[]>([])
  const [supportContacts, setSupportContacts] = useState<SupportContact[]>([])
  const [showSupportContact, setShowSupportContact] = useState(false)
  const [showGoFundMe, setShowGoFundMe] = useState(false)
  const scheduleDates = new Set(getThirtyDays().map((day) => day.dateKey))
  const calculatedHelpNeeded = applyCareTeamAssignments(buildHelpNeededEvents(teamEvents, familyInTown, familyInTownDates), careTeam)
  const supportFeedEvents = calculatedHelpNeeded
  const helpFeedEvents = supportFeedEvents.filter((event) => !event.helper && !event.requestPending)
  const publicScheduleEvents = buildPublicScheduleEvents(teamEvents, supportFeedEvents)
  const visibleEvents = (view === 'help' ? helpFeedEvents : teamEvents)
    .filter((event) => event.scheduleSource !== 'family_coverage' && (event.isFlexible || scheduleDates.has(event.date.slice(0, 8))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.endTime.localeCompare(b.endTime))
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
      setFoodPreferences(data.foodPreferences || defaultFoodPreferences)
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setFoodReservedDates(Array.isArray(data.foodReservedDates) ? data.foodReservedDates : [])
      setCareTeam(Array.isArray(data.careTeam) ? data.careTeam : [])
      setSupportContacts(Array.isArray(data.supportContacts) ? data.supportContacts : [])
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
      setFoodPreferences(data.foodPreferences || defaultFoodPreferences)
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setCareTeam(Array.isArray(data.careTeam) ? data.careTeam : [])
      setSupportContacts(Array.isArray(data.supportContacts) ? data.supportContacts : [])
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

  async function saveFoodPreferences(preferences: FoodPreferences) {
    try {
      const result = await apiRequest({ action: 'saveFoodPreferences', ...preferences })
      setFoodPreferences(result.foodPreferences)
      setMessage('Food preferences were updated.')
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not update food preferences.')
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
      setPlanRequestWindow(null)
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
  async function assignCalculatedCoverage(event: TeamEvent, contact: DriverContact) {
    try {
      await apiRequest({ action: 'assignCoverage', eventId: event.id, helper: contact.name, helperPhone: contact.phone, helperEmail: contact.email })
      setAssigningEvent(null)
      await refreshData()
      setMessage(`${contact.name} was added to this time.`)
      window.setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not add this person. Please try again.')
    }
  }
  async function saveCareTeamMember(member: CareTeamMember) {
    try {
      const result = await apiRequest({ action: 'saveCareTeamMember', member })
      setCareTeam((items) => [...items.filter((item) => item.id !== result.member.id), result.member].sort((a, b) => a.name.localeCompare(b.name)))
      setMessage(`${result.member.name} was saved to People.`)
      window.setTimeout(() => setMessage(''), 5000)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not save this person.')
      return false
    }
  }
  async function saveSupportContact(contact: Omit<SupportContact, 'id'>) {
    try {
      const result = await apiRequest({ action: 'addSupportContact', ...contact })
      setSupportContacts((items) => [result.contact, ...items.filter((item) => item.id !== result.contact.id)])
      setShowSupportContact(false)
      setShowGoFundMe(true)
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'We could not add your contact information.')
      return false
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
    window.setTimeout(() => document.getElementById('schedule-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  function openPlanRequest(type: PlanType, window: TeamEvent | null = null) {
    setPlanRequestWindow(window)
    setShowPlanRequest(type)
  }
  function openEditAndApprove() {
    if (!organizer) {
      setShowOrganizerLogin(true)
      return
    }
    document.getElementById('organizer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function openScheduleEvent(event: TeamEvent) {
    if (event.publicAction) {
      openPlanRequest(event.publicAction, event)
    } else if (organizer && !event.isCalculatedCoverage) {
      setEditingEvent(event)
    } else {
      setViewingEvent(event)
    }
  }
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Mary’s Team home"><span className="brand-mark"><HeartHandshake aria-hidden="true" /></span><span>Mary’s Team</span></a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /><span>Help Needed</span></button>
          <button type="button" onClick={() => openPlanRequest('food')}><Utensils aria-hidden="true" /><span>Bring Food</span></button>
        </nav>
        <div className="header-tools"><button className="family-access-button" type="button" onClick={openEditAndApprove}><Pencil aria-hidden="true" /><span>Edit &amp; Approve</span>{organizer && pendingRequests.length > 0 && <strong aria-label={`${pendingRequests.length} requests waiting`}>{pendingRequests.length}</strong>}</button><button className="help-button" type="button" onClick={() => setShowHelp(true)}><CircleHelp aria-hidden="true" /> <span>How to use this page</span></button></div>
      </header>
      <main id="top">
        <section className="welcome" aria-labelledby="page-title">
          <div><p className="eyebrow">Family schedule and support</p><h1 id="page-title">The Greenbergs’ Schedule</h1><p className="intro">See what’s coming up and sign up where support is needed.</p></div>
          <div className="quick-actions" role="group" aria-label="Page actions">
            <button className="support-button" type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /> Help Needed</button>
            <button className="secondary-button" type="button" onClick={() => openPlanRequest('food')}><Utensils aria-hidden="true" /> Bring Food</button>
          </div>
        </section>
        <div className="helper-note"><HeartHandshake aria-hidden="true" /><p><strong>New here?</strong> Choose Help Needed or Bring Food. The page will show exactly what is open.</p><button type="button" onClick={() => setShowHelp(true)}>See how it works</button></div>
        {organizer && <OrganizerPanel requests={pendingRequests} events={teamEvents} displayEvents={publicScheduleEvents} careTeam={careTeam} supportContacts={supportContacts} foodSettings={foodSettings} foodPreferences={foodPreferences} visitSettings={visitSettings} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveCareTeam={saveCareTeamMember} onSaveFoodSettings={saveFoodSettings} onSaveFoodPreferences={saveFoodPreferences} onSaveVisitSettings={saveVisitSettings} onSaveFamilyInTown={saveFamilyInTown} onEditInTownDates={setInTownDatesPerson} onEditBusyDates={setBusyPerson} onAddSchedule={(forWho) => { setAddForWho(forWho); setShowAdd(true) }} onEditEvent={setEditingEvent} onDecide={decideRequest} onLogout={organizerLogout} />}
        {cloudError && <div className="cloud-message error" role="alert"><p><strong>We could not reach the shared schedule.</strong> {cloudError}</p><button type="button" onClick={() => void refreshData(true)}>Try again</button></div>}
        {!cloudError && loading && <div className="cloud-message" role="status"><p><strong>Opening the shared schedule...</strong></p></div>}
        <section className="schedule" aria-labelledby="schedule-title">
          <div className="section-heading">
            <div><p className="eyebrow">Plan together</p><h2 id="schedule-title">Schedule</h2></div>
            <div className="view-toggle" role="group" aria-label="Choose schedule view"><button aria-pressed={view === 'help'} className={view === 'help' ? 'active' : ''} type="button" onClick={() => setView('help')}><ListChecks aria-hidden="true" /> Help Needed</button><button aria-pressed={view === 'upcoming'} className={view === 'upcoming' ? 'active' : ''} type="button" onClick={() => setView('upcoming')}><CalendarDays aria-hidden="true" /> Upcoming</button><button aria-pressed={view === 'month'} className={view === 'month' ? 'active' : ''} type="button" onClick={() => setView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div>
          </div>
          <p className="schedule-view-note">{view === 'help' ? 'Only times that are still open and need support.' : view === 'upcoming' ? 'Mary’s appointments, food drop-offs, and coverage for the next 10 days.' : 'Mary’s full month at a glance. Tap any date to see appointments, food drop-offs, and coverage.'}</p>
          {!loading && (view === 'help' ? <div className="event-list">
            {visibleEvents.length ? visibleEvents.map((event) => {
              const helper = helpers[event.id] || event.helper
              const suggestedHelpers = matchingAvailability(event, availability)
              return <article className={`event-card viewable ${event.category} ${helper || event.requestPending ? 'has-response' : ''}`} id={`event-${event.id}`} key={event.id} onClick={() => setViewingEvent(event)}>
                <div className="event-date"><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {eventTimeRangeLabel(event)}</strong>{(event.repeatGroupId || event.scheduleSource === 'stu_work') && <small className="repeat-label"><Repeat2 aria-hidden="true" /> {event.scheduleSource === 'stu_work' ? event.isScheduleException ? 'Different from weekly hours' : 'Weekly work hours' : 'Repeats weekly'}</small>}</div>
                <div className="event-info"><h3>{eventDisplayTitle(event)}</h3><p>{eventDisplayDetails(event)}</p>{shouldShowEventLocation(event) && <p className="location">{event.location}</p>}<span className="card-details-hint">Tap to see details</span>{event.proposalType ? <div className="needed planned-needed">{event.proposalType === 'food' ? <Utensils aria-hidden="true" /> : <Users aria-hidden="true" />}<span><small>Planned</small><strong>{event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by'}</strong></span></div> : <div className={`needed ${isNoSupport(event.helpNeeded) ? 'busy-needed' : ''}`}><ListChecks aria-hidden="true" /><span><small>{isNoSupport(event.helpNeeded) ? 'Busy time' : 'Support requested'}</small><strong>{isNoSupport(event.helpNeeded) ? 'Please do not stop by during this time.' : event.helpNeeded}</strong></span></div>}{!helper && !event.requestPending && suggestedHelpers.length > 0 && !isNoSupport(event.helpNeeded) && <div className="suggested-help"><HeartHandshake aria-hidden="true" /><span><small>{event.isFlexible ? 'People who may be available' : 'People available then'}</small><strong>{suggestedHelpers.map((entry) => entry.name).join(', ')}</strong><em>{event.isFlexible ? 'They may be able to fit this task into their availability.' : 'They can choose this time if it works for them.'}</em></span></div>}</div>
                <div className="event-actions">
                  {event.proposalType && helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.proposalType && event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Request submitted</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Waiting for confirmation'}</strong></span></div> : isNoSupport(event.helpNeeded) ? <div className="busy-status"><Clock3 aria-hidden="true" /><span><small>Status</small><strong>Busy</strong></span></div> : helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Request submitted</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Waiting for confirmation'}</strong></span></div> : <button className="primary-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setSignupEvent(event) }}><HeartHandshake aria-hidden="true" /> Sign me up!</button>}
                  <button className="edit-event-link" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setViewingEvent(event) }}><Pencil aria-hidden="true" /> {organizer ? 'View or edit details' : 'View details'}</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => organizer ? (setAddForWho('Mary'), setShowAdd(true)) : setShowOrganizerLogin(true)} onJoin={() => setShowSupportContact(true)} onAlreadySignedUp={() => setView('month')} supportOnly />}
          </div> : view === 'upcoming' ? <div className="upcoming-calendar-wrap"><UpcomingDaysList events={publicScheduleEvents} daysToShow={10} onOpen={openScheduleEvent} /></div> : <MonthCalendar events={publicScheduleEvents} onOpen={openScheduleEvent} />)}
        </section>
        {organizer && <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">Availability</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add availability</button></div>
          <div className="availability-view-heading"><div className="view-toggle" role="group" aria-label="Choose availability view"><button aria-pressed={availabilityView === 'upcoming'} className={availabilityView === 'upcoming' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('upcoming')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={availabilityView === 'month'} className={availabilityView === 'month' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div><p>{availabilityView === 'upcoming' ? 'The next 7 days' : 'The next 30 days'}</p></div>
          {!loading && <div className="availability-list">{visibleAvailability.length ? visibleAvailability.map((entry) => <article className={entry.editable ? 'editable' : ''} key={entry.id} onClick={() => entry.editable && setEditingAvailability(entry)}><div className="availability-date"><span>{availabilityDayLabel(entry.day).split(',')[0]}</span><strong>{availabilityDayLabel(entry.day).split(',').slice(1).join(',').trim()}</strong></div><div className="person-icon"><Users aria-hidden="true" /></div><div className="availability-person"><h3>{entry.name}</h3><p className={`availability-time ${entry.time === 'anytime' ? 'all-day' : ''}`}>{availabilityTimeLabel(entry.time)}</p><p className="availability-help">{entry.note}</p>{entry.phone && <a className="availability-phone" href={`tel:${entry.phone}`} onClick={(clickEvent) => clickEvent.stopPropagation()}><span>Call or text</span> {entry.phone}</a>}</div>{entry.editable && <button className="tap-edit" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setEditingAvailability(entry) }} aria-label={`Edit ${entry.name}’s availability for ${availabilityDayLabel(entry.day)}`}><Pencil aria-hidden="true" /> Edit</button>}</article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability in {availabilityView === 'upcoming' ? 'the next 7 days' : 'the next 30 days'}</h3><p>Share times when the family may call if something comes up. This does not sign anyone up automatically.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add availability</button></div>}</div>}
        </section>}
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Questions? Call or text Gabby.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {viewingEvent && <EventDetailsModal event={viewingEvent} organizer={organizer} availability={matchingAvailability(viewingEvent, availability)} onClose={() => setViewingEvent(null)} onEdit={() => { setViewingEvent(null); setEditingEvent(viewingEvent) }} onAssign={() => { setViewingEvent(null); setAssigningEvent(viewingEvent) }} />}
      {assigningEvent && <AssignCoverageModal event={assigningEvent} contacts={knownContacts(teamEvents, availability, [...careTeam.map((member) => ({ name: member.name, phone: member.phone, email: member.email })), ...supportContacts.map((contact) => ({ name: contact.name, phone: contact.phone, email: contact.email }))])} onClose={() => setAssigningEvent(null)} onAssign={(contact) => assignCalculatedCoverage(assigningEvent, contact)} />}
      {editingEvent && <EditEventModal event={editingEvent} availability={availability} events={teamEvents} onClose={() => setEditingEvent(null)} onSave={updateEvent} onRemove={removeEvent} />}
      {showAvailability && <AvailabilityModal onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
      {showPlanRequest && <PlanRequestModal type={showPlanRequest} initialWindow={planRequestWindow} events={teamEvents} foodSettings={foodSettings} foodPreferences={foodPreferences} visitSettings={visitSettings} foodReservedDates={foodReservedDates} onClose={() => { setShowPlanRequest(null); setPlanRequestWindow(null) }} onSave={saveProposedPlan} />}
      {editingAvailability && <EditAvailabilityModal entries={availability.filter((entry) => (phoneKey(editingAvailability.phone) ? phoneKey(entry.phone) === phoneKey(editingAvailability.phone) : entry.name.trim().toLocaleLowerCase() === editingAvailability.name.trim().toLocaleLowerCase()) && allAvailabilityDates.has(entry.day))} initialEntry={editingAvailability} onClose={() => setEditingAvailability(null)} onSave={updateAvailabilities} onRemove={removeAvailabilities} />}
      {showAdd && <AddEventModal initialForWho={addForWho} availability={availability} events={teamEvents} onClose={() => setShowAdd(false)} onSave={saveEvents} />}
      {busyPerson && <FamilyBusyDatesModal person={busyPerson} events={teamEvents} onClose={() => setBusyPerson(null)} onSave={(dates, startTime, endTime) => saveFamilyBusyDates(busyPerson, dates, startTime, endTime)} />}
      {inTownDatesPerson && <FamilyInTownDatesModal person={inTownDatesPerson} selectedDates={familyInTownDates[inTownDatesPerson]} onClose={() => setInTownDatesPerson(null)} onSave={(dates) => saveFamilyInTownDates(inTownDatesPerson, dates)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showSupportContact && <SupportContactModal onClose={() => setShowSupportContact(false)} onSave={saveSupportContact} />}
      {showGoFundMe && <GoFundMeModal onClose={() => setShowGoFundMe(false)} />}
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

function EmptySchedule({ onAdd, onJoin, onAlreadySignedUp, supportOnly = false }: { onAdd: () => void; onJoin?: () => void; onAlreadySignedUp?: () => void; supportOnly?: boolean }) {
  return <div className="empty-state"><CalendarDays aria-hidden="true" /><h3>{supportOnly ? 'No help is needed right now' : 'Nothing has been added yet'}</h3><p>{supportOnly ? 'Everything is covered. Add your contact information so the family knows you are open to helping if something comes up. We greatly appreciate it.' : 'Mary or Stu can add the first appointment or task.'}</p>{supportOnly && <div className="empty-state-actions">{onJoin && <button className="primary-button" type="button" onClick={onJoin}>Let us know you are open to helping</button>}{onAlreadySignedUp && <button className="secondary-button" type="button" onClick={onAlreadySignedUp}>Already signed up</button>}</div>}{!supportOnly && <button className="primary-button" type="button" onClick={onAdd}>+ Add the first item</button>}</div>
}

function UpcomingDaysList({ events, daysToShow, onOpen }: { events: TeamEvent[]; daysToShow: number; onOpen: (event: TeamEvent) => void }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: daysToShow }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const dateKey = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    const dayEvents = events.filter((event) => !event.isFlexible && event.date.startsWith(dateKey)).sort((a, b) => a.time.localeCompare(b.time))
    return {
      date,
      dateKey,
      events: dayEvents,
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
        {day.events.length ? day.events.map((event) => <button type="button" key={event.id} onClick={() => onOpen(event)}>
          <span className={`calendar-dot ${event.category}`} aria-hidden="true" />
          <span>
            <strong>{eventDisplayTitle(event)}</strong>
            {eventDisplayTitle(event) !== event.title && <small>{eventDisplayDetails(event)}</small>}
            <small>{eventTimeRangeLabel(event)}</small>
            <em>{event.publicAction === 'stop_by' ? 'Choose a time to stop by' : event.proposalType ? event.proposalType === 'food' ? event.helper ? `Food from ${event.helper}` : event.requesterName ? `Food requested by ${event.requesterName}` : 'Food drop-off requested' : event.helper ? `Stopping by: ${event.helper}` : event.requesterName ? `Stop by requested by ${event.requesterName}` : 'Stop-by request submitted' : isNoSupport(event.helpNeeded) ? 'Busy' : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted' : event.helpNeeded}</em>
          </span>
        </button>) : <p>Not available.</p>}
      </div>
    </section>)}
  </div>
}

function MonthCalendar({ events, onOpen }: { events: TeamEvent[]; onOpen: (event: TeamEvent) => void }) {
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
        const openHelp = day.events.some((event) => !event.proposalType && !isNoSupport(event.helpNeeded) && !event.helper && !event.requestPending)
        const busyCount = day.events.filter((event) => !event.proposalType && !event.publicAction && isNoSupport(event.helpNeeded)).length
        const foodCovered = day.events.some((event) => event.proposalType === 'food' && Boolean(event.helper))
        return <button className={`month-cell ${day.inMonth ? '' : 'outside-month'} ${day.isToday ? 'today' : ''} ${day.events.length ? 'has-events' : ''}`} type="button" key={day.dateKey} onClick={() => day.events.length && setSelectedDateKey(day.dateKey)} disabled={!day.events.length} aria-label={`${label}${day.events.length ? `, ${day.events.length} schedule ${day.events.length === 1 ? 'item' : 'items'}` : ', not available'}`}>
          <span className="month-number">{day.date.getDate()}</span>
          <span className="month-statuses">{openHelp && <span className="month-status help">Help Needed</span>}{busyCount > 0 && <span className="month-status appointment">{busyCount} {busyCount === 1 ? 'Appointment' : 'Appointments'}</span>}{foodCovered && <span className="month-status food">Food Covered</span>}{!day.events.length && <span className="month-status appointment">Not available</span>}</span>
        </button>
      })}</div>
    </div>
    {selectedDay && <ModalShell title={selectedDay.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} onClose={() => setSelectedDateKey('')}>
      <div className="day-event-list">{selectedDay.events.map((event) => <button type="button" key={event.id} onClick={() => { setSelectedDateKey(''); onOpen(event) }}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{eventDisplayTitle(event)}</strong><small>{eventTimeRangeLabel(event)}</small><em>{event.publicAction === 'stop_by' ? 'Choose a time to stop by' : isNoSupport(event.helpNeeded) ? 'Busy' : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted' : event.helpNeeded}</em></span><ChevronRight aria-hidden="true" /></button>)}</div>
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

function SupportContactModal({ onClose, onSave }: { onClose: () => void; onSave: (contact: Omit<SupportContact, 'id'>) => Promise<boolean> }) {
  const [saved] = useState(savedHelperContact)
  const [name, setName] = useState(saved.name)
  const [phone, setPhone] = useState(saved.phone)
  const [email, setEmail] = useState(saved.email)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !name.trim() || !phone.trim() || !email.trim()) return
    setSaving(true)
    const contact = { name: name.trim(), phone: phone.trim(), email: email.trim() }
    const didSave = await onSave(contact)
    if (didSave) window.localStorage.setItem('marys-team-helper-contact', JSON.stringify(contact))
    if (!didSave) setSaving(false)
  }

  return <ModalShell title="Stay on our contact list" onClose={onClose}>
    <p className="modal-intro">Everything is covered right now. Share your information so the family knows they can call you if something comes up.</p>
    <form onSubmit={submit}>
      <label htmlFor="support-contact-name">Your name</label>
      <input id="support-contact-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus required />
      <label htmlFor="support-contact-phone">Your phone number</label>
      <input id="support-contact-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required />
      <label htmlFor="support-contact-email">Your email address</label>
      <input id="support-contact-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
      <p className="form-note">This information is only visible to the family in Edit &amp; Approve.</p>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Adding you…' : 'Add me to the contact list'}</button></div>
    </form>
  </ModalShell>
}

function GoFundMeModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="Thank you for being part of Mary’s Team" onClose={onClose}>
    <p className="modal-intro">Your contact information was added. If you would like another way to support Mary and the family, you can visit Mary’s GoFundMe.</p>
    <a className="primary-button full-button" href="https://www.gofundme.com/f/support-mary-greenberg?utm_source=ig&amp;utm_medium=social&amp;utm_content=link_in_bio&amp;utm_id=97760_v0_s00_e0_tv3" target="_blank" rel="noreferrer">Visit Mary’s GoFundMe</a>
    <button className="text-button full-button" type="button" onClick={onClose}>Not now</button>
  </ModalShell>
}

function EventDetailsModal({ event, organizer, availability, onClose, onEdit, onAssign }: { event: TeamEvent; organizer: boolean; availability: Availability[]; onClose: () => void; onEdit: () => void; onAssign: () => void }) {
  return <ModalShell title={eventDisplayTitle(event)} onClose={onClose}>
    <div className="event-detail-summary">
      <div><small>When</small><strong>{event.dayLabel}<br />{eventTimeRangeLabel(event)}</strong></div>
      <div><small>{event.proposalType ? 'Plan' : isNoSupport(event.helpNeeded) ? 'Status' : 'Support requested'}</small><strong>{event.proposalType ? event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by' : isNoSupport(event.helpNeeded) ? 'Busy – please do not stop by' : event.helpNeeded}</strong></div>
      {shouldShowEventLocation(event) && <div><small>Where</small><strong>{event.location}</strong></div>}
      <div><small>Details</small><p>{eventDisplayDetails(event)}</p></div>
      {event.helper && <div><small>Confirmed</small><strong>{event.helper}</strong>{(event.helperEmail || event.helperPhone) && <span className="compact-contact">{event.helperEmail && <a href={`mailto:${event.helperEmail}`}>{event.helperEmail}</a>}{event.helperPhone && <a href={`tel:${event.helperPhone}`}>{event.helperPhone}</a>}</span>}</div>}
      {!event.helper && event.requestPending && <div><small>Status</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted'}</strong></div>}
      {organizer && !event.helper && availability.length > 0 && <div><small>People who may be available</small><div className="compact-contact-list">{availability.slice(0, 8).map((entry) => <span key={entry.id}><strong>{entry.name}</strong><small>{event.isFlexible ? `${availabilityDayLabel(entry.day)}, ${availabilityTimeLabel(entry.time)}` : availabilityTimeLabel(entry.time)}</small><a href={`sms:${entry.phone}`}>Text {entry.phone}</a></span>)}</div></div>}
    </div>
    {event.isCalculatedCoverage && organizer && <p className="form-note">This time is calculated from the family schedules. Edit the individual family members’ work or away entries to change it.</p>}
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Close</button>{organizer && event.isCalculatedCoverage && !event.helper && <button className="primary-button" type="button" onClick={onAssign}><Users aria-hidden="true" /> Assign someone</button>}{organizer && !event.isCalculatedCoverage && <button className="primary-button" type="button" onClick={onEdit}><Pencil aria-hidden="true" /> Edit</button>}</div>
  </ModalShell>
}

function AssignCoverageModal({ event, contacts, onClose, onAssign }: { event: TeamEvent; contacts: DriverContact[]; onClose: () => void; onAssign: (contact: DriverContact) => void }) {
  const [selected, setSelected] = useState('')
  const [newContact, setNewContact] = useState<DriverContact>({ name: '', phone: '', email: '' })
  const contact = selected === 'new' ? newContact : contacts.find((item) => item.name === selected)
  return <ModalShell title="Assign someone" onClose={onClose}><p className="modal-intro">Choose a saved person or add someone new for {event.dayLabel}, {eventTimeRangeLabel(event)}.</p><form onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (contact?.name.trim()) onAssign({ ...contact, name: contact.name.trim(), phone: contact.phone.trim(), email: contact.email.trim() }) }}><label htmlFor="coverage-helper">Who will be with Mary?</label><select id="coverage-helper" value={selected} onChange={(changeEvent) => setSelected(changeEvent.target.value)} required autoFocus><option value="">Choose a person</option>{contacts.map((item) => <option key={`${item.name}-${item.phone}`} value={item.name}>{item.name}</option>)}<option value="new">Someone new</option></select>{selected === 'new' && <><label htmlFor="new-helper-name">Name</label><input id="new-helper-name" value={newContact.name} onChange={(changeEvent) => setNewContact({ ...newContact, name: changeEvent.target.value })} required autoFocus /><div className="field-row"><div><label htmlFor="new-helper-phone">Phone <span>(optional)</span></label><input id="new-helper-phone" type="tel" value={newContact.phone} onChange={(changeEvent) => setNewContact({ ...newContact, phone: changeEvent.target.value })} autoComplete="tel" /></div><div><label htmlFor="new-helper-email">Email <span>(optional)</span></label><input id="new-helper-email" type="email" value={newContact.email} onChange={(changeEvent) => setNewContact({ ...newContact, email: changeEvent.target.value })} autoComplete="email" /></div></div></>}<div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!contact?.name.trim()}><Check aria-hidden="true" /> Add to this time</button></div></form></ModalShell>
}
function OrganizerPanel({ requests, events, displayEvents, careTeam, supportContacts, foodSettings, foodPreferences, visitSettings, familyInTown, familyInTownDates, onSaveCareTeam, onSaveFoodSettings, onSaveFoodPreferences, onSaveVisitSettings, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAddSchedule, onEditEvent, onDecide, onLogout }: { requests: PendingRequest[]; events: TeamEvent[]; displayEvents: TeamEvent[]; careTeam: CareTeamMember[]; supportContacts: SupportContact[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; visitSettings: VisitSettings; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveCareTeam: (member: CareTeamMember) => Promise<boolean>; onSaveFoodSettings: (settings: FoodSettings) => Promise<boolean>; onSaveFoodPreferences: (preferences: FoodPreferences) => Promise<boolean>; onSaveVisitSettings: (settings: VisitSettings) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAddSchedule: (forWho: ForWho) => void; onEditEvent: (event: TeamEvent) => void; onDecide: (id: string, decision: 'approve' | 'decline', declineReason?: string) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<'requests' | 'people' | 'work'>('requests')
  const [declining, setDeclining] = useState<PendingRequest | null>(null)
  const [editingMember, setEditingMember] = useState<CareTeamMember | null>(null)
  const people = knownContacts(displayEvents, [...careTeam.map((member) => ({ id: member.id, name: member.name, phone: member.phone, day: '', time: '', note: member.role })), ...supportContacts.map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone, day: '', time: '', note: 'Open to helping' }))]).map((contact) => {
    const member = careTeam.find((item) => item.name.trim().toLocaleLowerCase() === contact.name.trim().toLocaleLowerCase())
    const volunteer = supportContacts.find((item) => item.name.trim().toLocaleLowerCase() === contact.name.trim().toLocaleLowerCase())
    const contactLabel = volunteer?.source === 'contact_list' ? 'Open to helping' : volunteer ? 'Saved contact' : ''
    return { ...contact, email: contact.email || volunteer?.email || '', name: member ? `${contact.name} · ${member.role}` : contactLabel ? `${contact.name} · ${contactLabel}` : contact.name, member, events: displayEvents.filter((event) => event.helper?.trim().toLocaleLowerCase() === contact.name.trim().toLocaleLowerCase()).sort((a, b) => a.date.localeCompare(b.date)) }
  })
  return <section className="organizer-panel" id="organizer-panel" aria-labelledby="organizer-title">
    <div className="organizer-heading"><div><p className="eyebrow">Private family area</p><h2 id="organizer-title">Edit &amp; Approve</h2></div><button className="text-button" type="button" onClick={onLogout}>Close private access</button></div>
    <div className="organizer-tabs" role="tablist" aria-label="Choose private family area">
      <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} type="button" onClick={() => setTab('requests')}><Check aria-hidden="true" /> Requests{requests.length ? ` (${requests.length})` : ''}</button>
      <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'active' : ''} type="button" onClick={() => setTab('people')}><Users aria-hidden="true" /> People</button>
      <button role="tab" aria-selected={tab === 'work'} className={tab === 'work' ? 'active' : ''} type="button" onClick={() => setTab('work')}><Clock3 aria-hidden="true" /> Family Schedule</button>
    </div>
    {tab === 'people' && <div className="family-schedule-actions"><button className="primary-button" type="button" onClick={() => setEditingMember({ id: crypto.randomUUID(), name: '', phone: '', email: '', role: 'Helper', weekdays: [1], startTime: '09:00', endTime: '17:00', autoAssign: false })}><Users aria-hidden="true" /> Add nurse or helper</button></div>}
    {tab === 'people' && careTeam.length > 0 && <div className="people-summary"><p className="organizer-intro"><strong>Nurses and helpers</strong><br />Their role and regular hours control automatic coverage.</p>{careTeam.map((member) => <section key={member.id}><div className="people-summary-heading"><div><strong>{member.name}</strong><span className="compact-contact"><span>{member.role}</span><span>{member.weekdays.map((day) => weekdayChoices.find((choice) => choice.value === day)?.short).join(', ')} · {eventTimeLabel(member.startTime)} – {eventTimeLabel(member.endTime)}</span>{member.autoAssign && <span>Automatic assignment on</span>}</span></div><button className="secondary-button" type="button" onClick={() => setEditingMember(member)}><Pencil aria-hidden="true" /> Edit role &amp; hours</button></div></section>)}</div>}
    {tab === 'requests' ? requests.length ? <><p className="organizer-intro">Review support sign-ups, food drop-offs, and stop-by requests below. Contact information stays inside this private family area.</p><div className="organizer-requests">{requests.map((request) => <article key={request.id}><div><strong>{request.requesterName}</strong><span className="compact-contact"><a href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a>{request.requesterEmail && <a href={`mailto:${request.requesterEmail}`}>{request.requesterEmail}</a>}</span><p>{request.proposalType === 'food' ? 'Food drop-off' : request.proposalType === 'stop_by' ? 'Stop by' : request.title}</p><small>{request.isFlexible ? 'Anytime' : `${request.dayLabel}, ${eventTimeLabel(request.requestStartTime || request.time)} – ${eventTimeLabel(request.requestEndTime || request.endTime)}`}{request.proposalType ? request.details ? ` · ${request.details}` : ` · ${request.requestNote || ''}` : ` · ${request.helpNeeded}${request.requestNote ? ` · “${request.requestNote}”` : ''}`}</small></div><div><button className="text-button" type="button" onClick={() => setDeclining(request)}>Decline</button><button className="primary-button" type="button" onClick={() => onDecide(request.id, 'approve')}><Check aria-hidden="true" /> Approve</button></div></article>)}</div></> : <div className="organizer-empty"><Check aria-hidden="true" /><p><strong>No requests are waiting.</strong><br />New requests will appear here even if email is delayed.</p></div> : tab === 'people' ? <div className="people-summary"><p className="organizer-intro">Saved contacts stay here even after you remove them from a time. Use the private phone and email links to contact them directly.</p>{people.length ? people.map((person) => <section key={person.name}><div className="people-summary-heading"><div><strong>{person.name}</strong><span className="compact-contact">{person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}{person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}</span></div><small>{person.events.length ? `${person.events.length} ${person.events.length === 1 ? 'commitment' : 'commitments'}` : 'No current commitments'}</small></div><div className="family-schedule-list">{person.events.map((event) => <button type="button" key={event.id} onClick={() => onEditEvent(event)}><span><strong>{eventDisplayTitle(event)}</strong><small>{event.dayLabel} · {eventTimeRangeLabel(event)}</small></span><span>Edit</span><Pencil aria-hidden="true" /></button>)}</div></section>) : <div className="organizer-empty"><Users aria-hidden="true" /><p><strong>No saved contacts yet.</strong></p></div>}</div> : <FamilyScheduleEditor events={events} foodSettings={foodSettings} foodPreferences={foodPreferences} visitSettings={visitSettings} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveFood={onSaveFoodSettings} onSaveFoodPreferences={onSaveFoodPreferences} onSaveVisit={onSaveVisitSettings} onSaveFamilyInTown={onSaveFamilyInTown} onEditInTownDates={onEditInTownDates} onEditBusyDates={onEditBusyDates} onAdd={onAddSchedule} onEdit={onEditEvent} />}
    {declining && <DeclineRequestModal name={declining.requesterName} onClose={() => setDeclining(null)} onDecline={(reason) => { onDecide(declining.id, 'decline', reason); setDeclining(null) }} />}
    {editingMember && <CareTeamMemberModal member={editingMember} onClose={() => setEditingMember(null)} onSave={async (member) => { if (await onSaveCareTeam(member)) setEditingMember(null) }} />}
  </section>
}

function CareTeamMemberModal({ member, onClose, onSave }: { member: CareTeamMember; onClose: () => void; onSave: (member: CareTeamMember) => void }) {
  const [form, setForm] = useState(member)
  const valid = form.name.trim() && form.weekdays.length > 0 && form.endTime > form.startTime
  return <ModalShell title="Add nurse or helper" onClose={onClose}><p className="modal-intro">Add their regular hours. Automatic assignment never applies to rides.</p><form onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ ...form, name: form.name.trim() }) }}><label htmlFor="care-name">Name</label><input id="care-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus /><label htmlFor="care-role">Role</label><select id="care-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as CareTeamMember['role'] })}><option>Nurse</option><option>Helper</option></select><div className="field-row"><div><label htmlFor="care-phone">Phone <span>(optional)</span></label><input id="care-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div><label htmlFor="care-email">Email <span>(optional)</span></label><input id="care-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div><fieldset className="weekday-picker"><legend>Regular days</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={form.weekdays.includes(day.value)} onChange={() => setForm({ ...form, weekdays: form.weekdays.includes(day.value) ? form.weekdays.filter((value) => value !== day.value) : [...form.weekdays, day.value].sort() })} /><span>{day.short}</span></label>)}</fieldset><div className="field-row"><div><label htmlFor="care-start">Starts</label><input id="care-start" type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required /></div><div><label htmlFor="care-end">Ends</label><input id="care-end" type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required /></div></div><label className="repeat-toggle"><input type="checkbox" checked={form.autoAssign} onChange={(event) => setForm({ ...form, autoAssign: event.target.checked })} /><span><Check aria-hidden="true" /><strong>Assign automatically during these hours</strong><small>Applies to support needs except rides.</small></span></label><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!valid}><Check aria-hidden="true" /> Save person</button></div></form></ModalShell>
}

function DeclineRequestModal({ name, onClose, onDecline }: { name: string; onClose: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <ModalShell title="Decline this request" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onDecline(reason.trim()) }}><p className="modal-intro">Add a short, kind reason for {name}. It will be included in their email when an email address is available.</p><label htmlFor="decline-reason">Reason</label><textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: We no longer need coverage at this time." autoFocus required /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="danger-button" type="submit" disabled={!reason.trim()}>Decline request</button></div></form></ModalShell>
}

function FamilyScheduleEditor({ events, foodSettings, foodPreferences, visitSettings, familyInTown, familyInTownDates, onSaveFood, onSaveFoodPreferences, onSaveVisit, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAdd, onEdit }: { events: TeamEvent[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; visitSettings: VisitSettings; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveFood: (settings: FoodSettings) => Promise<boolean>; onSaveFoodPreferences: (preferences: FoodPreferences) => Promise<boolean>; onSaveVisit: (settings: VisitSettings) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAdd: (forWho: ForWho) => void; onEdit: (event: TeamEvent) => void }) {
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
    {person === 'Family' && <><div className="family-rules"><form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); if (visitEnd > visitStart) await onSaveVisit({ startTime: visitStart, endTime: visitEnd }) }}><h3>Normal visiting hours</h3><p>Friends are welcome to request a Stop By time during these hours. They can still request a different time for the family to approve.</p><div className="field-row"><div><label htmlFor="visit-start">From</label><input id="visit-start" type="time" value={visitStart} onChange={(event) => setVisitStart(event.target.value)} required /></div><div><label htmlFor="visit-end">Until</label><input id="visit-end" type="time" value={visitEnd} onChange={(event) => setVisitEnd(event.target.value)} required /></div></div><div className="form-actions"><button className="primary-button" type="submit" disabled={visitEnd <= visitStart}><Check aria-hidden="true" /> Save visiting hours</button></div></form><form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); if (foodDays.length && foodEnd > foodStart) await onSaveFood({ weekdays: foodDays, startTime: foodStart, endTime: foodEnd }) }}><h3>Food drop-off days</h3><p>Choose the days and hours shown in Bring Food. Filled dates are hidden automatically.</p><fieldset className="weekday-picker"><legend>Available days</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={foodDays.includes(day.value)} onChange={() => setFoodDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value].sort())} /><span aria-hidden="true">{day.short}</span><span className="sr-only">{day.label}</span></label>)}</fieldset><div className="field-row"><div><label htmlFor="food-start">From</label><input id="food-start" type="time" value={foodStart} onChange={(event) => setFoodStart(event.target.value)} required /></div><div><label htmlFor="food-end">Until</label><input id="food-end" type="time" value={foodEnd} onChange={(event) => setFoodEnd(event.target.value)} required /></div></div><div className="form-actions"><button className="primary-button" type="submit" disabled={!foodDays.length || foodEnd <= foodStart}><Check aria-hidden="true" /> Save food days</button></div></form><FoodPreferencesEditor preferences={foodPreferences} onSave={onSaveFoodPreferences} /></div><div className="family-schedule-divider" /><div><h3>Upcoming family appointments</h3><p>Open any item below to view or edit it.</p></div>{upcomingList}</>}
  </div>
}

function FoodPreferencesEditor({ preferences, onSave }: { preferences: FoodPreferences; onSave: (preferences: FoodPreferences) => Promise<boolean> }) {
  const [form, setForm] = useState(preferences)
  const updateSuggestion = (id: string, patch: Partial<FoodPreference>) => setForm((current) => ({ ...current, suggestions: current.suggestions.map((suggestion) => suggestion.id === id ? { ...suggestion, ...patch } : suggestion) }))
  const addSuggestion = () => setForm((current) => ({ ...current, suggestions: [...current.suggestions, { id: crypto.randomUUID(), type: 'homemade', name: '', items: [], note: '' }] }))
  return <form className="simple-settings food-preferences-editor" onSubmit={async (event) => { event.preventDefault(); await onSave({ ...form, suggestions: form.suggestions.filter((suggestion) => suggestion.name.trim()).map((suggestion) => ({ ...suggestion, name: suggestion.name.trim(), items: suggestion.items.map((item) => item.trim()).filter(Boolean), note: suggestion.note.trim() })) }) }}>
    <h3>Food preferences and favorites</h3><p>These notes appear in Bring Food so people can choose something the household will enjoy.</p>
    <label htmlFor="food-overview">What works well</label><textarea id="food-overview" value={form.overview} onChange={(event) => setForm({ ...form, overview: event.target.value })} />
    <label htmlFor="food-avoid">Please avoid</label><textarea id="food-avoid" value={form.avoid} onChange={(event) => setForm({ ...form, avoid: event.target.value })} />
    <div className="food-suggestion-list">{form.suggestions.map((suggestion, index) => <fieldset className="food-suggestion" key={suggestion.id}><legend>Favorite idea {index + 1}</legend><div className="field-row"><div><label htmlFor={`food-type-${suggestion.id}`}>Type</label><select id={`food-type-${suggestion.id}`} value={suggestion.type} onChange={(event) => updateSuggestion(suggestion.id, { type: event.target.value as FoodPreferenceType, items: event.target.value === 'restaurant' ? (suggestion.items.length ? suggestion.items : ['']) : [] })}><option value="restaurant">Restaurant</option><option value="homemade">Homemade</option><option value="grocery">Grocery item</option></select></div><div><label htmlFor={`food-name-${suggestion.id}`}>{suggestion.type === 'restaurant' ? 'Restaurant' : suggestion.type === 'homemade' ? 'Dish or meal' : 'Grocery item'}</label><input id={`food-name-${suggestion.id}`} value={suggestion.name} onChange={(event) => updateSuggestion(suggestion.id, { name: event.target.value })} placeholder={suggestion.type === 'restaurant' ? 'Example: Mendocino Farms' : suggestion.type === 'homemade' ? 'Example: Chicken and vegetables' : 'Example: Fresh fruit'} /></div></div>{suggestion.type === 'restaurant' && <div className="restaurant-items"><strong>Favorite menu items <span>(optional)</span></strong>{suggestion.items.map((item, itemIndex) => <div className="inline-item" key={`${suggestion.id}-${itemIndex}`}><input aria-label={`Favorite menu item ${itemIndex + 1}`} value={item} onChange={(event) => updateSuggestion(suggestion.id, { items: suggestion.items.map((current, currentIndex) => currentIndex === itemIndex ? event.target.value : current) })} placeholder="Menu item" />{suggestion.items.length > 1 && <button type="button" className="icon-text-button" onClick={() => updateSuggestion(suggestion.id, { items: suggestion.items.filter((_, currentIndex) => currentIndex !== itemIndex) })}><X aria-hidden="true" /> Remove</button>}</div>)}<button type="button" className="secondary-button compact-button" onClick={() => updateSuggestion(suggestion.id, { items: [...suggestion.items, ''] })}>+ Add item</button></div>}<label htmlFor={`food-note-${suggestion.id}`}>Note <span>(optional)</span></label><input id={`food-note-${suggestion.id}`} value={suggestion.note} onChange={(event) => updateSuggestion(suggestion.id, { note: event.target.value })} placeholder="Anything useful to know" /><button type="button" className="icon-text-button remove-suggestion" onClick={() => setForm((current) => ({ ...current, suggestions: current.suggestions.filter((item) => item.id !== suggestion.id) }))}><Trash2 aria-hidden="true" /> Remove this idea</button></fieldset>)}</div>
    <button type="button" className="secondary-button" onClick={addSuggestion}>+ Add another favorite</button><div className="form-actions"><button className="primary-button" type="submit"><Check aria-hidden="true" /> Save food preferences</button></div>
  </form>
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

function PlanRequestModal({ type, initialWindow, events, foodSettings, foodPreferences, visitSettings, foodReservedDates, onClose, onSave }: { type: PlanType; initialWindow?: TeamEvent | null; events: TeamEvent[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; visitSettings: VisitSettings; foodReservedDates: string[]; onClose: () => void; onSave: (plan: { type: PlanType; name: string; phone: string; email: string; date: string; time: string; endTime: string; details: string }) => Promise<boolean> }) {
  const [contact] = useState(savedHelperContact)
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email)
  const [date, setDate] = useState(() => type === 'food' ? nextFoodDate(foodSettings.weekdays) : initialWindow ? `${initialWindow.date.slice(0, 4)}-${initialWindow.date.slice(4, 6)}-${initialWindow.date.slice(6, 8)}` : localDateInputValue())
  const [time, setTime] = useState(type === 'food' ? foodSettings.startTime : initialWindow?.time || visitSettings.startTime)
  const [endTime, setEndTime] = useState(type === 'food' ? addMinutes(foodSettings.startTime, 30) : initialWindow ? (addHour(initialWindow.time) < initialWindow.endTime ? addHour(initialWindow.time) : initialWindow.endTime) : addHour(visitSettings.startTime))
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
  const stopByDayUnavailable = type === 'stop_by' && events.some((item) => item.date.slice(0, 8) === compactDate)
  const maryBusyThatDay = events.filter((item) => item.date.slice(0, 8) === compactDate).sort((a, b) => a.time.localeCompare(b.time))
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
    if (saving || !timeIsValid || foodSlotUnavailable || stopByDayUnavailable) return
    setSaving(true)
    const foodDetails = type === 'food' ? `${details.trim() || 'Food drop-off'} · ${dropOffPlace}` : details.trim()
    const saved = await onSave({ type, name: name.trim(), phone: phone.trim(), email: email.trim(), date, time, endTime, details: foodDetails })
    if (!saved) setSaving(false)
  }

  return <ModalShell title={type === 'food' ? 'Bring food' : 'Request a time to stop by'} onClose={onClose}>
    <p className="modal-intro">{type === 'food' ? `Choose an open ${foodDayNames} between ${eventTimeLabel(foodSettings.startTime)} and ${eventTimeLabel(foodSettings.endTime)}. Filled dates are unavailable.` : `The usual Stop By hours are ${eventTimeLabel(visitSettings.startTime)} – ${eventTimeLabel(visitSettings.endTime)}. Choose the time that works for you. You may stay longer if you would like.`}</p>
    {type === 'food' && <FoodPreferencesCard preferences={foodPreferences} />}
    <form onSubmit={submit}>
      <label htmlFor="plan-name">Your name</label><input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your first and last name" autoComplete="name" autoFocus required />
      <div className="field-row"><div><label htmlFor="plan-phone">Phone number</label><input id="plan-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(602) 555-0123" autoComplete="tel" required /></div><div><label htmlFor="plan-email">Email address</label><input id="plan-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></div></div>
      {type === 'food' ? <><label>Choose an open date</label><div className="calendar-date-picker food-date-picker"><div className="date-picker-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="date-picker-grid">{Array.from({ length: foodCalendarBlanks }, (_, index) => <span className="date-picker-blank" key={`food-blank-${index}`} />)}{foodCalendarDays.map((day) => { const isoDate = `${day.dateKey.slice(0, 4)}-${day.dateKey.slice(4, 6)}-${day.dateKey.slice(6, 8)}`; const weekday = new Date(`${isoDate}T12:00:00`).getDay(); const filled = foodReservedDates.includes(day.dateKey); const allowed = foodSettings.weekdays.includes(weekday) && !filled; const selected = date === isoDate; return <button type="button" key={day.dateKey} disabled={!allowed} aria-pressed={selected} aria-label={`${day.fullDay}${filled ? ', filled' : allowed ? ', open' : ', unavailable'}`} onClick={() => setDate(isoDate)}><span>{day.monthShort}</span><strong>{day.number}</strong>{filled && <small>Filled</small>}</button> })}</div></div></> : <><label htmlFor="plan-date">Date</label><input id="plan-date" type="date" min={localDateInputValue()} value={date} onChange={(event) => setDate(event.target.value)} required /></>}
      {type === 'food' && <div className={`meal-week-status ${foodSlotUnavailable ? 'covered' : ''}`} role="status"><Utensils aria-hidden="true" /><p><strong>{!foodDayAllowed ? `Please choose ${foodDayNames}.` : foodDateIsTaken ? 'Someone is already bringing food that day.' : maryHasAppointmentThen ? 'Mary has an appointment during that time.' : !foodTimeIsValid ? `Choose a time between ${eventTimeLabel(foodSettings.startTime)} and ${eventTimeLabel(foodSettings.endTime)}.` : 'This food drop-off time is open.'}</strong><br />Filled dates and appointment conflicts are blocked automatically.</p></div>}
      <div className="field-row"><div><label htmlFor="plan-time">{type === 'food' ? 'Drop off around' : 'Arrive'}</label><input id="plan-time" type="time" value={time} onChange={(event) => changeStartTime(event.target.value)} required /></div><div><label htmlFor="plan-end-time">{type === 'food' ? 'Until' : 'Leave'}</label><input id="plan-end-time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></div></div>
      {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      {outsideVisitHours && <p className="outside-hours-note" role="status"><strong>Outside normal visiting hours.</strong> You can still send this request for the family to approve.</p>}
      {type === 'stop_by' && maryBusyThatDay.length > 0 && <div className="meal-week-status covered" role="status"><Clock3 aria-hidden="true" /><p><strong>That day is not open for drop-ins.</strong><br />Stop By requests are available only on completely open days. Please choose another date.</p></div>}
      {type === 'stop_by' && <p className="form-note"><strong>A quiet visit is welcome.</strong> Mary may need to nap while you are there. It is completely fine to sit with her quietly while she rests.</p>}
      {type === 'food' && <><label htmlFor="drop-off-place">Where will you leave the food?</label><select id="drop-off-place" value={dropOffPlace} onChange={(event) => setDropOffPlace(event.target.value)}><option>Front door</option><option>Back gate by the garage</option><option>I would like to come inside and say hi</option></select><p className="form-note">For a quick drop-off, text the family when you arrive so someone can bring it inside. To visit, choose the last option so the family knows.</p></>}
      <label htmlFor="plan-details">{type === 'food' ? 'What are you bringing? ' : 'Anything Mary and Stu should know? '}<span>(optional)</span></label><textarea id="plan-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder={type === 'food' ? 'Example: Chicken soup and bread' : 'Example: I can keep Mary company and help with small things around the house.'} />
      <p className="form-note privacy-note">This request stays private until Mary or Stu approves it. We will email you after they decide.</p>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !timeIsValid || foodSlotUnavailable || stopByDayUnavailable}><Check aria-hidden="true" /> {saving ? 'Sending request…' : 'Send request'}</button></div>
    </form>
  </ModalShell>
}

function FoodPreferencesCard({ preferences }: { preferences: FoodPreferences }) {
  return <section className="food-preferences-card" aria-labelledby="food-preferences-title"><h3 id="food-preferences-title">Food preferences</h3><p>{preferences.overview}</p>{preferences.avoid && <p className="food-avoid"><strong>Please avoid:</strong> {preferences.avoid}</p>}{preferences.suggestions.length > 0 && <div className="food-favorites"><strong>Favorite ideas</strong>{preferences.suggestions.map((suggestion) => <div key={suggestion.id}><span className={`food-type-tag ${suggestion.type}`}>{suggestion.type === 'grocery' ? 'Grocery item' : suggestion.type}</span><p><strong>{suggestion.name}</strong>{suggestion.items.length > 0 && <> · {suggestion.items.join(', ')}</>}{suggestion.note && <><br /><small>{suggestion.note}</small></>}</p></div>)}</div>}</section>
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
      <fieldset className="bulk-date-list"><legend>Which dates do you want to change?</legend><div className="bulk-date-actions"><button type="button" onClick={() => setSelectedIds(entries.map((entry) => entry.id))}>Select all {entries.length} dates</button><button type="button" onClick={() => setSelectedIds([initialEntry.id])}>Only {availabilityDayLabel(initialEntry.day)}</button></div>{[...entries].sort((a, b) => a.day.localeCompare(b.day)).map((entry) => <label key={entry.id}><input type="checkbox" checked={selectedIds.includes(entry.id)} onChange={() => setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])} /><span><strong>{availabilityDayLabel(entry.day)}</strong><small>{availabilityTimeLabel…13943 tokens truncated…ctive { border-color:#cbd9ce; background:#fff; box-shadow:0 2px 7px rgba(36,59,49,.1); }
.family-schedule-heading { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-bottom:14px; }
.family-schedule-heading p { margin:4px 0 0!important; }
.family-schedule-heading .secondary-button { flex:0 0 auto; }
.family-schedule-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.family-schedule-actions .primary-button,.family-schedule-actions .secondary-button { min-height:44px; padding:10px 13px; }
.simple-settings { margin-top:22px; padding:18px; border:1px solid var(--line); border-radius:14px; background:#f8faf8; }
.simple-settings h3 { margin:0 0 5px; color:var(--pine-dark); }
.simple-settings>p { margin:0 0 16px; color:var(--muted); }
.food-preferences-editor { grid-column:1/-1; }
.food-suggestion-list { display:grid; gap:12px; margin:18px 0; }
.food-suggestion { margin:0; padding:15px; border:1px solid var(--line); border-radius:11px; background:#fff; }
.food-suggestion legend { padding:0 6px; color:var(--pine-dark); font-weight:850; }
.restaurant-items { display:grid; gap:8px; margin:16px 0 6px; }
.restaurant-items>strong { font-size:.95rem; }
.restaurant-items>strong span { color:var(--muted); font-weight:550; }
.inline-item { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; }
.icon-text-button { border:0; background:transparent; color:#7a3d31; padding:8px; font:inherit; font-size:.84rem; font-weight:800; display:inline-flex; align-items:center; gap:5px; cursor:pointer; }
.icon-text-button svg { width:17px; }
.remove-suggestion { margin-top:10px; }
.compact-button { min-height:40px!important; padding:8px 11px!important; width:max-content; }
.family-schedule-list { display:grid; gap:7px; margin-bottom:18px; }
.family-schedule-list button { width:100%; min-height:62px; border:1px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); padding:11px 13px; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:14px; text-align:left; cursor:pointer; }
.family-schedule-list button:hover { border-color:var(--fern); background:#fbfdfb; }
.family-schedule-list strong,.family-schedule-list small { display:block; }
.family-schedule-list small { margin-top:3px; color:var(--muted); }
.family-schedule-list button>span:nth-child(2) { color:var(--fern); font-size:.84rem; font-weight:750; text-align:right; }
.family-schedule-list svg { width:18px; color:var(--pine); }
.family-schedule-divider { height:1px; margin:24px 0; background:var(--line); }
.work-hours-editor>div>p { margin:5px 0 16px; color:var(--muted); line-height:1.5; }
.weekday-picker { margin:0; padding:0; border:0; }
.weekday-picker legend { margin-bottom:9px; color:var(--ink); font-weight:850; }
.weekday-picker label { display:inline-block; margin:0 7px 7px 0; cursor:pointer; }
.weekday-picker input { position:absolute; opacity:0; pointer-events:none; }
.weekday-picker label>span:first-of-type { min-width:55px; min-height:45px; border:1px solid #b8cabd; border-radius:9px; background:#fff; color:var(--pine-dark); display:grid; place-items:center; font-weight:800; }
.weekday-picker input:checked+span { border-color:var(--pine); background:var(--pine); color:#fff; }
.weekday-picker input:focus-visible+span { outline:3px solid #ddb455; outline-offset:2px; }
.work-hours-tip { margin:16px 0 0; padding:12px 14px; border-radius:10px; background:var(--mist); color:var(--muted); line-height:1.5; }
.work-hours-tip strong { color:var(--ink); }
.sr-only { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
.empty-availability { grid-column:1/-1; background:#fff; border:1px solid var(--line); border-radius:15px; padding:22px; display:grid; grid-template-columns:auto 1fr auto; gap:16px; align-items:center; }
.empty-availability>svg { width:44px; height:44px; padding:10px; background:var(--mint); color:var(--pine); border-radius:50%; }
.empty-availability h3 { margin:0 0 4px; color:var(--pine-dark); font-size:1.12rem; }
.empty-availability p { margin:0; color:var(--muted); line-height:1.45; }
footer { background:var(--pine-dark); color:#fff; display:flex; justify-content:center; align-items:center; gap:18px; padding:35px 24px; text-align:left; }
footer svg { width:34px; color:#cfe1d3; }
footer p { margin:0; line-height:1.5; }
.toast { position:fixed; right:24px; bottom:24px; z-index:50; background:var(--pine-dark); color:#fff; padding:17px 20px; border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.25); display:flex; gap:10px; align-items:center; max-width:430px; font-weight:700; }
.toast svg { width:24px; flex:0 0 auto; }
.modal-backdrop { position:fixed; inset:0; background:rgba(20,38,29,.68); z-index:100; display:grid; place-items:center; padding:22px; overflow-y:auto; }
.modal { background:#fff; color:var(--ink); width:min(610px,100%); border-radius:20px; padding:34px; box-shadow:0 30px 80px rgba(0,0,0,.3); position:relative; }
.modal h2 { margin:0 44px 22px 0; font-size:2rem; line-height:1.12; }
.close-button { position:absolute; right:22px; top:22px; width:44px; height:44px; border-radius:50%; border:1px solid var(--line); background:#fff; color:var(--pine); display:grid; place-items:center; }
.close-button:hover { background:var(--mint); }
.modal-summary { background:var(--mist); border-left:5px solid var(--fern); border-radius:10px; padding:18px; margin-bottom:22px; }
.modal-summary strong,.modal-summary span { display:block; }
.modal-summary strong { font-size:1.16rem; color:var(--pine-dark); }
.modal-summary span { margin-top:5px; color:var(--muted); }
.modal-summary p { margin:12px 0 0; font-weight:700; }
.meal-week-status { margin:12px 0 18px; padding:12px 14px; border:1px solid #b9d2bf; border-radius:11px; background:#eef7f0; color:var(--pine-dark); display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:center; }
.meal-week-status.covered { border-color:#dfc98f; background:#fff8e9; color:#654e1e; }
.meal-week-status svg { width:24px; }
.meal-week-status p { margin:0; line-height:1.45; }
.food-preferences-card { margin:-5px 0 22px; padding:16px; border:1px solid #b9d2bf; border-radius:12px; background:#f4f9f5; }
.food-preferences-card h3 { margin:0 0 7px; color:var(--pine-dark); }
.food-preferences-card>p { margin:0; color:var(--ink); line-height:1.5; }
.food-preferences-card .food-avoid { margin-top:8px; color:#704238; }
.food-favorites { display:grid; gap:8px; margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
.food-favorites>strong { color:var(--pine-dark); }
.food-favorites>div { display:grid; grid-template-columns:auto 1fr; gap:8px; align-items:start; }
.food-favorites p { margin:1px 0 0; line-height:1.4; }
.food-favorites small { color:var(--muted); }
.food-type-tag { padding:4px 7px; border-radius:999px; background:#dceade; color:var(--pine-dark); font-size:.7rem; font-weight:850; text-transform:capitalize; white-space:nowrap; }
.food-type-tag.restaurant { background:#e6f1f8; color:#275f82; }
.food-type-tag.grocery { background:#fff1d6; color:#71501b; }
.modal-intro { color:var(--muted); font-size:1.02rem; line-height:1.55; margin:-8px 0 22px; }
.event-detail-summary { display:grid; gap:0; border:1px solid var(--line); border-radius:13px; overflow:hidden; }
.event-detail-summary>div { padding:15px 17px; border-bottom:1px solid var(--line); background:#fff; }
.event-detail-summary>div:last-child { border-bottom:0; }
.event-detail-summary small,.event-detail-summary strong { display:block; }
.event-detail-summary small { color:var(--muted); font-size:.78rem; font-weight:850; text-transform:uppercase; letter-spacing:.04em; }
.event-detail-summary strong { margin-top:4px; color:var(--pine-dark); line-height:1.45; }
.event-detail-summary p { margin:5px 0 0; color:var(--ink); line-height:1.55; }
.compact-contact { display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:5px; color:var(--muted); font-size:.82rem; font-weight:600; }
.compact-contact a { color:var(--pine); text-decoration:underline; }
.compact-contact-list { display:grid; gap:8px; margin-top:8px; }
.compact-contact-list>span { display:grid; grid-template-columns:1fr auto; gap:2px 10px; align-items:center; font-size:.86rem; }
.compact-contact-list>span strong { margin:0; font-size:.88rem; }
.compact-contact-list>span small { grid-column:1; margin:0; text-transform:none; letter-spacing:0; font-size:.78rem; }
.compact-contact-list>span a { grid-column:2; grid-row:1 / span 2; color:var(--pine); font-size:.8rem; }
form label { display:block; font-weight:800; color:var(--ink); margin:16px 0 7px; }
form label span { font-weight:500; color:var(--muted); }
input,textarea,select { width:100%; border:2px solid #b9c9bd; border-radius:10px; padding:14px 15px; color:var(--ink); background:#fff; font-size:1.05rem; }
input { min-height:53px; }
textarea { min-height:95px; resize:vertical; }
.field-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.form-note { color:var(--muted); font-size:.9rem; line-height:1.45; margin:10px 0 0; }
.privacy-note { padding:10px 12px; border-radius:9px; background:#fff8e9; color:#624c24; }
.form-actions { display:flex; justify-content:flex-end; gap:14px; margin-top:26px; }
.repeat-toggle { margin-top:18px; padding:13px 15px; border:1px solid var(--line); border-radius:11px; background:var(--mist); display:flex; align-items:center; gap:12px; cursor:pointer; }
.repeat-toggle input { width:24px; min-height:24px; height:24px; flex:0 0 24px; accent-color:var(--pine); }
.repeat-toggle span,.repeat-toggle strong,.repeat-toggle small { display:block; }
.repeat-toggle span { position:relative; padding-left:29px; }
.repeat-toggle svg { position:absolute; left:0; top:1px; width:20px; color:var(--pine); }
.repeat-toggle small { margin-top:2px; color:var(--muted); font-weight:550; }
.bulk-date-list { margin:0; padding:0; border:0; display:grid; gap:8px; }
.bulk-date-list legend { margin-bottom:8px; color:var(--ink); font-weight:850; }
.bulk-date-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:2px; }
.bulk-date-actions button { min-height:44px; border:1px solid #aec3b3; border-radius:9px; background:#fff; color:var(--pine-dark); padding:8px 10px; font:inherit; font-weight:800; cursor:pointer; }
.bulk-date-actions button:hover { background:var(--mint); }
.bulk-date-list label { margin:0; padding:11px 13px; border:1px solid var(--line); border-radius:10px; display:flex; align-items:center; gap:12px; background:var(--mist); cursor:pointer; }
.bulk-date-list input { width:23px; min-height:23px; height:23px; flex:0 0 23px; accent-color:var(--pine); }
.bulk-date-list span,.bulk-date-list strong,.bulk-date-list small { display:block; }
.bulk-date-list small { margin-top:2px; color:var(--muted); font-weight:600; }
.remove-area { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); }
.remove-button,.danger-button { min-height:44px; border-radius:10px; padding:10px 14px; display:inline-flex; align-items:center; justify-content:center; gap:8px; font:inherit; font-weight:800; cursor:pointer; }
.remove-button { border:1px solid #d2b4aa; background:#fff; color:#7a3d31; }
.danger-button { border:1px solid #7b3a31; background:#7b3a31; color:#fff; }
.remove-button svg,.danger-button svg { width:19px; }
.remove-confirm { padding:16px; border:1px solid #d7b9ae; border-radius:12px; background:#fff7f4; }
.remove-confirm p { margin:0; line-height:1.5; }
.remove-confirm>div { display:flex; justify-content:flex-end; gap:10px; margin-top:14px; }
.availability-mode { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px; padding:5px; border-radius:12px; background:#eef3ef; }
.availability-mode button { min-height:44px; border:0; border-radius:9px; background:transparent; color:var(--pine-dark); font:inherit; font-weight:800; cursor:pointer; }
.availability-mode button[aria-pressed="true"] { background:#fff; box-shadow:0 1px 5px rgba(36,59,49,.13); }
.calendar-date-picker { padding:9px; border:1px solid #d6e1d8; border-radius:12px; background:#f8faf8; }
.date-picker-weekdays { display:grid; grid-template-columns:repeat(7,1fr); gap:7px; margin-bottom:6px; }
.date-picker-weekdays span { text-align:center; color:var(--muted); font-size:.72rem; font-weight:850; text-transform:uppercase; }
.date-picker-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:7px; }
.date-picker-blank { min-height:58px; }
.date-picker-grid button { min-height:58px; border:1px solid #c6d5ca; border-radius:9px; background:#fff; color:var(--pine-dark); font:inherit; cursor:pointer; }
.date-picker-grid button span,.date-picker-grid button strong { display:block; }
.date-picker-grid button span { font-size:.75rem; color:var(--muted); }
.date-picker-grid button strong { margin-top:2px; font-size:1.05rem; }
.date-picker-grid button[aria-pressed="true"] { border-color:var(--pine); background:var(--pine); color:#fff; }
.date-picker-grid button[aria-pressed="true"] span { color:#fff; }
.date-picker-grid button:disabled { cursor:not-allowed; opacity:.42; background:#eef1ee; }
.date-picker-grid button small { display:block; margin-top:2px; color:#795f2a; font-size:.56rem; font-weight:850; text-transform:uppercase; }
.range-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.range-fields>div:first-child:nth-last-child(3) { grid-column:1/-1; }
.time-mode { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:5px; border-radius:12px; background:#eef3ef; }
.time-mode button { min-height:46px; border:0; border-radius:9px; background:transparent; color:var(--pine-dark); font:inherit; font-weight:800; cursor:pointer; }
.time-mode button[aria-pressed="true"] { background:#fff; box-shadow:0 1px 5px rgba(36,59,49,.13); }
.selection-summary { margin:10px 0 18px; color:var(--muted); }
.field-error { margin:-4px 0 16px; color:#8a3f2f; font-weight:750; }
.primary-button:disabled { cursor:not-allowed; opacity:.48; }
.full-button { width:100%; margin-top:26px; }
.show-more-button { width:min(100%,360px); margin:4px auto 0; }
.family-rules { display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; }
.outside-hours-note { margin:-2px 0 18px; padding:12px 14px; border:1px solid #dfc98f; border-radius:10px; background:#fff8e9; color:#654d20; line-height:1.45; }
.help-list { display:grid; gap:18px; }
.help-list>div { display:grid; grid-template-columns:44px 1fr; gap:14px; align-items:flex-start; }
.help-list span { width:40px; height:40px; border-radius:50%; background:var(--mint); color:var(--pine-dark); display:grid; place-items:center; font-weight:900; }
.help-list p { margin:0; line-height:1.55; color:var(--muted); }
.help-list strong { color:var(--ink); }
@media (max-width:900px) {
  .welcome { align-items:flex-start; flex-direction:column; gap:28px; }
  .quick-actions { min-width:0; width:100%; align-items:stretch; }
  .steps ol { grid-template-columns:1fr; gap:17px; }
  .section-heading { align-items:flex-start; flex-direction:column; }
  .view-toggle { width:100%; }
  .view-toggle button { flex:1; justify-content:center; }
  .filters { justify-content:flex-start; }
  .event-card { grid-template-columns:205px 1fr; }
  .event-actions { grid-column:1/-1; border-left:0; border-top:1px solid #e2e9e3; flex-direction:row; padding:18px 24px; }
  .event-actions>* { flex:1; }
}
@media (max-width:650px) {
  .site-header { min-height:0; padding:9px 12px 8px; display:grid; grid-template-columns:1fr auto; gap:7px 8px; }
  .brand { font-size:1.4rem; }
  .brand-mark { width:40px; height:40px; }
  .primary-nav { grid-column:1/-1; width:100%; margin:0; display:grid; grid-template-columns:repeat(3,1fr); gap:5px; }
  .primary-nav button { min-width:0; min-height:47px; padding:5px 3px; flex-direction:column; gap:2px; border-color:#dbe5dd; background:#fbfdfb; font-size:.72rem; line-height:1.08; }
  .primary-nav svg { width:18px; height:18px; }
  .header-tools { grid-column:2; grid-row:1; justify-self:end; }
  .help-button,.family-access-button { width:42px; height:42px; padding:0; font-size:0; }
  .help-button span,.family-access-button span { display:none; }
  .help-button svg,.family-access-button svg { width:23px; }
  .family-access-button { position:relative; }
  .family-access-button strong { position:absolute; right:-2px; top:-2px; min-width:18px; height:18px; font-size:.65rem; }
  main { width:min(100% - 28px,1180px); }
  .welcome { padding:28px 0 20px; gap:20px; }
  h1 { font-size:2.4rem; }
  .intro { font-size:1.08rem; margin-top:10px; }
  .quick-actions { gap:8px; }
  .quick-actions .text-button { display:none; }
  .helper-note { grid-template-columns:auto 1fr; padding:13px 14px; }
  .helper-note>button { grid-column:2; justify-self:start; padding:3px 0 1px; }
  .approval-banner { grid-template-columns:auto 1fr; align-items:start; }
  .approval-banner button { grid-column:1/-1; width:100%; }
  .organizer-panel { padding:16px; }
  .organizer-heading { align-items:flex-start; flex-direction:column; }
  .organizer-tabs { grid-template-columns:1fr; }
  .work-hours-editor { padding:15px; }
  .family-roster { grid-template-columns:1fr; }
  .family-person-tabs { grid-template-columns:repeat(3,1fr); }
  .family-schedule-heading { align-items:flex-start; flex-direction:column; }
  .family-schedule-actions,.family-schedule-actions .primary-button,.family-schedule-actions .secondary-button { width:100%; }
  .family-schedule-list button { grid-template-columns:minmax(0,1fr) auto; }
  .family-schedule-list button>span:nth-child(2) { grid-column:1; text-align:left; }
  .family-schedule-list svg { grid-column:2; grid-row:1/3; }
  .weekday-picker { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
  .weekday-picker label { margin:0; }
  .weekday-picker label>span:first-of-type { min-width:0; }
  .organizer-requests article { grid-template-columns:1fr; }
  .organizer-requests article>div:last-child { justify-content:flex-end; }
  .cloud-message.error { align-items:flex-start; flex-direction:column; }
  .schedule { padding-top:36px; }
  .section-heading h2 { font-size:2rem; }
  .filters { display:none; }
  .status-filters { flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; }
  .status-filters::-webkit-scrollbar { display:none; }
  .status-filters button { flex:0 0 auto; }
  .event-card { grid-template-columns:1fr; }
  .event-card.has-response { grid-template-columns:1fr; min-height:0; }
  .event-date { border-right:0; border-bottom:1px solid #e2e9e3; }
  .event-date p { margin-top:16px; }
  .event-info,.event-date { padding:20px; }
  .event-info>p { display:none; }
  .card-details-hint { display:block; margin-top:7px; }
  .event-actions { grid-column:auto; flex-direction:column; padding:20px; }
  .availability-section .secondary-button { width:100%; }
  .availability-view-heading { align-items:flex-start; flex-direction:column; }
  .availability-view-heading .view-toggle { width:100%; }
  .availability-list article { grid-template-columns:84px minmax(0,1fr) auto; gap:10px; padding:12px; align-items:start; }
  .availability-date { padding-right:9px; align-self:stretch; display:flex; flex-direction:column; justify-content:center; }
  .availability-date strong { font-size:.88rem; }
  .person-icon { display:none; }
  .availability-person { min-width:0; }
  .availability-list h3 { font-size:1rem; }
  .availability-help { font-size:.9rem; }
  .availability-phone { font-size:.76rem; overflow-wrap:anywhere; }
  .tap-edit { grid-column:3; grid-row:1; padding:5px 4px; font-size:.78rem; }
  .support-filter-note { align-items:flex-start; flex-direction:column; }
  .empty-availability { grid-template-columns:auto 1fr; padding:18px; }
  .empty-availability .secondary-button { grid-column:1/-1; width:100%; }
  .calendar-day { grid-template-columns:76px 1fr; min-height:92px; }
  .calendar-date strong { font-size:1.75rem; }
  .calendar-items { padding:9px; }
  .calendar-items button { padding:10px; }
  .month-calendar-heading { min-height:58px; padding:7px 9px; grid-template-columns:42px 1fr 42px; }
  .month-calendar-heading h3 { font-size:1.25rem; }
  .month-calendar-heading button { width:38px; height:38px; }
  .month-weekdays span { padding:8px 1px; font-size:.65rem; letter-spacing:0; }
  .month-cell { min-height:73px; padding:5px 4px; gap:4px; align-items:center; }
  .month-cell.outside-month { opacity:.55; }
  .month-cell.today .month-number { width:27px; height:27px; margin:-2px 0 0; }
  .month-number { font-size:.87rem; }
  .month-statuses { gap:2px; }
  .month-status { padding:3px 2px; font-size:.52rem; line-height:1.05; text-align:center; }
  .family-rules { grid-template-columns:1fr; }
  .modal { padding:28px 20px 22px; }
  .modal h2 { font-size:1.7rem; }
  .close-button { right:16px; top:16px; }
  .field-row { grid-template-columns:1fr; gap:0; }
  .calendar-date-picker { padding:6px; }
  .date-picker-grid,.date-picker-weekdays { gap:4px; }
  .date-picker-grid button,.date-picker-blank { min-height:48px; }
  .date-picker-grid button span { font-size:.66rem; }
  .range-fields { grid-template-columns:1fr; gap:0; }
  .form-actions { flex-direction:column-reverse; }
  .form-actions>* { width:100%; }
  .remove-button { width:100%; }
  .remove-confirm>div { flex-direction:column; }
  .remove-confirm button { width:100%; }
  .bulk-date-actions { grid-template-columns:1fr; }
  footer { text-align:center; flex-direction:column; }
  .toast { left:14px; right:14px; bottom:14px; }
  #organizer-panel,#schedule-title { scroll-margin-top:145px; }
}
.family-rules .simple-settings:first-child { display:none; }
.family-rules { grid-template-columns:1fr; }
@media print {
  .site-header,.quick-actions,.helper-note,.filters,.view-toggle,.event-actions,.availability-section .secondary-button,footer { display:none!important; }
  body { background:#fff; }
  main { width:100%; }
  .welcome { padding:20px 0; }
  h1 { font-size:2.4rem; }
  .schedule { padding:10px 0; }
  .event-card { break-inside:avoid; box-shadow:none; grid-template-columns:180px 1fr; min-height:auto; }
  .event-info,.event-date { padding:14px; }
}

