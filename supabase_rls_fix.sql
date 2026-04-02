-- =============================================
-- RLS 무한재귀 수정 패치
-- Supabase Dashboard > SQL Editor (avqaflxufyadgzjiojkk) 에서 실행
-- =============================================

-- ① 재귀 원인 정책 제거
DROP POLICY IF EXISTS "users: 같은 그룹 멤버 read" ON public.users;
DROP POLICY IF EXISTS "patient_group_members: 같은 그룹 read" ON public.patient_group_members;

-- ② patient_group_members: 본인 행만 조회 (자기참조 제거)
CREATE POLICY "patient_group_members: 본인 read"
  ON public.patient_group_members FOR SELECT
  USING (user_id = auth.uid());

-- ③ 그룹 멤버십 체크 함수 (SECURITY DEFINER → RLS 우회하여 재귀 방지)
CREATE OR REPLACE FUNCTION public.is_same_patient_group(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM patient_group_members pgm1
    JOIN patient_group_members pgm2 ON pgm1.group_id = pgm2.group_id
    WHERE pgm1.user_id = auth.uid()
      AND pgm2.user_id = target_user_id
  );
$$;

-- ④ users: 같은 그룹 멤버 read (함수 사용으로 재귀 없음)
CREATE POLICY "users: 같은 그룹 멤버 read"
  ON public.users FOR SELECT
  USING (public.is_same_patient_group(id));
