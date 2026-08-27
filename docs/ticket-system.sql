-- PackSMP ticket subsystem schema
-- Run this file against the dedicated PostgreSQL database referenced by TICKET_DATABASE_URL.
-- It intentionally contains no credentials or provider-specific connection settings.

CREATE TABLE IF NOT EXISTS ticket_counters (
  guild_id TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, ticket_type),
  CHECK (ticket_type IN ('rekrutacja', 'sojusz', 'konkurs', 'wsparcie', 'event', 'walka', 'inne')) ,
  CHECK (next_number > 0)
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  ticket_type TEXT NOT NULL,
  opener_id TEXT,
  claimed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  stage TEXT,
  category_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ticket_type IN ('rekrutacja', 'sojusz', 'konkurs', 'wsparcie', 'event', 'walka', 'inne')) ,
  CHECK (status IN ('open', 'closed', 'archived', 'deleted')) ,
  CHECK (stage IS NULL OR stage IN ('important', 'stage1', 'stage2', 'stage3', 'archive'))
);

CREATE INDEX IF NOT EXISTS tickets_guild_status_idx ON tickets (guild_id, status);
CREATE INDEX IF NOT EXISTS tickets_opener_open_idx ON tickets (guild_id, opener_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS tickets_claimed_by_idx ON tickets (guild_id, claimed_by) WHERE claimed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_created_idx ON ticket_events (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  discord_message_id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL,
  author_tag TEXT,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  embeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_sent_idx ON ticket_messages (ticket_id, sent_at);

CREATE OR REPLACE FUNCTION set_ticket_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_updated_at ON tickets;
CREATE TRIGGER tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION set_ticket_updated_at();