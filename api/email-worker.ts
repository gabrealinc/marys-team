import { neon } from '@neondatabase/serverless'
import { QueueClient } from '@vercel/queue'
import { runEmailJob, EmailRetry } from '../lib/outbox.js'

const queue = new QueueClient()
export default queue.handleNodeCallback<{ jobId: string; probeId?: string }>(async (message, metadata) => {
  if (!message.jobId || !/^[0-9a-f-]{36}$/i.test(message.jobId)) return
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('Email database is unavailable')
  const sql = neon(url)
  if (message.probeId === message.jobId) {
    await sql`INSERT INTO notification_log(notification_key) VALUES (${`queue-probe:${message.probeId}`}) ON CONFLICT DO NOTHING`
    return
  }
  await runEmailJob(sql, message.jobId, metadata.deliveryCount)
}, {
  retry: (error, metadata) => metadata.deliveryCount > 16 ? { acknowledge: true }
    : { afterSeconds: error instanceof EmailRetry ? error.afterSeconds : 300 },
})
