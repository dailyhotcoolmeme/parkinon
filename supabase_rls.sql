-- =============================================
-- 파킨온 (ParkinON) RLS 정책
-- Supabase Dashboard > SQL Editor에서 실행
-- =============================================

-- ─── users ────────────────────────────────────────────────────────────────────
-- 본인 데이터 read/write
create policy "users: 본인 read"
  on users for select
  using (auth.uid() = id);

create policy "users: 본인 update"
  on users for update
  using (auth.uid() = id);

create policy "users: 본인 insert"
  on users for insert
  with check (auth.uid() = id);

-- 같은 patient_group 멤버는 환자 데이터 read 가능
create policy "users: 같은 그룹 멤버 read"
  on users for select
  using (
    exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = users.id
    )
  );

-- ─── patient_groups ───────────────────────────────────────────────────────────
create policy "patient_groups: 멤버 read"
  on patient_groups for select
  using (
    exists (
      select 1 from patient_group_members
      where group_id = patient_groups.id
        and user_id = auth.uid()
    )
  );

create policy "patient_groups: 인증 유저 insert"
  on patient_groups for insert
  with check (auth.uid() is not null);

create policy "patient_groups: 멤버 update"
  on patient_groups for update
  using (
    exists (
      select 1 from patient_group_members
      where group_id = patient_groups.id
        and user_id = auth.uid()
    )
  );

-- ─── patient_group_members ────────────────────────────────────────────────────
create policy "patient_group_members: 같은 그룹 read"
  on patient_group_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from patient_group_members pgm
      where pgm.group_id = patient_group_members.group_id
        and pgm.user_id = auth.uid()
    )
  );

create policy "patient_group_members: 인증 유저 insert"
  on patient_group_members for insert
  with check (auth.uid() is not null);

create policy "patient_group_members: 본인 delete"
  on patient_group_members for delete
  using (user_id = auth.uid());

-- ─── medications ──────────────────────────────────────────────────────────────
create policy "medications: 환자 본인 read"
  on medications for select
  using (patient_id = auth.uid());

-- 보호자도 연동된 환자 약 read 가능
create policy "medications: 같은 그룹 보호자 read"
  on medications for select
  using (
    exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = medications.patient_id
    )
  );

create policy "medications: 환자 본인 insert"
  on medications for insert
  with check (patient_id = auth.uid());

create policy "medications: 환자 본인 update"
  on medications for update
  using (patient_id = auth.uid());

create policy "medications: 환자 본인 delete"
  on medications for delete
  using (patient_id = auth.uid());

-- ─── med_logs ─────────────────────────────────────────────────────────────────
create policy "med_logs: 환자 본인 또는 기록자 read"
  on med_logs for select
  using (
    patient_id = auth.uid()
    or logged_by = auth.uid()
    or exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = med_logs.patient_id
    )
  );

create policy "med_logs: 환자 또는 보호자 insert"
  on med_logs for insert
  with check (
    logged_by = auth.uid()
    and (
      patient_id = auth.uid()
      or exists (
        select 1 from patient_group_members pgm1
        join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
        where pgm1.user_id = auth.uid()
          and pgm2.user_id = med_logs.patient_id
      )
    )
  );

create policy "med_logs: 기록자 delete"
  on med_logs for delete
  using (logged_by = auth.uid());

-- ─── on_off_logs ──────────────────────────────────────────────────────────────
create policy "on_off_logs: 환자 본인 또는 기록자 read"
  on on_off_logs for select
  using (
    patient_id = auth.uid()
    or logged_by = auth.uid()
    or exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = on_off_logs.patient_id
    )
  );

create policy "on_off_logs: 환자 또는 보호자 insert"
  on on_off_logs for insert
  with check (
    logged_by = auth.uid()
    and (
      patient_id = auth.uid()
      or exists (
        select 1 from patient_group_members pgm1
        join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
        where pgm1.user_id = auth.uid()
          and pgm2.user_id = on_off_logs.patient_id
      )
    )
  );

create policy "on_off_logs: 기록자 delete"
  on on_off_logs for delete
  using (logged_by = auth.uid());

-- ─── exercise_logs ────────────────────────────────────────────────────────────
create policy "exercise_logs: 환자 본인 또는 기록자 read"
  on exercise_logs for select
  using (
    patient_id = auth.uid()
    or logged_by = auth.uid()
    or exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = exercise_logs.patient_id
    )
  );

create policy "exercise_logs: 환자 또는 보호자 insert"
  on exercise_logs for insert
  with check (
    logged_by = auth.uid()
    and (
      patient_id = auth.uid()
      or exists (
        select 1 from patient_group_members pgm1
        join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
        where pgm1.user_id = auth.uid()
          and pgm2.user_id = exercise_logs.patient_id
      )
    )
  );

create policy "exercise_logs: 기록자 delete"
  on exercise_logs for delete
  using (logged_by = auth.uid());

-- ─── symptom_notes ────────────────────────────────────────────────────────────
create policy "symptom_notes: 환자 본인 read"
  on symptom_notes for select
  using (
    patient_id = auth.uid()
    or exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = symptom_notes.patient_id
    )
  );

create policy "symptom_notes: 환자 본인 insert"
  on symptom_notes for insert
  with check (patient_id = auth.uid());

create policy "symptom_notes: 환자 본인 delete"
  on symptom_notes for delete
  using (patient_id = auth.uid());

-- ─── media_logs ───────────────────────────────────────────────────────────────
create policy "media_logs: 환자 본인 또는 기록자 read"
  on media_logs for select
  using (
    patient_id = auth.uid()
    or logged_by = auth.uid()
    or exists (
      select 1 from patient_group_members pgm1
      join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
      where pgm1.user_id = auth.uid()
        and pgm2.user_id = media_logs.patient_id
    )
  );

create policy "media_logs: 환자 또는 보호자 insert"
  on media_logs for insert
  with check (
    logged_by = auth.uid()
    and (
      patient_id = auth.uid()
      or exists (
        select 1 from patient_group_members pgm1
        join patient_group_members pgm2 on pgm1.group_id = pgm2.group_id
        where pgm1.user_id = auth.uid()
          and pgm2.user_id = media_logs.patient_id
      )
    )
  );

create policy "media_logs: 기록자 delete"
  on media_logs for delete
  using (logged_by = auth.uid());

-- ─── news_feed ────────────────────────────────────────────────────────────────
-- 모든 인증 유저 read only
create policy "news_feed: 인증 유저 read"
  on news_feed for select
  using (auth.uid() is not null);

-- ─── posts ────────────────────────────────────────────────────────────────────
-- 모든 인증 유저 read
create policy "posts: 인증 유저 read"
  on posts for select
  using (auth.uid() is not null);

-- 본인만 write
create policy "posts: 본인 insert"
  on posts for insert
  with check (author_id = auth.uid());

create policy "posts: 본인 update"
  on posts for update
  using (author_id = auth.uid());

create policy "posts: 본인 delete"
  on posts for delete
  using (author_id = auth.uid());

-- ─── comments ─────────────────────────────────────────────────────────────────
-- 모든 인증 유저 read
create policy "comments: 인증 유저 read"
  on comments for select
  using (auth.uid() is not null);

-- 본인만 write
create policy "comments: 본인 insert"
  on comments for insert
  with check (author_id = auth.uid());

create policy "comments: 본인 update"
  on comments for update
  using (author_id = auth.uid());

create policy "comments: 본인 delete"
  on comments for delete
  using (author_id = auth.uid());

-- ─── post_media ───────────────────────────────────────────────────────────────
-- 모든 인증 유저 read (게시글 미디어)
create policy "post_media: 인증 유저 read"
  on post_media for select
  using (auth.uid() is not null);

-- 게시글 작성자만 insert/delete
create policy "post_media: 게시글 작성자 insert"
  on post_media for insert
  with check (
    exists (
      select 1 from posts
      where id = post_media.post_id
        and author_id = auth.uid()
    )
  );

create policy "post_media: 게시글 작성자 delete"
  on post_media for delete
  using (
    exists (
      select 1 from posts
      where id = post_media.post_id
        and author_id = auth.uid()
    )
  );
