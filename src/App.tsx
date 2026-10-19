import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, HeartHandshake,
  ListChecks, Pencil, Repeat2, Trash2, Users, Utensils, X,
} from 'lucide-react'
import './App.css'
import { EmailStatus } from './FamilyPlanning'
import type { EmailNotice, WeekTemplate } from './FamilyPlanning'
import { buildHelpNeededEvents } from '../lib/schedule'
import type { TeamEvent, FamilyInTown, FamilyInTownDates, CareTeamMember } from '../lib/schedule'
import { defaultVisitorPreferences, signupVisitorPreferences, mergeContacts, samePerson, openCareWindows, foodTimeSlots } from '../lib/care'

type ForWho = 'Mary' | 'Stu' | 'Gabby' | 'Spencer' | 'Coco' | 'Family'
type PlanType = 'food' | 'stop_by'
type DriverContact = { personId?: string; familyKey?: string; name: string; phone: string; email: string }
type Availability = { id: string; personId?: string; email?: string; name: string; phone: string; day: string; time: string; note: string; editable?: boolean }
type ApprovalRequest = { status: string; requesterName: string; requesterPhone: string; requesterEmail: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type PendingRequest = { id: string; personId?: string; eventId: string; requesterName: string; requesterPhone: string; requesterEmail: string; notificationSentAt?: string; title: string; dayLabel: string; time: string; endTime: string; requestStartTime?: string; requestEndTime?: string; requestNote?: string; helpNeeded: string; details?: string; proposalType?: PlanType; isFlexible?: boolean }
type FoodSettings = { weekdays: number[]; startTime: string; endTime: string }
type FoodPreferenceType = 'restaurant' | 'homemade' | 'grocery'
type FoodPreference = { id: string; type: FoodPreferenceType; name: string; items: string[]; note: string }
type FoodPreferences = { overview: string; avoid: string; suggestions: FoodPreference[] }
type VisitSettings = { startTime: string; endTime: string }
type SupportContact = { id: string; personId?: string; familyKey?: string; name: string; phone: string; email: string; source?: 'contact_list' | 'request' }

const availabilityTimes = [
  { value: 'morning', label: 'Morning (8 AM – noon)' },
  { value: 'afternoon', label: 'Afternoon (noon – 5 PM)' },
  { value: 'evening', label: 'Evening (5 PM – 8 PM)' },
  { value: 'anytime', label: 'All day' },
]

const helpChoices = ['Driving or giving a ride', 'Practical care and household support', 'Home projects or errands', 'Bringing a meal', 'Pet care or errands', 'Anything that would be useful']
const alsWalkUrl = 'https://secure.alsaz.org/site/TR/Endurance/General?pg=team&team_id=4912&fr_id=1200'
const supportChoices = ['Need a ride', 'Spend time with Mary', 'Support at home or with an errand', 'Help with Coco', 'No help needed']
const maryAppointmentChoices = ['At Home Appointment', 'Appointment']
const defaultEventDetails = 'Please sign up through this website and wait for confirmation. No social visits or drop-ins. Thank you for respecting any schedule changes.'
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
  return value === 'Group event' || value === 'No help needed' || value === 'No help needed, just sharing the schedule'
}

function shouldShowEventLocation(event: Pick<TeamEvent, 'location' | 'helpNeeded'>) {
  return Boolean(event.location) && event.helpNeeded !== 'Spend time with Mary'
}

function eventDisplayTitle(event: TeamEvent) {
  return event.scheduleSource === 'nurse_coverage' ? 'Nurse with Mary' : event.helpNeeded === 'Spend time with Mary' ? 'Practical care for Mary' : event.title
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

function knownContacts(events: TeamEvent[], availability: Availability[], extraContacts: DriverContact[] = []) {
  return mergeContacts([...extraContacts, ...events.filter((event) => event.helper).map((event) => ({ personId: event.helperPersonId, name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' })), ...availability.map(({ personId, name, phone, email }) => ({ personId, name, phone, email: email || '' }))])
}

function localDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nextFoodDate(weekdays = [1, 3]) {
  const date = new Date()
  while (!weekdays.includes(date.getDay())) date.setDate(date.getDate() + 1)
  return localDateInputValue(date)
}


function buildPublicScheduleEvents(events: TeamEvent[], helpNeededEvents: TeamEvent[]) {
  const marySupport = helpNeededEvents
    .filter((event) => event.helper && !event.publicAction && (event.forWho === 'Mary' || event.isCalculatedCoverage || event.helpNeeded === 'Spend time with Mary'))
    .map((event) => event.helpNeeded === 'Spend time with Mary' && event.forWho !== 'Mary'
      ? { ...event, title: 'Spend time with Mary', forWho: 'Mary' as const }
      : event)
  return [
    ...marySupport,
    ...events.filter((event) => event.proposalType === 'food' && event.helper),
    ...events.filter((event) => event.helpNeeded === 'Group event' || event.scheduleSource === 'nurse_coverage'),
    ...events.filter((event) => event.helpNeeded !== 'Group event' && event.scheduleSource !== 'nurse_coverage' && event.forWho === 'Mary' && !event.proposalType && isNoSupport(event.helpNeeded) && !event.isFlexible),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.endTime.localeCompare(b.endTime))
}

function applyCareTeamAssignments(events: TeamEvent[], careTeam: CareTeamMember[]) {
  return events.map((event) => {
    if (event.helper || event.requestPending || event.isFlexible || isNoSupport(event.helpNeeded) || event.helpNeeded.toLocaleLowerCase().includes('ride')) return event
    const dateKey = event.date.slice(0, 8)
    const weekday = new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T12:00:00`).getDay()
    const member = careTeam.find((person) => person.role !== 'Nurse' && person.autoAssign && person.weekdays.includes(weekday) && event.time >= person.startTime && event.endTime <= person.endTime)
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
  const [showAvailabilityThanks, setShowAvailabilityThanks] = useState(false)
  const [foodConfirmation, setFoodConfirmation] = useState<{ name: string; email: string; date: string; time: string } | null>(null)
  const [addContact, setAddContact] = useState<DriverContact | undefined>(undefined)
  const [visitorPreferences, setVisitorPreferences] = useState(defaultVisitorPreferences)
  const [homeAddress, setHomeAddress] = useState('')
  const [notifications, setNotifications] = useState<EmailNotice[]>([])
  const [templates, setTemplates] = useState<WeekTemplate[]>([])
  const refreshing = useRef(false)
  const scheduleDates = new Set(getThirtyDays().map((day) => day.dateKey))
  const calculatedHelpNeeded = applyCareTeamAssignments(buildHelpNeededEvents(teamEvents, familyInTown, familyInTownDates), careTeam)
  const foodNeeds: TeamEvent[] = getThirtyDays().flatMap((day) => {
    const slots = foodTimeSlots(day.dateKey, foodSettings, foodReservedDates, teamEvents)
    return slots.length ? [{ id: `food-open-${day.dateKey}`, category: 'home' as const, forWho: 'Mary' as const, date: `${day.dateKey}T${slots[0].replace(':', '')}00`, dayLabel: day.fullDay, time: slots[0], endTime: addMinutes(slots[slots.length - 1], 30), title: 'Bring food', details: 'Choose this day to see food preferences, select an available drop-off time, and tell us what you’re bringing. Brief drop-off only; no social visit.', helpNeeded: 'Food drop-off', publicAction: 'food' as const }]: []
  })
  const supportFeedEvents = [...calculatedHelpNeeded.flatMap((event) => openCareWindows(event, careTeam)), ...foodNeeds]
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
    if (refreshing.current) return
    refreshing.current = true
    if (showLoading) setLoading(true)
    try {
      const data = await apiRequest()
      setTeamEvents(data.events)
      setAvailability(data.availability)
      setOrganizer(Boolean(data.organizer))
      setFoodSettings(data.foodSettings || { weekdays: [1, 3], startTime: '14:00', endTime: '18:00' })
      setFoodPreferences(data.foodPreferences || defaultFoodPreferences)
      setVisitorPreferences(data.visitorPreferences ?? defaultVisitorPreferences)
      setHomeAddress(data.homeAddress || '')
      setNotifications(data.notifications || [])
      setTemplates(data.templates || [])
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setFoodReservedDates(Array.isArray(data.foodReservedDates) ? data.foodReservedDates : [])
      setCareTeam(Array.isArray(data.careTeam) ? data.careTeam : [])
      setSupportContacts(Array.isArray(data.supportContacts) ? data.supportContacts : [])
      setCloudError('')
      if (data.organizer) await loadPendingRequests()
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    } finally {
      refreshing.current = false
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
      setVisitorPreferences(data.visitorPreferences ?? defaultVisitorPreferences)
      setHomeAddress(data.homeAddress || '')
      setNotifications(data.notifications || [])
      setTemplates(data.templates || [])
      setVisitSettings(data.visitSettings || { startTime: '10:00', endTime: '17:00' })
      setFamilyInTown(data.familyInTown || { Stu: true, Gabby: true, Spencer: false })
      setFamilyInTownDates(data.familyInTownDates || { Stu: [], Gabby: [], Spencer: [] })
      setCareTeam(Array.isArray(data.careTeam) ? data.careTeam : [])
      setSupportContacts(Array.isArray(data.supportContacts) ? data.supportContacts : [])
      setFoodReservedDates(Array.isArray(data.foodReservedDates) ? data.foodReservedDates : [])
      setCloudError('')
      if (data.organizer) await loadPendingRequests()
    }).catch((error) => {
      if (active) setCloudError(error instanceof Error ? error.message : 'The shared schedule could not be reached.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refreshData() }
    const timer = window.setInterval(refreshVisible, 120000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible) }
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
      setMessage(`${decision === 'approve' ? `The ${isPlan ? 'plan' : 'request'} is approved and confirmed.` : `The ${isPlan ? 'plan' : 'request'} was declined.`}${result.emailSent ? ' The email service accepted the message.' : ' The email is saved for automatic retry. Check Email updates in the family schedule.'}`)
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

  async function saveHomeAddress(address: string) {
    try { const result = await apiRequest({ action: 'saveHomeAddress', address }); setHomeAddress(result.homeAddress); setMessage('The private home address was saved.'); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the private address.'); return false }
  }
  async function saveVisitorPreferences(text: string) {
    try { const result = await apiRequest({ action: 'saveVisitorPreferences', text }); setVisitorPreferences(result.visitorPreferences); setMessage('Visitor preferences were saved.'); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save visitor preferences.'); return false }
  }
  async function savePerson(originals: DriverContact[], contact: DriverContact) {
    try { await apiRequest({ action: 'savePerson', originals, contact }); await refreshData(); await loadPendingRequests(); setMessage('Contact details were updated across the schedule.'); return true }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save this person.'); return false }
  }
  async function saveVisitSettings(settings: VisitSettings) {
    try {
      const result = await apiRequest({ action: 'saveVisitSettings', ...settings })
      setVisitSettings(result.visitSettings)
      setMessage('Care coordination hours were updated.')
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
      if (plan.type === 'food') setFoodConfirmation(plan)
      await refreshData()
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
      if (!organizer) setShowAvailabilityThanks(true)
      const matchingNeeds = teamEvents.filter((event) => !event.helper && !event.requestPending && !isNoSupport(event.helpNeeded) && entries.some((entry) => entry.day === event.date.slice(0, 8) && (event.isFlexible || availabilityMatchesTime(entry.time, event.time, event.endTime))))
      if (matchingNeeds.length) {
        setView('help')
        window.setTimeout(() => document.getElementById('schedule-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      }
      setMessage(matchingNeeds.length ? `Thank you, ${entries[0].name}. We found ${matchingNeeds.length} open ${matchingNeeds.length === 1 ? 'time' : 'times'} that match your availability. Choose one below if it works for you.` : `Thank you, ${entries[0].name}. Your availability was added. The family will email if they schedule specific help; you are not signed up for anything.`)
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
      setAddContact(undefined)
      await refreshData()
      setMessage(`${eventsToSave.length === 1 ? 'The new item was added to the shared schedule.' : `${eventsToSave.length} weekly items were added to the shared schedule.`}${result.driverEmailSent === true ? ' The confirmation was accepted by the email service.' : result.driverEmailSent === false ? ' The assignment was saved; the email is queued for retry. Check Email updates.' : ''}`)
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
      await refreshData()
      await loadPendingRequests()
      setMessage(`The schedule item was updated.${result.driverEmailSent === true ? ' The confirmation was accepted by the email service.' : result.driverEmailSent === false ? ' The assignment was saved; the email is queued for retry. Check Email updates.' : ''}`)
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
      await refreshData()
      setMessage(`${result.member.name} was saved under Nurses & hired help.`)
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
      setMessage('Thank you. Your contact information was added.')
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
      await refreshData()
      await loadPendingRequests()
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
      setMessage(`${decision === 'approve' ? 'Approved. The schedule now shows who is confirmed.' : 'Declined. The time is open again.'}${result.emailSent ? ' The email service accepted the message.' : ' The email is saved for automatic retry. Check Email updates in the family schedule.'}`)
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
    if (event.scheduleSource === 'nurse_coverage') {
      setViewingEvent(event)
    } else if (event.publicAction) {
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
        {teamEvents.filter((event) => event.helpNeeded === 'Group event' && event.date.slice(0, 8) >= localDateInputValue().replaceAll('-', '')).map((event) => <section className="group-event-banner" key={event.id} aria-label="Community group event"><div><p className="eyebrow">Group event · Everyone is welcome</p><h2>{event.title}</h2><p>{event.dayLabel} · {eventTimeRangeLabel(event)}</p>{event.location && <p>{event.location}</p>}<p>Come walk with Mary’s Team. Register on the official ALS team page to join us.</p></div><a className="primary-button" href={alsWalkUrl} target="_blank" rel="noreferrer">Sign up for the ALS walk</a></section>)}
        <section className="welcome" aria-labelledby="page-title">
          <div><p className="eyebrow">Family schedule and support</p><h1 id="page-title">The Greenbergs’ Schedule</h1><p className="intro">See what’s coming up and sign up where support is needed.</p></div>
          <div className="quick-actions" role="group" aria-label="Page actions">
            <button className="support-button" type="button" onClick={showSupportNeeded}><ListChecks aria-hidden="true" /> Help Needed</button>
            <button className="secondary-button" type="button" onClick={() => openPlanRequest('food')}><Utensils aria-hidden="true" /> Bring Food</button><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add your availability</button>
          </div>
        </section>
        <div className="helper-note"><HeartHandshake aria-hidden="true" /><p><strong>New here?</strong> Choose Help Needed or Bring Food. The page will show exactly what is open.</p><button type="button" onClick={() => setShowHelp(true)}>See how it works</button></div>
        {organizer && <OrganizerPanel needs={helpFeedEvents} notifications={notifications} templates={templates} onRefresh={async () => { await refreshData(); await loadPendingRequests() }} homeAddress={homeAddress} onSaveHomeAddress={saveHomeAddress} onAddForPerson={(contact) => { setAddContact(contact); setAddForWho('Family'); setShowAdd(true) }} availability={availability} visitorPreferences={visitorPreferences} onSaveVisitorPreferences={saveVisitorPreferences} onSavePerson={savePerson} requests={pendingRequests} events={teamEvents} displayEvents={publicScheduleEvents} careTeam={careTeam} supportContacts={supportContacts} foodSettings={foodSettings} foodPreferences={foodPreferences} visitSettings={visitSettings} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveCareTeam={saveCareTeamMember} onSaveFoodSettings={saveFoodSettings} onSaveFoodPreferences={saveFoodPreferences} onSaveVisitSettings={saveVisitSettings} onSaveFamilyInTown={saveFamilyInTown} onEditInTownDates={setInTownDatesPerson} onEditBusyDates={setBusyPerson} onAddSchedule={(forWho) => { setAddForWho(forWho); setShowAdd(true) }} onEditEvent={(event) => { if (event.publicAction) openPlanRequest(event.publicAction, event); else if (event.isCalculatedCoverage) setAssigningEvent(event); else setEditingEvent(event) }} onDecide={decideRequest} onLogout={organizerLogout} />}
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
              return <article className={`event-card viewable ${event.category} ${helper || event.requestPending ? 'has-response' : ''}`} id={`event-${event.id}`} key={event.id} onClick={() => event.publicAction ? openPlanRequest(event.publicAction, event) : setViewingEvent(event)}>
                <div className="event-date"><p>{event.dayLabel}</p><strong><Clock3 aria-hidden="true" /> {eventTimeRangeLabel(event)}</strong>{(event.repeatGroupId || event.scheduleSource === 'stu_work') && <small className="repeat-label"><Repeat2 aria-hidden="true" /> {event.scheduleSource === 'stu_work' ? event.isScheduleException ? 'Different from weekly hours' : 'Weekly work hours' : 'Repeats weekly'}</small>}</div>
                <div className="event-info"><h3>{eventDisplayTitle(event)}</h3><p>{eventDisplayDetails(event)}</p>{shouldShowEventLocation(event) && <p className="location">{event.location}</p>}<span className="card-details-hint">Tap to see details</span>{event.proposalType ? <div className="needed planned-needed">{event.proposalType === 'food' ? <Utensils aria-hidden="true" /> : <Users aria-hidden="true" />}<span><small>Planned</small><strong>{event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by'}</strong></span></div> : <div className={`needed ${isNoSupport(event.helpNeeded) ? 'busy-needed' : ''}`}>{event.publicAction === 'food' ? <Utensils aria-hidden="true" /> : <ListChecks aria-hidden="true" />}<span><small>{isNoSupport(event.helpNeeded) ? 'No visitors' : 'Support requested'}</small><strong>{isNoSupport(event.helpNeeded) ? 'Please do not stop by during this time.' : event.helpNeeded}</strong></span></div>}{!helper && !event.requestPending && suggestedHelpers.length > 0 && !isNoSupport(event.helpNeeded) && <div className="suggested-help"><HeartHandshake aria-hidden="true" /><span><small>{event.isFlexible ? 'People who may be available' : 'People available then'}</small><strong>{suggestedHelpers.map((entry) => entry.name).join(', ')}</strong><em>{event.isFlexible ? 'They may be able to fit this task into their availability.' : 'They can choose this time if it works for them.'}</em></span></div>}</div>
                <div className="event-actions">
                  {event.proposalType && helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.proposalType && event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Request submitted</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Waiting for confirmation'}</strong></span></div> : isNoSupport(event.helpNeeded) ? <div className="busy-status"><Clock3 aria-hidden="true" /><span><small>Status</small><strong>Busy</strong></span></div> : helper ? <div className="claimed"><Check aria-hidden="true" /><span><small>Confirmed</small><strong>{helper}</strong></span></div> : event.requestPending ? <div className="requested"><Clock3 aria-hidden="true" /><span><small>Request submitted</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Waiting for confirmation'}</strong></span></div> : <button className="primary-button" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); if (event.publicAction) openPlanRequest(event.publicAction, event); else setSignupEvent(event) }}><HeartHandshake aria-hidden="true" /> {event.publicAction === 'food' ? 'Choose a drop-off time' : 'Sign up to help'}</button>}
                  <button className="edit-event-link" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setViewingEvent(event) }}><Pencil aria-hidden="true" /> {organizer ? 'View or edit details' : 'View details'}</button>
                </div>
              </article>
            }) : <EmptySchedule onAdd={() => organizer ? (setAddForWho('Mary'), setShowAdd(true)) : setShowOrganizerLogin(true)} onJoin={() => setShowSupportContact(true)} onAlreadySignedUp={() => setView('month')} supportOnly />}
          </div> : view === 'upcoming' ? <div className="upcoming-calendar-wrap"><UpcomingDaysList events={publicScheduleEvents} daysToShow={10} onOpen={openScheduleEvent} /></div> : <MonthCalendar events={publicScheduleEvents} onOpen={openScheduleEvent} />)}
        </section>
        {(organizer || availability.some((entry) => entry.editable)) && <section className="availability-section" aria-labelledby="availability-title">
          <div className="section-heading compact"><div><p className="eyebrow">Friends and family</p><h2 id="availability-title">{organizer ? 'Availability offers' : 'Your availability offers'}</h2></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}><Clock3 aria-hidden="true" /> Add your availability</button></div>
          <div className="availability-view-heading"><div className="view-toggle" role="group" aria-label="Choose availability view"><button aria-pressed={availabilityView === 'upcoming'} className={availabilityView === 'upcoming' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('upcoming')}><ListChecks aria-hidden="true" /> Upcoming</button><button aria-pressed={availabilityView === 'month'} className={availabilityView === 'month' ? 'active' : ''} type="button" onClick={() => setAvailabilityView('month')}><CalendarDays aria-hidden="true" /> This Month</button></div><p>{availabilityView === 'upcoming' ? 'The next 7 days' : 'The next 30 days'}</p></div>
          {!loading && <div className="availability-list">{visibleAvailability.length ? visibleAvailability.map((entry) => <article className={entry.editable ? 'editable' : ''} key={entry.id} onClick={() => entry.editable && setEditingAvailability(entry)}><div className="availability-date"><span>{availabilityDayLabel(entry.day).split(',')[0]}</span><strong>{availabilityDayLabel(entry.day).split(',').slice(1).join(',').trim()}</strong></div><div className="person-icon"><Users aria-hidden="true" /></div><div className="availability-person"><h3>{entry.name}</h3><p className={`availability-time ${entry.time === 'anytime' ? 'all-day' : ''}`}>{availabilityTimeLabel(entry.time)}</p><p className="availability-help">{entry.note}</p>{entry.phone && <a className="availability-phone" href={`tel:${entry.phone}`} onClick={(clickEvent) => clickEvent.stopPropagation()}><span>Call or text</span> {entry.phone}</a>}</div>{entry.editable && <button className="tap-edit" type="button" onClick={(clickEvent) => { clickEvent.stopPropagation(); setEditingAvailability(entry) }} aria-label={`Edit ${entry.name}’s availability for ${availabilityDayLabel(entry.day)}`}><Pencil aria-hidden="true" /> Edit</button>}</article>) : <div className="empty-availability"><Users aria-hidden="true" /><div><h3>No availability in {availabilityView === 'upcoming' ? 'the next 7 days' : 'the next 30 days'}</h3><p>Share times when the family may call if something comes up. This does not sign anyone up automatically.</p></div><button className="secondary-button" type="button" onClick={() => setShowAvailability(true)}>Add your availability</button></div>}</div>}
        </section>}
      </main>
      <footer><HeartHandshake aria-hidden="true" /><p><strong>Thank you for being part of Mary’s Team.</strong><br />Please coordinate support through this website and your confirmation email.</p></footer>
      {message && <div className="toast" role="status"><Check aria-hidden="true" /> {message}</div>}
      {signupEvent && <SignupModal visitorPreferences={visitorPreferences} event={signupEvent} onClose={() => setSignupEvent(null)} onSave={saveHelper} />}
      {viewingEvent && <EventDetailsModal onSignUp={() => { setViewingEvent(null); if (viewingEvent.publicAction) openPlanRequest(viewingEvent.publicAction, viewingEvent); else setSignupEvent(viewingEvent) }} event={viewingEvent} organizer={organizer} availability={matchingAvailability(viewingEvent, availability)} onClose={() => setViewingEvent(null)} onEdit={() => { setViewingEvent(null); setEditingEvent(viewingEvent) }} onAssign={() => { setViewingEvent(null); setAssigningEvent(viewingEvent) }} />}
      {assigningEvent && <AssignCoverageModal event={assigningEvent} contacts={knownContacts(teamEvents, availability, [...careTeam.map((member) => ({ personId: member.personId, name: member.name, phone: member.phone, email: member.email })), ...supportContacts.map((contact) => ({ personId: contact.personId, name: contact.name, phone: contact.phone, email: contact.email }))])} onClose={() => setAssigningEvent(null)} onAssign={(contact) => assignCalculatedCoverage(assigningEvent, contact)} />}
      {editingEvent && <EditEventModal event={editingEvent} availability={availability} events={teamEvents} savedContacts={[...careTeam, ...supportContacts]} onClose={() => setEditingEvent(null)} onSave={updateEvent} onRemove={removeEvent} />}
      {showAvailability && <AvailabilityModal visitorPreferences={visitorPreferences} onClose={() => setShowAvailability(false)} onSave={saveAvailability} />}
      {showPlanRequest === 'food' ? <FoodSignupModal initialWindow={planRequestWindow} visitorPreferences={visitorPreferences} events={teamEvents} foodSettings={foodSettings} foodPreferences={foodPreferences} foodReservedDates={foodReservedDates} onClose={() => { setShowPlanRequest(null); setPlanRequestWindow(null) }} onSave={saveProposedPlan} /> : showPlanRequest && <PlanRequestModal visitorPreferences={visitorPreferences} type={showPlanRequest} initialWindow={planRequestWindow} events={teamEvents} foodSettings={foodSettings} foodPreferences={foodPreferences} visitSettings={visitSettings} foodReservedDates={foodReservedDates} onClose={() => { setShowPlanRequest(null); setPlanRequestWindow(null) }} onSave={saveProposedPlan} />}
      {editingAvailability && <EditAvailabilityModal entries={availability.filter((entry) => samePerson({ ...editingAvailability, email: editingAvailability.email || '' }, { ...entry, email: entry.email || '' }) && allAvailabilityDates.has(entry.day))} initialEntry={editingAvailability} onClose={() => setEditingAvailability(null)} onSave={updateAvailabilities} onRemove={removeAvailabilities} />}
      {showAdd && <AddEventModal initialContact={addContact} initialForWho={addForWho} availability={availability} events={teamEvents} savedContacts={[...careTeam, ...supportContacts]} onClose={() => { setShowAdd(false); setAddContact(undefined) }} onSave={saveEvents} />}
      {busyPerson && <FamilyBusyDatesModal person={busyPerson} events={teamEvents} onClose={() => setBusyPerson(null)} onSave={(dates, startTime, endTime) => saveFamilyBusyDates(busyPerson, dates, startTime, endTime)} />}
      {inTownDatesPerson && <FamilyInTownDatesModal person={inTownDatesPerson} selectedDates={familyInTownDates[inTownDatesPerson]} onClose={() => setInTownDatesPerson(null)} onSave={(dates) => saveFamilyInTownDates(inTownDatesPerson, dates)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showSupportContact && <SupportContactModal visitorPreferences={visitorPreferences} onClose={() => setShowSupportContact(false)} onSave={saveSupportContact} />}
      {foodConfirmation && <ModalShell title="Your food drop-off request is submitted" onClose={() => setFoodConfirmation(null)}><p>Thank you, {foodConfirmation.name}. You requested {dayLabelForDate(foodConfirmation.date)} at {eventTimeLabel(foodConfirmation.time)}.</p><p><strong>Please wait for confirmation before coming.</strong> We’ll email {foodConfirmation.email} after the family reviews your request, with the address and drop-off instructions. There is no need to text for confirmation or an address.</p><p>Food drop-offs do not include a visit. Please respect any changes or cancellations.</p><button className="primary-button" type="button" onClick={() => setFoodConfirmation(null)}>Done</button></ModalShell>}
      {showAvailabilityThanks && <AvailabilityThanksModal onClose={() => setShowAvailabilityThanks(false)} />}
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
            <em>{event.scheduleSource === 'nurse_coverage' ? 'Nurse with Mary · No visitors' : event.helpNeeded === 'Group event' ? 'Group event · Everyone is welcome' : event.publicAction === 'stop_by' ? 'Choose a time to stop by' : event.proposalType ? event.proposalType === 'food' ? event.helper ? `Food from ${event.helper}` : event.requesterName ? `Food requested by ${event.requesterName}` : 'Food drop-off requested' : event.helper ? `Stopping by: ${event.helper}` : event.requesterName ? `Stop by requested by ${event.requesterName}` : 'Stop-by request submitted' : isNoSupport(event.helpNeeded) ? (event.forWho === 'Mary' ? 'Mary is too sick to see anyone' : 'Busy') : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted' : event.helpNeeded}</em>
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
      isPast: date.getTime() < today.getTime(),
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
        return <button className={`month-cell ${day.inMonth ? '' : 'outside-month'} ${day.isToday ? 'today' : ''} ${day.isPast ? 'past-day' : ''} ${day.events.length ? 'has-events' : ''}`} type="button" key={day.dateKey} onClick={() => day.events.length && setSelectedDateKey(day.dateKey)} disabled={!day.events.length} aria-label={`${label}${day.events.length ? `, ${day.events.length} schedule ${day.events.length === 1 ? 'item' : 'items'}` : ', not available'}`}>
          <span className="month-number">{day.date.getDate()}</span>
          <span className="month-statuses">{openHelp && <span className="month-status help">Help Needed</span>}{busyCount > 0 && <span className="month-status appointment">{busyCount} {busyCount === 1 ? 'Appointment' : 'Appointments'}</span>}{foodCovered && <span className="month-status food">Food Covered</span>}{!day.events.length && <span className="month-status appointment">Not available</span>}</span>
        </button>
      })}</div>
    </div>
    {selectedDay && <ModalShell title={selectedDay.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} onClose={() => setSelectedDateKey('')}>
      <div className="day-event-list">{selectedDay.events.map((event) => <button type="button" key={event.id} onClick={() => { setSelectedDateKey(''); onOpen(event) }}><span className={`calendar-dot ${event.category}`} aria-hidden="true" /><span><strong>{eventDisplayTitle(event)}</strong><small>{eventTimeRangeLabel(event)}</small><em>{event.scheduleSource === 'nurse_coverage' ? 'Nurse with Mary · No visitors' : event.helpNeeded === 'Group event' ? 'Group event · Everyone is welcome' : event.publicAction === 'stop_by' ? 'Choose a time to stop by' : isNoSupport(event.helpNeeded) ? (event.forWho === 'Mary' ? 'Mary is too sick to see anyone' : 'Busy') : event.helper ? `Confirmed with ${event.helper}` : event.requestPending ? event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted' : event.helpNeeded}</em></span><ChevronRight aria-hidden="true" /></button>)}</div>
    </ModalShell>}
  </>
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLElement | null>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = dialog.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab' || !panel) return
      const elements = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0)
      const first = elements[0], last = elements.at(-1)
      if (!first) { event.preventDefault(); panel.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { window.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section ref={dialog} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="close-button" type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button><h2 id="modal-title">{title}</h2>{children}</section></div>
}

function SupportContactModal({ visitorPreferences, onClose, onSave }: { visitorPreferences: string; onClose: () => void; onSave: (contact: Omit<SupportContact, 'id'>) => Promise<boolean> }) {
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
    <VisitorNotice text={visitorPreferences} /><form onSubmit={submit}>
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

function AvailabilityThanksModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="Thank you for sharing your availability" onClose={onClose}>
    <p className="modal-intro">Your availability has been saved. This is an offer, not a confirmed commitment. The family will email you if they schedule specific help.</p>
    <p>Please join us at the ALS walk.</p>
    <a className="primary-button full-button" href={alsWalkUrl} target="_blank" rel="noreferrer">Join us at the ALS walk</a>
    <p className="form-note">Also, feel free to share <a href="https://www.gofundme.com/f/support-mary-greenberg" target="_blank" rel="noreferrer">this link</a>.</p>
    <button className="text-button full-button" type="button" onClick={onClose}>Done</button>
  </ModalShell>
}

function EventDetailsModal({ onSignUp, event, organizer, availability, onClose, onEdit, onAssign }: { onSignUp: () => void; event: TeamEvent; organizer: boolean; availability: Availability[]; onClose: () => void; onEdit: () => void; onAssign: () => void }) {
  return <ModalShell title={eventDisplayTitle(event)} onClose={onClose}>
    <div className="event-detail-summary">
      <div><small>When</small><strong>{event.dayLabel}<br />{eventTimeRangeLabel(event)}</strong></div>
      <div><small>{event.helpNeeded === 'Group event' ? 'Open to everyone' : event.proposalType ? 'Plan' : isNoSupport(event.helpNeeded) ? 'Status' : 'Support requested'}</small><strong>{event.helpNeeded === 'Group event' ? 'Join Mary’s Team at the ALS walk' : event.proposalType ? event.proposalType === 'food' ? 'Food drop-off' : 'Stopping by' : isNoSupport(event.helpNeeded) ? (event.forWho === 'Mary' ? 'Mary is too sick to see anyone' : 'Please do not stop by') : event.helpNeeded}</strong></div>
      {shouldShowEventLocation(event) && <div><small>Where</small><strong>{event.location}</strong></div>}
      <div><small>Details</small><p>{eventDisplayDetails(event)}</p></div>
      {event.helper && <div><small>Confirmed</small><strong>{event.helper}</strong>{(event.helperEmail || event.helperPhone) && <span className="compact-contact">{event.helperEmail && <a href={`mailto:${event.helperEmail}`}>{event.helperEmail}</a>}{event.helperPhone && <a href={`tel:${event.helperPhone}`}>{event.helperPhone}</a>}</span>}</div>}
      {!event.helper && event.requestPending && <div><small>Status</small><strong>{event.requesterName ? `Requested by ${event.requesterName}` : 'Request submitted'}</strong></div>}
      {organizer && !event.helper && availability.length > 0 && <div><small>People who may be available</small><div className="compact-contact-list">{availability.slice(0, 8).map((entry) => <span key={entry.id}><strong>{entry.name}</strong><small>{event.isFlexible ? `${availabilityDayLabel(entry.day)}, ${availabilityTimeLabel(entry.time)}` : availabilityTimeLabel(entry.time)}</small><a href={`sms:${entry.phone}`}>Text {entry.phone}</a></span>)}</div></div>}
    </div>
    {event.isCalculatedCoverage && organizer && <p className="form-note">This time is calculated from the family schedules. Edit the individual family members’ work or away entries to change it.</p>}
    {!isNoSupport(event.helpNeeded) && !event.helper && !event.requestPending && !organizer && <button className="primary-button full-button" type="button" onClick={onSignUp}>{event.publicAction === 'food' ? 'Choose this food drop-off date' : 'Sign up for this practical task'}</button>}
    {event.helpNeeded === 'Group event' && <><p className="form-note">Everyone is welcome. Sign up on the official ALS team page to let the team know you are going.</p><a className="primary-button full-button" href={alsWalkUrl} target="_blank" rel="noreferrer">Join the ALS walk</a></>}
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Close</button>{organizer && event.isCalculatedCoverage && !event.helper && <button className="primary-button" type="button" onClick={onAssign}><Users aria-hidden="true" /> Assign someone</button>}{organizer && !event.isCalculatedCoverage && event.scheduleSource !== 'nurse_coverage' && <button className="primary-button" type="button" onClick={onEdit}><Pencil aria-hidden="true" /> Edit</button>}</div>
  </ModalShell>
}

function AssignCoverageModal({ event, contacts, onClose, onAssign }: { event: TeamEvent; contacts: DriverContact[]; onClose: () => void; onAssign: (contact: DriverContact) => void }) {
  const [selected, setSelected] = useState('')
  const [newContact, setNewContact] = useState<DriverContact>({ name: '', phone: '', email: '' })
  const contact = selected === 'new' ? newContact : contacts.find((item) => item.name === selected)
  return <ModalShell title="Assign someone" onClose={onClose}><p className="modal-intro">Choose a saved person or add someone new for {event.dayLabel}, {eventTimeRangeLabel(event)}.</p><form onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (contact?.name.trim()) onAssign({ ...contact, name: contact.name.trim(), phone: contact.phone.trim(), email: contact.email.trim() }) }}><label htmlFor="coverage-helper">Who will be with Mary?</label><select id="coverage-helper" value={selected} onChange={(changeEvent) => setSelected(changeEvent.target.value)} required autoFocus><option value="">Choose a person</option>{contacts.map((item) => <option key={`${item.name}-${item.phone}`} value={item.name}>{item.name}</option>)}<option value="new">Someone new</option></select>{selected === 'new' && <><label htmlFor="new-helper-name">Name</label><input id="new-helper-name" value={newContact.name} onChange={(changeEvent) => setNewContact({ ...newContact, name: changeEvent.target.value })} required autoFocus /><div className="field-row"><div><label htmlFor="new-helper-phone">Phone <span>(optional)</span></label><input id="new-helper-phone" type="tel" value={newContact.phone} onChange={(changeEvent) => setNewContact({ ...newContact, phone: changeEvent.target.value })} autoComplete="tel" /></div><div><label htmlFor="new-helper-email">Email <span>(optional)</span></label><input id="new-helper-email" type="email" value={newContact.email} onChange={(changeEvent) => setNewContact({ ...newContact, email: changeEvent.target.value })} autoComplete="email" /></div></div></>}<div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!contact?.name.trim()}><Check aria-hidden="true" /> Add to this time</button></div></form></ModalShell>
}
function VisitorNotice({ text }: { text: string }) {
  return <aside className="visitor-notice" aria-label="Before you sign up"><h3>Before you sign up</h3><p>{signupVisitorPreferences(text)}</p></aside>
}

function PrivateAddressEditor({ address, onSave }: { address: string; onSave: (address: string) => Promise<boolean> }) {
  const [value, setValue] = useState(address)
  const [saving, setSaving] = useState(false)
  return <form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(value.trim()); setSaving(false) }}><h3>Private home address</h3><p>Visible only in this family area. The address is included in confirmation emails, never on the public schedule.</p><label htmlFor="private-home-address">Home address and drop-off instructions</label><textarea id="private-home-address" value={value} onChange={(event) => setValue(event.target.value)} required rows={3} /><button className="primary-button" type="submit" disabled={saving || !value.trim()}>{saving ? 'Saving…' : 'Save private address'}</button></form>
}

function VisitorPreferencesEditor({ text, onSave }: { text: string; onSave: (text: string) => Promise<boolean> }) {
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  return <form className="simple-settings visitor-preferences-editor" onSubmit={async (event) => { event.preventDefault(); setSaving(true); await onSave(value.trim()); setSaving(false) }}><h3>Sign-up message</h3><p>This message appears inside help and food sign-up forms. Do not include the private home address.</p><label htmlFor="visitor-preferences">Message people read before signing up</label><textarea id="visitor-preferences" value={value} maxLength={4000} onChange={(event) => setValue(event.target.value)} required rows={8} /><button className="primary-button" disabled={saving || !value.trim()} type="submit">{saving ? 'Saving…' : 'Save sign-up message'}</button></form>
}

function PersonModal({ person, sources, events, requests, member, availability, onClose, onSave, onEditEvent, onAdd, onEditMember, onReviewRequests, onDecide }: { person: DriverContact; sources: DriverContact[]; events: TeamEvent[]; requests: PendingRequest[]; member?: CareTeamMember; availability: Availability[]; onClose: () => void; onSave: (originals: DriverContact[], contact: DriverContact) => Promise<boolean>; onEditEvent: (event: TeamEvent) => void; onAdd: () => void; onEditMember: (member: CareTeamMember) => void; onReviewRequests: () => void; onDecide: (id: string, decision: 'approve' | 'decline', reason?: string) => void }) {
  const [form, setForm] = useState(person)
  const [saving, setSaving] = useState(false)
  const [assignment, setAssignment] = useState('')
  const [error, setError] = useState('')
  const matches = (contact: DriverContact) => samePerson(person, contact)
  const commitments = events.filter((event) => event.date.slice(0, 8) >= localDateInputValue().replaceAll('-', '') && matches({ personId: event.helperPersonId, name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' }))
  const personalSchedule = events.filter((event) => (person.familyKey ? event.forWho === person.familyKey : samePerson(person, { name: event.forWho, phone: '', email: '' })) && event.date.slice(0, 8) >= localDateInputValue().replaceAll('-', '')).sort((a, b) => a.date.localeCompare(b.date))
  const pending = requests.filter((request) => matches({ personId: request.personId, name: request.requesterName, phone: request.requesterPhone, email: request.requesterEmail }))
  const open = events.filter((event) => !isNoSupport(event.helpNeeded) && !event.helper && !event.requestPending && !event.proposalType && event.scheduleSource !== 'nurse_coverage' && event.date.slice(0, 8) >= localDateInputValue().replaceAll('-', ''))
  const available = availability.filter((entry) => matches({ ...entry, email: entry.email || '' }))
  return <ModalShell title={person.name || 'Add contact'} onClose={onClose}><form onSubmit={async (event) => { event.preventDefault(); setSaving(true); const saved = await onSave(sources.filter(matches), { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() }); setSaving(false); if (saved) onClose(); else setError('Could not save. Please try again.') }}><label htmlFor="person-name">Name</label><input id="person-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><div className="field-row"><div><label htmlFor="person-phone">Phone (optional)</label><input id="person-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div><label htmlFor="person-email">Email (optional)</label><input id="person-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div><p className="form-note">Saving updates this person’s contact details across their saved entries and sign-ups.</p>{error && <p role="alert">{error}</p>}<button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save contact details'}</button></form>
    {member && <div className="person-section"><p><strong>{member.role}</strong> · {member.weekdays.map((day) => weekdayChoices.find((choice) => choice.value === day)?.short).join(', ')} · {eventTimeLabel(member.startTime)}–{eventTimeLabel(member.endTime)}</p><button type="button" className="secondary-button" onClick={() => onEditMember(member)}>Edit role &amp; regular hours</button></div>}
    {person.name && <><div className="person-section"><h3>Assign to a task</h3><label htmlFor="person-assignment">Open tasks</label><select id="person-assignment" value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="">Choose an open task</option>{open.map((event) => <option value={event.id} key={`${event.id}-${event.time}`}>{event.title} · {event.dayLabel} · {eventTimeRangeLabel(event)}</option>)}</select><div className="form-actions"><button type="button" className="secondary-button" onClick={onAdd}>Add a new event for {person.name.split(' ')[0]}</button><button className="primary-button" type="button" disabled={!assignment} onClick={() => { const event = open.find((item) => item.id === assignment); if (event) onEditEvent({ ...event, helper: person.name, helperPhone: person.phone, helperEmail: person.email, helperPersonId: person.personId }) }}>Review assignment</button></div></div>
    <div className="person-section"><h3>Helping with</h3><div className="family-schedule-list">{commitments.map((event) => event.scheduleSource === 'nurse_coverage' ? <p key={event.id}>Nurse with Mary · {event.dayLabel} · {eventTimeRangeLabel(event)}</p> : <button type="button" key={event.id} onClick={() => onEditEvent(event)}><span><strong>{event.title}</strong><small>{event.dayLabel} · {eventTimeRangeLabel(event)}</small></span><span>Edit time or remove</span></button>)}{!commitments.length && <p>No confirmed commitments.</p>}</div></div>
    {personalSchedule.length > 0 && <div className="person-section"><h3>Personal schedule</h3><p>Appointments and time away for this family member.</p><div className="family-schedule-list">{personalSchedule.map((event) => event.scheduleSource === 'nurse_coverage' ? <p key={event.id}>{event.title} · {event.dayLabel} · {eventTimeRangeLabel(event)}</p> : <button type="button" key={event.id} onClick={() => onEditEvent(event)}><span><strong>{event.title}</strong><small>{event.dayLabel} · {eventTimeRangeLabel(event)}</small></span><span>Edit appointment</span></button>)}</div></div>}
    {pending.length > 0 && <div className="person-section"><h3>Pending sign-ups</h3>{pending.map((request) => <div className="pending-person-request" key={request.id}><strong>{request.title}</strong><p>{request.dayLabel} · {eventTimeLabel(request.requestStartTime || request.time)}–{eventTimeLabel(request.requestEndTime || request.endTime)}</p><p>{request.requestNote || request.details}</p><button type="button" className="secondary-button" onClick={() => { onDecide(request.id, 'approve'); onClose() }}>Approve</button><button type="button" className="text-button" onClick={onReviewRequests}>Review in Requests</button></div>)}</div>}
    {available.length > 0 && <div className="person-section"><h3>Shared availability</h3>{available.map((entry) => <p key={entry.id}>{availabilityDayLabel(entry.day)} · {availabilityTimeLabel(entry.time)}</p>)}</div>}</>}
  </ModalShell>
}

function OrganizerPanel({ notifications, onRefresh, homeAddress, onSaveHomeAddress, availability, visitorPreferences, onSaveVisitorPreferences, onSavePerson, onAddForPerson, requests, events, careTeam, supportContacts, foodSettings, foodPreferences, visitSettings, familyInTown, familyInTownDates, onSaveCareTeam, onSaveFoodSettings, onSaveFoodPreferences, onSaveVisitSettings, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAddSchedule, onEditEvent, onDecide, onLogout }: { needs: TeamEvent[]; notifications: EmailNotice[]; templates: WeekTemplate[]; onRefresh: () => Promise<void>; homeAddress: string; onSaveHomeAddress: (address: string) => Promise<boolean>; availability: Availability[]; visitorPreferences: string; onSaveVisitorPreferences: (text: string) => Promise<boolean>; onSavePerson: (originals: DriverContact[], contact: DriverContact) => Promise<boolean>; onAddForPerson: (contact: DriverContact) => void; requests: PendingRequest[]; events: TeamEvent[]; displayEvents: TeamEvent[]; careTeam: CareTeamMember[]; supportContacts: SupportContact[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; visitSettings: VisitSettings; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveCareTeam: (member: CareTeamMember) => Promise<boolean>; onSaveFoodSettings: (settings: FoodSettings) => Promise<boolean>; onSaveFoodPreferences: (preferences: FoodPreferences) => Promise<boolean>; onSaveVisitSettings: (settings: VisitSettings) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAddSchedule: (forWho: ForWho) => void; onEditEvent: (event: TeamEvent) => void; onDecide: (id: string, decision: 'approve' | 'decline', declineReason?: string) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<'people' | 'preferences'>('preferences')
  const [declining, setDeclining] = useState<PendingRequest | null>(null)
  const [editingMember, setEditingMember] = useState<CareTeamMember | null>(null)
  const [selectedPerson, setSelectedPerson] = useState<DriverContact | null>(null)
  const sources = [...careTeam, ...supportContacts, ...events.filter((event) => event.helper && event.scheduleSource !== 'nurse_coverage').map((event) => ({ personId: event.helperPersonId, name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' })), ...availability.map((entry) => ({ ...entry, email: entry.email || '' })), ...requests.map((request) => ({ personId: request.personId, name: request.requesterName, phone: request.requesterPhone, email: request.requesterEmail }))]
  const people = mergeContacts(sources)
  const volunteerPeople = people.filter((person) => !person.familyKey && !careTeam.some((member) => samePerson(person, member)))
  const matchesEvent = (person: DriverContact, event: TeamEvent) => samePerson(person, { personId: event.helperPersonId, name: event.helper || '', phone: event.helperPhone || '', email: event.helperEmail || '' })
  return <section className="organizer-panel" id="organizer-panel" aria-labelledby="organizer-title">
    <div className="organizer-heading"><div><p className="eyebrow">Private family area</p><h2 id="organizer-title">Edit &amp; Approve</h2></div><button className="text-button" type="button" onClick={onLogout}>Close private access</button></div>
    <div className="organizer-tabs" role="tablist" aria-label="Choose private family area">
      <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'active' : ''} type="button" onClick={() => setTab('people')}><Users aria-hidden="true" /> Friends</button>
      <button role="tab" aria-selected={tab === 'preferences'} className={tab === 'preferences' ? 'active' : ''} type="button" onClick={() => setTab('preferences')}>Family &amp; Home</button>
    </div>
    {tab === 'people' && <div className="family-schedule-actions"><button className="primary-button" type="button" onClick={() => setSelectedPerson({ name: '', phone: '', email: '' })}>+ Add volunteer</button></div>}
    {requests.length > 0 && <section className="people-summary" id="approval-inbox"><div className="people-summary-heading"><div><h3>Needs approval</h3><p>Approve or decline each request here. There is no separate request area to manage.</p></div><strong>{requests.length} waiting</strong></div><div className="organizer-requests">{requests.map((request) => <article key={request.id}><div><strong>{request.requesterName}</strong><span className="compact-contact"><a href={`tel:${request.requesterPhone}`}>{request.requesterPhone}</a>{request.requesterEmail && <a href={`mailto:${request.requesterEmail}`}>{request.requesterEmail}</a>}</span><p>{request.proposalType === 'food' ? 'Food drop-off' : request.proposalType === 'stop_by' ? 'Stop by' : request.title}</p><small>{request.isFlexible ? 'Anytime' : `${request.dayLabel}, ${eventTimeLabel(request.requestStartTime || request.time)} – ${eventTimeLabel(request.requestEndTime || request.endTime)}`}{request.proposalType ? request.details ? ` · ${request.details}` : ` · ${request.requestNote || ''}` : ` · ${request.helpNeeded}${request.requestNote ? ` · “${request.requestNote}”` : ''}`}</small></div><div><button className="text-button" type="button" onClick={() => setDeclining(request)}>Decline</button><button className="primary-button" type="button" onClick={() => onDecide(request.id, 'approve')}><Check aria-hidden="true" /> Approve</button></div></article>)}</div></section>}
    {tab === 'people' ? <div className="people-summary"><p className="organizer-intro">Friends and volunteers are saved here. Nurses, hired help, and family members are managed in Home Settings.</p>{volunteerPeople.map((person) => {
      const commitments = events.filter((event) => event.scheduleSource !== 'nurse_coverage' && matchesEvent(person, event))
      const waiting = requests.filter((request) => samePerson(person, { personId: request.personId, name: request.requesterName, phone: request.requesterPhone, email: request.requesterEmail }))
      return <section key={`${person.name}-${person.email}-${person.phone}`}><button className="person-select" type="button" onClick={() => setSelectedPerson(person)}><span><strong>{person.name}</strong><small>Volunteer</small><small>{commitments.length} commitments{waiting.length ? ` · ${waiting.length} pending` : ''}</small></span><span>View &amp; edit <ChevronRight aria-hidden="true" /></span></button></section>
    })}{!volunteerPeople.length && <p>No saved friends or volunteers yet.</p>}</div> : <FamilyPreferences foodSettings={foodSettings} foodPreferences={foodPreferences} familyInTown={familyInTown} familyInTownDates={familyInTownDates} onSaveFood={onSaveFoodSettings} onSaveFoodPreferences={onSaveFoodPreferences} onSaveFamilyInTown={onSaveFamilyInTown} onEditInTownDates={onEditInTownDates} onEditBusyDates={onEditBusyDates} onAddSchedule={onAddSchedule} />}
    {tab === 'preferences' && <><EmailStatus notices={notifications} request={apiRequest} onRefresh={onRefresh} /><section className="people-summary"><div className="people-summary-heading"><div><h3>Nurses &amp; hired help</h3><p>Paid or scheduled caregivers belong here, separate from volunteer friends.</p></div><button className="primary-button" type="button" onClick={() => setEditingMember({ id: crypto.randomUUID(), name: '', phone: '', email: '', role: 'Helper', weekdays: [1], startTime: '09:00', endTime: '17:00', autoAssign: false })}><Users aria-hidden="true" /> Add nurse or hired help</button></div>{careTeam.length ? careTeam.map((member) => <section key={member.id}><button className="person-select" type="button" onClick={() => setEditingMember(member)}><span><strong>{member.name}</strong><small>{member.role === 'Helper' ? 'Hired help' : member.role}</small><small>{member.weekdays.map((day) => weekdayChoices.find((choice) => choice.value === day)?.short).filter(Boolean).join(', ')} · {eventTimeLabel(member.startTime)} – {eventTimeLabel(member.endTime)}</small></span><span>Edit <ChevronRight aria-hidden="true" /></span></button></section>) : <p>No nurses or hired help have been added.</p>}</section><PrivateAddressEditor address={homeAddress} onSave={onSaveHomeAddress} /><VisitorPreferencesEditor text={visitorPreferences} onSave={onSaveVisitorPreferences} /></>}
    {selectedPerson && <PersonModal person={selectedPerson} sources={sources} events={events} requests={requests} member={careTeam.find((item) => samePerson(selectedPerson, item))} availability={availability} onClose={() => setSelectedPerson(null)} onSave={onSavePerson} onEditEvent={(event) => { setSelectedPerson(null); onEditEvent(event) }} onAdd={() => { setSelectedPerson(null); onAddForPerson(selectedPerson) }} onEditMember={(member) => { setSelectedPerson(null); setEditingMember(member) }} onReviewRequests={() => { setSelectedPerson(null); document.getElementById('approval-inbox')?.scrollIntoView({ behavior: 'smooth' }) }} onDecide={onDecide} />}
    {declining && <DeclineRequestModal name={declining.requesterName} onClose={() => setDeclining(null)} onDecline={(reason) => { onDecide(declining.id, 'decline', reason); setDeclining(null) }} />}
    {editingMember && <CareTeamMemberModal member={editingMember} onClose={() => setEditingMember(null)} onSave={async (member) => { if (await onSavePerson([editingMember], member) && await onSaveCareTeam(member)) setEditingMember(null) }} />}
  </section>
}

function CareTeamMemberModal({ member, onClose, onSave }: { member: CareTeamMember; onClose: () => void; onSave: (member: CareTeamMember) => void }) {
  const [form, setForm] = useState(member)
  const valid = form.name.trim() && form.weekdays.length > 0 && form.endTime > form.startTime
  return <ModalShell title="Nurse or hired help" onClose={onClose}><p className="modal-intro">Add their regular hours. Automatic assignment never applies to rides.</p><form onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ ...form, name: form.name.trim() }) }}><label htmlFor="care-name">Name</label><input id="care-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus /><label htmlFor="care-role">Role</label><select id="care-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as CareTeamMember['role'] })}><option value="Nurse">Nurse</option><option value="Helper">Hired help</option></select><div className="field-row"><div><label htmlFor="care-phone">Phone <span>(optional)</span></label><input id="care-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div><div><label htmlFor="care-email">Email <span>(optional)</span></label><input id="care-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></div><fieldset className="weekday-picker"><legend>Regular days</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={form.weekdays.includes(day.value)} onChange={() => setForm({ ...form, weekdays: form.weekdays.includes(day.value) ? form.weekdays.filter((value) => value !== day.value) : [...form.weekdays, day.value].sort() })} /><span>{day.short}</span></label>)}</fieldset><div className="field-row"><div><label htmlFor="care-start">Starts</label><input id="care-start" type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required /></div><div><label htmlFor="care-end">Ends</label><input id="care-end" type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required /></div></div><label className="repeat-toggle"><input type="checkbox" checked={form.autoAssign} onChange={(event) => setForm({ ...form, autoAssign: event.target.checked })} /><span><Check aria-hidden="true" /><strong>Assign automatically during these hours</strong><small>Applies to support needs except rides.</small></span></label><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={!valid}><Check aria-hidden="true" /> Save person</button></div></form></ModalShell>
}

function DeclineRequestModal({ name, onClose, onDecline }: { name: string; onClose: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <ModalShell title="Decline this request" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onDecline(reason.trim()) }}><p className="modal-intro">Add a short, kind reason for {name}. It will be included in their email when an email address is available.</p><label htmlFor="decline-reason">Reason</label><textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: We no longer need coverage at this time." autoFocus required /><div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="danger-button" type="submit" disabled={!reason.trim()}>Decline request</button></div></form></ModalShell>
}

function FamilyPreferences({ foodSettings, foodPreferences, familyInTown, familyInTownDates, onSaveFood, onSaveFoodPreferences, onSaveFamilyInTown, onEditInTownDates, onEditBusyDates, onAddSchedule }: { foodSettings: FoodSettings; foodPreferences: FoodPreferences; familyInTown: FamilyInTown; familyInTownDates: FamilyInTownDates; onSaveFood: (settings: FoodSettings) => Promise<boolean>; onSaveFoodPreferences: (preferences: FoodPreferences) => Promise<boolean>; onSaveFamilyInTown: (person: keyof FamilyInTown, inTown: boolean) => Promise<void>; onEditInTownDates: (person: keyof FamilyInTown) => void; onEditBusyDates: (person: keyof FamilyInTown) => void; onAddSchedule: (person: ForWho) => void }) {
  const [foodDays, setFoodDays] = useState(foodSettings.weekdays)
  const [foodStart, setFoodStart] = useState(foodSettings.startTime)
  const [foodEnd, setFoodEnd] = useState(foodSettings.endTime)
  return <div className="family-preferences"><h3>Family</h3><p>Manage each person under their name. The public Upcoming and This Month views show the combined result.</p><div className="family-roster" aria-label="Family schedule settings"><div className="family-presence"><span><strong>Mary</strong><small>Appointments and care</small></span><button type="button" onClick={() => onAddSchedule('Mary')}><CalendarDays aria-hidden="true" /> Add Mary’s appointment</button></div>{(['Stu', 'Gabby', 'Spencer'] as (keyof FamilyInTown)[]).map((name) => <div className="family-presence" key={name}><span><strong>{name}</strong><small>{name === 'Stu' ? 'Husband' : name === 'Gabby' ? 'Daughter' : 'Son'}</small></span><label className="in-town-check"><input type="checkbox" checked={familyInTown[name]} onChange={(event) => void onSaveFamilyInTown(name, event.target.checked)} /><strong>In town full time</strong></label>{!familyInTown[name] && <button type="button" onClick={() => onEditInTownDates(name)}><CalendarDays aria-hidden="true" /> {familyInTownDates[name].length ? `${familyInTownDates[name].length} in-town dates` : 'Choose in-town dates'}</button>}<button type="button" onClick={() => onEditBusyDates(name)}><Clock3 aria-hidden="true" /> Manage {name}’s schedule</button></div>)}</div>
<div className="family-rules"><form className="simple-settings" onSubmit={async (event) => { event.preventDefault(); if (foodDays.length && foodEnd > foodStart) await onSaveFood({ weekdays: foodDays, startTime: foodStart, endTime: foodEnd }) }}><h3>Food drop-off days</h3><p>Choose the days and hours shown in Bring Food. Filled dates are hidden automatically.</p><fieldset className="weekday-picker"><legend>Available days</legend>{weekdayChoices.map((day) => <label key={day.value}><input type="checkbox" checked={foodDays.includes(day.value)} onChange={() => setFoodDays((current) => current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value].sort())} /><span aria-hidden="true">{day.short}</span><span className="sr-only">{day.label}</span></label>)}</fieldset><div className="field-row"><div><label htmlFor="food-start">From</label><input id="food-start" type="time" value={foodStart} onChange={(event) => setFoodStart(event.target.value)} required /></div><div><label htmlFor="food-end">Until</label><input id="food-end" type="time" value={foodEnd} onChange={(event) => setFoodEnd(event.target.value)} required /></div></div><div className="form-actions"><button className="primary-button" type="submit" disabled={!foodDays.length || foodEnd <= foodStart}><Check aria-hidden="true" /> Save food days</button></div></form><FoodPreferencesEditor preferences={foodPreferences} onSave={onSaveFoodPreferences} /></div></div>
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
function SignupModal({ visitorPreferences, event, onClose, onSave }: { visitorPreferences: string; event: TeamEvent; onClose: () => void; onSave: (id: string, name: string, phone: string, email: string, startTime: string, endTime: string, note: string) => Promise<boolean> }) {
  const [contact] = useState(savedHelperContact)
  const [name, setName] = useState(contact.name)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email)
  const [startTime, setStartTime] = useState(event.isFlexible ? '' : event.time)
  const [endTime, setEndTime] = useState(event.isFlexible ? '' : event.endTime)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const isRide = event.helpNeeded.toLowerCase().includes('ride')
  const timeIsValid = event.isFlexible || (isRide ? startTime === event.time && endTime === event.endTime : startTime >= event.time && endTime <= event.endTime && endTime > startTime)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !name.trim() || !phone.trim() || !email.trim() || !timeIsValid) return
    setSaving(true)
    const saved = await onSave(eventId, name.trim(), phone.trim(), email.trim(), startTime, endTime, note.trim())
    if (saved) window.localStorage.setItem('marys-team-helper-contact', JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim() }))
    if (!saved) setSaving(false)
  }
  const eventId = event.id
  return <ModalShell title="Sign up for practical help" onClose={onClose}><div className="modal-summary"><strong>{event.title}</strong><span>{event.isFlexible ? 'Anytime' : `${event.dayLabel}, help is welcome anytime from ${eventTimeRangeLabel(event)}`}</span><p>{event.helpNeeded}</p></div><VisitorNotice text={visitorPreferences} /><form onSubmit={submit}>{!event.isFlexible && <><p className="form-note"><strong>{event.helpNeeded.toLowerCase().includes('ride') ? 'Appointment helpers must stay for the entire appointment and provide hands-on mobility support.' : 'Choose a time when you can provide the practical support requested. This is not a social visit.'}</strong></p><div className="field-row"><div><label htmlFor="helper-start">I can arrive at</label><input id="helper-start" readOnly={isRide} type="time" min={event.time} max={event.endTime} value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></div><div><label htmlFor="helper-end">I need to leave at</label><input id="helper-end" readOnly={isRide} type="time" min={event.time} max={event.endTime} value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></div></div>{!timeIsValid && <p className="field-error">Choose a start and end time inside the open window.</p>}</>}<label htmlFor="helper-name">Your name</label><input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your first and last name" autoFocus required /><label htmlFor="helper-phone">Your phone number</label><input id="helper-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" required /><label htmlFor="helper-email">Your email address</label><input id="helper-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /><label htmlFor="helper-note">Note or question <span>(optional)</span></label><textarea id="helper-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe any practical information about the help you can provide." /><p className="form-note">Confirmations, changes, and cancellations are communicated by email. Your exact time and note will be included with your request. We will email you after it is approved or declined. Please do not come unless confirmed, and respect any cancellation. No need to text for the address.</p><label className="repeat-toggle"><input type="checkbox" required /><span>I have read the visitor preferences and can provide the requested practical support. I will wait for confirmation before coming.</span></label><div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !timeIsValid} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Submitting…' : 'Submit this time'}</button></div></form></ModalShell>
}

function FoodSignupModal({ initialWindow, visitorPreferences, events, foodSettings, foodPreferences, foodReservedDates, onClose, onSave }: { initialWindow?: TeamEvent | null; visitorPreferences: string; events: TeamEvent[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; foodReservedDates: string[]; onClose: () => void; onSave: (plan: { type: PlanType; name: string; phone: string; email: string; date: string; time: string; endTime: string; details: string }) => Promise<boolean> }) {
  const [selectedDate, setSelectedDate] = useState(initialWindow ? `${initialWindow.date.slice(0, 4)}-${initialWindow.date.slice(4, 6)}-${initialWindow.date.slice(6, 8)}` : '')
  const [time, setTime] = useState(initialWindow?.time || '')
  const [contact, setContact] = useState(savedHelperContact)
  const [details, setDetails] = useState('')
  const [place, setPlace] = useState('Front door')
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const days = getThirtyDays().map((day) => {
    const iso = `${day.dateKey.slice(0, 4)}-${day.dateKey.slice(4, 6)}-${day.dateKey.slice(6, 8)}`
    const slots = foodTimeSlots(day.dateKey, foodSettings, foodReservedDates, events)
    return { ...day, iso, slots }
  }).filter((day) => day.slots.length)
  const selected = days.find((day) => day.iso === selectedDate)
  const valid = Boolean(selected?.slots.includes(time))
  if (!selectedDate) return <ModalShell title="Choose an open food drop-off date" onClose={onClose}><p className="modal-intro">Only available dates are shown. Choose a day, then see food preferences and tell us what you’ll bring. One food drop-off per day.</p><div className="food-open-dates">{days.map((day) => <button className="food-open-date" type="button" key={day.dateKey} onClick={() => { setSelectedDate(day.iso); setTime(day.slots[0]) }}><span><strong>{day.fullDay}</strong><small>{day.slots.map(eventTimeLabel).join(' · ')}</small></span><span>Choose day <ChevronRight aria-hidden="true" /></span></button>)}</div>{!days.length && <div className="organizer-empty"><p><strong>There are no open food drop-off dates in the next 30 days.</strong><br />Please check back here. No need to contact the family to arrange another time.</p></div>}<p className="form-note">Food drop-offs are brief and do not include a social visit. Confirmation, changes, and cancellations are communicated by email. The family will email confirmation and instructions after reviewing your request.</p></ModalShell>
  return <ModalShell title="Plan your food drop-off" onClose={onClose}><div className="modal-summary"><strong>{selected?.fullDay || selectedDate}</strong><button className="text-button" type="button" onClick={() => setSelectedDate('')}>Change date</button></div><FoodPreferencesCard preferences={foodPreferences} /><VisitorNotice text={visitorPreferences} /><form onSubmit={async (event) => {
    event.preventDefault(); if (saving || !valid || !acknowledged) return
    setSaving(true); setError('')
    const saved = await onSave({ type: 'food', ...contact, name: contact.name.trim(), phone: contact.phone.trim(), email: contact.email.trim(), date: selectedDate, time, endTime: addMinutes(time, 30), details: `${details.trim()} · Leave at: ${place}. Brief drop-off only; no social visit.` })
    if (!saved) { setSaving(false); setError('This request could not be saved. The date may have filled. Please choose another open date and try again.') }
  }}>
    <label htmlFor="food-slot">Choose an available drop-off time</label><select id="food-slot" value={time} onChange={(event) => setTime(event.target.value)} required>{selected?.slots.map((slot) => <option value={slot} key={slot}>{eventTimeLabel(slot)}–{eventTimeLabel(addMinutes(slot, 30))}</option>)}</select>{!valid && <p className="field-error" role="alert">This date is no longer available. Please choose another date.</p>}
    {foodPreferences.suggestions.length > 0 && <><label htmlFor="food-idea">Choose a favorite or bring your own</label><select id="food-idea" defaultValue="" onChange={(event) => { if (event.target.value) setDetails(event.target.value) }}><option value="">I’ll describe what I’m bringing below</option>{foodPreferences.suggestions.map((idea) => <option key={idea.id} value={`${idea.name}${idea.items.filter(Boolean).length ? `: ${idea.items.filter(Boolean).join(', ')}` : ''}`}>{idea.name}</option>)}</select></>}
    <label htmlFor="food-description">What are you bringing?</label><textarea id="food-description" value={details} onChange={(event) => setDetails(event.target.value)} required placeholder="Describe the dish, order, or groceries, including ingredients the family should know about." />
    <label htmlFor="food-location">Where will you leave the food?</label><select id="food-location" value={place} onChange={(event) => setPlace(event.target.value)}><option>Front door</option><option>Back gate by the garage</option></select><p className="form-note">Please wait for the confirmation email before coming. It will include the drop-off address and instructions. Leave the food at the agreed location; a visit is not included.</p>
    <label htmlFor="food-name">Your name</label><input id="food-name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} required autoComplete="name" /><div className="field-row"><div><label htmlFor="food-phone">Phone number</label><input id="food-phone" type="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} required autoComplete="tel" /></div><div><label htmlFor="food-email">Email address</label><input id="food-email" type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} required autoComplete="email" /></div></div>
    <label className="repeat-toggle"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /><span>I understand this is a food drop-off only, and I will wait for confirmation and respect any changes or cancellations.</span></label>{error && <p className="field-error" role="alert">{error}</p>}<div className="form-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !valid || !acknowledged}>{saving ? 'Submitting…' : 'Request this drop-off'}</button></div>
  </form></ModalShell>
}

function PlanRequestModal({ visitorPreferences, type, initialWindow, events, foodSettings, foodPreferences, visitSettings, foodReservedDates, onClose, onSave }: { visitorPreferences: string; type: PlanType; initialWindow?: TeamEvent | null; events: TeamEvent[]; foodSettings: FoodSettings; foodPreferences: FoodPreferences; visitSettings: VisitSettings; foodReservedDates: string[]; onClose: () => void; onSave: (plan: { type: PlanType; name: string; phone: string; email: string; date: string; time: string; endTime: string; details: string }) => Promise<boolean> }) {
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
    <VisitorNotice text={visitorPreferences} /><form onSubmit={submit}>
      <label htmlFor="plan-name">Your name</label><input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your first and last name" autoComplete="name" autoFocus required />
      <div className="field-row"><div><label htmlFor="plan-phone">Phone number</label><input id="plan-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(602) 555-0123" autoComplete="tel" required /></div><div><label htmlFor="plan-email">Email address</label><input id="plan-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></div></div>
      {type === 'food' ? <><label>Choose an open date</label><div className="calendar-date-picker food-date-picker"><div className="date-picker-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="date-picker-grid">{Array.from({ length: foodCalendarBlanks }, (_, index) => <span className="date-picker-blank" key={`food-blank-${index}`} />)}{foodCalendarDays.map((day) => { const isoDate = `${day.dateKey.slice(0, 4)}-${day.dateKey.slice(4, 6)}-${day.dateKey.slice(6, 8)}`; const weekday = new Date(`${isoDate}T12:00:00`).getDay(); const filled = foodReservedDates.includes(day.dateKey); const allowed = foodSettings.weekdays.includes(weekday) && !filled; const selected = date === isoDate; return <button type="button" key={day.dateKey} disabled={!allowed} aria-pressed={selected} aria-label={`${day.fullDay}${filled ? ', filled' : allowed ? ', open' : ', unavailable'}`} onClick={() => setDate(isoDate)}><span>{day.monthShort}</span><strong>{day.number}</strong>{filled && <small>Filled</small>}</button> })}</div></div></> : <><label htmlFor="plan-date">Date</label><input id="plan-date" type="date" min={localDateInputValue()} value={date} onChange={(event) => setDate(event.target.value)} required /></>}
      {type === 'food' && <div className={`meal-week-status ${foodSlotUnavailable ? 'covered' : ''}`} role="status"><Utensils aria-hidden="true" /><p><strong>{!foodDayAllowed ? `Please choose ${foodDayNames}.` : foodDateIsTaken ? 'Someone is already bringing food that day.' : maryHasAppointmentThen ? 'Mary has an appointment during that time.' : !foodTimeIsValid ? `Choose a time between ${eventTimeLabel(foodSettings.startTime)} and ${eventTimeLabel(foodSettings.endTime)}.` : 'This food drop-off time is open.'}</strong><br />Filled dates and appointment conflicts are blocked automatically.</p></div>}
      <div className="field-row"><div><label htmlFor="plan-time">{type === 'food' ? 'Drop off around' : 'Arrive'}</label><input id="plan-time" type="time" value={time} onChange={(event) => changeStartTime(event.target.value)} required /></div><div><label htmlFor="plan-end-time">{type === 'food' ? 'Until' : 'Leave'}</label><input id="plan-end-time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></div></div>
      {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      {outsideVisitHours && <p className="outside-hours-note" role="status"><strong>Outside normal visiting hours.</strong> You can still send this request for the family to approve.</p>}
      {type === 'stop_by' && maryBusyThatDay.length > 0 && <div className="meal-week-status covered" role="status"><Clock3 aria-hidden="true" /><p><strong>That day is not open for drop-ins.</strong><br />Stop By requests are available only on completely open days. Please choose another date.</p></div>}
      {type === 'stop_by' && <p className="form-note"><strong>A quiet visit is welcome.</strong> Mary may need to nap while you are there. It is completely fine to sit with her quietly while she rests.</p>}
      {type === 'food' && <><label htmlFor="drop-off-place">Where will you leave the food?</label><select id="drop-off-place" value={dropOffPlace} onChange={(event) => setDropOffPlace(event.target.value)}><option>Front door</option><option>Back gate by the garage</option></select><p className="form-note">Please leave the food at the agreed location and text the family when it has arrived. Drop-offs do not include a visit.</p></>}
      <label htmlFor="plan-details">{type === 'food' ? 'What are you bringing? ' : 'Anything Mary and Stu should know? '}<span>(optional)</span></label><textarea id="plan-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder={type === 'food' ? 'Example: Chicken soup and bread' : 'Example: I can keep Mary company and help with small things around the house.'} />
      <p className="form-note privacy-note">This request stays private until Mary or Stu approves it. We will email you after they decide.</p>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !timeIsValid || foodSlotUnavailable || stopByDayUnavailable}><Check aria-hidden="true" /> {saving ? 'Sending request…' : 'Send request'}</button></div>
    </form>
  </ModalShell>
}

function FoodPreferencesCard({ preferences }: { preferences: FoodPreferences }) {
  return <section className="food-preferences-card" aria-labelledby="food-preferences-title"><h3 id="food-preferences-title">Food preferences</h3><p>{preferences.overview}</p>{preferences.avoid && <p className="food-avoid"><strong>Please avoid:</strong> {preferences.avoid}</p>}{preferences.suggestions.length > 0 && <div className="food-favorites"><strong>Favorite ideas</strong>{preferences.suggestions.map((suggestion) => <div key={suggestion.id}><span className={`food-type-tag ${suggestion.type}`}>{suggestion.type === 'grocery' ? 'Grocery item' : suggestion.type}</span><p><strong>{suggestion.name}</strong>{suggestion.items.length > 0 && <> · {suggestion.items.join(', ')}</>}{suggestion.note && <><br /><small>{suggestion.note}</small></>}</p></div>)}</div>}</section>
}

function AvailabilityModal({ visitorPreferences, onClose, onSave }: { visitorPreferences: string; onClose: () => void; onSave: (entries: Omit<Availability, 'id'>[]) => Promise<boolean> }) {
  const days = getThirtyDays()
  const firstDate = days[0].dateKey
  const firstWeekday = new Date(`${firstDate.slice(0, 4)}-${firstDate.slice(4, 6)}-${firstDate.slice(6, 8)}T12:00:00`).getDay()
  const timeOptions = Array.from({ length: 37 }, (_, index) => {
    const minutes = 6 * 60 + index * 30
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return { value, label: eventTimeLabel(value) }
  })
  const [name, setName] = useState(savedHelperContact().name)
  const [phone, setPhone] = useState(savedHelperContact().phone)
  const [email, setEmail] = useState(savedHelperContact().email)
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
    const saved = await onSave(chosenDates.map((day) => ({ name, phone, email, day, time: timeMode === 'all-day' ? 'anytime' : `${startTime}-${endTime}`, note })))
    if (!saved) setSaving(false)
  }

  return <ModalShell title="Add your availability" onClose={onClose}>
    <p className="modal-intro">Let the family know when you could help if needed. This is an offer only, not a sign-up or confirmed commitment. The family will email you if they schedule specific help. Confirmations, changes, and cancellations arrive by email; please do not come without confirmation.</p>
    <VisitorNotice text={visitorPreferences} />
    <form onSubmit={submit}>
      <label htmlFor="available-name">Your name</label>
      <input id="available-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first and last name" autoFocus />
      <label htmlFor="available-phone">Your phone number</label>
      <input id="available-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Example: (602) 555-0123" autoComplete="tel" />
      <label htmlFor="available-email">Your email address</label><input id="available-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /><p className="form-note privacy-note">Only the family can see your contact details. Sharing availability does not reserve or confirm any task.</p>
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
      <select id="available-note" required value={note} onChange={(e) => setNote(e.target.value)}><option value="">Choose one</option>{helpChoices.map((choice) => <option key={choice} value={choice}>{choice === 'Spend time with Mary' ? 'Practical care for Mary' : choice}</option>)}</select>
      <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!selectionIsValid || saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : 'Share availability — not a commitment'}</button></div>
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
  const [email, setEmail] = useState(initialEntry.email || '')
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
    onSave(selectedEntries.map((entry) => ({ ...entry, name: name.trim(), phone: phone.trim(), email: email.trim(), time: timeMode === 'all-day' ? 'anytime' : `${startTime}-${endTime}`, note })))
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
      <label htmlFor="edit-available-email">Email address</label><input id="edit-available-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /><p className="form-note privacy-note">Only the family can see your contact details. This is an availability offer, not a confirmed commitment.</p>
      <label>When are you available?</label>
      <div className="time-mode" role="group" aria-label="Choose all day or specific hours"><button type="button" aria-pressed={timeMode === 'all-day'} onClick={() => setTimeMode('all-day')}>All day</button><button type="button" aria-pressed={timeMode === 'hours'} onClick={() => setTimeMode('hours')}>Choose hours</button></div>
      {timeMode === 'hours' && <div className="field-row"><div><label htmlFor="edit-available-start-time">Available from</label><select id="edit-available-start-time" value={startTime} onChange={(event) => setStartTime(event.target.value)}>{timeOptions.slice(0, -1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label htmlFor="edit-available-end-time">Until</label><select id="edit-available-end-time" value={endTime} onChange={(event) => setEndTime(event.target.value)}>{timeOptions.slice(1).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>}
      {timeMode === 'hours' && !timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
      <label htmlFor="edit-available-note">What are you comfortable supporting?</label>
      <select id="edit-available-note" required value={note} onChange={(event) => setNote(event.target.value)}>{helpChoices.map((choice) => <option key={choice} value={choice}>{choice === 'Spend time with Mary' ? 'Practical care for Mary' : choice}</option>)}</select>
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
  const currentContact = contacts.findIndex((contact) => samePerson(contact, driver))
  const [choice, setChoice] = useState(driver.name ? currentContact >= 0 ? `contact:${currentContact}` : 'manual' : 'open')
  function choose(value: string) {
    setChoice(value)
    if (value === 'open') onChange({ name: '', phone: '', email: '' })
    else if (value.startsWith('contact:')) onChange(contacts[Number(value.split(':')[1])] || { name: '', phone: '', email: '' })
    else onChange({ name: '', phone: '', email: '' })
  }
  return <div className="driver-fields">
    <label htmlFor="ride-driver">Who is confirmed?</label>
    <select id="ride-driver" value={choice} onChange={(event) => choose(event.target.value)}>
      <option value="open">No one assigned yet</option>
      {contacts.map((contact, index) => <option value={`contact:${index}`} key={`${contact.name}-${contact.phone}`}>{contact.name}</option>)}
      <option value="manual">Someone new</option>
    </select>
    {choice.startsWith('contact:') && !driver.email && <p className="field-error">No email is saved for this person. Add it in People so they can receive confirmation, changes, cancellations, and the private address.</p>}
    {choice === 'manual' && <><div className="field-row"><div><label htmlFor="driver-name">Driver’s name</label><input id="driver-name" required value={driver.name} onChange={(event) => onChange({ ...driver, name: event.target.value })} /></div><div><label htmlFor="driver-phone">Phone number</label><input id="driver-phone" type="tel" value={driver.phone} onChange={(event) => onChange({ ...driver, phone: event.target.value })} autoComplete="tel" /></div></div><label htmlFor="driver-email">Email address</label><input id="driver-email" type="email" value={driver.email} onChange={(event) => onChange({ ...driver, email: event.target.value })} autoComplete="email" placeholder="Needed to send confirmation" /><p className="form-note">If an email is provided, this person will receive the event details.</p></>}
  </div>
}

function AddEventModal({ initialContact, initialForWho, availability, events, savedContacts, onClose, onSave }: { initialContact?: DriverContact; initialForWho: ForWho; availability: Availability[]; events: TeamEvent[]; savedContacts: DriverContact[]; onClose: () => void; onSave: (events: TeamEvent[]) => Promise<boolean> }) {
  const [form, setForm] = useState(() => ({ title: initialForWho === 'Mary' ? 'At Home Appointment' : '', date: localDateInputValue(), time: '12:00', endTime: '13:00', forWho: initialForWho, helpNeeded: initialForWho === 'Mary' ? 'No help needed' : needsTimeWithMary(initialForWho) ? 'Spend time with Mary' : 'Need a ride', details: '', locationChoice: initialForWho === 'Mary' ? 'home' : 'location', location: '', helper: initialContact?.name || '', helperPhone: initialContact?.phone || '', helperEmail: initialContact?.email || '', helperPersonId: initialContact?.personId, isFlexible: false }))
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
    const events = dates.map((date) => ({ id: crypto.randomUUID(), category: form.forWho === 'Mary' ? 'appointment' as const : 'family' as const, forWho: form.forWho, date: compactEventDate(date, form.isFlexible ? '00:00' : form.time), dayLabel: form.isFlexible ? 'Anytime' : dayLabelForDate(date), time: form.isFlexible ? 'anytime' : form.time, endTime: form.isFlexible ? 'anytime' : form.endTime, title: form.title, details: form.details.trim() || defaultEventDetails, location: hideLocation ? undefined : form.locationChoice === 'home' ? 'Home' : form.location || undefined, helpNeeded: form.helpNeeded, helper: !isNoSupport(form.helpNeeded) ? form.helper || undefined : undefined, helperPhone: !isNoSupport(form.helpNeeded) ? form.helperPhone || undefined : undefined, helperEmail: !isNoSupport(form.helpNeeded) ? form.helperEmail || undefined : undefined, helperPersonId: !isNoSupport(form.helpNeeded) ? form.helperPersonId : undefined, repeatGroupId: form.isFlexible ? undefined : repeatGroupId, isFlexible: form.isFlexible }))
    setSaving(true)
    const saved = await onSave(events)
    if (!saved) setSaving(false)
  }

  return <ModalShell title="Add an appointment or task" onClose={onClose}><p className="modal-intro">Add one item or repeat it every week.</p><form onSubmit={submit}>
    <label htmlFor="event-title">What is happening?</label>{form.forWho === 'Mary' ? <select id="event-title" required value={form.title} onChange={(event) => { const title = event.target.value; setForm({ ...form, title, locationChoice: title === 'At Home Appointment' ? 'home' : 'location', helpNeeded: title === 'At Home Appointment' ? 'No help needed' : 'Need a ride' }) }} autoFocus>{maryAppointmentChoices.map((choice) => <option key={choice} value={choice}>{choice === 'Spend time with Mary' ? 'Practical care for Mary' : choice}</option>)}</select> : <input id="event-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Example: Stu at work" autoFocus />}
    <div className="field-row"><div><label htmlFor="event-date">{form.isFlexible ? 'Available starting' : 'Date'}</label><input id="event-date" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div><div><label htmlFor="event-for-who">Who is this for?</label><select id="event-for-who" value={form.forWho} onChange={(event) => { const forWho = event.target.value as ForWho; setForm({ ...form, forWho, title: forWho === 'Mary' ? 'At Home Appointment' : form.title === 'At Home Appointment' || form.title === 'Appointment' ? '' : form.title, locationChoice: forWho === 'Mary' ? 'home' : form.locationChoice, helpNeeded: forWho === 'Mary' ? 'No help needed' : needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <label className="repeat-toggle"><input type="checkbox" checked={form.isFlexible} onChange={(event) => setForm({ ...form, isFlexible: event.target.checked })} /><span><Clock3 aria-hidden="true" /><strong>Anytime task</strong><small>Use this for something that needs to be done but has no set appointment time.</small></span></label>
    {!form.isFlexible && <div className="field-row"><div><label htmlFor="event-time">Starts</label><input id="event-time" type="time" required value={form.time} onChange={(event) => changeStartTime(event.target.value)} /></div><div><label htmlFor="event-end-time">Ends</label><input id="event-end-time" type="time" required value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></div></div>}
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    {!form.isFlexible && <label className="repeat-toggle"><input type="checkbox" checked={repeats} onChange={(event) => setRepeats(event.target.checked)} /><span><Repeat2 aria-hidden="true" /><strong>Repeat every week</strong><small>Add this on the same weekday each week.</small></span></label>}
    {!form.isFlexible && repeats && <><label htmlFor="repeat-through">Repeat through</label><input id="repeat-through" type="date" min={form.date} value={repeatThrough < form.date ? form.date : repeatThrough} onChange={(event) => setRepeatThrough(event.target.value)} /></>}
    <label htmlFor="event-help">What support is needed?</label><select id="event-help" value={form.helpNeeded} onChange={(event) => setForm({ ...form, helpNeeded: event.target.value })}>{(form.helpNeeded === 'Group event' ? ['Group event', ...supportChoices] : supportChoices).map((choice) => <option key={choice} value={choice}>{choice === 'Spend time with Mary' ? 'Practical care for Mary' : choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    {!isNoSupport(form.helpNeeded) && <DriverFields contacts={knownContacts(events, availability, savedContacts)} driver={{ personId: form.helperPersonId, name: form.helper, phone: form.helperPhone, email: form.helperEmail }} onChange={(driver) => setForm({ ...form, helper: driver.name, helperPhone: driver.phone, helperEmail: driver.email, helperPersonId: driver.personId })} />}
    {!hideLocation && <><label htmlFor="event-location-choice">Where?</label><select id="event-location-choice" value={form.locationChoice} onChange={(event) => { const locationChoice = event.target.value; setForm({ ...form, locationChoice, title: form.forWho === 'Mary' ? locationChoice === 'home' ? 'At Home Appointment' : 'Appointment' : form.title, helpNeeded: form.forWho === 'Mary' ? locationChoice === 'home' ? 'No help needed' : 'Need a ride' : form.helpNeeded }) }}><option value="home">Home</option><option value="location">Location</option></select>{form.locationChoice === 'location' && <><label htmlFor="event-location">Location name or address</label><input id="event-location" required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Example: Mayo Clinic, 13400 E Shea Blvd" /></>}</>}
    <label htmlFor="event-details">Details {form.forWho !== 'Mary' && <span>(optional)</span>}</label><textarea id="event-details" required={form.forWho === 'Mary'} value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} placeholder={form.forWho === 'Mary' ? 'Example: Stretch with Cara' : defaultEventDetails} />
    <div className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={!timeIsValid || saving} aria-busy={saving}><Check aria-hidden="true" /> {saving ? 'Saving…' : repeats ? 'Add weekly schedule' : 'Add to the schedule'}</button></div>
  </form></ModalShell>
}

function EditEventModal({ event, availability, events, savedContacts, onClose, onSave, onRemove }: { event: TeamEvent; availability: Availability[]; events: TeamEvent[]; savedContacts: DriverContact[]; onClose: () => void; onSave: (event: TeamEvent) => void; onRemove: (eventId: string) => void }) {
  const date = `${event.date.slice(0, 4)}-${event.date.slice(4, 6)}-${event.date.slice(6, 8)}`
  const startsAtHome = event.proposalType === 'food' || event.location?.trim().toLocaleLowerCase() === 'home' || event.title.toLocaleLowerCase().includes('at home')
  const [form, setForm] = useState({ ...event, title: event.title, details: event.details, locationChoice: startsAtHome ? 'home' : 'location', location: startsAtHome ? '' : event.location || '', helper: event.helper || '', helperPhone: event.helperPhone || '', helperEmail: event.helperEmail || '', date, endTime: event.endTime || addHour(event.time), helpNeeded: event.helpNeeded === 'Group event' ? 'Group event' : isNoSupport(event.helpNeeded) ? 'No help needed' : event.helpNeeded })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const timeIsValid = form.isFlexible || form.endTime > form.time
  const hideLocation = form.helpNeeded === 'Spend time with Mary'
  const contacts = knownContacts(events, availability, savedContacts)

  function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    if (!timeIsValid) return
    onSave({ ...event, ...form, category: event.proposalType === 'food' ? event.category : form.forWho === 'Mary' ? 'appointment' : 'family', date: compactEventDate(form.date, form.isFlexible ? '00:00' : form.time), dayLabel: form.isFlexible ? 'Anytime' : dayLabelForDate(form.date), time: form.isFlexible ? 'anytime' : form.time, endTime: form.isFlexible ? 'anytime' : form.endTime, details: form.details.trim() || defaultEventDetails, location: hideLocation ? undefined : form.locationChoice === 'home' ? 'Home' : form.location || undefined, helper: isNoSupport(form.helpNeeded) && event.proposalType !== 'food' ? undefined : form.helper || undefined, helperPhone: isNoSupport(form.helpNeeded) && event.proposalType !== 'food' ? undefined : form.helperPhone || undefined, helperEmail: isNoSupport(form.helpNeeded) && event.proposalType !== 'food' ? undefined : form.helperEmail || undefined })
  }

  return <ModalShell title="View or edit schedule" onClose={onClose}><p className="modal-intro">Click any box below to make a change.{event.repeatGroupId || event.scheduleSource === 'stu_work' ? ' This changes this date only.' : ''}</p><form onSubmit={submit}>
    <label htmlFor="edit-event-title">What is happening?</label><input id="edit-event-title" required value={form.title} onChange={(changeEvent) => setForm({ ...form, title: changeEvent.target.value })} autoFocus />
    <div className="field-row"><div><label htmlFor="edit-event-date">{form.isFlexible ? 'Available starting' : 'Date'}</label><input id="edit-event-date" type="date" required value={form.date} onChange={(changeEvent) => setForm({ ...form, date: changeEvent.target.value })} /></div><div><label htmlFor="edit-event-for-who">Who is this for?</label><select id="edit-event-for-who" value={form.forWho} onChange={(changeEvent) => { const forWho = changeEvent.target.value as ForWho; setForm({ ...form, forWho, helpNeeded: needsTimeWithMary(forWho) ? 'Spend time with Mary' : form.helpNeeded }) }}>{whoChoices.map((person) => <option key={person}>{person}</option>)}</select></div></div>
    <label className="repeat-toggle"><input type="checkbox" checked={Boolean(form.isFlexible)} onChange={(changeEvent) => setForm({ ...form, isFlexible: changeEvent.target.checked, time: changeEvent.target.checked ? 'anytime' : '12:00', endTime: changeEvent.target.checked ? 'anytime' : '13:00', dayLabel: changeEvent.target.checked ? 'Anytime' : form.dayLabel })} /><span><Clock3 aria-hidden="true" /><strong>Anytime task</strong><small>Use this for something that needs doing but has no set appointment time.</small></span></label>
    {!form.isFlexible && <div className="field-row"><div><label htmlFor="edit-event-time">Starts</label><input id="edit-event-time" type="time" required value={form.time} onChange={(changeEvent) => setForm({ ...form, time: changeEvent.target.value, endTime: addHour(changeEvent.target.value) })} /></div><div><label htmlFor="edit-event-end-time">Ends</label><input id="edit-event-end-time" type="time" required value={form.endTime} onChange={(changeEvent) => setForm({ ...form, endTime: changeEvent.target.value })} /></div></div>}
    {!timeIsValid && <p className="field-error" role="alert">Choose an ending time that is later than the starting time.</p>}
    <label htmlFor="edit-event-help">What support is needed?</label><select id="edit-event-help" value={form.helpNeeded} onChange={(changeEvent) => setForm({ ...form, helpNeeded: changeEvent.target.value })}>{(form.helpNeeded === 'Group event' ? ['Group event', ...supportChoices] : supportChoices).map((choice) => <option key={choice} value={choice}>{choice === 'Spend time with Mary' ? 'Practical care for Mary' : choice}</option>)}</select>{needsTimeWithMary(form.forWho) && <p className="form-note">Spend time with Mary is suggested for Stu and Coco plans, but you can choose any option, including No help needed.</p>}
    {(!isNoSupport(form.helpNeeded) || event.proposalType === 'food') && <DriverFields contacts={contacts} driver={{ personId: form.helperPersonId, name: form.helper, phone: form.helperPhone, email: form.helperEmail }} onChange={(driver) => setForm({ ...form, helper: driver.name, helperPhone: driver.phone, helperEmail: driver.email, helperPersonId: driver.personId })} />}

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
  return <ModalShell title="How to use Mary’s Team" onClose={onClose}><div className="help-list"><div><span>1</span><p><strong>Help Needed.</strong> Choose a specific practical task you can provide. Appointment helpers must stay throughout and provide hands-on support. Social visits are not available.</p></div><div><span>2</span><p><strong>Bring Food.</strong> Choose an open date first, then a drop-off time. Read food preferences, tell us what you’re bringing, and enter your contact details.</p></div><div><span>3</span><p><strong>Wait for confirmation.</strong> Watch for an email with approval and instructions. Please do not come without confirmation or after a cancellation. Food drop-offs do not include a visit.</p></div></div><button className="primary-button full-button" type="button" onClick={onClose}>Got it</button></ModalShell>
}

export default App
