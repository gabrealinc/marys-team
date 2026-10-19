import { openCareWindows } from './care.js'
import { buildHelpNeededEvents } from './schedule.js'
import type { TeamEvent, FamilyInTown, FamilyInTownDates, CareTeamMember } from './schedule.js'

// An explicit allowlist: private event titles, notes, locations, contact IDs and
// relatives' work/away schedules must never travel to an anonymous browser.
export function publicSchedule(events: TeamEvent[], careTeam: CareTeamMember[], town: FamilyInTown, dates: FamilyInTownDates): TeamEvent[] {
  const needs = buildHelpNeededEvents(events, town, dates).map((event) => {
    if (event.helper || event.requestPending || event.isFlexible || event.helpNeeded.toLowerCase().includes('ride')) return event
    const weekday = new Date(`${event.date.slice(0, 4)}-${event.date.slice(4, 6)}-${event.date.slice(6, 8)}T12:00:00Z`).getUTCDay()
    const member = careTeam.find((person) => person.role !== 'Nurse' && person.autoAssign && person.weekdays.includes(weekday) && event.time >= person.startTime && event.endTime <= person.endTime)
    return member ? { ...event, helper: member.name } : event
  }).flatMap((event) => openCareWindows(event, careTeam))
  const timing = (event: TeamEvent) => ({ date: event.date, dayLabel: event.dayLabel, time: event.time, endTime: event.endTime, isFlexible: event.isFlexible })
  const helper = (event: TeamEvent) => event.helper ? event.helper.trim().split(/\s+/)[0] : undefined
  const output: TeamEvent[] = needs.map((event) => ({
    id: event.id, ...timing(event), category: event.helpNeeded.toLowerCase().includes('ride') ? 'appointment' : 'home', forWho: 'Mary',
    title: event.helpNeeded.toLowerCase().includes('ride') ? 'Appointment support' : 'Practical support for Mary',
    details: event.helpNeeded.toLowerCase().includes('ride') ? 'Provide transportation and stay for the entire appointment. Location and instructions are shared after confirmation.' : 'Provide the practical care or household support requested. Instructions are shared after confirmation.',
    helpNeeded: event.helpNeeded, helper: helper(event), requestPending: Boolean(event.requestPending),
  }))
  events.forEach((event, index) => {
    if (event.helpNeeded === 'Group event') output.push({ id: event.id, ...timing(event), category: 'family', forWho: 'Family', title: event.title, details: 'Register using the official event link.', helpNeeded: 'Group event' })
    else if (event.scheduleSource === 'nurse_coverage') output.push({ id: `nurse-public-${index}`, ...timing(event), category: 'appointment', forWho: 'Mary', title: 'Nurse with Mary', details: 'Care is covered during this time.', helpNeeded: 'No help needed', helper: 'Nurse', scheduleSource: 'nurse_coverage' })
    else if (event.proposalType === 'food' && event.helper) output.push({ id: event.id, ...timing(event), category: 'company', forWho: 'Mary', title: 'Food drop-off', details: 'This food slot is covered.', helpNeeded: 'No help needed', helper: helper(event), proposalType: 'food' })
    else if (event.forWho === 'Mary' && !event.proposalType && !event.isFlexible && ['No help needed', 'No help needed, just sharing the schedule'].includes(event.helpNeeded)) output.push({ id: `busy-public-${index}`, ...timing(event), category: 'appointment', forWho: 'Mary', title: 'Mary is too sick to see anyone', details: 'No help is requested during this time.', helpNeeded: 'No help needed' })
  })
  return output.sort((a, b) => a.date.localeCompare(b.date))
}
