# 알림음 개인화 + 구독 — 상세 설계서

> 의사결정 요약은 `personalized_alarm_subscription_spec.md` 참고. 이 문서는 **개발 청사진**.
> 작성: 2026-05-31. 전부 **네이티브 신규 개발** → OTA 불가, 새 빌드 필요(현재 출시 전이라 재심사 부담 없음).

---

## 0. 큰 그림

```
[보호자/환자가 앱에서 녹음 or 프리셋 선택]
        │  (구독 그룹만 가능)
        ▼
[R2 업로드: m4a 원본 + 변환본(iOS caf, Android ogg/mp3)]
        │
        ▼
[대상 사용자(환자/보호자) 기기가 다운로드 → 알림음으로 "프로비저닝"]
   iOS: Library/Sounds/<name>.caf  |  Android: notification channel(sound=URI)
        │
        ▼
[알림 발송 시 그 사운드 + (무음뚫기=critical/alarm) 지정]
   환자 약시간: 기기 로컬 예약 알람(끝까지 가능)
   미복용·보호자: 서버 푸시(FCM/APNs, 사운드명+critical)
        │
        ▼
[구독: 웹(토스페이먼츠) 결제 → 그룹 entitlement → 앱이 확인 후 기능 잠금해제]
```

핵심 원칙:
- **누구 기기에서 울리든, 그 사운드 파일이 그 기기에 미리 깔려 있어야** 함(프로비저닝).
- **약 복용 안전(알림 자체)은 무료 baseline** 유지 — 구독 만료 시 시스템 기본음으로 복귀하되 약 알림은 계속.
- **개인화(녹음/프리셋/강한 알림)**만 구독 게이트.

---

## 1. DB 스키마 (Supabase)

기존: `users`, `patient_groups`, `patient_group_members`. 아래 신규/추가.

### 1-1. 구독 (그룹 단위)
```sql
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references patient_groups(id) on delete cascade,
  status text not null default 'trialing',      -- trialing | active | past_due | canceled | expired
  plan text not null default 'personalized_alarm_monthly',
  trial_end timestamptz,                          -- 7일 체험 종료
  current_period_end timestamptz,                 -- 다음 결제일
  billing_key_ref text,                           -- 토스 빌링키 식별자(원문 토큰은 서버/PG에)
  price_currency text default 'KRW',
  subscribed_by uuid references users(id),        -- 결제 주체(보통 보호자)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(group_id)                                -- 그룹당 1구독
);
```
- 결제/웹훅은 **서버(service role)**가 갱신. 클라는 read만.
- "기능 활성" 판정: `status in ('trialing','active')` AND (trial_end/current_period_end 미래). → `is_subscription_active(group_id)` SQL 함수로 캡슐화.

### 1-2. 커스텀 녹음 사운드 (그룹 라이브러리)
```sql
create table public.custom_sounds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references patient_groups(id) on delete cascade,
  recorded_by uuid not null references users(id),  -- 누가 녹음했나
  label text,                                       -- "엄마가 부르는 손주 목소리" 등
  r2_key_src text not null,                         -- 원본 m4a
  r2_key_caf text,                                  -- iOS용 caf(≤30s)
  r2_key_android text,                              -- Android용(ogg/mp3)
  duration_ms int,
  created_at timestamptz default now()
);
```
- 미구독·탈퇴 정책: 미구독 시 **삭제 안 함(보관)**. 탈퇴/그룹 해체 시 cascade 삭제 + R2 정리(별도 잡).

### 1-3. 알림음 설정 (사용자별 = 그 사용자가 받는 알림에 적용)
```sql
create table public.alarm_sound_prefs (
  user_id uuid primary key references users(id) on delete cascade,
  sound_type text not null default 'system',      -- system | preset | recorded
  preset_key text,                                 -- 'child_grandpa', 'mom_casual' 등(아래 카탈로그)
  custom_sound_id uuid references custom_sounds(id) on delete set null,
  bypass_silent boolean not null default false,    -- 무음/방해금지 뚫기 (iOS=critical / Android=alarm)
  persistent boolean not null default false,       -- 해제할 때까지 계속(약시간 한정 적용)
  updated_at timestamptz default now()
);
```
- **환자의 알림음을 보호자가 설정** 가능(같은 그룹) → RLS 또는 RPC(`set_member_alarm_pref`)로. (기존 `update_patient_notif_prefs` 패턴 재사용)
- `bypass_silent`/`persistent`는 **환자의 약복용 관련 알림에만** 의미(스펙 결정). 보호자 수신 알림은 사운드 커스텀만.

### 1-4. 프리셋 카탈로그
- DB 테이블 불필요(앱 번들/원격 상수). preset_key 정의:
  - `child_grandpa`, `child_grandma` (손주: 할아버지/할머니)
  - `dad_casual`(아빠), `dad_formal`(아버지), `mom_casual`(엄마), `mom_formal`(어머니) — 부드러운 중년 남성
  - `dad_casual_f`, ... 차분한 중년 여성 버전(여성 화자) — 총 10개
  - (네이밍은 구현 시 확정. 음성 파일은 앱 번들에 동봉 → 프로비저닝 단순)

### 1-5. RLS
- `subscriptions`: 그룹 멤버 read, 서버만 write.
- `custom_sounds`: 그룹 멤버 read; insert는 그룹 멤버 + **구독 active일 때만**(트리거/RPC에서 체크).
- `alarm_sound_prefs`: 본인 read/write + 같은 그룹 보호자 write(RPC).
- realtime: `alarm_sound_prefs`, `custom_sounds`, `subscriptions` 구독 → 설정/녹음/결제 상태 변하면 기기가 즉시 재프로비저닝(기존 realtime 패턴 재사용).

---

## 2. 사운드 프로비저닝 (네이티브)

각 기기는 "내 alarm_sound_prefs"의 사운드를 **로컬 알림음으로 설치**한다.

### 트리거
- 앱 시작 / 포커스 / realtime(설정·녹음·구독 변경) 시 `ensureProvisioned()` 실행.

### ensureProvisioned() 로직
1. 구독 비활성 → 시스템 기본음으로 폴백(설치된 커스텀 제거 or 무시).
2. sound_type 결정:
   - `preset` → 앱 번들 동봉 파일 사용(다운로드 불필요). iOS는 번들 사운드, Android는 res/raw 또는 파일.
   - `recorded` → custom_sounds에서 r2_key 다운로드(iOS=caf, Android=ogg/mp3) → 로컬 저장.
3. **iOS**: 파일을 `Library/Sounds/<stableName>.caf`에 기록(≤30s). 네이티브 모듈 필요.
4. **Android**: 사운드 URI로 **notification channel 생성**(채널은 불변 → 사운드 바뀌면 새 channelId; 옛 채널 정리). `AudioAttributes.USAGE_ALARM`(무음 뚫기용)/`USAGE_NOTIFICATION` 구분.

### 변환
- 녹음(m4a) → iOS caf: 서버(Edge Function)에서 변환해 r2_key_caf 저장하는 게 안전(기기 변환 부담↓). 또는 기기에서 `afconvert`류.
- 5초 제한이라 용량·변환 가벼움.

---

## 3. 알림 발송 분기

### 3-1. 환자 약 복용 시간(정해진 시간) — **기기 로컬 예약**
- 기존 서버 크론(send-medication-reminders) 대신/병행, **기기에서 로컬 예약 알람**으로:
  - iOS: 예약 local notification + (bypass_silent면 critical sound) / 또는 iOS26 AlarmKit. `persistent`면 반복.
  - Android: `AlarmManager.setAlarmClock()` + 전체화면 인텐트(persistent) / 또는 알람-usage 채널 notification.
- 사운드 = 프로비저닝된 사운드. bypass/persistent = pref 반영.
- 장점: 끝까지 울림·무음 뚫기 가장 확실, 푸시 지연 무관.

### 3-2. 미복용·보호자 알림(비정형) — **서버 푸시**
- 트리거: 서버(미복용 20분 등) 또는 보호자 액션.
- 발송 시 **수신자 alarm_sound_prefs 조회** → 사운드명 + critical 플래그로 push 구성.
  - iOS: critical alert payload(`sound: {critical:1, name, volume}`) — **Expo Push로 부족하면 APNs 직접**.
  - Android: 해당 채널(사운드/알람-usage)로 표시. FCM data+notification.
- "끝까지"는 푸시 한계 → 강하게/반복까지만(스펙 결정), 사용자 안내.

### 3-3. 기존 Edge Function 수정
- `send-medication-reminders`, `send-missed-med-reminders`, `notify-measurement-completed`, `send-push`: 수신자 pref(사운드명·critical) 반영하도록 payload 확장. 커스텀/critical 필요 시 **Expo Push → FCM/APNs 직접 전환** 검토.
- 사운드명 매핑: preset_key → 번들 파일명, recorded → 프로비저닝된 stableName.

---

## 4. 결제 + Entitlement (웹, 국내 먼저)

### 흐름
1. 웹페이지(기존 parkinon-web): 로그인(앱 계정과 연동) → 구독 소개 → **7일 무료 시작**.
2. **토스페이먼츠 빌링**: 카드 등록(빌링키 발급) → subscriptions(status='trialing', trial_end=+7d, billing_key_ref).
   - **자동전환 고지·동의 화면 필수**(전자상거래법): "7일 후 월 990원 자동결제" 명시 + 동의 체크 + 해지 안내.
3. trial_end 도래: 서버 스케줄러가 빌링키로 첫 결제 → status='active', current_period_end=+1개월. 실패 시 past_due → 재시도/만료.
4. 매월 갱신/해지 처리. 해지 시 current_period_end까지 유지 후 expired.
5. **앱**: subscriptions realtime/포커스로 그룹 구독 상태 확인 → 기능 잠금해제/복귀.

### 앱 수수료 회피
- 결제·결제유도 링크를 **앱 안에 두지 않음**(웹에서 독립적으로 구독). 앱은 entitlement 반영만. (국내 제3자 결제 허용이라 비교적 안전, 단 "앱 내 결제 유도 금지" 원칙 유지)

---

## 5. 필요한 네이티브 작업 / 권한

### iOS
- **Critical Alerts entitlement**(신청 완료, 승인 대기) → 승인 후 `com.apple.developer.usernotifications.critical-alerts` 추가.
- 네이티브 모듈: Library/Sounds 쓰기, caf 보장(≤30s), critical local notification 예약, critical 권한 요청(`requestAuthorization([.criticalAlert])`).
- (옵션) iOS 26 AlarmKit 예약 알람.

### Android
- 권한: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`(알람앱 자격), `USE_FULL_SCREEN_INTENT`(알람/전화 카테고리), `ACCESS_NOTIFICATION_POLICY`(DND 우회). 배터리 최적화 예외 유도(기존 일부 대응).
- 네이티브: 사운드별 notification channel 동적 생성/정리, USAGE_ALARM, 전체화면 인텐트 액티비티(persistent), AlarmManager 예약.
- Play Console: 알람/정확알람·FSI 사용 선언.

### 공통
- expo-notifications 한계로 커스텀음/critical은 **FCM/APNs 직접 발송** 또는 커스텀 네이티브 알림 경로 필요할 수 있음 → PoC로 조기 검증.

---

## 6. 클라이언트 UI

- **설정 > 알림음**(구독 게이트):
  - 내(또는 환자) 알림음 선택: 프리셋(미리듣기) / 직접 녹음(5초, 미리듣기) / 시스템 기본
  - 보호자: 본인 수신 알림음 + (환자용) 알림음 설정(같은 그룹)
  - 토글: 무음에도 울리기 / 끝까지 울림(약시간) + **안내 문구**("약시간은 끝까지, 보호자 알림 등은 강하게 한 번")
  - 비구독 상태: 잠금 + "체험/구독" 안내(웹으로 유도는 정책상 신중 — 앱 내 결제 링크 지양)
- **녹음 화면**: 마이크 권한 → 녹음(≤5초) → 미리듣기 → 저장(업로드) → 대상에 적용.
- **웹**: 구독 랜딩 + 토스 결제 + 자동전환 고지/동의 + 해지.

---

## 7. 개발 순서(권장)

1. **PoC(가장 불확실한 것 먼저)**: iOS Critical+커스텀음 1개 끝단 동작(Expo로 되는지/FCM·APNs 직접 필요한지), Android 알람채널 무음뚫기. → 발송 경로 확정.
2. DB 스키마 + entitlement 함수 + 웹 토스 결제(체험→자동전환).
3. 프로비저닝(프리셋 먼저: 번들 음성 → 선택→설치) + 설정 UI.
4. 직접 녹음 → 업로드 → 변환(caf) → 프로비저닝.
5. 발송 분기(로컬 예약 알람 / 푸시 critical) + Edge Function 수정.
6. 강한 알림(무음뚫기/끝까지) + 권한 플로우 + 안내.
7. Apple 승인 반영 → iOS 무음뚫기 활성. 미승인 시 fallback(iOS 일반+개인화음, 무음뚫기 Android 중심).

---

## 7-B. 구현 진행 현황 (2026-05-31)
- [x] DB: `custom_sounds`, `alarm_sound_prefs` 생성(구독 테이블 제외).
- [x] `r2-upload` 엣지펑션에 sounds 경로/오디오 타입 추가 + 배포(v13). `lib/r2Upload.ts`에 `uploadSound()`.
- [x] **1단계 녹음 화면**(`RecordSoundScreen`, expo-av, 5초, 미리듣기) → R2 업로드 → `custom_sounds` 저장. 메뉴 "알림음 녹음(테스트)" 진입. **OTA 배포 완료(테스트 가능)**.
- [x] **PoC 성공 (2026-06-02)** — Android에서 **런타임 녹음 파일을 알림음으로 재생 검증 완료.** 정답 레시피:
  - ❌ 채널 sound에 앱 내부 파일경로(`/data/.../cache/x.m4a`) 직접 지정 → **시스템이 접근 불가 → 기본음으로 폴백**(실패).
  - ✅ `getContentUriAsync(fileUri)`(expo-file-system/legacy)로 **content:// URI 변환** → 채널 sound에 지정 → **녹음 목소리로 울림**.
  - ⚠️ **채널은 불변** — 같은 channelId로 sound 바꿔도 안 바뀜. `deleteChannel(id)` 후 `createChannel` 또는 새 id 사용 필수.
  - 코드: `AlarmSoundSettingsScreen.handleTestAlarm` (테스트 버튼). notifee 9.1.8.
- [x] **푸시 경로 검증 성공 (2026-06-02)** — **서버 Expo Push로 보낸 알림이 앱 백그라운드 상태에서 녹음 목소리로 울림.** 검증 방법: 클라가 `alarm_v2_{soundId}` 채널을 content-URI 사운드로 미리 생성 → Expo Push `{to, title, body, channelId, priority:'high'}` 발송(`exp.host/--/api/v2/push/send`) → 그 채널 사운드 재생. **content URI가 백그라운드 푸시 시점에도 유효함 확인.** → **1차 출시 경로 전체 확정.**
- [ ] **2단계 본 구현 (다음)** — PoC를 실제 사용 흐름으로:
  1. **프로비저닝**: 알림음 "이걸로 설정" 시 alarm_sound_prefs 저장 + 그 사운드로 채널 생성(`ensureProvisioned`: 앱 시작/포커스/realtime 변경 시). 채널 불변→pref 바뀌면 새 channelId(`alarm_{userId}_{soundId}`) + 옛 채널 정리.
  2. **서버 발송 분기**: 약 알림 Edge Function(send-medication-reminders 등)이 **수신자 alarm_sound_prefs 조회 → channelId를 그 사용자 사운드 채널로 지정**해 Expo Push. recorded면 channelId, system이면 default 채널.
  3. 삭제권한 RPC(같은 가족) + iOS(caf 변환·Library/Sounds).
- ✅ **충돌 해소(2026-05-31, 오너 "직접 녹음 먼저 출시" 방향으로 결정).** 출시를 2차로 쪼갬:
  - **[1차 출시] 서버 푸시 유지(CLAUDE.md 준수) + 알림음만 개인화.** 약시간 알림은 지금처럼 서버 크론 푸시. 다만 수신 기기에 개인 녹음/프리셋 사운드를 **프로비저닝**해 두고, 푸시 발송 시 그 사운드명을 지정(Android=커스텀 사운드 채널, iOS=Library/Sounds caf 파일명). → "내 가족 목소리로 약 알림"이 동작. **로컬 알람 안 씀 → CLAUDE.md 충돌 없음.** "끝까지 울림"은 1차 미포함.
  - **[2차 빌드] 끝까지 울림 + 무음뚫기.** 이게 진짜로 기기 로컬 예약 알람(AlarmManager/critical)을 요구 → 이때 약시간만 로컬 알람 병행 여부 재검토. iOS Critical Alerts 승인과 함께. (환자 본인 기기 알람이라 cross-user 규칙은 불침해)
  - **최우선 PoC**: "Expo Push로 수신 기기의 개인 녹음음이 실제로 재생되나" 검증(Android 커스텀 채널 / iOS payload sound). 안 되면 FCM/APNs 직접. → 빌드 헛수고 방지 위해 먼저.

## 8. 리스크 체크
- iOS Critical Alerts 승인(외부 변수) — 신청 완료, 대기.
- Expo Push의 커스텀음/critical 한계 → FCM/APNs 직접 가능성.
- Android OEM 배터리 킬러(예약 알람 신뢰성).
- Fish Audio 음성 상업 라이선스(미통과 시 성우 자체제작).
- 자동전환 결제 법적 고지(전자상거래법) — 화면 필수.
