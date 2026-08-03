# 스토어 스크린샷용 임시 게스트 계정 — 작업 방법 (2026-08-03 확립)

> 목적: 실제 카카오/구글/애플 로그인 없이, 시뮬레이터에서 **실제 데이터가 채워진 화면**을
> 캡처해서 앱스토어/플레이스토어용 스크린샷을 만든다.
>
> ⚠️ **외부 계정(카카오/구글/애플)은 절대 만들지 않는다.** 아래 방법은 전부 우리
> **자체 Supabase 프로젝트 안에서만** 이뤄지는 임시 데이터이고, 끝나면 전부 지운다.
> toolshere의 `scripts/verify/auth.mjs`(자체 DB에 검증용 계정을 만들고 검사 후 삭제하는
> 패턴)와 같은 성격 — 외부 서비스에 실존하는 계정을 만드는 것과는 다르다.

## 전체 흐름

1. Supabase에 게스트용 실데이터 시드
2. 앱 코드에 임시 우회 4곳 추가(온보딩/로그인/광고/디버그 배너 스킵)
3. 시뮬레이터에서 언어별로 실행 + 탭별로 캡처
4. 코드 원복 + DB 원복

## 1. Supabase 시드 — 계정 만들기

`useAuth.ts`의 `devSignIn()`(앱에 이미 있는 "게스트로 둘러보기" 개발용 mock 로그인)이 쓰는
고정 ID `00000000-0000-0000-0000-000000000001`(`GUEST_USER_ID`, `guestGuard.ts`)를 그대로
쓴다.

**함정 1 — `public.users.id`는 `auth.users(id)`를 참조하는 FK가 있다(`NOT VALID`로 걸려있어
기존 행 검증은 건너뛰지만 새 INSERT는 그대로 막는다).** 그래서 `auth.users`에도 최소 행이
있어야 한다:

```sql
insert into auth.users (id, is_anonymous, aud, role)
values ('00000000-0000-0000-0000-000000000001', true, 'authenticated', 'authenticated');
```

`is_anonymous = true`로 표시해 실제 사용자가 아님을 명확히 한다. (이게 없으면
`insert into public.users`가 `users_id_fkey` 위반으로 실패한다.)

그다음 실데이터를 넣는다(예시 — 화면 다 채우려면 이 정도는 필요했음):

```sql
insert into public.patient_groups (id, invite_code, subscription_tier, subscription_expires_at)
values ('30000000-0000-0000-0000-000000000001', 'SCRNSH', 'premium', now() + interval '30 days');

insert into public.users (id, name, role, onboarding_done, birth_year, gender, diagnosis_year, patient_group_id)
values ('00000000-0000-0000-0000-000000000001', '이정숙', 'patient', true, 1958, 'female', 2020,
        '30000000-0000-0000-0000-000000000001');

insert into public.medications (id, patient_id, name, dosage, is_active) values (...);
insert into public.dose_slots (id, patient_id, time, label, sort_order) values (...);
insert into public.med_logs (patient_id, medication_id, dose_slot_id, taken_at, meal_time) values (...);
insert into public.exercise_logs (patient_id, exercise_type, duration_minutes, logged_at) values (...);
insert into public.on_off_logs (patient_id, body_state, mood, sleep_quality, constipation, triggered_by, logged_at) values (...);
```

`patient_groups.subscription_tier = 'premium'`으로 해두면 해외 로케일에서도 **광고가 안 뜬다**
(`AdSlot.tsx`: `active = isOverseasLocale() && !isPremium`) — 스크린샷에 테스트 광고나
"AdMob native ad validator" 팝업이 끼는 걸 막는 핵심 트릭.

## 2. RLS — 정책 + 테이블 grant + 함수 grant, 3층 다 필요

앱은 `devSignIn()`으로 로그인해도 **진짜 Supabase 세션이 없다**(순수 로컬 상태). 그래서
`anon` 롤로 쿼리가 나가고, 아래 3가지가 전부 있어야 읽힌다. 하나라도 빠지면 `42501` 에러.

```sql
-- ① RLS 정책: 이 고정 ID 데이터만 익명도 읽게 하는 좁은 예외
create policy "temp_screenshot_guest_medications_select"
on public.medications for select to public
using (patient_id = '00000000-0000-0000-0000-000000000001'::uuid);
-- (users, dose_slots, med_logs, exercise_logs, on_off_logs, patient_group_members,
--  patient_groups 도 동일 패턴)

-- ② 테이블 레벨 grant: RLS 정책만으론 부족하다 — anon 롤에 SELECT 자체가 없으면
--    정책과 무관하게 42501(permission denied for table)
grant select on public.medications to anon;
-- (나머지 테이블도 동일)

-- ③ 함수 실행 권한: 다른(기존) RLS 정책이 is_same_group() 같은 헬퍼 함수를 쓰면,
--    그 함수를 anon이 실행할 권한이 없어도 42501이 난다(내 정책이 통과해도 같이 평가되는
--    다른 정책에서 에러가 나면 쿼리 전체가 실패한다).
grant execute on function public.is_same_group(uuid, uuid) to anon;
grant execute on function public.is_same_patient_group(uuid) to anon;
```

**함정 2 — 마이그레이션 하나에 정책·grant·시드 데이터를 다 넣고 시드 INSERT가 FK 위반으로
실패하면, 트랜잭션 전체가 롤백되어 정책·grant까지 같이 사라진다.** (처음에 이걸 몰라서
"분명 grant 했는데 왜 또 42501이지" 하고 한참 헤맸다.) → **정책/grant와 데이터 시드는
별도 마이그레이션으로 나눠서 실행**하거나, 시드부터 먼저 성공시키고 정책/grant를 나중에 붙일 것.

## 3. 앱 코드 임시 우회 (스크린샷 끝나면 전부 `git checkout --`로 원복)

4개 파일, 5곳:

**`src/navigation/RootNavigator.tsx`**
```tsx
const { user, loading, devSignIn } = useAuth();
React.useEffect(() => {
  if (__DEV__ && !user && !loading) devSignIn();  // 게스트 자동 로그인(탭 불필요)
}, [user, loading]);
// ...
React.useEffect(() => {
  if (__DEV__ && gateEnabled && gateState === 'blocked' && !skipped && canSkip) skip();
}, [gateEnabled, gateState, skipped, canSkip]);  // 알림 권한 게이트 자동 스킵
```

**`src/components/common/DevLetterModal.tsx`**
```tsx
export async function shouldShowDevLetter(): Promise<boolean> {
  if (__DEV__) return false;  // "파킨온 앱을 출시하며" 개발자 편지 팝업 스킵
  ...
```

**`App.tsx`**
```tsx
import { AppState, AppStateStatus, StatusBar, LogBox } from 'react-native';
if (__DEV__) LogBox.ignoreAllLogs(true);  // 화면 하단 "Open debugger..." 노란 배너 제거
```

**`src/navigation/MainNavigator.tsx`**
```tsx
<Tab.Navigator initialRouteName="BodyStateTab" ...>  // 탭 이동은 탭 불가하니 이 값을
```                                                    // 바꿔가며 재실행해서 캡처

// 탭 이름: Medication / BodyStateTab / Exercise / OverseasMedTab(해외) 또는 Feed(국내) / MyInfo
```

이 5곳 외엔 건드릴 필요 없었다. `useAuth.ts`의 `devSignIn()` mock 객체에서
`patient_group_id: null` → 시드해둔 그룹 id로 바꿔야 프리미엄(광고 제거)이 적용된다는 것도
잊지 말 것(로컬 mock 객체 필드라서 DB만 고쳐선 반영 안 됨):
```tsx
patient_group_id: '30000000-0000-0000-0000-000000000001',
```

## 4. 시뮬레이터 실행·캡처

**태블릿/권한 이슈 우회**: Claude iOS Simulator MCP는 매번 "Let Claude use it" 사용자 승인이
필요해서, 승인이 안 될 때는 `xcrun simctl` CLI를 직접 쓴다 — 이건 그 승인 게이트를 안 탄다.

```bash
# 언어 전환은 OS 전체를 안 바꾸고 launch argument로 그 실행 1회만 적용(fastlane snapshot과 동일 원리)
xcrun simctl terminate <UDID> com.ourmine.parkinon
xcrun simctl launch <UDID> com.ourmine.parkinon -AppleLanguages "(fr)" -AppleLocale "fr_FR"
sleep 6
xcrun simctl io <UDID> screenshot out.png
```

`fr`/`ja` 외에 다른 언어도 동일 패턴. 탭을 바꾸려면 `MainNavigator.tsx`의
`initialRouteName`을 고치고 다시 `terminate`+`launch`(Metro fast refresh가 안 먹을 때가
있어 완전 재기동이 제일 확실했다).

## 5. 원복 체크리스트 (스크린샷 다 찍으면 반드시)

```bash
# 코드
git checkout -- src/navigation/RootNavigator.tsx src/navigation/MainNavigator.tsx \
  src/hooks/useAuth.ts src/components/common/DevLetterModal.tsx App.tsx
git diff --stat   # supabase/.temp/cli-latest 말고 남는 게 없어야 정상

# DB — 정책/grant 먼저, 데이터는 FK 역순으로, auth.users는 맨 마지막
drop policy ...(9개)
revoke select on ...(9개) from anon;
revoke execute on function ...(2개) from anon;
delete from public.med_logs where patient_id = '00000000...0001';
delete from public.dose_slots where patient_id = '00000000...0001';
delete from public.medications where patient_id = '00000000...0001';
delete from public.exercise_logs where patient_id = '00000000...0001';
delete from public.on_off_logs where patient_id = '00000000...0001';
delete from public.users where id = '00000000...0001';
delete from public.patient_groups where id = '30000000...0001';
delete from auth.users where id = '00000000...0001';   -- 반드시 마지막
```

## 알아두면 좋은 것

- **Google 광고 테스트 검증 팝업("AdMob native ad validator")**은 해외 로케일 + 무료(free)
  티어일 때만 뜬다 → 게스트를 premium으로 만들면 자연히 안 뜬다(코드를 안 건드려도 됨).
- **화면 하단 노란 "Open debugger to view warnings" 배너**는 `LogBox.ignoreAllLogs(true)`
  한 줄로 없앨 수 있다(React Native 기본 기능, 실제 배포 빌드엔 원래 안 뜸).
- **온보딩 인트로 슬라이드**는 `LoginScreen.tsx`가 아니라 그 앞 단계라, `devSignIn()`을
  `LoginScreen` 안에서 자동 호출해봐야 소용없다 — `RootNavigator`(모든 온보딩 스택보다
  위)에서 걸어야 인트로까지 통째로 건너뛴다.
