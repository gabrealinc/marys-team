type Category = 'appointment' | 'company' | 'home' | 'family'
type ForWho = 'Mary' | 'Stu' | 'Gabby' | 'Spencer' | 'Coco' | 'Family'
type PlanType = 'food' | 'stop_by'
export type TeamEvent = { id: string; category: Category; forWho: ForWho; date: string; dayLabel: string; time: string; endTime: string; title: string; details: string; location?: string; helpNeeded: string; helper?: string; helperPhone?: string; helperEmail?: string; helperPersonId?: string; repeatGroupId?: string; requestPending?: boolean; requesterName?: string; scheduleSource?: string; isScheduleException?: boolean; isFlexible?: boolean; proposalType?: PlanType; isCalculatedCoverage?: boolean; publicAction?: PlanType }
export type FamilyInTown = { Stu: boolean; Gabby: boolean; Spencer: boolean }
export type FamilyInTownDates = { Stu: string[]; Gabby: string[]; Spencer: string[] }
export type CareTeamMember = { id: string; personId?: string; name: string; phone: string; email: string; role: 'Nurse' | 'Helper'; weekdays: number[]; startTime: string; endTime: string; autoAssign: boolean }
const isNoSupport = (value: string) => ['Group event', 'No help needed', 'No help needed, just sharing the schedule'].includes(value)
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
