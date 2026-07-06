# Phase 1 — 타임존 기반 상세 실행 설계 (해외 출시)

작성: 2026-07-03. 배경·근거: [overseas_expansion_review.md](./overseas_expansion_review.md), [overseas_execution_plan.md](./overseas_execution_plan.md).
목표: 사용자별 IANA 타임존을 자동 감지·저장하고, **서버 알림 크론**과 **클라 하루 경계**를 사용자 tz 기준으로 전환. 국내(Asia/Seoul) 사용자는 동작이 **100% 동일**(회귀 0)해야 한다.

> ⚠️ 이 문서는 설계·조사 문서다. 실제 앱/서버 코드는 이 문서 기준으로 별도 승인 후 수정한다.

---

## 0. 핵심 결론 (요약)

1. **`users.timezone` 컬럼 없음** — 마이그레이션 전수 grep 결과 존재하지 않음. 신설 필요.
2. **서버 크론의 KST 가정은 딱 두 곳의 "전역 벽시계"에서 발생**: `send-medication-reminders`(정시/+10/+20/운동)와 `send-missed-med-reminders`(taken 판정 하루경계). `send-appointment-reminders`는 **트리거는 이미 tz 안전**(절대 ms 윈도우), 표시 문자열만 KST 포맷.
3. **약효추적 큐(queue-effect-tracking)는 완전 안전** — `send_at = now + minutes*60*1000` 절대 오프셋. 재확인 완료. 변경 불필요.
4. **tz 감지는 네이티브 모듈 없이 OTA로 가능** — 앱이 이미 `toLocaleDateString('ko-KR', {weekday…})`를 쓰므로 런타임에 ICU/Intl이 살아 있음. `Intl.DateTimeFormat().resolvedOptions().timeZone`로 IANA tz를 얻을 수 있어 **expo-localization(네이티브 재빌드) 불필요**. (Phase 6에서 어차피 재빌드하므로 그때 expo-localization로 이중화 가능하나, Phase 1은 Intl만으로 OTA 완결.)
5. **클라 KST 하드코딩은 medUtils 밖으로도 광범위하게 흩어져 있음** — 최소 10개 파일. Phase 1의 "하루 경계"는 medUtils 계열(약/신체/운동/타임라인)만 우선 처리하고, 나머지(일기·영상·알림이력 표시)는 Phase 2(i18n/로케일 포맷)로 넘기는 경계를 명확히 둔다.

---

## 1. 현 구조 정밀 조사 (파일:줄 근거)

### 1.1 users 스키마 — timezone 컬럼 부재
- `grep -rin timezone supabase/migrations/` → **매치 0건**. users 테이블에 tz 관련 컬럼 전혀 없음.
- users 행 **생성 지점**:
  - 구글 등 비-카카오 경로: `src/hooks/useAuth.ts:324-357` — 클라가 직접 `POST /users`로 INSERT. INSERT 페이로드(`newUser`, 325-337)에 `role:'patient'`, `notification_enabled:true` 등은 있으나 tz 없음.
  - 카카오 경로: Edge Function/DB 트리거가 `public.users` 행을 INSERT(`useAuth.ts:280` 주석). 클라는 select만(`useAuth.ts:293`).
- users 행 **수정(PATCH) 지점** (tz upsert에 재사용 가능):
  - `src/utils/notifications.ts:151-162` — 앱 시작/알림 등록 시 `PATCH /users?id=eq.{userId}` body `{ push_token, push_platform: Platform.OS }`. **앱 부팅마다 실행되는 자연스러운 upsert 지점** → 여기에 `timezone` 한 필드만 추가하는 게 최소 침습.

### 1.2 서버 크론 3종의 KST 처리

**pg_cron 스케줄** (`supabase/migrations/20260626100900_cron_http_post_timeout_30s.sql`):
- jobid 10 `parkinon-med-time` → `send-medication-reminders`, **매분**(`* * * * *`), `net.http_post(body:={})`.
- jobid 11 `parkinon-appointment` → `send-appointment-reminders`, **매분**.
- jobid 9 `parkinon-effect-queue` → `process-notification-queue`(약효 큐 소비), **매분**.
- `send-missed-med-reminders`는 **cron 없음** — HTTP 온디맨드 호출(요청 body에 `meal_time` 또는 `dose_slot_id`). 구 per-slot 미복용 크론은 `remove_old_missed_crons.sql`로 제거됐고, 정기 미복용(+10/+20) 로직은 `send-medication-reminders` 안으로 통합됨.

**(a) send-medication-reminders/index.ts** — 전역 KST 벽시계가 매칭의 뿌리:
```
453  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)   // ★ KST 고정
454  const hh = String(kstNow.getHours()).padStart(2,'0')
455  const mm = String(kstNow.getMinutes()).padStart(2,'0')
456  const currentTime = `${hh}:${mm}`                          // "HH:MM" 전역 1개
457  const time10 = subtractMinutes(currentTime, 10)
458  const time20 = subtractMinutes(currentTime, 20)
459  const today  = kstNow.toISOString().split('T')[0]          // ★ 하루 경계도 KST
```
- 정시: `rpc('get_meds_at_time',{target_time: currentTime})` (464) → `groupTargets` → 환자별 발송.
- +10분 1차 미복용(501), +20분 2차 미복용(542): 같은 RPC를 `time10`/`time20`로 호출.
- `hasTakenMed(patientId, target, today)`로 복용 여부 판정 — **today가 KST 하루 경계**.
- 운동 알림(585-620): 각 환자 `exercise_notif_prefs`의 `ampm+hour+minute`를 24h `HH:MM`으로 만들어 **전역 `currentTime`과 문자열 비교**(608 `if (target !== currentTime) continue`).
- 응답: `{ sent, time: currentTime, … }` (624).

**슬롯 시각 저장 형식** = 벽시계 `HH:MM` 문자열(타임존 정보 없음):
- `get_meds_at_time` RPC(`supabase/migrations/20260611020000_get_meds_dose_slots_authoritative.sql`)는
  `to_char(ds.time,'HH24:MI') = target_time`로 매칭. `dose_slots.time`은 Postgres `time`(무-tz) 컬럼, legacy `medications.meal_schedules`/`users.meal_schedules`는 jsonb의 `"HH:MM"` 값. → **저장값은 "현지 벽시계"이며 어느 tz의 벽시계인지는 어디에도 없다.** 지금은 "항상 KST"라는 암묵 가정으로 성립.

**(b) send-missed-med-reminders/index.ts** — 온디맨드, KST 하루 경계로 taken 판정:
```
115  const kstNow = new Date(Date.now() + 9*60*60*1000)   // ★ KST
116  const today  = kstNow.toISOString().split('T')[0]
117  const dayStart = `${today}T00:00:00+09:00`            // ★ +09:00 고정
118  const dayEnd   = `${today}T23:59:59+09:00`
```
- 이 경계로 `med_logs.taken_at` gte/lte 조회(152-171)해 "오늘 복용했는지" 판정.

**(c) send-appointment-reminders/index.ts** — 트리거는 tz 안전, 표시만 KST:
- 윈도우 판정 `inWindow(iso, nowMs, days)`(121-125): `t > now && t <= now + days*24h` — **절대 ms 롤링 윈도우**라 tz 무관(D-7=7일 전, D-1=1일 전이 어디서든 동일). `Deno.serve`(129) `now=new Date()`도 절대시각. → **트리거 로직 변경 불필요.**
- 단 `kstWhen(iso)`(16-27)가 `new Date(iso).getTime()+9h`로 **표시 문자열을 KST로** 포맷(`M월 D일(요일) 오전/오후 H:MM`). 해외 사용자는 진료 시각이 KST로 보임 → 표시 로케일화 필요(경미, Phase 2 문자열 로케일화와 함께).

### 1.3 클라 하루 경계 KST — 전수

**medUtils 계열(Phase 1 핵심 범위):**
- `src/utils/medUtils.ts:4-8` `getKSTToday()` = `Date.now()+9h`의 ISO 날짜.
- `src/utils/medUtils.ts:11-16` `getKSTDayRange(dateStr)` = `${date}T00:00:00+09:00` ~ `T23:59:59.999+09:00`.
- 소비처:
  - `src/hooks/useMedication.ts:181-182, 561-562, 652` (약 복용 오늘/범위)
  - `src/hooks/useBodyState.ts:83-84, 251, 276-277, 301` (신체 상태)
  - `src/hooks/useExercise.ts:65-66, 244` (운동)
  - `src/components/common/HistoryTimeline.tsx:133-134` + 자체 `getKSTTodayStr()`(67-71)
  - `src/utils/notifActionFeedback.ts:132`의 `hasTakenTodayKST()` + 자체 KST 분 계산(31 `Date.now()+9h`, `isTimePastKST` 39). 이 함수는 `MedicationManageScreen`(1119,1133,2553), `DoseSlotSetList`(568,608,634,671,693)에서 호출 → 슬롯 "오늘 복용됨" 배지.

**medUtils 밖 인라인 KST(±9h) — Phase 1에서 볼지/미룰지 결정 필요:**
- `src/hooks/useDiary.ts:118-123` `kstDayRangeUtc()` (일기 하루 경계, +09:00 고정).
- `src/screens/diary/DiaryScreen.tsx:77, 90, 101` (일기 날짜 계산).
- `src/screens/bodystate/BodyStateScreen.tsx:163, 173`, `src/screens/bodystate/VideoListScreen.tsx:45` (신체/영상 화면 KST 오프셋).
- `src/screens/exercise/ExerciseScreen.tsx:123, 135` (운동 화면 KST) + `:314` 표시 `toLocaleTimeString('ko-KR')`.
- `src/screens/menu/MedicationManageScreen.tsx:331` (timestamptz→KST 'YYYY.M.D' 표시).
- `src/screens/notification/NotificationHistoryScreen.tsx:64,67,73,86` — `toLocaleDateString('ko-KR')` (표시 그룹핑, 기기 tz로 자동 동작하나 로케일 하드코딩).

> **경계선**: Phase 1은 "약 알림 정확성"에 직결되는 **medUtils 계열 + notifActionFeedback**만 tz 일반화한다. 일기/영상/신체·운동 화면의 표시성 KST와 `ko-KR` 하드코딩은 회귀 위험 대비 효용이 낮고 i18n과 얽혀 있어 **Phase 2(로케일 포맷 정리)로 이관**. 단 목록에 남겨 추적한다(아래 6.4).

### 1.4 약효추적 큐 — tz 무관 재확인 (변경 불필요)
- `supabase/functions/queue-effect-tracking/index.ts:168, 240`:
  `send_at = new Date(now + n.minutes*60*1000).toISOString()`. **복용 시각으로부터의 상대 오프셋**(예 +120분)이라 절대 UTC 순간으로 저장 → 어느 tz든 "복용 후 N분"이 정확. 소비자 `process-notification-queue`도 `send_at <= now` 절대 비교. **결론: 안전, 손대지 않음.**

### 1.5 expo-localization / tz 감지 API
- `package.json`에 **expo-localization 없음**(grep 0). `date-fns ^4.1.0` 존재, `expo ~54.0.33`, `react-native 0.81.5`(Hermes).
- 앱이 이미 `toLocaleDateString/TimeString('ko-KR', {weekday…})` 사용(NotificationHistoryScreen, ExerciseScreen) → **런타임 ICU/Intl 활성 확정**. 따라서 `Intl.DateTimeFormat().resolvedOptions().timeZone`가 IANA tz('Asia/Seoul','America/New_York' 등) 반환 → **네이티브 모듈·재빌드 없이 OTA로 tz 감지 가능**.

---

## 2. 재설계안

### 2.1 스키마 (DB 마이그레이션)
```sql
-- Phase1-M1: users.timezone 신설. 기존/국내 회귀 0을 위해 기본값 Asia/Seoul.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Seoul';
-- 기존 행은 DEFAULT로 자동 'Asia/Seoul' 백필됨(별도 UPDATE 불필요).
-- (선택) 형식 안전장치: 존재하는 IANA 이름만 허용하려면 앱단 검증 + 잘못된 값 방어.
--   Postgres CHECK로 IANA 전체를 강제하긴 어려우므로, 서버 크론에서 tz 캐스팅 실패 시
--   'Asia/Seoul'로 폴백(2.3 참조)하는 방어를 둔다.
```
- NOT NULL + DEFAULT라 신규 INSERT가 tz를 안 넣어도 안전. 클라가 채우면 갱신.

### 2.2 클라: tz 감지·저장 (OTA)
- **감지 헬퍼**(신규, 예 `src/utils/timezone.ts`):
  ```ts
  export function getDeviceTimeZone(): string {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz && tz.length ? tz : 'Asia/Seoul';
    } catch { return 'Asia/Seoul'; }
  }
  ```
- **저장(upsert)**: `src/utils/notifications.ts:161`의 push_token PATCH body에 `timezone: getDeviceTimeZone()` 추가(1줄). 앱 부팅/알림 등록마다 실행 → 사용자가 해외로 이동하면 자동 갱신. 국내 기기는 항상 'Asia/Seoul' 기록 → DEFAULT와 동일 → 회귀 0.
- **INSERT 경로 보강**: `useAuth.ts:325-337` `newUser`에 `timezone: getDeviceTimeZone()` 추가(카카오 경로는 트리거가 DEFAULT로 넣고, 이후 notifications.ts PATCH가 실제 tz로 갱신).
- **주의**: `Intl.timeZone`은 기기 설정 tz. 앱 최초 실행 device tz 미검증 리스크는 낮으나, Phase 1 착수 시 실기기 1회 `console.log` 검증(6.5).

### 2.3 서버 크론: 전역 KST 벽시계 → 사용자별 tz 벽시계

**핵심 원리**: "전역 `currentTime` 1개로 모든 슬롯 매칭"을 "각 사용자의 현지 벽시계로 매칭"으로 바꾼다. Postgres가 tz 계산에 강하므로 **매칭을 RPC(SQL) 안으로 밀어넣는 것**이 가장 안전·단순(Edge Function은 tz 루프 없이 유지).

**RPC 재작성 — `get_meds_at_time(target_time)` → `get_meds_due(offset_minutes int)`:**
- 아이디어: 전역 target_time을 받지 말고, **오프셋(0/10/20분)만** 받아 각 행에서 사용자 tz로 "지금-오프셋"의 현지 `HH:MM`을 계산해 슬롯 `HH:MM`과 비교.
```sql
-- 개념 스케치 (실구현 시 기존 3-way union 구조·role 필터·dose_slots 우선순위 그대로 유지):
create or replace function public.get_meds_due(offset_minutes int default 0)
returns table(patient_id text, meal_time text, dose_slot_id uuid, label text, "time" text)
language sql stable set search_path to 'public','pg_temp'
as $$
  select distinct ds.patient_id::text, /* …meal_time 매핑 동일… */,
         ds.id, ds.label, to_char(ds.time,'HH24:MI')
  from dose_slots ds
  join users u on u.id = ds.patient_id and u.role = 'patient'
  where ds.is_active and ds.remind_enabled
    and to_char(ds.time,'HH24:MI')
        = to_char(
            (now() - make_interval(mins => offset_minutes))
              at time zone coalesce(nullif(u.timezone,''),'Asia/Seoul'),
            'HH24:MI')
  union … (medications.meal_schedules, users.meal_schedules 경로도 동일하게
           u.timezone 기준 현지 HH:MM 비교로 치환) ;
$$;
```
- `now() at time zone u.timezone` = 그 사용자 현지 벽시계(timestamp). `to_char(…,'HH24:MI')`로 분 단위 매칭. **Asia/Seoul 사용자는 `now() at time zone 'Asia/Seoul'` = KST 벽시계 = 기존 `Date.now()+9h`와 동일 분** → 회귀 0.
- 잘못된 tz 문자열 방어: `coalesce(nullif(u.timezone,''),'Asia/Seoul')`. (존재하지 않는 IANA면 캐스팅 에러 가능 → 필요 시 안전 tz 목록 매핑 or 앱단 검증으로 방지.)

**Edge Function `send-medication-reminders` 변경점:**
- 453-459의 `kstNow/currentTime/time10/time20/today` 계산 **제거 또는 축소**.
- `rpc('get_meds_at_time',{target_time})` 3콜 → `rpc('get_meds_due',{offset_minutes:0|10|20})` 3콜.
- **`today`(하루 경계)의 사용자별화**: `hasTakenMed`의 "오늘"은 각 환자 tz의 캘린더 데이(2.4와 동일 원리). 두 방법 중 택1:
  1. **RPC가 tz별 today를 함께 반환** — get_meds_due가 행마다 `to_char(now() at time zone u.timezone,'YYYY-MM-DD')`를 컬럼으로 내려주면 Edge에서 그대로 사용(권장, 왕복 최소).
  2. Edge에서 각 patient의 tz를 조회(이미 patient row select) → `Intl`로 현지 today 계산. Deno도 Intl 지원.
- 운동 알림(585-620): 전역 `currentTime` 비교(608)를 **환자 tz 현지 `HH:MM`**과 비교로 치환. 방법:
  1. 별도 tz-aware RPC(운동 pref는 users JSON이라 SQL화 부담) 대신, 이미 `allPatients`를 순회(585)하므로 **환자별 tz로 현지 HH:MM을 Intl로 계산**해 pref와 비교(가장 국소적·안전).
- 미복용(+10/+20)의 taken 판정도 위 today를 그 환자 tz 기준으로.

**Edge Function `send-missed-med-reminders` 변경점:**
- 115-118의 KST `today/dayStart/dayEnd` → 대상 환자(slot.patient_id 또는 meal_time 경로)의 tz로 하루 경계 산출. slot 경로는 patient 1명이라 그 환자 tz로 `Intl`/SQL 계산. legacy meal_time 경로(전체 환자)는 환자별 tz가 달라지므로, taken 조회를 환자별 tz today로 개별화(또는 이 온디맨드 함수는 통합된 med-reminders로 대체 검토).

**Edge Function `send-appointment-reminders`:**
- 트리거(inWindow) **변경 없음**(tz 안전).
- `kstWhen`(16-27) 표시만 **환자 tz 포맷**으로: `patient.timezone`을 select에 추가하고 `Intl.DateTimeFormat(locale,{timeZone})`로 포맷. (Phase 1에선 "시각을 환자 tz로" 정확화, 언어 문자열은 Phase 2.)

### 2.4 클라 하루 경계: getKST* → tz 인자 일반화
- `medUtils.ts`에 tz 인자 버전 추가(기존 함수는 얇은 래퍼로 하위호환):
  ```ts
  export function getLocalToday(tz: string = 'Asia/Seoul'): string {
    // Intl로 tz의 'YYYY-MM-DD' 산출 (en-CA 포맷이 YYYY-MM-DD)
    return new Intl.DateTimeFormat('en-CA',{ timeZone: tz }).format(new Date());
  }
  export function getLocalDayRange(dateStr: string, tz: string = 'Asia/Seoul') {
    // dateStr 00:00~24:00을 tz 기준 UTC 절대경계로 변환해 반환
    // (KST면 기존 +09:00 경계와 동일 순간)
  }
  // 하위호환: getKSTToday = () => getLocalToday('Asia/Seoul')
  //           getKSTDayRange = (d) => getLocalDayRange(d,'Asia/Seoul')
  ```
- 소비처(useMedication/useBodyState/useExercise/HistoryTimeline/notifActionFeedback)는 **로그인 사용자 tz를 인자로 전달**하도록 점진 교체. tz 출처 = `useAuth`의 user 프로필에 `timezone` 필드 노출(현재 `UserProfile`에 추가). 미로그인/미로딩 시 기본 'Asia/Seoul'.
- **KST 사용자는 tz='Asia/Seoul'가 흘러 기존과 동일 경계** → 회귀 0. 이 하위호환 래퍼 유지가 회귀 방지의 핵심.

---

## 3. 단계별 작업 순서 (저위험 → 고위험)

| 단계 | 내용 | 종류 | 위험 | 되돌리기 |
|---|---|---|---|---|
| **S0** | `users.timezone` 컬럼 신설(NOT NULL DEFAULT 'Asia/Seoul') | **DB 마이그** | 저 (추가만, 읽는 곳 없음) | 컬럼 DROP |
| **S1** | 클라 tz 감지(`getDeviceTimeZone`, Intl) + `notifications.ts` PATCH·`useAuth` INSERT에 timezone 저장 | **OTA** | 저 (쓰기만, 서버 미사용) | OTA 롤백 |
| **S2** | 클라 하루 경계 tz 일반화(`getLocalToday/DayRange` + 하위호환 래퍼) — medUtils 계열·notifActionFeedback 소비처를 user.tz로 | **OTA** | 중 (경계 계산 변경) | OTA 롤백(래퍼가 KST 보존) |
| **S3a** | RPC 재작성 `get_meds_due(offset)`(tz-aware) + tz별 today | **DB 마이그** | 고 | 이전 RPC 재배포 |
| **S3b** | `send-medication-reminders` tz화(RPC 교체·운동 tz 비교·taken today tz) | **서버 배포** | 고 (약 알림 정확성 직결) | 이전 함수 재배포 |
| **S3c** | `send-missed-med-reminders` 하루경계 tz화 | **서버 배포** | 중~고 | 이전 함수 재배포 |
| **S3d** | `send-appointment-reminders` 표시 tz화(트리거 불변) | **서버 배포** | 저 | 이전 함수 재배포 |

**진행 원칙**
- S0→S1은 **국내 라이브에 무해**(서버가 tz를 안 읽음). 먼저 배포해 **데이터부터 축적**(해외 진출 전 국내 유저 tz='Asia/Seoul' 채워짐).
- S3(서버 tz화)은 **S1이 충분히 퍼져 timezone이 채워진 뒤** 착수. NOT NULL DEFAULT라 미채움 유저도 'Asia/Seoul'로 안전.
- S3a 마이그와 S3b 배포는 **원자적으로 함께**(RPC 시그니처 변경 = Edge 호출부 변경). 신 RPC를 **새 이름**(`get_meds_due`)으로 추가 후 Edge 전환 → 구 `get_meds_at_time` 잠시 유지 → 안정화 후 정리(무중단).
- 서버 배포 전 **staging/수동 호출**로 KST·해외 tz 각각 dry-run(sent 카운트·time 로그 확인).

---

## 4. 국내(KST) 회귀 방지 테스트 계획

**전제**: KST 사용자에 대해 모든 단계 출력이 변경 전과 **비트 동일**해야 함.

### 4.1 서버 (S3)
1. **정시 매칭 동치성**: 기기 tz='Asia/Seoul' 환자가 08:00 슬롯 보유 → 신 `get_meds_due(0)`가 KST 08:00 정각 분에 그 환자를 반환하는지. 구 `get_meds_at_time('08:00')`와 **동일 patient set** 비교(같은 분에 두 RPC 결과 diff=0).
2. **+10/+20 미복용**: KST 08:10/08:20에 각각 1차/2차 후보가 구/신 동일한지.
3. **하루 경계 taken**: 자정 근처(예 KST 23:55, 00:05)에 전날/당일 med_log가 "오늘 복용"으로 올바르게 갈리는지 — KST today와 tz-today('Asia/Seoul')가 동일한지.
4. **운동 알림**: `exercise_notif_prefs`(오전/오후+시:분)가 KST 현지 HH:MM과 매칭되어 변경 전과 같은 분에 발송.
5. **진료 D-7/D-1**: inWindow 불변 확인(코드 diff 없음) + 표시 문자열이 KST 환자에게 기존과 동일 포맷.
6. **DST 무영향 확인**: Asia/Seoul은 DST 없음 → 연중 오프셋 +9 고정. 신 로직이 KST에 대해 항상 +9인지(America/New_York 등 DST 지역만 오프셋 변동).

### 4.2 클라 (S2)
1. `getLocalToday('Asia/Seoul')` === 기존 `getKSTToday()` (여러 시각·자정 경계에서 문자열 동일).
2. `getLocalDayRange(d,'Asia/Seoul')`의 start/end UTC 순간 === 기존 `${d}T00:00:00+09:00`~`T23:59:59.999+09:00` (경계 포함/제외 semantics 유지 주의).
3. 소비처(약/신체/운동/타임라인) "오늘" 목록이 tz 교체 전후 동일 레코드.
4. 슬롯 "오늘 복용됨" 배지(hasTakenTodayKST 경로)가 KST 사용자에게 동일.

### 4.3 클라 (S1)
1. 국내 기기에서 `getDeviceTimeZone()`가 'Asia/Seoul' 반환(실기기·시뮬레이터 tz=서울).
2. PATCH 후 `users.timezone='Asia/Seoul'` 저장 확인, push_token 저장이 깨지지 않음.
3. `Intl` 예외 시 폴백 'Asia/Seoul' 동작.

### 4.4 해외 스모크(진출 전 사전 검증)
- 기기 tz를 America/New_York로 바꾼 계정: 슬롯 08:00 → **뉴욕 08:00**에 발송(서버 로그로 확인), KST 08:00엔 미발송. 하루 경계·미복용·운동 동일 tz.
- DST 경계(3월/11월) 근처 뉴욕에서 벽시계 08:00 유지되는지(now at time zone이 DST 자동 처리).

---

## 5. 리스크·주의점

1. **라이브 DB + 폰 dev빌드가 라이브 DB를 봄** (메모리 `project_parkinon_test_only_db`). S0 컬럼 추가/S3 RPC 교체가 즉시 실 사용자에게 반영됨 → **RPC는 새 이름으로 병행 배포 후 전환**(무중단). 마이그는 되돌리기 스크립트 준비.
2. **RPC 시그니처 변경 = Edge 동시 배포 필수**. `get_meds_at_time`을 in-place로 바꾸면 구 Edge가 깨짐. → 신규 `get_meds_due` 추가 방식으로 결합도 차단.
3. **잘못된 IANA 문자열**: 클라가 이상값을 넣으면 `at time zone`이 에러. 방어: 앱단 Intl 결과만 저장 + `coalesce/nullif` + (선택) 화이트리스트. 크론이 tz 캐스팅 에러로 전체 실패하지 않도록 함수 단위 try/폴백.
4. **자정·DST 경계 오프바이원**: today/DayRange를 Intl `en-CA`(YYYY-MM-DD)로 뽑을 때 tz 인자 누락 시 기기 tz로 새는 버그 주의. 반드시 `{ timeZone: tz }` 명시.
5. **매분 크론 30s 타임아웃**(cron_http_post_timeout_30s.sql): tz 로직을 Edge JS 루프(환자별 Intl)로 과하게 돌리면 지연↑. 가능한 매칭은 SQL(RPC)로, 환자 수 증가 대비. 운동 pref만 JS 루프 불가피(users JSON) — 이미 all patients 순회 중이라 추가 비용은 tz 계산뿐.
6. **범위 경계 준수**: Phase 1은 medUtils 계열 + 크론만. 일기/영상/신체·운동 **화면 표시**의 인라인 KST(1.3 후반)와 `ko-KR` 하드코딩은 **건드리지 않고 Phase 2로**(불필요한 회귀면적 축소). 목록으로 인계(6.4).
7. **약효추적 큐 무변경 재확인**: 안전하므로 "겸사겸사" 손대지 말 것(불필요 회귀).
8. **expo-localization 도입 여부**: Phase 1은 Intl만으로 OTA 완결 권장. Phase 6 재빌드 때 expo-localization로 이중화(Intl 미지원 런타임 방어)는 선택.

---

## 6. 부록 — 인계·체크리스트

### 6.1 변경 파일 예상 목록
- 마이그: 신규 `..._add_users_timezone.sql`, 신규 `..._get_meds_due_tz_aware.sql`.
- 클라: 신규 `src/utils/timezone.ts`, `src/utils/notifications.ts`(PATCH body), `src/hooks/useAuth.ts`(INSERT + UserProfile에 timezone), `src/utils/medUtils.ts`(tz 인자 함수 + 래퍼), 소비처 hooks 4종·HistoryTimeline·notifActionFeedback.
- 서버: `supabase/functions/send-medication-reminders/index.ts`, `send-missed-med-reminders/index.ts`, `send-appointment-reminders/index.ts`.

### 6.2 절대 손대지 말 것
- `queue-effect-tracking`/`process-notification-queue`(tz 안전).
- `send-appointment-reminders`의 `inWindow` 트리거 로직(tz 안전).

### 6.3 tz 데이터 출처 단일화
- 저장: notifications.ts PATCH(부팅마다) = 사실상의 단일 upsert 지점.
- 읽기(서버): RPC 내부 `users.timezone`. Edge는 patient row select에 `timezone` 추가.
- 읽기(클라): `useAuth` user.timezone → 하루 경계 함수 인자.

### 6.4 Phase 2로 이관되는 KST/로케일 항목 (추적용)
`useDiary.ts:118`, `DiaryScreen.tsx:77/90/101`, `BodyStateScreen.tsx:163/173`, `VideoListScreen.tsx:45`, `ExerciseScreen.tsx:123/135/314`, `MedicationManageScreen.tsx:331`, `NotificationHistoryScreen.tsx:64/67/73/86`(`ko-KR`), `send-*`의 한국어 문구.

### 6.5 착수 직전 1회 검증
- 실기기에서 `console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)` → IANA 반환 확인(국내='Asia/Seoul').
- Deno(Edge)에서 `new Date().toLocaleString('en-CA',{timeZone:'America/New_York'})` 동작 확인(ICU 포함 런타임인지).
