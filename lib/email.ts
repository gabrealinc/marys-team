import nodemailer from 'nodemailer'

export type NotificationDetails = {
  subject: string
  heading: string
  intro: string
  rows: Array<{ label: string; value: string }>
  actionUrl?: string
  actionLabel?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function recipientList(override?: string[]) {
  const testAddress = process.env.NOTIFICATION_TEST_EMAIL?.trim()
  if (process.env.NOTIFICATION_MODE !== 'live') return testAddress ? [testAddress] : []
  if (override?.length) return override.map((email) => email.trim()).filter(Boolean)
  return (process.env.NOTIFICATION_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean)
}

function notificationHtml(details: NotificationDetails) {
  const rows = details.rows.map(({ label, value }) => `<tr><td style="padding:8px 12px 8px 0;color:#5b6d64;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:8px 0;color:#193f2e;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')
  const actionUrl = details.actionUrl || 'https://marys-team.vercel.app'
  const actionLabel = details.actionLabel || "Open Mary's Team"
  return `<div style="background:#f3f7f2;padding:28px 16px;font-family:Arial,sans-serif;color:#243b31"><div style="max-width:580px;margin:auto;background:#fff;border:1px solid #cedbd1;border-radius:16px;padding:28px"><p style="margin:0 0 8px;color:#4f7c61;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Mary's Team</p><h1 style="margin:0 0 14px;color:#193f2e;font-family:Georgia,serif;font-size:28px">${escapeHtml(details.heading)}</h1><p style="font-size:16px;line-height:1.55">${escapeHtml(details.intro)}</p><table style="width:100%;border-collapse:collapse;margin:18px 0">${rows}</table><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#285b44;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">${escapeHtml(actionLabel)}</a></div></div>`
}

function notificationText(details: NotificationDetails) {
  const actionUrl = details.actionUrl || 'https://marys-team.vercel.app'
  const actionLabel = details.actionLabel || "Open Mary's Team"
  return `${details.heading}\n\n${details.intro}\n\n${details.rows.map(({ label, value }) => `${label}: ${value}`).join('\n')}\n\n${actionLabel}: ${actionUrl}`
}

async function sendWithHighLevel(details: NotificationDetails, recipients: string[], token: string, locationId: string) {
  const fromEmail = process.env.GHL_FROM_EMAIL?.trim() || 'hello@gabrealinc.com'
  const html = notificationHtml(details)
  const message = notificationText(details)

  const receipts = await Promise.all(recipients.map(async (email) => {
    const upsertResponse = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      signal: AbortSignal.timeout(12000),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, locationId, source: "Mary's Team notifications" }),
    })
    if (!upsertResponse.ok) throw new Error(`HighLevel contact request failed with ${upsertResponse.status}`)
    const upsertData = await upsertResponse.json() as { contact?: { id?: string } }
    const contactId = upsertData.contact?.id
    if (!contactId) throw new Error('HighLevel did not return a contact ID')

    const messageResponse = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      signal: AbortSignal.timeout(12000),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-04-15', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type: 'Email', contactId, emailTo: email, emailFrom: fromEmail, subject: details.subject, html, message, status: 'pending' }),
    })
    if (!messageResponse.ok) throw new Error(`HighLevel email request failed with ${messageResponse.status}`)
    const result = await messageResponse.json() as { messageId?: string; id?: string }
    return { provider: 'ghl', messageId: result.messageId || result.id || '' }
  }))
  return receipts[0]
}

export async function deliverTeamNotification(details: NotificationDetails, recipientOverride?: string[]) {
  const highLevelToken = process.env.GHL_PRIVATE_TOKEN?.trim()
  const highLevelLocationId = process.env.GHL_LOCATION_ID?.trim()
  const recipients = recipientList(recipientOverride)
  if (highLevelToken && highLevelLocationId && recipients.length) return sendWithHighLevel(details, recipients, highLevelToken, highLevelLocationId)

  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASS?.replaceAll(' ', '')
  if (!user || !password || !recipients.length) return false

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
    connectionTimeout: 12000, socketTimeout: 15000,
  })
  const result = await transporter.sendMail({
    from: `Mary's Team <${user}>`,
    to: recipients,
    subject: details.subject,
    text: notificationText(details),
    html: notificationHtml(details),
  })
  return { provider: 'smtp', messageId: result.messageId || '' }
}

export async function sendTeamNotification(details: NotificationDetails, recipientOverride?: string[]) {
  return Boolean(await deliverTeamNotification(details, recipientOverride))
}

export async function checkMessageDelivery(messageId: string) {
  const token = process.env.GHL_PRIVATE_TOKEN?.trim()
  if (!token || !messageId) return null
  const response = await fetch(`https://services.leadconnectorhq.com/conversations/messages/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: '2021-04-15', Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Delivery status check failed (${response.status})`)
  const result = await response.json() as { status?: string; error?: string; message?: { status?: string; error?: string } }
  const message = result.message || result
  return { status: String(message.status || ''), error: String(message.error || '') }
}
