export const defaultVisitorPreferences = 'Mary has full-time care from her nurse and family and is not receiving social visits or drop-ins. Please sign up only for a specific practical task the family has requested. Appointment helpers must stay with Mary throughout and be comfortable providing hands-on mobility support. The most helpful ways to support the family are contributing to the GoFundMe or bringing food when a slot is open. Food drop-offs are brief and do not include a visit. Please wait for confirmation before coming, and respect any changes or cancellations. Thank you for understanding and giving Mary and her family privacy.'
export type Contact = { name: string; phone: string; email: string }
export function nameKey(value: string) {
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ')
  const family: Record<string, string> = { mary: 'mary greenberg', stu: 'stu greenberg', stuart: 'stu greenberg', 'stuart greenberg': 'stu greenberg', gabby: 'gabby greenberg', gabrielle: 'gabby greenberg', 'gabrielle greenberg': 'gabby greenberg', spencer: 'spencer greenberg' }
  return family[key] || key
}
export function samePerson(a: Contact, b: Contact) {
  const phone = (v: string) => v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const aName = nameKey(a.name), bName = nameKey(b.name)
  if (!aName || !bName) return false
  if (aName === bName) return true
  // Shared household contact information must not collapse different people.
  const compatible = aName.split(' ')[0] === bName.split(' ')[0] && (aName.split(' ').length === 1 || bName.split(' ').length === 1)
  return compatible && Boolean((a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) || (phone(a.phone) && phone(a.phone) === phone(b.phone)))
}
export function mergeContacts(entries: Contact[]) {
  const result: Contact[] = []
  for (const entry of entries.filter((item) => item.name.trim())) {
    const matches = result.filter((item) => samePerson(item, entry))
    const contact = matches[0]
    if (contact) {
      if (!contact.phone) contact.phone = entry.phone
      if (!contact.email) contact.email = entry.email
      for (const extra of matches.slice(1)) {
        contact.phone ||= extra.phone; contact.email ||= extra.email
        result.splice(result.indexOf(extra), 1)
      }
    } else result.push({ ...entry })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
export type Nurse = { id: string; name: string; phone: string; email: string; role: string; weekdays: number[]; startTime: string; endTime: string; autoAssign: boolean }
export function nurseOnDate(member: Nurse, dateKey: string) {
  return member.role === 'Nurse' && member.autoAssign && member.weekdays.includes(new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T12:00:00Z`).getUTCDay())
}
export function openCareWindows<T extends { date: string; time: string; endTime: string; helpNeeded: string; helper?: string; requestPending?: boolean; isFlexible?: boolean }>(event: T, nurses: Nurse[]): T[] {
  if (event.helper || event.requestPending || event.isFlexible || event.helpNeeded.toLowerCase().includes('ride')) return [event]
  let windows = [event]
  for (const nurse of nurses.filter((person) => nurseOnDate(person, event.date.slice(0, 8)))) {
    windows = windows.flatMap((window) => {
      if (nurse.endTime <= window.time || nurse.startTime >= window.endTime) return [window]
      return [window.time < nurse.startTime ? { ...window, endTime: nurse.startTime } : null, window.endTime > nurse.endTime ? { ...window, time: nurse.endTime, date: `${window.date.slice(0, 8)}T${nurse.endTime.replace(':', '')}00` } : null].filter((value): value is T => value !== null)
    })
  }
  return windows
}
