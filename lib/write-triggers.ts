import type { NeonQueryFunction } from '@neondatabase/serverless'

// Link only the row being saved. Reads never repair or rewrite the directory.
export async function installWriteTriggers(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE OR REPLACE FUNCTION person_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE lower(regexp_replace(trim(value), '[[:space:]]+', ' ', 'g'))
      WHEN 'mary' THEN 'mary greenberg' WHEN 'stu' THEN 'stu greenberg' WHEN 'stuart' THEN 'stu greenberg'
      WHEN 'stuart greenberg' THEN 'stu greenberg' WHEN 'gabby' THEN 'gabby greenberg' WHEN 'gabrielle' THEN 'gabby greenberg'
      WHEN 'gabrielle greenberg' THEN 'gabby greenberg' WHEN 'spencer' THEN 'spencer greenberg'
      ELSE lower(regexp_replace(trim(value), '[[:space:]]+', ' ', 'g')) END
  $$`
  await sql`CREATE OR REPLACE FUNCTION link_saved_person() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data jsonb := to_jsonb(NEW); contact_name text; contact_phone text; contact_email text; key text; person directory_people%ROWTYPE;
    BEGIN
      contact_name := trim(coalesce(row_data->>TG_ARGV[0], ''));
      IF contact_name = '' THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[3], NULL)); RETURN NEW;
      END IF;
      key := person_name_key(contact_name);
      contact_phone := coalesce(row_data->>TG_ARGV[1], ''); contact_email := coalesce(row_data->>TG_ARGV[2], '');
      SELECT * INTO person FROM directory_people
        WHERE id = row_data->>TG_ARGV[3] OR alias_keys @> ARRAY[key]
        ORDER BY (id = coalesce(row_data->>TG_ARGV[3], '')) DESC LIMIT 1;
      IF person.id IS NULL THEN
        INSERT INTO directory_people(id, name, phone, email, alias_keys)
          VALUES ('person-' || md5(key), contact_name, contact_phone, contact_email, ARRAY[key])
          ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING * INTO person;
      ELSE
        UPDATE directory_people SET phone = CASE WHEN phone = '' THEN contact_phone ELSE phone END,
          email = CASE WHEN email = '' THEN contact_email ELSE email END
          WHERE id = person.id AND ((phone = '' AND contact_phone <> '') OR (email = '' AND contact_email <> ''));
      END IF;
      NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[3], person.id)); RETURN NEW;
    END
  $$`
  await sql`CREATE OR REPLACE TRIGGER link_event_person BEFORE INSERT OR UPDATE OF helper, helper_phone, helper_email, helper_person_id ON team_events FOR EACH ROW EXECUTE FUNCTION link_saved_person('helper', 'helper_phone', 'helper_email', 'helper_person_id')`
  await sql`CREATE OR REPLACE TRIGGER link_request_person BEFORE INSERT OR UPDATE OF requester_name, requester_phone, requester_email, person_id ON support_requests FOR EACH ROW EXECUTE FUNCTION link_saved_person('requester_name', 'requester_phone', 'requester_email', 'person_id')`
  await sql`CREATE OR REPLACE TRIGGER link_availability_person BEFORE INSERT OR UPDATE OF name, phone, email, person_id ON availability FOR EACH ROW EXECUTE FUNCTION link_saved_person('name', 'phone', 'email', 'person_id')`
  await sql`CREATE OR REPLACE TRIGGER link_care_person BEFORE INSERT OR UPDATE OF name, phone, email, person_id ON care_team FOR EACH ROW EXECUTE FUNCTION link_saved_person('name', 'phone', 'email', 'person_id')`
  await sql`CREATE OR REPLACE TRIGGER link_contact_person BEFORE INSERT OR UPDATE OF name, phone, email, person_id ON support_contacts FOR EACH ROW EXECUTE FUNCTION link_saved_person('name', 'phone', 'email', 'person_id')`
  await sql`CREATE OR REPLACE FUNCTION maintain_food_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_id text; food team_events%ROWTYPE; reserved_id text;
    BEGIN
      IF TG_TABLE_NAME = 'team_events' THEN target_id := coalesce(NEW.id, OLD.id);
      ELSE target_id := coalesce(NEW.event_id, OLD.event_id); END IF;
      SELECT * INTO food FROM team_events WHERE id = target_id;
      IF food.proposal_type = 'food' AND (coalesce(trim(food.helper), '') <> '' OR EXISTS (SELECT 1 FROM support_requests WHERE event_id = target_id AND status = 'pending')) THEN
        DELETE FROM food_reservations WHERE event_id = target_id AND food_date <> substring(food.event_date, 1, 8);
        INSERT INTO food_reservations(food_date, event_id) VALUES (substring(food.event_date, 1, 8), target_id)
          ON CONFLICT(food_date) DO UPDATE SET event_id = EXCLUDED.event_id WHERE food_reservations.event_id = EXCLUDED.event_id
          RETURNING event_id INTO reserved_id;
        IF reserved_id IS NULL THEN RAISE EXCEPTION 'Food is already booked for this day' USING ERRCODE = '23505'; END IF;
      ELSIF TG_OP <> 'INSERT' THEN DELETE FROM food_reservations WHERE event_id = target_id;
      END IF;
      RETURN NULL;
    END
  $$`
  await sql`CREATE OR REPLACE TRIGGER food_event_reservation AFTER INSERT OR UPDATE OR DELETE ON team_events FOR EACH ROW EXECUTE FUNCTION maintain_food_reservation()`
  await sql`CREATE OR REPLACE TRIGGER food_request_reservation AFTER INSERT OR UPDATE OR DELETE ON support_requests FOR EACH ROW EXECUTE FUNCTION maintain_food_reservation()`
}
