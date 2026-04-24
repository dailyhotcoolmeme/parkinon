-- patient_groups / patient_group_members 테이블 생성 및 RLS 정책
-- 무한 재귀 방지를 위해 patient_groups RLS는 patient_group_members 직접 조회 방식 사용

-- patient_groups 테이블
CREATE TABLE IF NOT EXISTS public.patient_groups (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invite_code           char(6) NOT NULL,
  invite_code_expires_at timestamptz,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE public.patient_groups ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 insert 가능 (온보딩 시 그룹 생성)
CREATE POLICY "patient_groups: 인증 유저 insert"
  ON public.patient_groups
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 초대코드 조회는 인증 유저 전체 허용 (연동 시 코드 검색)
CREATE POLICY "patient_groups: 초대코드 조회"
  ON public.patient_groups
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 같은 그룹 멤버만 update
CREATE POLICY "patient_groups: 멤버 update"
  ON public.patient_groups
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_group_members
      WHERE patient_group_members.group_id = patient_groups.id
        AND patient_group_members.user_id = auth.uid()
    )
  );

-- 같은 그룹 멤버만 delete
CREATE POLICY "patient_groups: 멤버 delete"
  ON public.patient_groups
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_group_members
      WHERE patient_group_members.group_id = patient_groups.id
        AND patient_group_members.user_id = auth.uid()
    )
  );

-- patient_group_members 테이블
CREATE TABLE IF NOT EXISTS public.patient_group_members (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id  uuid NOT NULL REFERENCES public.patient_groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role      text NOT NULL,
  joined_at timestamptz DEFAULT now()
);

ALTER TABLE public.patient_group_members ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자는 insert 가능 (그룹 가입)
CREATE POLICY "pgm_insert_auth"
  ON public.patient_group_members
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 같은 그룹 멤버만 select — users.patient_group_id 기준으로 재귀 없이 조회
CREATE POLICY "pgm_select_same_group"
  ON public.patient_group_members
  FOR SELECT
  USING (
    group_id = (
      SELECT users.patient_group_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

-- 본인 멤버십만 delete (연동 해제)
CREATE POLICY "pgm_delete_own"
  ON public.patient_group_members
  FOR DELETE
  USING (user_id = auth.uid());
