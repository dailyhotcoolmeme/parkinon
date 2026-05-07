# 파킨온 알림 시스템 진단/조치 이력

> 각 이슈별로 보고 → 진단 → 조치 → 결과 기록.
> 향후 회귀나 신규 이슈 발생 시 이 문서를 **먼저** 확인할 것.
>
> **핵심 교훈**: 알림 시스템은 누적 패치(patch on patch)가 아주 쉽게 회귀를 만든다.
> 작은 수정도 dedupe / nested navigate / route.params / AsyncStorage / pendingFlag TTL /
> useFocusEffect의 5축이 어떻게 상호작용하는지 머릿속에 그려보고 손을 댈 것.

---

## [이슈 1] 약 복용 후 "기록하기" → 몸상태 팝업 미표시 (2026-05-02 이전)

**보고:** 환자가 약 복용 기록 후 "몸상태 기록할래요?" 팝업에서 "기록하기"를 탭했지만
몸상태 팝업이 뜨지 않음.

**의심 가설:**
- AsyncStorage write가 commit되기 전에 navigate 발생
- BodyStateScreen이 stale state로 read

**진단:**
- `AsyncStorage.setItem(...)`이 `await` 없이 호출되고 곧바로 `navigateTo` 실행
- BodyStateScreen 진입 시점에 storage에 값이 아직 없어 `null`을 read → 팝업 분기 진입 못 함
- 추가로 nested navigate 형식이 부정확 (`navigateTo('BodyState')`만 호출, 실제로는
  `Main > BodyStateTab > BodyState` 3단 nested 필요)

**조치:** 커밋 `553056a` "알림→팝업 흐름 4개 결함 통합 수정"
- `await AsyncStorage.setItem(...)`로 변경
- 정상 nested navigate 형식 적용
- `route.params`로 직접 전달 + AsyncStorage 이중 안전망

**결과:** 정상 동작 확인. 사용자 "푸시알림 눌러서 자동 팝업은 이제 잘 되는거 같다" 피드백.

---

## [이슈 2] 운동 후 몸상태 진입 시 잘못된 "중복?" 팝업 (2026-05-02 이전)

**보고:** 운동 기록 후 몸상태 화면 진입 시 "이미 기록이 있습니다, 덮어쓰시겠어요?"류
잘못된 dedup 팝업 노출.

**진단:**
- `route.params.openFlow` 가 dedupe 처리 후에도 남아있어 다음 진입에서 재실행
- 잘못된 시점에 중복 체크 트리거

**조치:** 커밋 `553056a`
- `openFlowWithDuplicateCheck` 흐름 정리
- dedupe 직후 route.params 클리어

**결과:** 정상.

---

## [이슈 3] 약복용 알림 → 시간대 팝업 미표시 (2026-05-02 이전)

**보고:** 약복용 알림 탭 시 "어느 시간대 약을 드셨나요?" 팝업이 뜨지 않음.

**진단:**
- handler에서 navigate 후 즉시 dedupe 등록 → 화면 mount 전에 useFocusEffect가 stale param read

**조치:** 커밋 `553056a`
- handler 순서 정리 (navigate → useFocusEffect 처리 → dedupe)

**결과:** 정상.

---

## [이슈 4] App.tsx 이중 핸들러 (2026-05-02 이전)

**보고:** 한 번의 알림 탭에 핸들러가 2회 발화하여 팝업이 두 번 뜸.

**진단:**
- `useLastNotificationResponse` 훅과 `addNotificationResponseReceivedListener` 두 곳에서
  같은 응답을 처리
- dedupe Set이 없어 둘 다 통과

**조치:** 커밋 `553056a`
- `handledNotifIds` Set 도입
- 두 경로 모두 동일 핸들러를 통과하지만 dedupe로 1회만 실행

**결과:** 정상.

---

## [이슈 5] 운동 알림 회귀 (2026-05-02 이전)

**보고:** [이슈 1~4] 수정 이후 운동 알림이 동작 안 하게 됨 (회귀).

**진단:**
- dedupe 타이밍이 운동 분기에서는 너무 일찍 발생 → useFocusEffect가 처리하기 전에 차단
- 운동 화면 nested navigate 형식 누락
- ExerciseScreen에 useFocusEffect 결손

**조치:** 커밋 `4891f72` "운동 알림 회귀 수정"
- dedupe 타이밍 분기 보정
- nested navigate 형식 보강
- useFocusEffect 추가

**결과:** 정상.

**교훈:** 한 분기 고치면 다른 분기 부숨. 분기별 회귀 테스트 필수.

---

## [이슈 6] 몸상태 중복 팝업 회귀 (2026-05-02 이전)

**보고:** [이슈 5] 수정 이후 몸상태 중복 팝업이 다시 등장.

**진단:**
- `openFlowWithDuplicateCheck`가 Alert vs TriggerSelectModal 둘로 분리되어 있어 분기마다
  다른 팝업 띄움
- route.params가 재진입 시 stale dedupe됨

**조치:** 커밋 `8f6319c` "몸상태 중복 팝업 회귀 수정"
- 모든 분기를 TriggerSelectModal로 통일
- route.params stale dedupe 처리

**결과:** 정상.

---

## [이슈 7] 약 복용 후 종 뱃지 미감소 (2026-05-02 이전)

**보고:** 약 복용 기록해도 상단 종 뱃지 숫자가 줄어들지 않음.

**진단:**
- `takeMedication` 알림이 `read_at`이 업데이트 안 됨
- 안전망 cutoff가 너무 좁아 일부 알림이 안 잡힘

**조치:** 커밋 `aabd2f3` / `e2db671`
- 약복용 시 takeMedication 알림 read_at 자동 처리
- 안전망 cutoff를 KST today로 확장

**결과:** 정상.

---

## [이슈 8] 멀티 알림 동시 도착 race (2026-05-02 이전)

**보고:** 여러 알림이 동시에 도착하면 그중 일부만 처리.

**진단:**
- 핸들러가 비동기인데 직렬화 안 됨
- 동시 진입 시 navigate가 서로 덮어씀

**조치:** 커밋 `68e1720`
- 핸들러 enqueue/serialize 도입 (`enqueueHandler`)

**결과:** 정상.

---

## [이슈 9] PiP 환경 약복용 미표시 (2026-05-02 이전)

**보고:** 다른 앱 PiP 모드 상태에서 약복용 알림 탭해도 팝업이 안 뜸.

**진단:**
- AppState 전환 타이밍 + listener 발화 타이밍이 PiP에서는 어긋남

**조치:** 커밋 `dcf80ce`
- 일부 분기에서 fallback 처리

**결과:** 부분 해결.

---

## [이슈 10] 운동 알림 단독 미표시 (2026-05-02 이전)

**보고:** 운동 알림만 탭해도 화면 진입 안 됨.

**진단:** dedupe 타이밍 문제 잔존.

**조치:** 커밋 `423c8a5`

**결과:** 정상.

---

## [이슈 11] 삼성 인터넷 사용 중 약복용 미표시 (2026-05-02 이전)

**보고:** 삼성 인터넷 브라우저 활성 상태에서 약복용 알림 탭 시 미표시.

**진단:**
- 삼성 인터넷이 무겁게 메모리 점유 → expo-notifications listener 발화 race
- `useLastNotificationResponse` hook이 정상 발화 안 함

**조치:** 커밋 `7fedf79`
- 일부 fallback 추가

**결과:** 부분 해결. **이 시점에서 listener race가 구조적 한계임이 드러남.**

---

## [이슈 12] 몸상태 알림 미표시 (2026-05-02 이전)

**보고:** 몸상태 알림 탭 시 미표시.

**진단:** dedupe + nested navigate 누락.

**조치:** 커밋 `6005f42`

**결과:** 정상.

---

## [이슈 13] 알림 시스템 전체 재설계 시도 → 회귀 발생 (2026-05-02 이전)

**보고:** 누적 patch가 너무 많아 전체 재설계 시도.

**진단:** 재설계가 기존 안정 분기까지 건드리며 다중 회귀.

**조치:** 커밋 `ff3e065`로 재설계 머지.

**결과:** **회귀 다발**. 사용자 좌절. → 롤백 결정의 직접 원인.

**교훈:** "전체 재설계"는 알림처럼 분기 많은 시스템에서는 금기. 각 분기별 계약 유지가 우선.

---

## [이슈 14] 같은 탭 navigate no-op 응급 fix (2026-05-02 이전)

**보고:** [이슈 13] 회귀의 임시 응급 처치.

**조치:** 커밋 `790ce94` — 같은 탭 navigate가 no-op 되는 문제 응급 fix.

**결과:** 응급 fix 후에도 누적 회귀 누적 → 롤백 결정.

---

## [이슈 15] 롤백 결정 (2026-05-02 이전)

**결정:** 안정 시점인 `8f6319c`로 코드 롤백 + 종 뱃지 fix(`e2db671`)만 cherry-pick.

**근거:**
- 사용자 좌절 누적 ("자동 팝업은 잘 되는거 같다" 이후의 회귀들이 신뢰를 잃게 함)
- 패치 누적이 디버깅 자체를 어렵게 만듦

**결과:** 알림 핵심 동작은 안정 회복. 단, **이후 부수 UI fix들이 롤백으로 사라짐** → [이슈 16, 17] 재적용 작업 발생.

**교훈:** 롤백 시 주변 무관 fix까지 함께 사라진다. 롤백 직후 즉시 "함께 사라진 fix 목록"을 만들어 재적용해야 함.

---

## [이슈 16] NotificationOnboardingModal SafeArea 재적용 (2026-05-02 이전)

**보고:** 롤백 이후 알림 온보딩 모달이 삼성 nav bar에 가려짐.

**조치:** 커밋 `a60fc36` — SafeAreaProvider + ScrollView + lineHeight 복원.

**결과:** 정상.

---

## [이슈 17] SafeArea/UI fix 전수 재적용 (2026-05-02 이전)

**보고:** 롤백으로 사라진 다른 SafeArea/UI fix들도 재적용 필요.

**조치:** 커밋 `87ace4b` — FamilyCheckScreen 등 텍스트 클리핑/하단 버튼 가림 fix 재적용.

**결과:** 정상.

---

## [이슈 18] stale pendingMedNotif 차단 (2026-05-02 이전)

**보고:** 오래된 pending 알림 데이터가 잘못된 시점에 살아나 팝업을 띄움.

**진단:**
- AsyncStorage pendingMedNotif에 TTL 없음
- cross-type cleanup 누락 (약복용 pending이 몸상태 진입 시점에도 잡힘)
- removeItem이 await 안 됨

**조치:** 커밋 `4bc1551`
- TTL 5분 도입
- cross-type cleanup
- removeItem await

**결과:** 정상.

---

## [이슈 19] 알림 디버그 로깅 시스템 구축 (2026-05-02 이전)

**조치:** 커밋 `9348914` — `notification_debug_logs` Supabase 테이블 + 핸들러 각 단계
(`handler_enter`, `dedupe_skip`, `navigate_start`, `handler_exit` 등) 자동 기록.

**효과:** 사용자 기기에서 발생하는 listener race를 사후에 진단 가능.

---

## [이슈 20] expo-notifications listener 누락 — 영웅문# 사용 중 9시 약효추적 알림 (2026-05-02, 이번 fix)

**보고:** 사용자가 영웅문# (HTS) 앱 사용 중 9시 약효추적 알림 도착 → 알림 자체는
표시되었으나 탭 시 화면 진입 안 됨. 핸들러가 발화한 흔적이 `notification_debug_logs`에
없음.

**의심 가설:**
- 영웅문#이 메모리/CPU를 무겁게 점유 → expo-notifications JS listener가 race로 누락
- `useLastNotificationResponse` hook이 마운트 사이클에 따라 콜드스타트 응답을 놓침
- `addNotificationResponseReceivedListener`도 native → JS 이벤트 전달 race로 누락

**진단:**
- 디버그 로그가 비어있다는 것은 핸들러 자체가 호출되지 않았음을 의미
- 즉 listener subscription이 native 응답을 받지 못함
- 이는 [이슈 11] 삼성 인터넷 케이스와 동일한 구조적 한계
- expo-notifications의 알려진 race로, JS 측 fallback이 유일한 우회

**조치:** 이번 커밋 — `App.tsx`에 두 단계 fallback 추가
1. **콜드스타트 명시 호출**: 부팅 시 `Notifications.getLastNotificationResponseAsync()`를
   명시 호출하여 `useLastNotificationResponse` hook이 발화 못 한 응답을 회수.
2. **AppState active 전환 시 재확인**: `AppState.addEventListener('change')`에서
   background → active 전환마다 `getLastNotificationResponseAsync()`를 재호출.
   백그라운드 listener가 놓친 응답 회수.

두 fallback 모두 기존 `handledNotifIds` dedupe Set으로 중복 차단되므로 정상 발화 케이스에는
영향 없음. listener가 정상 발화하면 fallback의 응답은 dedupe로 즉시 skip된다.

**결과:** 배포 후 추적 필요. `notification_debug_logs`에서 `handler_enter` 로그가 늘어났는지,
`source: 'fallback'` 분기가 잡히는지 모니터링 권장.

**교훈:** expo-notifications listener race는 라이브러리 차원에서 완전 해결 안 됨. JS 측에서
다중 경로(hook + listener + getLast + AppState)로 중복 fallback을 까는 게 유일한 안정화.
dedupe만 단단하면 중복 fallback은 안전하다.

---

## 현재 알림 시스템 아키텍처 요약

### 입구 (3 → 4개 경로, 모두 같은 핸들러로 수렴)
1. `Notifications.useLastNotificationResponse()` hook — 콜드스타트
2. `Notifications.addNotificationResponseReceivedListener()` — 백/포그라운드 탭
3. `Notifications.getLastNotificationResponseAsync()` — **이번 fix 추가**, 콜드스타트 fallback
4. `AppState change → active` — **이번 fix 추가**, background → active 회수

### 공통 핸들러 (`enqueueHandler` → `handleNotificationResponse`)
- **직렬화**: enqueue로 동시 진입 race 차단
- **dedupe**: `handledNotifIds` Set + TTL → 중복 처리 차단
- **분기 처리**: type별 (`takeMedication`, `medEffect`, `bodyState`, `exercise` 등) nested
  navigate + AsyncStorage pending 저장 + route.params 전달
- **safety net**: AsyncStorage `pendingMedNotif` TTL 5분 + cross-type cleanup
- **로깅**: `notification_debug_logs` 각 단계 자동 기록

### 화면 측 수신 (각 탭 화면)
- `useFocusEffect` 안에서 `route.params` + AsyncStorage pending을 read
- 처리 후 `route.params` clear + AsyncStorage `removeItem await`

---

## 알려진 한계

1. **expo-notifications listener race**: 무거운 앱(영웅문#, 삼성 인터넷, 게임 등) 동시 실행 시
   native → JS listener 발화가 누락될 수 있음. **이번 fix의 fallback이 1차 우회**이지만
   AppState 전환이 발생하지 않는 시나리오(예: 알림 탭 → 즉시 재탭)에는 여전히 race 가능.
2. **PiP 환경 race**: PiP 모드에서 AppState 전환 타이밍이 어긋남. [이슈 9]에서 부분 해결.
3. **콜드스타트 시 첫 mount 전 response**: getLastNotificationResponseAsync로 보강했으나,
   매우 빠른 탭 → 즉시 다른 알림 탭 시나리오는 여전히 검증 부족.

---

## 향후 회귀 시 진단 절차

1. **무엇이 안 되는지 먼저 명확히 한다.**
   - 알림이 안 옴 (FCM/서버 푸시 문제) vs 알림은 오는데 탭이 안 먹음 (listener/handler 문제)
   - 화면 진입은 되는데 팝업이 안 뜸 (route.params/AsyncStorage/useFocusEffect 문제)

2. **Supabase `notification_debug_logs` 조회**:
   ```sql
   SELECT created_at, stage, notif_id, notif_type, payload, error
   FROM notification_debug_logs
   WHERE user_id = '...'
   ORDER BY created_at DESC
   LIMIT 50;
   ```
   - `handler_enter` 자체가 없으면 → listener race (이번 fix 영역)
   - `handler_enter` 후 `dedupe_skip` 즉시 → 의도된 중복 차단 (정상)
   - `navigate_start` 후 화면이 안 뜨면 → nested navigate 형식 / 화면 mount 문제
   - `handler_exit success: false` → error 필드 확인

3. **분기별 회귀 테스트 필수**:
   약복용 / 약효추적 / 몸상태 / 운동 / 보호자 cross-user 알림 — 한 분기 고치고 나머지 4개
   분기 모두 수동 테스트.

4. **롤백 검토 기준**: 누적 patch가 3개를 넘고도 회귀가 잡히지 않으면 롤백을 1순위로 검토.
   [이슈 13~15] 사례 참고.

5. **새로운 patch 추가 전**: 이 문서 [이슈 1~20] 전부 훑어보고, 같은 분기에서 과거에 어떤
   patch가 무엇을 깼는지 확인할 것.

---

_최종 업데이트: 2026-05-02 — [이슈 20] expo-notifications listener race fallback 추가_

---

## [검증 21] fallback (5bea550) 작동 확인 (2026-05-07 13:00)

**보고:** 13:00 KST 운동 + 몸상태(약효추적) 알림 동시 도착 → 각각 탭 → **둘 다 팝업 정상 표시**.

**디버그 로그 분석:**
- 적용 번들: `019e0066-c28f-7bc9-877a-88ef08950aa2` (5bea550 OTA 번들), isEmbeddedLaunch=false
- 부팅 시각: 12:34 KST (알림 28분 전), 그 후 background 유지
- 알림 처리 경로:
  - `addNotificationResponseReceivedListener` 단독 발화 **없음**
  - `fallback_appstate_active_check` 발화 (background→active 감지)
  - `fallback_appstate_active_result.hasResponse=true` (응답 획득)
  - 이를 통해 `handler_enter` 발화 → branch_match → navigate 성공
- handler_enter 6건, fallback_appstate_active_result hasResponse=true 3건
- dedupe_check blocked=true 1건 (중복 안전 차단)

**결론:**
- **fallback (`getLastNotificationResponseAsync` + AppState active)가 의도대로 작동**
- 원래 listener가 race로 누락된 응답을 fallback이 정확히 잡아냄
- expo-notifications listener race를 우회하는 데 성공

**한계:**
- 12시 점심약 케이스에서는 fallback 로깅이 없어 (아직 5bea550 적용 전) 어느 단계에서 끊겼는지 미확인
- `fallback_*` 로깅 추가 후 (이번 작업 5bea550) 다음 누락 케이스부터 정확한 단계별 추적 가능

---

## 현재 상태 (2026-05-07 KST)

- ✅ fallback 작동 확인 (13시 케이스)
- 🔍 일부 누락 케이스 원인 추가 데이터 필요 (12시 점심약 등)
- 📊 다음 누락 케이스 발생 시 fallback_*_check / fallback_*_result 단계별 추적 가능
- ⚠️ 디버그 로깅(`notification_debug_logs` 테이블 + App.tsx `logNotificationEvent` 호출들)은 임시. 진단 종료 후 제거 예정

