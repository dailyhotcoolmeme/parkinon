# 파킨온 알림/버튼 플로우 전체 명세

> 새 에이전트가 이 파일을 먼저 읽을 것. 알림·버튼 관련 코드 수정 전 반드시 숙지.

---

## 핵심 원칙

- **알림 탭 시**: AsyncStorage에 pending 키 저장 → 화면 이동 → useFocusEffect에서 읽어서 처리
- **직접 버튼 탭 시**: 현재 화면에서 직접 처리 (화면 이동 없음)
- **팝업 자동 오픈**: useFocusEffect 순서가 매우 중요 (아래 BodyStateScreen 주의사항 참고)

---

## 1. 💊 약복용 탭

### 1-1. 알림 탭 시 (약복용 알림 / 미복용 재알림)

```
🔔 약복용 알림 수신
  ↓
[App.tsx] 알림 타입: medication_reminder | missed_medication
  ↓
AsyncStorage.setItem('pendingMedNotif', { mealTime })   ← 콜드스타트 대비
+ notificationIntentManager.emit({ mealTime })          ← 포그라운드 대비
+ navigateTo('Main', { screen: 'Medication', params: { autoOpen, mealTime } })
  ↓
[MedicationScreen] 3중 안전장치로 시간대 선택 모달 자동 오픈:
  1) useEffect(routeParams.autoOpen) → setTimeout 400ms → setShowMealTimeModal(true)
  2) useFocusEffect → AsyncStorage.getItem('pendingMedNotif') → setShowMealTimeModal(true)
  3) notificationIntentManager.subscribe → setShowMealTimeModal(true)
  ↓
사용자: 시간대 선택
  ↓
이미 오늘 기록 있음? → 덮어쓰기 확인 Alert
  ↓
takeMedication(mealTime) 저장
  ↓
→ [1-3. 약복용 후 몸상태 연결] 진입
```

**관련 파일**: `App.tsx`, `MedicationScreen.tsx`  
**AsyncStorage 키**: `pendingMedNotif`

---

### 1-2. 직접 버튼 탭 시

```
💊 약복용 기록하기 버튼 탭
  ↓
역할 확인:
  - 환자 → 시간대 선택 모달 즉시 오픈
  - 보호자(동거) → 보호자 확인 모달 → 확인 시 시간대 선택 모달
  - 보호자(따로) → ❌ 버튼 비활성화 (입력 불가)
  ↓
사용자: 시간대 선택
  ↓
이미 오늘 기록 있음? → 덮어쓰기 확인 Alert
  ↓
takeMedication(mealTime) 저장
  ↓
→ [1-3. 약복용 후 몸상태 연결] 진입
```

---

### 1-3. 약복용 완료 후 → 몸상태 자동 연결 ⚠️ 중요

```
약복용 저장 완료
  ↓
"몸상태도 기록해볼까요?" 팝업 자동 표시 (showBodyStateSuggest)
  ↓
선택:
  ├─ [기록하기]
  │    AsyncStorage.setItem('pendingBodyStateNotif', { triggerMinutes: 0, triggerMealTime })
  │    navigateTo('BodyState')
  │    → [2-3. BodyState 팝업 오픈 공통 로직] 진입
  │
  └─ [나중에]
       다음 알림 예고 팝업 표시 (nextNotifInfo 있을 때)
```

**⚠️ 주의**: navigateTo에 triggerMinutes를 route.params로 넘기지 말 것.
탭 네비게이터에서 route.params 타이밍이 불안정함 → 반드시 AsyncStorage 방식 사용.

**관련 파일**: `MedicationScreen.tsx` (기록하기 버튼 onPress)  
**AsyncStorage 키**: `pendingBodyStateNotif`

---

## 2. 😊 몸상태 탭

### 2-1. 약효추적 알림 탭 시

```
🔔 약효추적 알림 수신 (복용 후 30분 / 2시간 등)
  ↓
[App.tsx] 알림 타입: effect_tracking
  ↓
AsyncStorage.setItem('pendingBodyStateNotif', { triggerMinutes, triggerMealTime })
+ navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState', params: { triggerMinutes, triggerMealTime, triggerTs } } })
  ↓
[BodyStateScreen] → [2-3. BodyState 팝업 오픈 공통 로직] 진입
```

**관련 파일**: `App.tsx`, `BodyStateScreen.tsx`  
**AsyncStorage 키**: `pendingBodyStateNotif`

---

### 2-2. 직접 버튼 탭 시

```
😊 몸상태·기분상태 기록하기 버튼 탭
  ↓
역할 확인:
  - 환자 → handleOpenBodyState()
  - 보호자(동거) → 보호자 확인 모달 → handleOpenBodyState()
  - 보호자(따로) → ❌ 버튼 비활성화
  ↓
AsyncStorage.getItem('parkinon_last_medication') 조회
  ↓
복용 기록 없음 → TriggerSelectModal (시간대 직접 선택)
  ↓
복용 기록 있음:
  경과 시간 ↔ 설정된 알림 시간대 비교
  ├─ ±20분 이내 → 트리거 자동 배정 → [2-3. 공통 로직] 진입
  ├─ 20분 초과  → ❌ "지금은 기록할 수 없어요" Alert
  └─ 파싱 오류  → TriggerSelectModal
```

**관련 파일**: `BodyStateScreen.tsx` (handleOpenBodyState)

---

### 2-3. BodyState 팝업 오픈 공통 로직 ⚠️ 핵심

```
useFocusEffect 실행 순서 (반드시 이 순서 유지!):

① 초기화 useFocusEffect (deps: [])
   hasBedtimeLoadedRef.current = false
   pendingFlowArgsRef.current = null

② 알림 useFocusEffect (deps: [route.params...])
   route.params에 triggerMinutes 있으면 openFlowOrPend() 호출

③ AsyncStorage useFocusEffect (deps: [])
   AsyncStorage.getItem('pendingBodyStateNotif')
   있으면 삭제 후 openFlowOrPend() 호출  ← 약복용→몸상태 연결 처리

④ 취침약 refresh useFocusEffect (deps: [patientId])
   setBedtimeRefreshTick(t => t+1)

useEffect([patientId, bedtimeRefreshTick]):
   medications 테이블에서 취침약 조회
   컬럼명: meal_times (배열!) → .contains('meal_times', ['bedtime'])  ← 주의
   hasBedtimeMedication 설정
   hasBedtimeLoadedRef.current = true
   pendingFlowArgsRef.current 있으면 openFlowWithDuplicateCheck() 실행
  ↓
openFlowOrPend():
  hasBedtimeLoadedRef = false → pendingFlowArgsRef에 저장 (대기)
  hasBedtimeLoadedRef = true  → openFlowWithDuplicateCheck() 즉시 실행
  ↓
openFlowWithDuplicateCheck():
  setPendingMealTime(mealTimeKey)
  오늘 동일 기록 있음? → 중복 확인 Alert
  없음? → setShowFlow(true)
  ↓
BodyStatePopupFlow 오픈:
  몸상태 → 기분 → 수면(오늘 첫 기록일 때만) → 변비(아래 조건)
  ↓
showConstipation 조건:
  pendingMealTime === 'bedtime'                            → 항상 표시
  pendingMealTime === 'dinner' && !hasBedtimeMedication   → 취침약 없을 때만 표시
  그 외                                                   → 표시 안 함
```

**⚠️ 주의사항**:
- useFocusEffect 순서 절대 변경 금지 (①이 ②③보다 먼저여야 함)
- medications 쿼리 시 `.eq('meal_time', ...)` 사용 금지 → `.contains('meal_times', ['bedtime'])` 사용
- pendingFlowArgsRef는 ①에서만 null로 초기화 (다른 곳에서 초기화하면 알림 자동연결 깨짐)

**관련 파일**: `BodyStateScreen.tsx`

---

## 3. 🏃 운동 탭

### 3-1. 알림 탭 시

```
🔔 운동 알림 수신
  ↓
[App.tsx] 알림 타입: exercise_reminder
  ↓
AsyncStorage.setItem('pendingExerciseNotif', 'true')
+ navigateTo('Main', { screen: 'Exercise', params: { screen: 'ExerciseRecord' } })
  ↓
[ExerciseScreen] useFocusEffect:
  AsyncStorage.getItem('pendingExerciseNotif')
  환자인 경우 → navigation.navigate('ExerciseRecord')
  보호자인 경우 → 이동 안 함
  ↓
ExerciseRecord 화면: 운동 종류 선택 → 시간 입력 → 저장
```

**관련 파일**: `App.tsx`, `ExerciseScreen.tsx`  
**AsyncStorage 키**: `pendingExerciseNotif`

---

### 3-2. 직접 버튼 탭 시

```
🏃 운동 기록하기 버튼 탭
  ↓
역할 확인:
  - 환자 → navigation.navigate('ExerciseRecord')
  - 보호자(동거) → 보호자 확인 모달 → ExerciseRecord
  - 보호자(따로) → ❌ 버튼 비활성화
  ↓
ExerciseRecord 화면: 운동 종류 선택 → 시간 입력 → 저장
```

---

## 4. AsyncStorage 키 목록

| 키 | 저장 위치 | 읽는 위치 | 값 형태 |
|---|---|---|---|
| `pendingMedNotif` | App.tsx (알림 수신) | MedicationScreen useFocusEffect | `{ mealTime: string }` |
| `pendingBodyStateNotif` | App.tsx (알림 수신)<br>MedicationScreen (기록하기 버튼) | BodyStateScreen useFocusEffect | `{ triggerMinutes: number, triggerMealTime: string }` |
| `pendingExerciseNotif` | App.tsx (알림 수신) | ExerciseScreen useFocusEffect | `'true'` |
| `parkinon_last_medication` | 약 복용 저장 시 | BodyStateScreen (직접 버튼, 알림) | `{ taken_at, meal_time }` |

---

## 5. 역할별 버튼 상태 정리

| 역할 | 약복용 | 몸상태 | 운동 |
|---|---|---|---|
| 환자 | ✅ 직접 입력 | ✅ 직접 입력 | ✅ 직접 입력 |
| 보호자(동거) | ✅ 확인 후 입력 | ✅ 확인 후 입력 | ✅ 확인 후 입력 |
| 보호자(따로) | ❌ 비활성화 | ❌ 비활성화 | ❌ 비활성화 |
| 보호자(환자 없음) | ❌ 비활성화 | ❌ 비활성화 | ❌ 비활성화 |

---

## 6. 자주 발생한 버그 이력 (참고)

1. **변비 팝업 항상 표시**: `medications.meal_time` (단수) 로 쿼리 → 컬럼명은 `meal_times` (배열). `.contains()` 사용해야 함.
2. **알림 팝업 자동연결 안 됨**: useFocusEffect 순서 문제. 취침약 useFocusEffect가 pendingFlowArgsRef를 null로 덮어씀. 초기화 useFocusEffect를 맨 앞에 별도 배치해야 함.
3. **약복용→몸상태 자동연결 안 됨**: route.params로 triggerMinutes 전달 시 탭 네비게이터에서 타이밍 불안정. AsyncStorage 방식으로 교체 필요.
