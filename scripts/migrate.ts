import { neon } from '@neondatabase/serverless'
import { migrate } from '../lib/schema.js'
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
if (process.env.VERCEL_ENV === 'production' || process.env.RUN_MIGRATIONS === '1') {
  if (!url) throw new Error('Database is required for deployment migrations')
  await migrate(neon(url))
  console.log('Database migrations complete')
} else console.log('Production migrations skipped for this build')
