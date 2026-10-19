import { useState } from 'react'
import type { TeamEvent } from '../lib/schedule'

export type EmailNotice = { id: string; recipient: string; subject: string; status: string; attempts: number; retryScheduled?: boolean; lastError?: string; createdAt: string }
export type WeekTemplate = { id: string; name: string; items: unknown[] }
type PreviewItem = TeamEvent & { exists: boolean; conflict: boolean }
type PlanningResponse = { template?: WeekTemplate; items?: PreviewItem[]; added?: number; notifications?: EmailNotice[] }
type PlanningRequest = (body: object) => Promise<PlanningResponse>

function emailDateTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date and time unavailable'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

export function EmailStatus({ notices, request, onRefresh }: { notices: EmailNotice[]; request: PlanningRequest; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const problems = notices.filter((notice) => ['failed', 'bounced', 'retry'].includes(notice.status))
  async function retry(id: string) {
    setBusy(id); setError('')
    try { await request({ action: 'retryNotification', id }); await onRefresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The email could not be retried.') }
    finally { setBusy('') }
  }
  const label: Record<string, string> = { queued: 'Waiting to send', retry: 'Delayed · automatic retry scheduled', sending: 'Sending', sent: 'Sent · receipt not confirmed', delivered: 'Delivered', bounced: 'Not delivered · check email address', failed: 'Could not send · needs attention', superseded: 'Replaced by a newer schedule update' }
  return <section className={`email-status ${problems.length ? 'needs-attention' : ''}`} aria-labelledby="email-status-title">
    <h3 id="email-status-title">Email updates {problems.length ? `· ${problems.length} need attention` : ''}</h3>
    <p>Messages are saved and retried automatically. “Sent” means accepted by the email service; it does not guarantee receipt.</p>
    {error && <p role="alert">{error}</p>}
    <details open={problems.length > 0}><summary>{notices.length ? 'See recent emails and delivery status' : 'New confirmations and changes will appear here'}</summary>
      {notices.map((notice) => <article key={notice.id}><div><strong>{notice.subject}</strong><small>{notice.recipient || 'Missing notification recipient'}</small><small><time dateTime={notice.createdAt}>{emailDateTimeLabel(notice.createdAt)}</time></small><small>{notice.status === 'retry' && notice.retryScheduled === false ? 'Delayed · retry scheduling needs attention' : label[notice.status] || notice.status}</small>{notice.lastError && <small>{notice.lastError}</small>}</div>
        {['failed', 'bounced', 'retry'].includes(notice.status) && notice.recipient && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void retry(notice.id)}>{busy === notice.id ? 'Retrying…' : 'Retry email'}</button>}</article>)}
    </details>
  </section>
}

function monday(offset = 0) {
  const date = new Date(); date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - (date.getDay() + 6) % 7 + offset * 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function WeeklyRoutine({ events, templates, request, onSaved }: { events: TeamEvent[]; templates: WeekTemplate[]; request: PlanningRequest; onSaved: () => Promise<void> }) {
  const [sourceWeek, setSourceWeek] = useState(monday(-1))
  const [targetWeek, setTargetWeek] = useState(monday(1))
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('Family weekly routine')
  const [templateId, setTemplateId] = useState('')
  const [saved, setSaved] = useState<WeekTemplate[]>(templates)
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [included, setIncluded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const start = sourceWeek.replaceAll('-', '')
  const endDate = new Date(`${sourceWeek}T12:00:00`); endDate.setDate(endDate.getDate() + 6)
  const end = `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}`
  const candidates = events.filter((event) => !event.isFlexible && !event.proposalType && event.scheduleSource !== 'nurse_coverage' && event.helpNeeded !== 'Group event' && event.date.slice(0, 8) >= start && event.date.slice(0, 8) <= end)
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setMessage(''); try { await work() } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Please try again.') } finally { setBusy(false) } }
  return <div className="weekly-routine"><p>Select the routines you want to reuse. Helpers and food bookings are never copied. Nurse hours continue from People.</p>
    <label htmlFor="routine-source">Copy from the week starting Monday</label><input id="routine-source" type="date" value={sourceWeek} onChange={(event) => { setSourceWeek(event.target.value); setSelected([]) }} />
    <fieldset><legend>Choose items to save</legend>{candidates.map((event) => <label className="routine-choice" key={event.id}><input type="checkbox" checked={selected.includes(event.id)} onChange={() => setSelected((items) => items.includes(event.id) ? items.filter((id) => id !== event.id) : [...items, event.id])} /><span><strong>{event.title}</strong><small>{event.forWho} · {event.dayLabel} · {event.time}–{event.endTime}</small></span></label>)}{!candidates.length && <p>No reusable items that week. Choose another week or add a repeating event.</p>}</fieldset>
    <label htmlFor="routine-name">Routine name</label><input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
    <button className="secondary-button" type="button" disabled={busy || !selected.length || !name.trim()} onClick={() => void run(async () => { const result = await request({ action: 'saveScheduleTemplate', name, selectedIds: selected }); if (result.template) { setSaved((items) => [...items, result.template!]); setTemplateId(result.template.id); setPreview(null); setMessage('Routine saved. Preview it for a future week below.'); await onSaved() } })}>Save selected items as a routine</button>
    <hr /><h3>Plan a future week</h3><label htmlFor="routine-select">Saved routine</label><select id="routine-select" value={templateId} onChange={(event) => { setTemplateId(event.target.value); setPreview(null) }}><option value="">Choose a routine</option>{saved.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.items.length} items)</option>)}</select>
    <label htmlFor="routine-target">Week starting Monday</label><input id="routine-target" type="date" value={targetWeek} onChange={(event) => { setTargetWeek(event.target.value); setPreview(null) }} />
    <button className="secondary-button" type="button" disabled={busy || !templateId} onClick={() => void run(async () => { const result = await request({ action: 'previewScheduleTemplate', id: templateId, weekOf: targetWeek }); setPreview(result.items || []); setIncluded((result.items || []).filter((item) => !item.exists && !item.conflict).map((item) => item.id)) })}>Preview week</button>
    {preview && <fieldset><legend>Review before adding</legend>{preview.map((item) => <label className="routine-choice" key={item.id}><input type="checkbox" disabled={item.exists || item.conflict} checked={included.includes(item.id)} onChange={() => setIncluded((items) => items.includes(item.id) ? items.filter((id) => id !== item.id) : [...items, item.id])} /><span><strong>{item.title}</strong><small>{item.forWho} · {item.dayLabel} · {item.time}–{item.endTime}</small><small>{item.exists ? 'Already on the schedule · will skip' : item.conflict ? 'Overlaps another item · will skip' : 'No helper assigned'}</small></span></label>)}<button className="primary-button" type="button" disabled={busy || !included.length} onClick={() => void run(async () => { const result = await request({ action: 'applyScheduleTemplate', id: templateId, weekOf: targetWeek, selectedIds: included }); setPreview(null); setMessage(`${result.added || 0} items added. Existing items were kept.`); await onSaved() })}>{busy ? 'Saving…' : `Add ${included.length} items to the schedule`}</button></fieldset>}
    {message && <p role="status">{message}</p>}
  </div>
}
