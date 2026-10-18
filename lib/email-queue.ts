import { send } from '@vercel/queue'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export async function scheduleEmailJob(sql: NeonQueryFunction<false, false>, jobId: string) {
  if (process.env.VERCEL_ENV !== 'production') return
  try {
    // Only an opaque job ID leaves the database; message text and contacts stay there.
    await send('care-email-updates', { jobId }, { delaySeconds: 60, retentionSeconds: 172800 })
    await sql`UPDATE email_outbox SET scheduled_at = NOW() WHERE id = ${jobId}`
  } catch {
    await sql`UPDATE email_outbox SET scheduled_at = NULL,
      last_error = 'Automatic retry scheduling is unavailable. This message remains saved; use Retry email or the daily recovery job.' WHERE id = ${jobId}`
  }
}
