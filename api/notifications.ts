import { neon } from '@neondatabase/serverless'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { timingSafeEqual } from 'node:crypto'
import { checkOutboxDelivery, processOutbox } from '../lib/outbox.js'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  const expected = process.env.CRON_SECRET ? Buffer.from(`Bearer ${process.env.CRON_SECRET}`) : null
  const actual = Buffer.from(String(request.headers.authorization || ''))
  if (!expected || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response.status(401).json({ error: 'Unauthorized' })
  if (request.method !== 'GET') return response.status(405).end()
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) return response.status(503).json({ error: 'Database is not connected' })
  try {
    const sql = neon(url)
    await processOutbox(sql)
    await checkOutboxDelivery(sql)
    return response.status(200).json({ processed: true })
  } catch {
    return response.status(500).json({ error: 'Email processing failed; queued messages remain saved.' })
  }
}
