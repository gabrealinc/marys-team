import nodemailer from 'nodemailer'

type NotificationDetails = {
  subject: string
  heading: string
  intro: string
  rows: Array<{ label: string; value: string }>
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function recipientList() {
  const testAddress = process.env.NOTIFICATION_TEST_EMAIL?.trim()
  if (process.env.NOTIFICATION_MODE !== 'live') return testAddress ? [testAddress] : []
  return (process.env.NOTIFICATION_EMAILS || '').split(',').map((email) => email.trim()).filter(Boolean)
}

export async function sendTeamNotification(details: NotificationDetails) {
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASS?.replaceAll(' ', '')
  const recipients = recipientList()
  if (!user || !password || !recipients.length) return false

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: password },
  })
  const rows = details.rows.map(({ label, value }) => `<tr><td style="padding:8px 12px 8px 0;color:#5b6d64;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:8px 0;color:#193f2e;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')

  await transporter.sendMail({
    from: `Mary's Team <${user}>`,
    to: recipients,
    subject: details.subject,
    text: `${details.heading}\n\n${details.intro}\n\n${details.rows.map(({ label, value }) => `${label}: ${value}`).join('\n')}\n\nOpen Mary's Team: https://marys-team.vercel.app`,
    html: `<div style="background:#f3f7f2;padding:28px 16px;font-family:Arial,sans-serif;color:#243b31"><div style="max-width:580px;margin:auto;background:#fff;border:1px solid #cedbd1;border-radius:16px;padding:28px"><p style="margin:0 0 8px;color:#4f7c61;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Mary's Team</p><h1 style="margin:0 0 14px;color:#193f2e;font-family:Georgia,serif;font-size:28px">${escapeHtml(details.heading)}</h1><p style="font-size:16px;line-height:1.55">${escapeHtml(details.intro)}</p><table style="width:100%;border-collapse:collapse;margin:18px 0">${rows}</table><a href="https://marys-team.vercel.app" style="display:inline-block;background:#285b44;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Open Mary's Team</a></div></div>`,
  })
  return true
}
