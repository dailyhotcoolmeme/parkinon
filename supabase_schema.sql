-- =============================================
-- 파킨온 (ParkinON) Supabase Schema
-- =============================================

-- UUID extension
create extension if not exists "uuid-ossp";

-- =============================================
-- 1. users
-- =============================================
create table users (
  id uuid primary key default uuid_generate_v4(),
  kakao_id text unique,
  name text not null,
  birth_year int,
  gender text check (gender in ('male', 'female')),
  role text not null check (role in ('patient', 'caregiver')),
  caregiver_relation text check (caregiver_relation in ('spouse', 'child', 'sibling', 'other')),
  residence_type text check (residence_type in ('together', 'separate')),
  diagnosis_year int,
  patient_group_id uuid,
  onboarding_done boolean default false,
  notification_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- 2. patient_groups
-- =============================================
create table patient_groups (
  id uuid primary key default uuid_generate_v4(),
  invite_code char(6) unique not null,
  invite_code_expires_at timestamptz,
  created_at timestamptz default now()
);

-- =============================================
-- 3. patient_group_members
-- =============================================
create table patient_group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references patient_groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('patient', 'caregiver')),
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

-- =============================================
-- 4. medications
-- =============================================
create table medications (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  name text not null,
  dosage text,
  meal_times text[] default '{}',
  scheduled_times text[] default '{}',
  drug_code text,
  drug_image_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- =============================================
-- 5. med_logs
-- =============================================
create table med_logs (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  logged_by uuid not null references users(id),
  medication_id uuid references medications(id),
  taken_at timestamptz not null,
  meal_time text not null check (meal_time in ('morning', 'lunch', 'dinner', 'bedtime')),
  note text,
  created_at timestamptz default now()
);

-- =============================================
-- 6. on_off_logs
-- =============================================
create table on_off_logs (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  logged_by uuid not null references users(id),
  body_state int check (body_state between 1 and 5),
  mood int check (mood between 1 and 5),
  sleep_quality int check (sleep_quality between 1 and 5),
  constipation boolean,
  triggered_by text not null check (triggered_by in ('notification', 'manual')),
  trigger_time_label text, -- 'after_medication', '30min_after', '2hour_after'
  logged_at timestamptz not null,
  created_at timestamptz default now()
);

-- =============================================
-- 7. exercise_logs
-- =============================================
create table exercise_logs (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  logged_by uuid not null references users(id),
  exercise_type text not null,
  duration_minutes int not null,
  logged_at timestamptz not null,
  created_at timestamptz default now()
);

-- =============================================
-- 8. symptom_notes
-- =============================================
create table symptom_notes (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  note text not null,
  logged_at timestamptz not null,
  created_at timestamptz default now()
);

-- =============================================
-- 9. media_logs
-- =============================================
create table media_logs (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references users(id) on delete cascade,
  logged_by uuid not null references users(id),
  media_type text not null check (media_type in ('video', 'photo')),
  r2_key text not null,
  r2_url text not null,
  duration_seconds int,
  category text not null check (category in ('body_state', 'exercise')),
  logged_at timestamptz not null,
  expires_at timestamptz not null, -- 6개월 후 자동 삭제
  created_at timestamptz default now()
);

-- =============================================
-- 10. news_feed
-- =============================================
create table news_feed (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  url text not null unique,
  source text,
  thumbnail_url text,
  published_at timestamptz,
  created_at timestamptz default now()
);

-- =============================================
-- 11. posts
-- =============================================
create table posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references users(id) on delete cascade,
  post_type text not null check (post_type in ('chat', 'question', 'info', 'exercise', 'cheer')),
  title text not null,
  content text not null,
  view_count int default 0,
  like_count int default 0,
  comment_count int default 0,
  is_news boolean default false,
  news_url text,
  youtube_url text,
  youtube_thumbnail text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- 12. comments
-- =============================================
create table comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  content text not null,
  like_count int default 0,
  created_at timestamptz default now()
);

-- =============================================
-- 13. post_media
-- =============================================
create table post_media (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  r2_key text not null,
  r2_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  sort_order int default 0,
  created_at timestamptz default now()
);

-- =============================================
-- RLS (Row Level Security)
-- =============================================
alter table users enable row level security;
alter table patient_groups enable row level security;
alter table patient_group_members enable row level security;
alter table medications enable row level security;
alter table med_logs enable row level security;
alter table on_off_logs enable row level security;
alter table exercise_logs enable row level security;
alter table symptom_notes enable row level security;
alter table media_logs enable row level security;
alter table news_feed enable row level security;
alter table posts enable row level security;
alter table comments enable row level security;
alter table post_media enable row level security;

-- =============================================
-- 인덱스
-- =============================================
create index on med_logs (patient_id, taken_at desc);
create index on on_off_logs (patient_id, logged_at desc);
create index on on_off_logs (patient_id, triggered_by, logged_at desc);
create index on exercise_logs (patient_id, logged_at desc);
create index on posts (created_at desc);
create index on comments (post_id, created_at);
create index on news_feed (published_at desc);

-- =============================================
-- updated_at 자동 갱신 트리거
-- =============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at before update on users
  for each row execute function update_updated_at();

create trigger posts_updated_at before update on posts
  for each row execute function update_updated_at();
