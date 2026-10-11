/** مهاجرت‌های پایگاه داده — هر آیتم باید خودکفا و بازتولیدپذیر باشد.
 *  نیازمند PostgreSQL >= 13 برای gen_random_uuid داخلی. */

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_init_core_tables',
    sql: `
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 500),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  price_toman integer NOT NULL CHECK (price_toman >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sku text NOT NULL UNIQUE CHECK (sku ~ '^[A-Za-z0-9-]+$'),
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'draft', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 2200),
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'scheduled')),
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drafts_scheduled_need_time CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)
);
CREATE INDEX content_drafts_product_idx ON content_drafts(product_id);
CREATE INDEX content_drafts_scheduled_idx ON content_drafts(scheduled_at);

CREATE TABLE publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES content_drafts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishing_jobs_status_idx ON publishing_jobs(status);
CREATE INDEX publishing_jobs_due_idx ON publishing_jobs(scheduled_at) WHERE status = 'pending';

CREATE TABLE integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE CHECK (provider IN ('instagram', 'telegram')),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  account_ref text,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connected_needs_account CHECK (status <> 'connected' OR account_ref IS NOT NULL)
);

CREATE TABLE operational_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  level text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  event text NOT NULL CHECK (length(event) <= 200),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operational_logs_created_idx ON operational_logs(created_at DESC);
`,
  },
  {
    id: '002_instagram_credentials',
    sql: `
CREATE TABLE instagram_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE CHECK (provider IN ('instagram')),
  token_ciphertext text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: '003_publishing_jobs_scheduling',
    sql: `
-- مرحله ۸: زمان‌بندی ماندگار انتشار. جدول publishing_jobs تاکنون نوشته نشده و خالی است،
-- لذا افزودن ستون image_url بدون پیش‌فرض ایمن است.
ALTER TABLE publishing_jobs
  ADD COLUMN image_url text NOT NULL,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN next_run_at timestamptz,
  ADD COLUMN container_id text,
  ADD COLUMN published_media_id text,
  ADD COLUMN provider_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN error_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE publishing_jobs
  ADD CONSTRAINT publishing_jobs_pending_needs_next_run CHECK (status <> 'pending' OR next_run_at IS NOT NULL);
ALTER TABLE publishing_jobs
  ADD CONSTRAINT publishing_jobs_succeeded_needs_confirmation
  CHECK (status <> 'succeeded' OR (provider_confirmed AND published_media_id IS NOT NULL));

DROP INDEX publishing_jobs_due_idx;
CREATE INDEX publishing_jobs_due_idx ON publishing_jobs(next_run_at) WHERE status = 'pending';

CREATE TABLE publishing_job_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES publishing_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt >= 1),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed_permanent', 'failed_transient')),
  error_code text,
  error_message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX publishing_job_attempts_job_idx ON publishing_job_attempts(job_id);
`,
  },
  {
    id: '004_engagement_core',
    sql: `
-- صندوق گفت‌وگوی یکپارچه (پیام مستقیم + نظرات) با سه عمل ارسال متمایز و ممیزی کامل.
CREATE TABLE engagement_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('direct','comment')),
  instagram_conversation_id text UNIQUE,
  instagram_comment_id text UNIQUE,
  media_id text,
  customer_id text NOT NULL,
  customer_username text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_attention','resolved')),
  sales_stage text NOT NULL DEFAULT 'new' CHECK (sales_stage IN ('new','qualified','order_initiated','completed','unresolved')),
  escalated boolean NOT NULL DEFAULT false,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_intent text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_channel_source CHECK (
    (channel = 'direct' AND instagram_conversation_id IS NOT NULL)
    OR (channel = 'comment' AND instagram_comment_id IS NOT NULL)
  )
);
CREATE INDEX engagement_conversations_last_msg_idx ON engagement_conversations(last_message_at DESC);
CREATE INDEX engagement_conversations_customer_idx ON engagement_conversations(customer_id);

CREATE TABLE engagement_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES engagement_conversations(id) ON DELETE CASCADE,
  external_id text UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel text NOT NULL CHECK (channel IN ('direct','comment_public','comment_private')),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  intent text,
  confidence real,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high')),
  needs_human boolean NOT NULL DEFAULT false,
  response_status text CHECK (response_status IN ('needs_reply','replied','escalated','no_action')),
  sent_by text NOT NULL DEFAULT 'customer' CHECK (sent_by IN ('customer','owner','automation')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_messages_conversation_idx ON engagement_messages(conversation_id, created_at);

CREATE TABLE engagement_reply_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES engagement_conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES engagement_messages(id) ON DELETE SET NULL,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 5000),
  intent text,
  needs_human boolean NOT NULL DEFAULT false,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high')),
  grounded_on jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'rule_based' CHECK (source IN ('rule_based','ai_generated')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','sent','failed')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_suggestions_conversation_idx ON engagement_reply_suggestions(conversation_id, created_at DESC);

CREATE TABLE engagement_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (length(action) <= 100),
  actor text NOT NULL CHECK (actor IN ('owner','automation','webhook')),
  conversation_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed','blocked')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_audit_created_idx ON engagement_audit_log(created_at DESC);

CREATE TABLE engagement_automation_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  auto_intents text[] NOT NULL DEFAULT '{}',
  business_hours jsonb NOT NULL DEFAULT '{"days":[6,0,1,2,3],"start":"09:00","end":"21:00"}'::jsonb,
  duplicate_window_minutes integer NOT NULL DEFAULT 60 CHECK (duplicate_window_minutes BETWEEN 1 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO engagement_automation_config (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
`,
  },
];
