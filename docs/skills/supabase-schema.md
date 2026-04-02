# Supabase 스키마 & 쿼리 패턴

## 테이블 구조

### users
```sql
create table users (
  id uuid references auth.users primary key,
  name text not null,
  birth_year int,
  gender text check (gender in ('male', 'female')),
  role text check (role in ('patient', 'caregiver')) not null,
  kakao_id text unique,
  created_at timestamptz default now()
);
```

### patient_profiles
```sql
create table patient_profiles (
  user_id uuid references users primary key,
  diagnosed_year int
);
```

### caregiver_profiles
```sql
create table caregiver_profiles (
  user_id uuid references users primary key,
  relation text check (relation in ('spouse', 'child', 'sibling', 'other')),
  lives_together boolean default false
);
```

### patient_groups
```sql
create table patient_groups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  created_at timestamptz default now()
);
```

### patient_group_members
```sql
create table patient_group_members (
  group_id uuid references patient_groups,
  user_id uuid references users,
  primary key (group_id, user_id)
);
```

### invite_codes
```sql
create table invite_codes (
  code text primary key,
  created_by uuid references users,
  patient_id uuid references users,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz default now()
);
```

### medications
```sql
create table medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  name text not null,
  dosage text,
  image_url text,
  frequency int,
  time_slots jsonb, -- [{ slot: 'morning', time: '08:00', after_meal: false }]
  created_at timestamptz default now()
);
```

### med_logs
```sql
create table med_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  time_slot text check (time_slot in ('morning', 'lunch', 'evening', 'bedtime')),
  taken_at timestamptz not null,
  taken_by uuid references users,
  is_proxy boolean default false,
  created_at timestamptz default now()
);
```

### on_off_logs
```sql
-- triggered_by: 'notification' = 알림 통해 입력, 'manual' = 수시 입력
-- triggered_by = 'notification' 기록만 기록보기 약효패턴에 반영
create table on_off_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  recorded_at timestamptz not null,
  body_score int check (body_score between 1 and 5),
  mood_score int check (mood_score between 1 and 5),
  sleep_score int check (sleep_score between 1 and 5),
  constipation boolean,
  triggered_by text check (triggered_by in ('notification', 'manual')),
  time_slot text, -- 'immediate', '30min', '2hour'
  med_log_id uuid references med_logs,
  created_by uuid references users,
  is_proxy boolean default false
);
```

### exercise_logs
```sql
create table exercise_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  exercise_type text not null,
  duration_minutes int not null,
  exercised_at timestamptz not null,
  recorded_by uuid references users,
  is_proxy boolean default false,
  created_at timestamptz default now()
);
```

### media_logs
```sql
create table media_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references users not null,
  r2_url text not null,
  duration_seconds int,
  recorded_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);
```

### news_feed
```sql
create table news_feed (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text unique not null,
  thumbnail text,
  source text,
  published_at timestamptz,
  created_at timestamptz default now()
);
```

### posts
```sql
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references users not null,
  post_type text check (post_type in ('chat', 'question', 'info', 'exercise', 'cheer')),
  title text not null,
  content text,
  youtube_url text,
  view_count int default 0,
  like_count int default 0,
  created_at timestamptz default now()
);
```

### post_media
```sql
create table post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts on delete cascade,
  r2_url text not null,
  order_index int default 0
);
```

### comments
```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts on delete cascade,
  author_id uuid references users not null,
  parent_id uuid references comments,
  content text not null,
  like_count int default 0,
  created_at timestamptz default now()
);
```

### likes
```sql
create table likes (
  user_id uuid references users,
  target_id uuid,
  target_type text check (target_type in ('post', 'comment')),
  primary key (user_id, target_id, target_type)
);
```

---

## 주요 쿼리 패턴

### 오늘 복용 현황 조회
```typescript
const today = new Date().toISOString().split('T')[0];
const { data } = await supabase
  .from('med_logs')
  .select('*')
  .eq('patient_id', patientId)
  .gte('taken_at', `${today}T00:00:00`)
  .lte('taken_at', `${today}T23:59:59`);
```

### 약효 패턴용 기록 조회 (notification만)
```typescript
const { data } = await supabase
  .from('on_off_logs')
  .select('*')
  .eq('patient_id', patientId)
  .eq('triggered_by', 'notification')
  .gte('recorded_at', startDate)
  .lte('recorded_at', endDate);
```

### 피드 무한스크롤
```typescript
const { data } = await supabase
  .from('posts')
  .select('*, author:users(name, role), media:post_media(*)')
  .order('created_at', { ascending: false })
  .range(page * limit, (page + 1) * limit - 1);
```
