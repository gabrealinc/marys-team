type Category = 'appointment' | 'company' | 'home' | 'family'
type ForWho = 'Mary' | 'Stu' | 'Gabby' | 'Spencer' | 'Coco' | 'Family'
type PlanType = 'food' | 'stop_by'
export type TeamEvent = { id: string; category: Category; forWho: ForWho; date: string; dayLabel: string; time: string; endTime: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string; helperPhone?: string; helperEmail?: string; helperPersonId?: string; repeatGroupId?: string; requestPending?: boolean; requesterName?: string; scheduleSource?: string; isScheduleException?: boolean; isFlexible?: boolean; proposalType?: PlanType; isCalculatedCoverage?: boolean; publicAction?: PlanType }
export type FamilyInTown = { Stu: boolean; Gabby: boolean; Spencer: boolean }
export type FamilyInTownDates = { Stu: string[]; Gabby: string[]; Spencer: string[] }
export type CareTeamMember = { id: string; personId?: string; name: string; phone: string; email: string; role: 'Nurse' | 'Helper'; weekdays: number[]; startTime: string; endTime: string; autoAssign: boolean }
export type VisitorStay = { id: string; personId: string; name: string; phone: string; email: string; startDate: string; startTime: string; endDate: string; endTime: string }
const isNoSupport = (value: string) => ['Group event', 'No help needed', 'No help needed, just sharing the schedule'].includes(value)

export function visitorStayDateKeys(stays: VisitorStay[]) {
  const keys = new Set<string>()
  for (const stay of stays) {
    if (!/^\d{8}$/.test(stay.startDate) || !/^\d{8}$/.test(stay.endDate) || stay.endDate < stay.startDate) continue
    const date = new Date(`${stay.startDate.slice(0, 4)}-${stay.startDate.slice(4, 6)}-${stay.startDate.slice(6, 8)}T12:00:00Z`)
    for (let count = 0; count < 370; count += 1) {
      const key = date.toISOString().slice(0, 10).replaceAll('-', '')
      if (key > stay.endDate) break
      keys.add(key)
      date.setUTCDate(date.getUTCDate() + 1)
    }
  }
  return [...keys]
}

// A visiting friend covers overlapping at-home support. Keep rides open and
// preserve any uncovered time before arrival or after departure.
export function applyVisitorCoverage(events: TeamEvent[], stays: VisitorStay[]) {
  return events.flatMap((event) => {
    if (event.helper || event.requestPending || event.isFlexible || isNoSupport(event.helpNeeded) || event.helpNeeded.toLowerCase().includes('ride') || !event.endTime) return [event]
    const dateKey = event.date.slice(0, 8)
    let windows: TeamEvent[] = [event]
    for (const stay of stays.filter((item) => item.startDate <= dateKey && item.endDate >= dateKey)) {
      const stayStart = dateKey === stay.startDate ? stay.startTime : '00:00'
      const stayEnd = dateKey === stay.endDate ? stay.endTime : '23:59'
      windows = windows.flatMap((window) => {
        if (window.helper || stayEnd <= window.time || stayStart >= window.endTime) return [window]
        const overlapStart = window.time > stayStart ? window.time : stayStart
        const overlapEnd = window.endTime < stayEnd ? window.endTime : stayEnd
        const pieces: TeamEvent[] = []
        if (window.time < overlapStart) pieces.push({ ...window, id: `${window.id}:before:${stay.id}`, endTime: overlapStart })
        pieces.push({
          ...window,
          id: `${window.id}:visitor:${stay.id}`,
          date: `${dateKey}T${overlapStart.replace(':', '')}00`,
          time: overlapStart,
          endTime: overlapEnd,
          helper: stay.name,
          helperPhone: stay.phone,
          helperEmail: stay.email,
          helperPersonId: stay.personId,
          scheduleSource: 'visitor_coverage',
        })
        if (overlapEnd < window.endTime) pieces.push({ ...window, id: `${window.id}:after:${stay.id}`, date: `${dateKey}T${overlapEnd.replace(':', '')}00`, time: overlapEnd })
        return pieces
      })
    }
    return windows
  })
}

export function careCoverageTitle(name = 'Nurse') {
  const first = name.trim().split(/\s+/)[0] || 'Nurse'
  return `${/^eri[ck]a$/i.test(first) ? 'Erika' : first} with Mary`
}

// One display block for covered care; retain the original family records for editing.
export function simplifyCoveredSchedule(events: TeamEvent[]) {
  const coverage = events.filter((event) => event.scheduleSource === 'nurse_coverage').map((event) => ({
    ...event,
    title: careCoverageTitle(event.helper),
    details: /^eri[ck]a\b/i.test(event.helper || '') ? 'Gabby and Stu at work' : event.details,
  }))
  const sameCaregiver = (a: string, b: string) => a.trim().split(/\s+/)[0].toLowerCase().replace(/^erica$/, 'erika') === b.trim().split(/\s+/)[0].toLowerCase().replace(/^erica$/, 'erika')
  const unique = coverage.filter((event, index) => !coverage.some((other, otherIndex) => otherIndex < index && other.date.slice(0, 8) === event.date.slice(0, 8) && other.time === event.time && other.endTime === event.endTime && sameCaregiver(other.helper || '', event.helper || '')))
  return [...unique, ...events.filter((event) => event.scheduleSource !== 'nurse_coverage' && !unique.some((nurse) => {
    if (event.date.slice(0, 8) !== nurse.date.slice(0, 8) || event.time < nurse.time || !event.endTime || event.endTime > nurse.endTime || event.proposalType || event.helpNeeded.toLowerCase().includes('ride') || event.helpNeeded === 'Group event') return false
    const sameHelper = Boolean(event.helper && sameCaregiver(event.helper, nurse.helper || ''))
    const coveredAppointment = event.forWho === 'Mary' && event.category === 'appointment' && isNoSupport(event.helpNeeded)
    return sameHelper || coveredAppointment
  }))].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}
export function buildHelpNeededEvents(events: TeamEvent[], familyInTown: FamilyInTown, familyInTownDates: FamilyInTownDates) {
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
