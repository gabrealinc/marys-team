import { randomUUID } from 'node:crypto'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { checkMessageDelivery, deliverTeamNotification, recipientList } from './email.js'
import { scheduleEmailJob } from './email-queue.js'
import type { NotificationDetails } from './email.js'
type Sql = NeonQueryFunction<false, false>

export async function queueNotification(sql: Sql, key: string, details: NotificationDetails, override?: string[]) {
  const recipients = [...new Set(recipientList(override).map((email) => email.toLowerCase()))]
  // A missing configuration is visible in the private dashboard, never silently successful.
  if (!recipients.length) recipients.push('')
  for (const recipient of recipients) {
    const inserted = await sql`INSERT INTO email_outbox (id, notification_key, recipient, details, status, last_error)
      SELECT ${randomUUID()}, ${key}, ${recipient}, ${JSON.stringify(details)}::jsonb,
        ${recipient ? 'queued' : 'failed'}, ${recipient ? null : 'No notification recipient is configured.'}
      WHERE NOT EXISTS (SELECT 1 FROM notification_log WHERE notification_key = ${key})
      ON CONFLICT (notification_key, recipient) DO NOTHING RETURNING id`
    if (inserted.length && recipient) await scheduleEmailJob(sql, String(inserted[0].id))
  }
  return recipients.some(Boolean)
}

export async function processOutbox(sql: Sql, key = '', limit = 6, jobId = '') {
  // SKIP LOCKED plus a lease prevents two workers from sending the same job concurrently.
  const jobs = await sql`WITH due AS (
      SELECT id FROM email_outbox
      WHERE ((status IN ('queued', 'retry') AND next_attempt_at <= NOW()) OR (status = 'sending' AND locked_at < NOW() - INTERVAL '10 minutes'))
        AND (${key} = '' OR notification_key = ${key}) AND (${jobId} = '' OR id = ${jobId})
      ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) UPDATE email_outbox o SET status = 'sending', locked_at = NOW(), attempts = attempts + 1
      FROM due WHERE o.id = due.id RETURNING o.*`
  for (const job of jobs) {
    try {
      const receipt = await deliverTeamNotification(job.details as NotificationDetails, [String(job.recipient)])
      if (!receipt) throw new Error('Email sending is not configured. The message is saved for retry.')
      await sql`UPDATE email_outbox SET status = 'sent', sent_at = NOW(), locked_at = NULL,
        provider = ${receipt.provider}, provider_message_id = ${receipt.messageId}, last_error = NULL WHERE id = ${job.id}`
      if (String(job.notification_key).startsWith('request:')) {
        await sql`UPDATE support_requests SET notification_sent_at = NOW() WHERE id = ${String(job.notification_key).slice(8)}`
      }
    } catch (error) {
      const attempts = Number(job.attempts)
      const delayMinutes = Math.min(360, 5 * 2 ** Math.min(attempts - 1, 7))
      await sql`UPDATE email_outbox SET status = ${attempts >= 6 ? 'failed' : 'retry'}, locked_at = NULL,
        next_attempt_at = NOW() + ${delayMinutes} * INTERVAL '1 minute',
        last_error = ${error instanceof Error ? error.message.slice(0, 300) : 'Email sending failed'} WHERE id = ${job.id}`
    }
  }
  if (key) {
    const rows = await sql`SELECT status FROM email_outbox WHERE notification_key = ${key}`
    return rows.length > 0 && rows.every((row) => ['sent', 'delivered'].includes(String(row.status)))
  }
  return true
}

export async function checkOutboxDelivery(sql: Sql, jobId = '') {
  const jobs = await sql`SELECT id, provider_message_id FROM email_outbox WHERE status = 'sent' AND provider = 'ghl'
    AND (${jobId} = '' OR id = ${jobId}) AND provider_message_id <> '' AND sent_at > NOW() - INTERVAL '7 days'
    AND (checked_at IS NULL OR checked_at < NOW() - INTERVAL '30 minutes') ORDER BY checked_at ASC NULLS FIRST LIMIT 12`
  for (const job of jobs) {
    try {
      const result = await checkMessageDelivery(String(job.provider_message_id))
      const status = result && ['delivered', 'opened', 'read', 'clicked'].includes(result.status) ? 'delivered'
        : result && ['failed', 'undelivered', 'opt_out'].includes(result.status) ? 'bounced' : 'sent'
      await sql`UPDATE email_outbox SET status = ${status}, checked_at = NOW(),
        last_error = ${status === 'bounced' ? result?.error || 'The email provider could not deliver this message. Check the address before retrying.' : null} WHERE id = ${job.id}`
    } catch {
      await sql`UPDATE email_outbox SET checked_at = NOW(), last_error = 'Delivery could not be checked. Sent does not confirm receipt.' WHERE id = ${job.id}`
    }
  }
}

export async function notificationSummary(sql: Sql) {
  return sql`SELECT id, recipient, details->>'subject' AS subject, status, attempts, last_error AS "lastError",
    (scheduled_at IS NOT NULL) AS "retryScheduled", created_at AS "createdAt", sent_at AS "sentAt", next_attempt_at AS "nextAttemptAt"
    FROM email_outbox ORDER BY (status IN ('failed', 'bounced', 'retry')) DESC, created_at DESC LIMIT 40`
}

export async function supersedeNotifications(sql: Sql, prefix: string, except = '') {
  await sql`UPDATE email_outbox SET status = 'superseded', last_error = NULL
    WHERE starts_with(notification_key, ${prefix}) AND notification_key <> ${except} AND status IN ('queued', 'retry', 'failed', 'bounced')`
}

export async function supersedeEventEmails(sql: Sql, eventId: string, except = '') {
  const url = `https://marys-team.vercel.app/api/data?calendar=${encodeURIComponent(eventId)}`
  await sql`UPDATE email_outbox SET status = 'superseded', last_error = NULL
    WHERE details->>'actionUrl' = ${url} AND notification_key <> ${except}
      AND status IN ('queued', 'retry', 'failed', 'bounced')`
}

export class EmailRetry extends Error {
  constructor(public afterSeconds: number) { super('Email work is waiting for its next attempt') }
}
export async function runEmailJob(sql: Sql, id: string, deliveryCount: number) {
  await processOutbox(sql, '', 1, id)
  await checkOutboxDelivery(sql, id)
  const jobs = await sql`SELECT status, next_attempt_at, locked_at, provider FROM email_outbox WHERE id = ${id}`
  const job = jobs[0]
  if (!job) return
  if (['queued', 'retry', 'sending'].includes(String(job.status))) {
    const delay = Math.ceil((new Date(String(job.next_attempt_at)).getTime() - Date.now()) / 1000)
    throw new EmailRetry(Math.max(60, Math.min(21600, delay)))
  }
  // A handful of delivery checks, rather than keeping the database awake by polling.
  if (job.status === 'sent' && job.provider === 'ghl' && deliveryCount < 5) {
    throw new EmailRetry([900, 3600, 21600, 86400][Math.max(0, deliveryCount - 1)] || 86400)
  }
}
