import type { NeonQueryFunction } from '@neondatabase/serverless'
import { ensureDirectory, synchronizeDirectory } from './directory.js'
import { installWriteTriggers } from './write-triggers.js'
const defaultEventDetails = 'Please sign up through this website and wait for confirmation. No social visits or drop-ins. Thank you for respecting any schedule changes.'
export async function migrate(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE TABLE IF NOT EXISTS app_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  if ((await sql`SELECT version FROM app_migrations WHERE version = '20261018-priorities-v1'`).length) return
  await sql`
    CREATE TABLE IF NOT EXISTS team_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      event_date TEXT NOT NULL,
      day_label TEXT NOT NULL,
      event_time TEXT NOT NULL,
      end_time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      location TEXT,
      help_needed TEXT NOT NULL,
      helper TEXT,
      helper_phone TEXT,
      helper_email TEXT,
      repeat_group_id TEXT,
      for_who TEXT NOT NULL DEFAULT 'Family',
      schedule_source TEXT,
      is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE,
      is_flexible BOOLEAN NOT NULL DEFAULT FALSE,
      is_proposed BOOLEAN NOT NULL DEFAULT FALSE,
      proposal_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS availability (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      available_day TEXT NOT NULL,
      available_time TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS owner_key_hash TEXT`
  await sql`ALTER TABLE availability ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`
  await sql`UPDATE availability SET owner_key_hash = 'legacy-organizer-only' WHERE owner_key_hash IS NULL`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_phone TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS helper_email TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS repeat_group_id TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS for_who TEXT NOT NULL DEFAULT 'Family'`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS schedule_source TEXT`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_schedule_exception BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_flexible BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS is_proposed BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE team_events ADD COLUMN IF NOT EXISTS proposal_type TEXT`
  await sql`
    CREATE TABLE IF NOT EXISTS food_settings (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      weekdays TEXT NOT NULL DEFAULT '1,3',
      start_time TEXT NOT NULL DEFAULT '14:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`INSERT INTO food_settings (singleton, weekdays, start_time, end_time) VALUES (TRUE, '1,3', '14:00', '18:00') ON CONFLICT (singleton) DO NOTHING`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS home_address TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS visitor_preferences TEXT`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS visit_start_time TEXT NOT NULL DEFAULT '10:00'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS visit_end_time TEXT NOT NULL DEFAULT '17:00'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS stu_in_town BOOLEAN NOT NULL DEFAULT TRUE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS gabby_in_town BOOLEAN NOT NULL DEFAULT TRUE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS spencer_in_town BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS stu_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS gabby_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS spencer_in_town_dates TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS food_overview TEXT NOT NULL DEFAULT 'Meals are for two people. We generally enjoy whole foods with a protein, vegetables, and a grain. Chicken is our first choice. Steak or beef is welcome when it fits the dish.'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS food_avoid TEXT NOT NULL DEFAULT 'No pork.'`
  await sql`ALTER TABLE food_settings ADD COLUMN IF NOT EXISTS food_suggestions TEXT NOT NULL DEFAULT '[{"id":"mendocino-farms","type":"restaurant","name":"Mendocino Farms","items":[],"note":""}]'`
  await sql`UPDATE team_events SET title = 'Stu at Work' WHERE schedule_source = 'stu_work' AND title <> 'Stu at Work'`
  await sql`UPDATE team_events SET details = ${defaultEventDetails} WHERE TRIM(details) = '' OR details = 'See Mary or Stu for details.' OR details = 'Text Mary directly if you have any questions.'`
  await sql`UPDATE team_events SET for_who = 'Mary' WHERE category = 'appointment' AND for_who = 'Family'`
  await sql`UPDATE team_events SET for_who = 'Stu' WHERE category = 'dad' AND for_who = 'Family'`
  await sql`
    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES team_events(id) ON DELETE CASCADE,
      requester_name TEXT NOT NULL,
      requester_phone TEXT NOT NULL,
      requester_email TEXT NOT NULL DEFAULT '',
      approval_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      notification_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    )
  `
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS requester_email TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS decline_reason TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_start_time TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_end_time TEXT`
  await sql`ALTER TABLE support_requests ADD COLUMN IF NOT EXISTS request_note TEXT NOT NULL DEFAULT ''`
  await sql`
    CREATE TABLE IF NOT EXISTS care_team (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'Helper',
      weekdays TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS support_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS one_pending_request_per_event ON support_requests(event_id) WHERE status = 'pending'`
  await sql`
    CREATE TABLE IF NOT EXISTS notification_log (
      notification_key TEXT PRIMARY KEY,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS organizer_login_attempts (
      attempt_key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS stu_work_defaults (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS stu_work_exceptions (
      work_date TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS family_work_defaults (
      person TEXT PRIMARY KEY CHECK (person IN ('Stu', 'Gabby', 'Spencer')),
      weekdays TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '17:00',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS family_work_exceptions (
      person TEXT NOT NULL CHECK (person IN ('Stu', 'Gabby', 'Spencer')),
      work_date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (person, work_date)
    )
  `
  await sql`
    INSERT INTO family_work_defaults (person, weekdays, start_time, end_time)
    SELECT 'Stu', weekdays, start_time, end_time FROM stu_work_defaults
    ON CONFLICT (person) DO NOTHING
  `
  await sql`
    INSERT INTO family_work_exceptions (person, work_date)
    SELECT 'Stu', work_date FROM stu_work_exceptions
    ON CONFLICT (person, work_date) DO NOTHING
  `
  await sql`CREATE TABLE IF NOT EXISTS food_reservations (food_date TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE)`
  await sql`DELETE FROM food_reservations r WHERE NOT EXISTS (SELECT 1 FROM team_events e WHERE e.id = r.event_id AND e.proposal_type = 'food' AND (COALESCE(e.helper, '') <> '' OR EXISTS (SELECT 1 FROM support_requests WHERE event_id = e.id AND status = 'pending')))`
  await sql`INSERT INTO food_reservations (food_date, event_id) SELECT DISTINCT ON (SUBSTRING(event_date, 1, 8)) SUBSTRING(event_date, 1, 8), id FROM team_events WHERE proposal_type = 'food' AND (COALESCE(helper, '') <> '' OR EXISTS (SELECT 1 FROM support_requests WHERE event_id = team_events.id AND status = 'pending')) ORDER BY SUBSTRING(event_date, 1, 8), (COALESCE(helper, '') <> '') DESC, created_at ASC ON CONFLICT DO NOTHING`

  await ensureDirectory(sql)
  await synchronizeDirectory(sql)
  await installWriteTriggers(sql)
  await sql`CREATE INDEX IF NOT EXISTS team_events_date_key ON team_events (SUBSTRING(event_date, 1, 8))`
  await sql`CREATE INDEX IF NOT EXISTS availability_owner_day ON availability (owner_key_hash, available_day)`
  await sql`CREATE INDEX IF NOT EXISTS support_requests_event_status ON support_requests (event_id, status)`
  await sql`CREATE INDEX IF NOT EXISTS directory_alias_keys ON directory_people USING GIN (alias_keys)`
  await sql`CREATE TABLE IF NOT EXISTS email_outbox (
    id TEXT PRIMARY KEY, notification_key TEXT NOT NULL, recipient TEXT NOT NULL, details JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_at TIMESTAMPTZ, locked_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, checked_at TIMESTAMPTZ, provider TEXT, provider_message_id TEXT,
    last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(notification_key, recipient)
  )`
  await sql`CREATE INDEX IF NOT EXISTS email_outbox_due ON email_outbox(next_attempt_at) WHERE status IN ('queued', 'retry', 'sending')`
  await sql`CREATE TABLE IF NOT EXISTS schedule_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, items JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`INSERT INTO app_migrations (version) VALUES ('20261018-priorities-v1') ON CONFLICT DO NOTHING`
}
