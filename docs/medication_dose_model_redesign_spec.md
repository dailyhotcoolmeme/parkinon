# 약 복용 모델 재설계 — 복용 시각 리스트 전환 (WIP)

> 상태: **설계 정리 중**. 결정된 것만 "확정", 나머지는 "미정"으로 표기. 코드/DB 미착수.
> 최종 수정: 2026-06-06

## 0. 배경 / 문제

- 현재 앱은 "약 복용 = **아침·점심·저녁·취침 4개 식사 슬롯**"으로 가정하고, 이 가정이 타입→DB→서버→화면 전반에 박혀 있음.
- 실제 환자(파킨슨)는 하루 **4회 초과** 복용이 많고, 복용이 식사가 아니라 **시간 간격** 중심임. → 식사 슬롯 모델 자체가 부적합.
- 추가로, 약효추적 알림을 **복용마다 on/off + 추적시간 개별 설정**할 수 있어야 함(현재는 전역 1세트가 모든 복용에 일괄 적용).

## 1. 확정된 결정

- **[확정] 모델 방향 = (가) 복용 시각 리스트.** 복용을 "아침/점심" 같은 고정 이름이 아니라 **복용 시각(들)의 리스트**로 모델링한다. 횟수 무제한.
  - 근거: 파킨슨 임상 실제와 일치, 약효추적을 "복용 1건" 단위로 깔끔히 부착 가능, 슬롯 이름의 누더기화 방지.
  - 반려안: (나) 4슬롯 유지 + 사용자정의 슬롯 추가 → 근본 해결 아님, 나중에 재작업 위험.
- **[확정] 미정 B = ② 환자 "복용 시간표" + 약 배정.** 복용 시각 리스트는 **환자(user) 단위 단일 출처**로 둔다. 환자가 하루 복용 시각 리스트(예: 08:00·11:00·14:00·17:00·20:00)를 만들고, 각 약을 해당 시각에 배정한다. 알림은 **시각 단위로 묶어서** 발송("8시 약 드세요 — 시네메트·마도파").
  - 근거: 시각당 알림 1개로 어르신 UX 단순, 약효추적을 "이 시각 복용"에 깔끔히 부착, 기존 `users.meal_schedules`(환자 단위)와 연속성.
  - 반려안: ① 약별 시각 지정 → 의학적으론 정밀하나 동시각 알림 묶기·입력 반복 부담.
- **[확정] 미정 C = ① 복용 시각별 기본값 = "세트" 방식.** 복용 시각 1개 = `{복용 알림 + 그 복용의 약효추적 알림(들)}` 한 세트로 묶는다. 그 시각에 "약 먹었어요" 누르면 세트에 정해둔 약효추적 설정대로 자동 큐잉. 매번 묻지 않음.
  - **[UI 원칙]** 내 정보 > 알림 설정에서 **복용 시각마다 한 카드(세트)** 로 표시: [복용 알림 on/off (+소리)] + [약효추적 on/off + 추적 시각들 (+소리)].
  - 이 "세트" 구조가 곧 **약복용 메뉴의 복용 후 팝업** 동작을 결정한다(아래 확정).
  - 보류안: ③ 세트 기본값 + 복용 시 "이번만 끄기" 오버라이드 → 나중에 필요 시 ①과 호환되게 얹음.
- **[확정] 복용 후 팝업 = 세트 종속(①).** "약 먹었어요" 저장 후 동작은 그 복용 세트의 약효추적 설정을 따른다.
  - 추적 시각 목록에 **"복용 직후"** 항목을 둔다. 그 복용 세트에 "복용 직후"가 켜져 있으면 → 저장 직후 **몸상태 팝업** 표시.
  - 그 복용의 약효추적이 **꺼져 있으면 → 팝업 없이 "기록됐어요" 확인만**.
  - 30분/1시간/2시간 후 등은 기존대로 예약 푸시 알림.
  - 효과: 세트가 즉시 팝업 + 예약 알림을 한 곳에서 통제. 직후 기록도 추적의 일부 → 약효 패턴 통계에 자연 반영(triggered_by 일관).
  - 반려안: ② 추적 on/off와 무관하게 항상 권유(현행, 세트와 따로 놂) / ③ 직후 팝업 제거(직후 기록률 저하).
- **[확정] 추적 시각 옵션 = B 프리셋 + 직접 추가.** 세트 카드에서 추적 시각은 **고정 프리셋 체크 + "＋ 직접 추가"(분 단위)** 로 고른다.
  - 프리셋 기본 항목: **복용 직후 · 30분 후 · 1시간 후 · 2시간 후 · 3시간 후** (파킨슨 약효 곡선 커버).
  - 평소엔 탭만(어르신 단순), 특수 시각은 직접 추가(보호자 등). CLAUDE.md "커스터마이징 가능" + "텍스트 입력 최소화" 동시 충족.

## 2. 핵심 개념 (정의) — 일부 미정

- **복용 슬롯(dose slot)**: 환자의 하루 복용 1회를 가리키는 단위. 시각(HH:MM)을 가짐. 라벨(예: "아침", "점심", "오후 추가")은 **선택**.
- **복용 기록(med_log)**: 실제로 약을 먹은 1건. 약효추적은 이 1건에 붙는다.
- **[미정 A] 슬롯 식별 방식**: 현재는 문자열 enum(`morning|lunch|dinner|bedtime`). 전환 후 식별자를 무엇으로?
  - 후보 ①: 슬롯 UUID (가장 유연, 마이그레이션 큼)
  - 후보 ②: 시각 문자열(HH:MM) 자체를 키로
  - 후보 ③: 기존 4개는 이름 유지 + 추가분만 custom id (하위호환 절충)
- **[확정 → §1] 미정 B**: 환자(user) 단위 복용 시각 리스트가 단일 출처. 약은 시각에 배정. (상세 §1)

## 3. 약효추적(effect tracking) 재설계 — 일부 미정

- 현재: `effect_tracking_queue`가 **`meal_time`(슬롯) 기준 중복제거**, 추적시간은 `users.med_notif_prefs` **전역 리스트**(30분·120분 등) 1개. 취침약 자동 제외. 환자 본인 수정 UI 없음(보호자만).
- 목표: **복용별로** ① 약효추적 적용 여부(on/off) ② 적용 시 추적 시간(들) 설정.
- **[확정 → §1] 미정 C**: ① 복용 시각별 기본값(세트). 복용 시각마다 약효추적 on/off+시각을 미리 정함. (상세 §1)
- **[미정 D] 큐 식별 기준**: 현재 `meal_time` → 전환 시 `med_log_id` 1:1 기준으로 변경(복용마다 독립 큐) 필요.
- **[확정] 제약: 추적과 "다음 복용" 겹침 = 소프트 경고(A안).** 막지 않고 알려준다 — "사용자가 직접 정한다"는 철학 우선.
  - 현재 상태(확인됨): `SettingsScreen.checkMealGapConflict`가 **설정 단계에서 하드 차단**(추적 간격 ≥ 슬롯 최소 간격이면 막음). 4슬롯 최소 간격 기준. 서버 큐잉/발송 재검증 없음.
  - 새 모델(A): 하드 차단 → **소프트 경고**로 완화. 복용별로 "그 복용 → 바로 다음 복용"을 넘는 추적 시각을 고르면 **"다음 복용과 겹쳐 약효 기록이 섞일 수 있어요" 안내만 띄우고 그대로 진행 허용**.
    - 사용자가 의도적으로 넘기게 둘 수 있으므로 **서버는 send_at을 자르지 않고 그대로 큐잉**(사용자 선택 존중). 단, 겹침 시 약효 패턴 통계에서 어떻게 다룰지는 구현 시 확인(데이터 모호성 표시 등).
  - **[확정] 그날 마지막 복용(다음 복용 없음) 추적 상한 = (다) 제한 없음.** 충돌할 다음 복용이 없고 사용자가 직접 정하므로 막지 않음.

## 4. 영향 범위 (현재 구조 조사 결과)

### 4.1 타입/상수 (중)
- `src/types/database.ts` `MealTime`(4개 고정).
- 화면별 중복 정의: `SettingsScreen`(`MED_TIME_SLOTS`,`SLOT_ORDER`), `MedicationManageScreen`(`TIME_SLOTS`), `MedicationScreen`(`DEFAULT_MEAL_TIME_LABELS`), `MealTimeModal`(`MEAL_OPTIONS`), `MedicationRegisterScreen`(`TIME_SLOTS`), `BodyStateScreen`/`ExerciseDurationScreen`(default times), `useMedication`(`TodayMedStatus`,`MEAL_TIME_LABELS`), `utils/medUtils`(`mealTimeToKorean/Period`).

### 4.2 DB (중대) — 마이그레이션·기존데이터 호환 주의
- `medications.meal_times`(배열)·`meal_schedules`(jsonb).
- `users.meal_schedules`·`med_time_notif_prefs`·`med_time_sound_prefs`(슬롯 키 가정).
- `med_logs.meal_time`(enum).
- `effect_tracking_queue.meal_time`.

### 4.3 서버 (중)
- RPC `get_meds_at_time` (meal_schedules 키 순회 — 동적화 여지 있음).
- `send-medication-reminders`(`MEAL_LABELS` 하드코딩, 정시/미복용 알림).
- `send-missed-med-reminders`(`MEAL_LABELS`).
- `queue-effect-tracking`(슬롯 기준 중복제거).
- `process-notification-queue`(`MEAL_LABELS`, 표시용).

### 4.4 화면 (중대 — 가장 큼)
- 온보딩 약 등록, 약 관리, 복용 기록 모달, 홈 약복용 탭, 알림 설정(약시간/약효추적/소리), 약효추적 팝업(BodyState), 운동 팝업(다음 복용 안내).

## 5. 마이그레이션 고려 (미정)
- 기존 사용자 4슬롯 데이터(`meal_schedules` 등)를 새 "복용 시각 리스트"로 변환하는 1회성 마이그레이션 필요.
- 기존 `med_logs.meal_time` 과거 기록 보존(통계·차트 영향) 방식 결정 필요.
- 출시 전이라 사용자 수 적음 → 파괴적 마이그레이션 부담은 상대적으로 낮음(확인 필요).

## 6. 단계별 구현 순서 (초안 — 미확정)
1. 데이터 모델 확정(미정 A~D) → 스키마 설계.
2. DB 마이그레이션 + `src/types/database.ts`.
3. 서버 함수(RPC·알림·약효추적 큐) 동적화.
4. 공용 슬롯 소스/유틸 1곳으로 통합(중복 상수 제거).
5. 화면 순차 전환(등록 → 관리 → 복용 기록 → 홈 → 알림 설정 → 약효추적/운동).
6. 약효추적 복용별 설정 UI.
7. 마이그레이션 검증 + 빌드/설치 테스트.

## 7. 다음에 정할 것 (차근차근 agenda)
### 확정
- [x] 모델 방향 → **(가) 복용 시각 리스트**
- [x] 미정 B: 슬롯 종속(약 vs 환자) → **② 환자 복용 시간표 + 약 배정**
- [x] 미정 C: 약효추적 부착 단위 → **① 복용 시각별 세트**
- [x] 복용 후 팝업 동작 → **① 세트 종속("복용 직후" 켜짐 시 팝업, 추적 꺼지면 확인만)**
- [x] 추적 시각 옵션 → **B 프리셋(직후·30분·1·2·3시간) + 직접 추가**
- [x] 추적-다음복용 겹침 → **A 소프트 경고(막지 않고 안내, 진행 허용)**
- [x] 마지막 복용 추적 상한 → **제한 없음**

### 확정 (구현 설계 — 아키텍처 패스)
- [x] 미정 A: 슬롯 식별 → **전용 테이블 `dose_slots`(+`medication_dose_slots` M:N), PK=UUID**
- [x] 미정 D: 큐 식별 → **`effect_tracking_queue.med_log_id` 1:1 + `dose_slot_id`**
- [x] 마이그레이션 → **비파괴(추가만): meal_schedules→dose_slots 생성, med_logs/on_off_logs/measurements 무변경. dose_slots drop으로 롤백 가능**
- [x] UI 전환 범위 → **7단계 점진(DB추가→마이그→서버동적화→공용상수통합→읽기전환→쓰기전환→세트카드/팝업)**, 전부 OTA 호환

### 확정 (구현 설계 — 추가)
- [x] **약효 패턴 통계/차트 = (가) 복용 슬롯별 트렌드로 재설계.** 4축 폐기. `on_off_logs`에 `dose_slot_id` 추가해 슬롯별 집계. 별도 구현 단계로 분리. 복용 多일 때 차트 가독성(묶어보기/스크롤)은 통계 단계에서 설계.

## 8. 구현 설계 핵심 (아키텍처 패스 결과)
- **신규 테이블**: `dose_slots`(id uuid, patient_id, time, label?, sort_order, remind_enabled/sound, track_enabled/track_intervals int[]/sound, is_active) + `medication_dose_slots`(약↔슬롯 M:N).
- `med_logs.dose_slot_id`(SET NULL) 추가, `meal_time`은 NULL 허용·legacy 보존. `effect_tracking_queue`에 `dose_slot_id`+`sound_id` 정식화, 중복제거 `meal_time`→`med_log_id`.
- 서버: `get_meds_at_time` RPC를 dose_slots 행조회로, 알림 함수들 `MEAL_LABELS`→슬롯 label/시각, bedtime 하드제외 삭제(track_enabled로), queue는 send_at 안 자름(소프트경고). `send-missed-med-reminders`는 send-medication-reminders +20분으로 일원화(폐기 후보).
- 클라: 중복 슬롯 상수 → 공용 `useDoseSlots`/`constants/doseSlots.ts` 1곳 통합.
- **숨은 결합 주의**: `measurements.med_intake_id→med_logs(id)` FK(med_log 재생성 금지), 통계가 `on_off_logs.medication_meal_time`+`med_logs.meal_time` TEXT 슬롯키 의존.
- **[확정] 통계 축 = (가) 복용 슬롯별 재설계.** `on_off_logs.dose_slot_id`(uuid) 추가 → 슬롯별 약효 트렌드. 4축(아침/점심/저녁/취침) 전제 폐기. `useRecordDetailData`/`useRecordsData` 차트 쿼리 재작성. **별도 단계**(핵심 모델 완성 후). 복용 多 시 차트 가독성(시간대 묶어보기/스크롤) 설계 포함.

## 9. 구현 단계 (확정 순서)
1. ✅**[DB·비파괴] 완료(2026-06-08)** dose_slots/medication_dose_slots 생성+RLS(medications 패턴), med_logs/on_off_logs/effect_tracking_queue에 dose_slot_id. 마이그 `20260608000000_add_dose_slots_model.sql`. 앱 영향 0. ⚠️drift: effect_tracking_queue.sound_id=uuid, med_log_id=text(서버단계 정합성 검토).
2. ✅**[DB] 완료(2026-06-08)** 데이터 이관 `20260608010000_migrate_4slot_to_dose_slots.sql`. dose_slots 4·배정 3·med_logs 83/83·on_off_logs 170/184 매핑, 멱등. ⚠️**med_logs.medication_id 전부 NULL = 복용기록이 약이 아니라 슬롯 단위**(patient 직접 매핑함). 서버/통계 설계에 반영 필요.
3. ✅**[서버] 완료(2026-06-09)** get_meds_at_time RPC + 알림 함수 dose_slot 동적화(legacy fallback 유지).
   - (2026-06-09 완료) get_meds_at_time RPC 동적화 + 4 Edge Function(send-medication-reminders/send-missed-med-reminders/queue-effect-tracking/process-notification-queue) dose_slot 호환화. 구버전 meal_time 경로 100% 보존(라이브 데이터로 검증). effect_tracking_queue.med_log_id text→uuid 정합화(무손실). 라이브 배포 완료.

   **⚠️ 4단계 진입 전 반드시 처리할 이월 항목**
   - ⚠️(중) RPC `get_meds_at_time`의 NOT EXISTS legacy 억제가 `dose_slot.remind_enabled=false`를 무시함 → 이관 환자의 dose_slot에서 리마인더 OFF한 시각이 legacy meal_schedules 분기로 새어 알림이 갈 수 있음. 현재는 `med_time_notif_prefs`가 실질 게이트라 잠복. 4단계에서 클라가 `dose_slot.remind_enabled`를 실질 게이트로 쓰려면, RPC 억제 조건을 "remind_enabled 무관, 해당 시각 active dose_slot 존재 시 legacy 억제"로 바꾸거나 이관 환자 legacy meal_schedules를 정리해야 함.
   - ✅(해결됨·2026-06-09) queue-effect-tracking 신규 분기 cross-patient 가드(403) + dose_slot_id만 있고 med_log_id 없을 때 400 거부 — 하드닝 완료. (기록만, 재작업 불필요)
   - ⚠️send-medication-reminders 보호자 미복용 data의 mealTime이 비표준 라벨 슬롯에서 null → 구버전 보호자 앱 표시 영향. 4단계 클라에서 doseSlotId 기반 표시로 전환 시 함께 처리.
4. ✅**[클라] 완료(2026-06-09·폰 검증)** 공용 슬롯 소스 통합 + 읽기 경로 전환.
   - (2026-06-09 완료·폰 검증) 신규 src/constants/doseSlots.ts + src/hooks/useDoseSlots.ts(resolveDisplaySlots 단일 분기점) 공용소스화. database.ts 타입(dose_slots/medication_dose_slots Row, med_logs.dose_slot_id+meal_time nullable). useMedication todayStatus additive 슬롯화(bySlotId, 정규키=dose_slot_id ?? legacyKey→slot.id ?? meal_time). 읽기 전환: MedicationScreen 홈 N슬롯 동적렌더, MealTimeModal·MedicationManageScreen·BodyState/Exercise 다음복용안내·HistoryTimeline. dose_slots 우선·legacy fallback. OTA 호환 순수 TS. 삼성 S24 실기 빌드, 이관 환자 약복용 홈에서 아침8:00→점심12:00→저녁18:00 시각순 렌더 + 점심 '완료/취소' 정상 표시 확인.

   **⚠️ 5단계로 이월된 항목**
   - ⚠️(5단계 필수) effect_tracking_queue에 존재하지 않는 meal_time 컬럼을 select하는 기존 결함 3곳: MedicationScreen fetchNextNotifMessage(~935행), BodyStateScreen(~1494행), ExerciseDurationScreen(~66행). 약효추적 후보가 조용히 누락(try/catch로 표시는 degrade). 5단계 쓰기 전환 시 dose_slot_id 기반으로 정리.
   - ⚠️(5단계) useDoseSlots 모듈 캐시 무효화(invalidateDoseSlotsCache) 호출처가 아직 없음. 5단계 슬롯/약 편집 저장 직후 호출 배선 필요(현재 읽기전용이라 무영향).
   - ⚠️(6단계) 비표준 라벨(legacyKey 역매핑 실패) dose_slot은 표준 4슬롯 섹션/모달에서 묵시 제외. N>4 비표준 슬롯은 6단계 세트카드에서 처리. 현 데이터는 표준 4슬롯이라 미발생.

   **🛠 (2026-06-09) 환경 복구 메모**
   - node_modules 부분 손상(@expo/vector-icons·@expo/metro-config 물리적 누락) → npm ci로 복구. metro.config.js의 require('@expo/metro-config')를 SDK54용 require('expo/metro-config')로 수정. expo-font가 56.0.5(SDK56용)로 잘못 깔려 getDirectConverter NoSuchMethodError 크래시 → npx expo install expo-font로 ~14.0.12 정렬 후 재빌드로 해결. package.json에 @expo/vector-icons ^15.0.3, expo-font ~14.0.12 명시됨.
5. ✅**[클라] 완료(2026-06-09·삼성S24 폰 검증)** 쓰기 경로 전환(takeMedication dose_slot_id+med_log_id, 등록/관리/복용기록 모달).
   - (2026-06-09 완료·삼성S24 폰 검증) takeMedication dual-write(med_logs에 dose_slot_id+meal_time, .select('id')로 med_log_id 확보) + queue-effect-tracking 신규 시그니처(dose_slot_id+med_log_id 1:1) 이중분기. MealTimeModal onSelect에 dose_slot_id+비표준슬롯 선택. 공용 헬퍼 ensurePatientDoseSlots/syncMedicationDoseSlots(멱등키 patient_id+label) 신설. 약관리(handleAdd/Edit/SlotEdit/OCR/Delete)·온보딩(FamilyInviteScreen return=representation+sync, MedicationRegisterScreen ensure) dual-write + invalidateDoseSlotsCache 배선. effect_tracking_queue 라벨결함 3곳(MedicationScreen/BodyState/Exercise) dose_slot_id 해석으로 수정. 회귀 2건 수정(과거날짜 정규키 매핑·취침슬롯 로컬알림 trackEnabled 게이트). 라이브 검증: 저녁약 기록→med_logs dual-write+effect_tracking_queue 2건(dose_slot_id+med_log_id, 30/120분) 정확 생성→취소→큐 0건 정리 확인.
   - 🐞(2026-06-09 폰테스트 발견·수정) 복용 취소 시 effect_tracking_queue가 정리 안 돼 취소해도 약효추적 알림이 발송되던 버그. 원인 2개: ①effect_tracking_queue에 DELETE RLS 정책 없음→클라 .delete() 무효(0행) ②med_log 삭제 시 FK ON DELETE SET NULL로 큐 고아화. 수정: cancel_patient_record RPC(SECURITY DEFINER) 내부에서 med_log 삭제 전 큐 정리(신규 med_log_id 1:1 + legacy meal_time+send_at>=taken_at, sent_at IS NULL만 삭제·발송완료 보존). 라이브 RPC 적용 완료 + 마이그 supabase/migrations/20260609000000_cancel_record_cleanup_effect_queue.sql. 클라의 무효 delete는 제거.

   **⚠️ 6단계로 이월된 항목**
   - ⚠️(6단계) MealTimeModal이 부모와 별도 useDoseSlots 호출→캐시 stale 윈도우서 라벨 누락 가능(라이브 영향 없음, 6단계 세트카드서 prop 단일소스화 권장).

   **(이하 1파 진행 시점 기록 — 위 완료 항목으로 흡수됨)**
   - 🟡(1파 완료·미검증) 공용 동기화 헬퍼 + takeMedication dual-write 코어 + MealTimeModal/MedicationScreen 호출부.
     - `useDoseSlots.ts`에 `ensurePatientDoseSlots(patientId, mealSchedules, notifPrefs?, notifMinutes?)`·`syncMedicationDoseSlots(patientId, medicationId, mealTimes)` 신설(멱등 upsert/delete-then-insert, 실패해도 throw 안 함). 약관리/온보딩 에이전트가 import.
     - `takeMedication({mealTime, doseSlotId})` 시그니처 전환(medication_id 항상 NULL). insert `.select('id').single()`로 medLogId 확보. queue-effect-tracking 이중분기: doseSlotId+medLogId 쌍이면 신규 payload(track_enabled 서버 게이트), 아니면 legacy meal_time. medLogId undefined면 신규 분기 미발송(서버 400 회피).
     - effect_tracking_queue.meal_time 타입 누락 보강(database.ts). fetchNextNotifMessage dose_slot_id 라벨 해석.
     - ⚠️ 2파(등록/관리 화면에서 헬퍼 배선·invalidate)·폰 검증 대기. 비표준 슬롯 쓰기는 가능해졌으나 6단계 세트카드 전까지 표준 라벨 위주.
6. **[클라] 구현(미검증·2026-06-09)** 알림설정 세트카드 — 복용 시각별 카드(아코디언) 구현. 결정 5건 반영: ①추적시각=큰 체크줄 5개(0/30/60/120/180분, 0=약 드신 바로 뒤) ②신규 슬롯 기본 추적시각={0,30} ③표준 4슬롯(legacyKey)은 삭제 불가·복용 알림 끄기만(비표준 추가분만 is_active=false 삭제) ④소리 2개(복용 알림 소리+여쭤볼 때 소리) ⑤'약 드신 바로 뒤' 체크줄에 ⓘ 예고 문구(약복용 탭 팝업 코드는 보류). 신규 `src/components/settings/DoseSlotSetList.tsx`(dose_slots 직접 read/write·즉시저장·invalidate+refresh·시간 바텀시트 useSwipeDownDismiss). SettingsScreen Card1(약시간)+Card2(약효추적)만 세트카드로 통합, 약 미복용 알림은 별도 카드로 보존, 전체알림·운동·보호자 카드 무변경. checkMealGapConflict 하드차단 미사용(세트카드에서 인라인 소프트 경고로 대체, 마지막 복용은 경고 없음). 보호자 '환자 알림 수정' 서브카드는 이번 단계 미변경(이월). 복용후 팝업 세트종속은 보류. 순수 TS·OTA 호환. 본인 코드 TS 에러 0(baseline 68 무관). 폰 검증 대기.
7. **[통계]** 약효 패턴 차트 슬롯별 재설계(가).
8. **[정리]** legacy 컬럼/함수 deprecate.
