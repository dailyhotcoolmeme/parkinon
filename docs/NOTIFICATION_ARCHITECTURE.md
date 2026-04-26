# 파킨온 알림 시스템 아키텍처 분석

**분석 일자**: 2026-04-26  
**프로젝트**: ParkinON (파킨온)  
**Supabase Project**: `avqaflxufyadgzjiojkk`

---

## 목차

1. [전체 알림 구조 개요](#1-전체-알림-구조-개요)
2. [환자가 받는 알림](#2-환자가-받는-알림)
3. [보호자가 받는 알림](#3-보호자가-받는-알림)
4. [현재 상태 진단](#4-현재-상태-진단)
5. [근본 원인 분석](#5-근본-원인-분석)
6. [수정 방안](#6-수정-방안)

---

## 1. 전체 알림 구조 개요

파킨온 앱은 **환자-보호자 연동 알림 시스템**을 사용합니다.

### 알림 발송 주체 분류

1. **서버 크론 (pg_cron)** - 정시 실행
2. **서버 Edge Function** - 이벤트 기반
3. **로컬 알림 (클라이언트)** - 백그라운드 작업

### 필수 인프라

- **Expo Push Token**: 사용자별 `users.push_token` 필드에 저장
- **Firebase Cloud Messaging (FCM)**: `google-services.json` 설정
- **Expo Notifications API**: 클라이언트 알림 수신/표시
- **Supabase pg_cron**: 서버 크론 작업 스케줄러

---

## 2. 환자가 받는 알림

| 알림 이름 | 발송 주체 | 트리거 | push_token 필요 | 현재 상태 | 문제 |
|----------|----------|--------|----------------|----------|------|
| **약 복용 시간 알림** | 서버 크론 (매분) | 시간 기반 | ✅ 필수 | ❌ 작동 안 함 | `push_token` null |
| **약 복용 +10분 재알림** | 로컬 알림 | 복용 미입력 시 | ❌ 불필요 | ✅ 작동 | - |
| **약 미복용 경고 (+20분)** | 서버 크론 | 복용 미입력 시 | ✅ 필수 | ❌ 작동 안 함 | `push_token` null |
| **약효 추적 알림 (30분/2시간)** | 서버 큐 (3분마다) | 복용 후 시간 경과 | ✅ 필수 | ❌ 작동 안 함 | `push_token` null |
| **약효 추적 (fallback)** | 로컬 알림 | `push_token` 없을 때 | ❌ 불필요 | ⚠️ 대체 작동 중 | fallback 동작 |
| **운동 알림** | 로컬 알림 | 시간 기반 (DAILY) | ❌ 불필요 | ✅ 작동 | - |

### 상세 분석

#### 2.1. 약 복용 시간 알림

- **파일**: `/supabase/functions/send-medication-reminders/index.ts`
- **크론 스케줄**: `* * * * *` (매분 실행)
- **작동 방식**:
  1. 현재 KST 시간(`HH:MM`)을 계산
  2. `get_meds_at_time(target_time)` RPC 함수 호출 → 해당 시간에 약 먹을 환자 조회
  3. 환자별 `push_token`, `notification_enabled`, `med_time_notif_prefs` 확인
  4. 오늘 이미 복용한 경우 (`med_logs` 확인) 알림 스킵
  5. Expo Push API로 알림 전송
- **현재 상태**: ❌ **작동 안 함** (환자 `push_token` null)
- **크론 작업 ID**: `jobid=10`, `jobname=parkinon-med-time`

#### 2.2. 약 복용 +10분 재알림 (로컬)

- **파일**: `/src/utils/notifications.ts` (L208-242)
- **함수**: `registerMissedMedCheckTask(mealTime, delaySeconds=600)`
- **작동 방식**:
  1. 약 복용 시간 알림 수신 시 호출
  2. 10분 후 로컬 알림 스케줄 (`Notifications.scheduleNotificationAsync`)
  3. 복용 완료 시 `cancelMissedMedRemindNotif()` 호출하여 취소
- **현재 상태**: ✅ **작동 중** (로컬 알림이므로 `push_token` 불필요)

#### 2.3. 약 미복용 경고 (+20분)

- **파일**: `/supabase/functions/send-missed-med-reminders/index.ts`
- **크론 스케줄**:
  - 아침: `20 23 * * *` (UTC 23:20 = KST 08:20)
  - 점심: `20 3 * * *` (UTC 03:20 = KST 12:20)
  - 저녁: `20 9 * * *` (UTC 09:20 = KST 18:20)
  - 취침: `20 13 * * *` (UTC 13:20 = KST 22:20)
- **작동 방식**:
  1. 해당 `meal_time`에 대해 오늘 복용 여부 확인
  2. 미복용 시 환자에게 푸시 알림
  3. 보호자에게도 동시 알림 (보호자 `caregiver_notif_prefs.med_missed` 확인)
- **현재 상태**: ❌ **작동 안 함** (환자/보호자 모두 `push_token` null)
- **크론 작업 ID**: `jobid=5,6,7,8`

#### 2.4. 약효 추적 알림

- **서버 큐 방식** (우선):
  - **파일**: `/supabase/functions/queue-effect-tracking/index.ts`, `/supabase/functions/process-notification-queue/index.ts`
  - **트리거**: 약 복용 시 (`useMedication.ts` L212-222)
  - **큐 테이블**: `effect_tracking_queue`
  - **크론 스케줄**: `*/3 * * * *` (3분마다 큐 처리)
  - **작동 방식**:
    1. 약 복용 시 `queue-effect-tracking` Edge Function 호출
    2. `effect_tracking_queue` 테이블에 알림 예약 (send_at = 복용시간 + n분)
    3. 크론이 3분마다 `process-notification-queue` 호출
    4. `send_at <= now` 조건에 맞는 알림 전송
  - **현재 상태**: ❌ **작동 안 함** (`push_token` null)
  - **DB 확인**: `effect_tracking_queue` 테이블 비어 있음 (큐 등록 자체가 안 됨)

- **로컬 알림 방식** (fallback):
  - **파일**: `/src/utils/notifications.ts` (L425-440)
  - **함수**: `scheduleEffectTrackingNotifications(medNotifs)`
  - **트리거**: `push_token` 없을 때 (`useMedication.ts` L221)
  - **현재 상태**: ⚠️ **대체 작동 중** (로컬 알림으로 대체)

#### 2.5. 운동 알림

- **파일**: `/src/utils/notifications.ts` (L444-487)
- **함수**: `scheduleExerciseReminders(exerciseNotifs)`
- **트리거**: 시간 기반 (DAILY)
- **작동 방식**:
  1. 사용자가 설정한 시간에 매일 반복
  2. `Notifications.scheduleNotificationAsync` + `trigger.type=DAILY`
  3. 로컬 알림이므로 서버 필요 없음
- **현재 상태**: ✅ **정상 작동**

---

## 3. 보호자가 받는 알림

| 알림 이름 | 발송 주체 | 트리거 | push_token 필요 | 현재 상태 | 문제 |
|----------|----------|--------|----------------|----------|------|
| **환자 약 복용 완료** | Edge Function (`send-push`) | 환자가 약 복용 시 | ✅ 필수 | ❌ 작동 안 함 | 보호자 `push_token` null |
| **환자 몸상태 기록** | Edge Function (`send-push`) | 환자가 몸상태 기록 시 | ✅ 필수 | ❌ 작동 안 함 | 보호자 `push_token` null |
| **환자 운동 완료** | Edge Function (`send-push`) | 환자가 운동 기록 시 | ✅ 필수 | ❌ 작동 안 함 | 보호자 `push_token` null |
| **환자 약 미복용 경고** | 서버 크론 | 약 복용 시간 +20분 | ✅ 필수 | ❌ 작동 안 함 | 보호자 `push_token` null |

### 상세 분석

#### 3.1. 환자 약 복용 완료 알림

- **파일**: `/src/hooks/useMedication.ts` (L225-253)
- **트리거**: 환자가 약 복용 기록 저장 시
- **작동 방식**:
  1. 환자의 `patient_group_id`로 보호자 조회
  2. 보호자의 `push_token`, `caregiver_notif_prefs` 확인
  3. `caregiver_notif_prefs.med_taken !== false` 조건 확인
  4. `sendCaregiverPush()` → Edge Function `/functions/send-push` 호출
- **현재 상태**: ❌ **작동 안 함** (보호자 `push_token` null)

#### 3.2. 환자 몸상태 기록 알림

- **파일**: `/src/hooks/useBodyState.ts` (L139-196)
- **트리거**: 환자가 몸상태/기분/수면/변비 기록 시
- **작동 방식**:
  1. 환자의 `patient_group_id`로 보호자 조회
  2. 보호자의 `caregiver_notif_prefs` 확인
  3. 항목별로 알림 전송 (body_state, mood, sleep, constipation)
- **현재 상태**: ❌ **작동 안 함** (보호자 `push_token` null)

#### 3.3. 환자 운동 완료 알림

- **파일**: `/src/hooks/useExercise.ts` (L128-161)
- **트리거**: 환자가 운동 기록 저장 시
- **작동 방식**:
  1. 환자의 `patient_group_id`로 보호자 조회
  2. 보호자의 `caregiver_notif_prefs.exercise !== false` 확인
  3. `sendCaregiverPush()` 호출
- **현재 상태**: ❌ **작동 안 함** (보호자 `push_token` null)

#### 3.4. 환자 약 미복용 경고 알림

- **파일**: `/supabase/functions/send-missed-med-reminders/index.ts` (L83-111)
- **트리거**: 서버 크론 (약 복용 시간 +20분)
- **작동 방식**:
  1. 환자 미복용 확인 후 환자에게 알림
  2. 환자의 `patient_group_id`로 보호자 조회
  3. 보호자 `caregiver_notif_prefs.med_missed !== false` 확인
  4. 보호자에게도 푸시 알림 전송
- **현재 상태**: ❌ **작동 안 함** (보호자 `push_token` null)

---

## 4. 현재 상태 진단

### 4.1. DB 상태

#### users 테이블
```sql
SELECT id, name, role, 
       push_token IS NOT NULL as has_token, 
       notification_enabled, 
       patient_group_id IS NOT NULL as has_group
FROM users 
ORDER BY created_at DESC;
```

**결과**:
| id | name | role | has_token | notification_enabled | has_group |
|----|------|------|-----------|---------------------|-----------|
| 08a42a64-1fe2-49c6-a542-6616c19dacfa | 최성철 | patient | **false** | true | true |
| c5656978-49f4-483a-839c-bab9a820e89c | 한민석 | caregiver | **false** | true | true |

**⚠️ 치명적 문제**: 환자/보호자 모두 `push_token` null!

#### get_meds_at_time RPC 함수 테스트

```sql
SELECT * FROM get_meds_at_time('08:00');
```

**결과**:
```json
[{"patient_id":"08a42a64-1fe2-49c6-a542-6616c19dacfa","meal_time":"morning"}]
```

✅ **서버 크론은 정상 작동 중** (08:00에 아침약 먹을 환자 조회 성공)

#### effect_tracking_queue 테이블

```sql
SELECT * FROM effect_tracking_queue 
ORDER BY created_at DESC 
LIMIT 5;
```

**결과**: 빈 배열 `[]`

**⚠️ 문제**: 약 복용 시 큐 등록이 안 됨 → `push_token` null이라 큐 등록 조건 (`user?.push_token` 체크) 실패

### 4.2. 서버 크론 작동 상태

| jobid | 작업명 | 스케줄 | 상태 | Edge Function | 설명 |
|-------|--------|--------|------|---------------|------|
| 10 | parkinon-med-time | `* * * * *` (매분) | ✅ active | `/send-medication-reminders` | 약 복용 시간 알림 |
| 9 | parkinon-effect-queue | `*/3 * * * *` (3분마다) | ✅ active | `/process-notification-queue` | 약효 추적 큐 처리 |
| 5 | parkinon-missed-morning | `20 23 * * *` | ✅ active | `/send-missed-med-reminders` | 아침약 미복용 경고 |
| 6 | parkinon-missed-lunch | `20 3 * * *` | ✅ active | `/send-missed-med-reminders` | 점심약 미복용 경고 |
| 7 | parkinon-missed-dinner | `20 9 * * *` | ✅ active | `/send-missed-med-reminders` | 저녁약 미복용 경고 |
| 8 | parkinon-missed-bedtime | `20 13 * * *` | ✅ active | `/send-missed-med-reminders` | 취침약 미복용 경고 |

**결론**: 서버 크론은 모두 정상 작동 중!

### 4.3. FCM 설정 상태

#### google-services.json
```bash
ls -la /Users/ourmine/Desktop/parkinon-app/google-services.json
# -rw-r--r--@ 1 ourmine  staff  678  4월 22 20:00 google-services.json
```
✅ **파일 존재**

#### app.json 설정
```json
{
  "expo": {
    "android": {
      "googleServicesFile": "./google-services.json",
      "permissions": [
        "android.permission.POST_NOTIFICATIONS"
      ]
    },
    "plugins": [
      ["expo-notifications", { ... }]
    ],
    "extra": {
      "eas": {
        "projectId": "3ab78295-11fe-4002-8175-e1c42ff6583d"
      }
    }
  }
}
```
✅ **FCM 설정 완료**
✅ **Expo projectId 존재**
✅ **POST_NOTIFICATIONS 권한 선언됨**

---

## 5. 근본 원인 분석

### 5.1. push_token이 null인 이유

#### 코드 분석: `/src/utils/notifications.ts`

**함수**: `requestPermissionsAndSaveToken(userId, accessToken?)`

**작동 흐름**:
1. L295-303: 알림 권한 확인 (`Notifications.getPermissionsAsync`)
2. L299-303: `undetermined`일 때만 권한 요청 다이얼로그 표시
3. L305-309: 권한 거부 시 → `return null` (DB 저장 안 함)
4. L338-349: Expo Push Token 획득 (`getExpoPushTokenAsync`)
5. L370-379: DB 저장 (`PATCH /rest/v1/users?id=eq.${userId}`)

**⚠️ 문제점**:

1. **알림 권한이 거부됨**
   - `finalStatus !== 'granted'` 조건에서 return null
   - 로그: `"알림 권한 없음 (상태: XXX) — push token 저장 스킵"`

2. **호출 타이밍 문제**
   - 이 함수를 언제 호출하는지 확인 필요
   - 로그인 직후? 앱 시작 시? 설정 화면?

#### 호출 위치 확인 필요

```bash
grep -r "requestPermissionsAndSaveToken" /Users/ourmine/Desktop/parkinon-app/src
```

### 5.2. 예상 시나리오

#### 시나리오 A: 권한 요청 미실행
- 앱 설치 후 알림 권한 요청 팝업이 표시되지 않음
- `requestPermissionsAndSaveToken` 함수가 호출되지 않음

#### 시나리오 B: 권한 거부됨
- 사용자가 알림 권한 거부
- `finalStatus = 'denied'` → DB 저장 스킵

#### 시나리오 C: Expo Push Token 획득 실패
- 권한은 허용됐지만 `getExpoPushTokenAsync()` 실패
- FCM 서버 키가 EAS에 업로드되지 않았을 가능성

#### 시나리오 D: DB 저장 실패
- Token은 획득됐지만 DB PATCH 실패
- `accessToken` 없음 또는 네트워크 오류

### 5.3. FCM 서버 키 확인 필요

Expo Push Notification은 **두 가지 방식**을 지원:

1. **Expo Push Token** (기본) - Expo 서버 경유
2. **FCM Direct** (권장) - FCM 서버 직접 연결 (더 안정적)

**FCM 서버 키가 EAS에 업로드되지 않으면**:
- Android에서 Expo Push Token 발급 실패 가능
- `getExpoPushTokenAsync()` 오류 발생

**확인 방법**:
```bash
eas credentials
# Android → Push Notifications → FCM 서버 키 확인
```

---

## 6. 수정 방안

### 6.1. 즉시 조치 사항

#### 1단계: 권한 요청 함수 호출 위치 확인

```bash
# 어디서 requestPermissionsAndSaveToken을 호출하는지 확인
grep -r "requestPermissionsAndSaveToken" /Users/ourmine/Desktop/parkinon-app/src
```

**예상 위치**:
- `App.tsx` (앱 시작 시)
- 로그인 성공 직후
- 설정 화면 "알림 허용" 버튼

**조치**: 호출되지 않는다면 → **로그인 성공 직후 즉시 호출하도록 수정**

#### 2단계: 알림 권한 상태 디버깅

`/src/utils/notifications.ts` 함수에 로그 추가:

```typescript
export async function requestPermissionsAndSaveToken(userId, accessToken?) {
  console.log('[notifications] ======= 권한 요청 시작 =======');
  console.log('[notifications] userId:', userId);
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  console.log('[notifications] 현재 권한 상태:', existingStatus);
  
  let finalStatus = existingStatus;
  
  if (existingStatus === 'undetermined') {
    console.log('[notifications] 권한 미설정 → 다이얼로그 표시');
    const { status: requestedStatus } = await Notifications.requestPermissionsAsync();
    finalStatus = requestedStatus;
    console.log('[notifications] 요청 후 권한 상태:', finalStatus);
  }
  
  if (finalStatus !== 'granted') {
    console.error('[notifications] ❌ 권한 거부됨:', finalStatus);
    return null;
  }
  
  // ... 이하 동일
}
```

**테스트 방법**:
1. 앱 재설치 (권한 상태 초기화)
2. 로그인
3. 로그 확인 (`npx react-native log-android`)

#### 3단계: FCM 서버 키 업로드 확인

```bash
eas credentials
```

1. **Android** 선택
2. **Push Notifications** 선택
3. **FCM 서버 키** 확인
   - 없으면 → Firebase Console에서 서버 키 복사 후 업로드
   - 있으면 → 다음 단계

#### 4단계: 수동으로 push_token 저장 테스트

DB에 직접 삽입하여 알림 작동 테스트:

```sql
-- 테스트용 push_token 생성 (Expo Go 앱으로 테스트)
-- 실제 기기에서 Expo Go 실행 후 아래 스크립트 실행:
```

```typescript
// 테스트용 스크립트 (Expo Go에서 실행)
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

async function getTestToken() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.error('권한 거부됨');
    return;
  }
  
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  console.log('✅ Push Token:', tokenData.data);
  
  // 이 토큰을 DB에 직접 입력:
  // UPDATE users SET push_token = 'ExponentPushToken[...]' WHERE id = '환자ID';
}

getTestToken();
```

#### 5단계: 알림 전송 테스트

```bash
# 서버 크론 수동 실행
curl -X POST https://avqaflxufyadgzjiojkk.supabase.co/functions/v1/send-medication-reminders \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

### 6.2. 중장기 조치 사항

#### 1. 권한 요청 UX 개선

**현재 문제**:
- 권한 거부 시 재요청 방법 없음
- 설정 화면에서 알림 켜기/끄기만 가능 (권한 재요청 불가)

**개선 방안**:
```typescript
// 권한 거부 시 시스템 설정으로 안내
if (finalStatus === 'denied') {
  Alert.alert(
    '알림 권한 필요',
    '약 복용 알림을 받으려면 설정에서 알림을 허용해주세요.',
    [
      { text: '취소', style: 'cancel' },
      { text: '설정 열기', onPress: () => Linking.openSettings() },
    ]
  );
  return null;
}
```

#### 2. push_token 동기화 모니터링

**배경 태스크 추가**:
```typescript
// App.tsx에 추가
useEffect(() => {
  // 앱 포그라운드 전환 시마다 push_token 재확인
  const subscription = AppState.addEventListener('change', async (nextAppState) => {
    if (nextAppState === 'active' && user?.id) {
      const { data } = await supabase
        .from('users')
        .select('push_token')
        .eq('id', user.id)
        .single();
      
      if (!data?.push_token) {
        // push_token 없으면 재등록
        await requestPermissionsAndSaveToken(user.id);
      }
    }
  });
  
  return () => subscription.remove();
}, [user]);
```

#### 3. FCM Direct 모드로 전환 (권장)

Expo Push Token 대신 FCM Token 직접 사용:

```typescript
// expo-notifications 대신 react-native-firebase 사용
import messaging from '@react-native-firebase/messaging';

async function getFCMToken() {
  const fcmToken = await messaging().getToken();
  console.log('FCM Token:', fcmToken);
  return fcmToken;
}
```

**장점**:
- Expo 서버 경유하지 않음 → 더 안정적
- FCM 최신 기능 사용 가능 (토픽, 조건부 전송 등)

**단점**:
- 네이티브 모듈 추가 → OTA 불가 (APK 재빌드 필요)

#### 4. 알림 전송 실패 로그 수집

**Edge Function에 로그 추가**:

```typescript
// send-medication-reminders/index.ts
const response = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to, title, body, data }),
});

const result = await response.json();
console.log('[send-push] 결과:', result);

if (result.data?.status === 'error') {
  console.error('[send-push] ❌ 전송 실패:', result.data.message);
  // DB에 실패 로그 저장
  await supabase.from('notification_logs').insert({
    patient_id: patientId,
    type: 'medication_reminder',
    status: 'failed',
    error: result.data.message,
  });
}
```

---

## 7. 체크리스트

### 디버깅 체크리스트

- [ ] `requestPermissionsAndSaveToken` 함수가 호출되는 위치 확인
- [ ] 앱 재설치 후 알림 권한 요청 팝업이 표시되는지 확인
- [ ] 권한 허용 후 `push_token`이 DB에 저장되는지 확인
- [ ] FCM 서버 키가 EAS에 업로드되어 있는지 확인 (`eas credentials`)
- [ ] `getExpoPushTokenAsync()` 오류 로그 확인
- [ ] 수동으로 push_token 삽입 후 서버 크론 작동 여부 확인

### 수정 체크리스트

- [ ] 로그인 성공 직후 `requestPermissionsAndSaveToken` 호출하도록 수정
- [ ] 권한 거부 시 시스템 설정 안내 Alert 추가
- [ ] 앱 포그라운드 전환 시 push_token 재확인 로직 추가
- [ ] Edge Function에 알림 전송 실패 로그 추가
- [ ] notification_logs 테이블 생성 (실패 이력 저장)

---

## 8. 요약

### 현재 상태

✅ **정상 작동 중**:
- 서버 크론 6개 (약 복용 시간, 약효 큐, 미복용 경고)
- 로컬 알림 (약 복용 +10분 재알림, 운동 알림)
- FCM 설정 (`google-services.json`, app.json)
- `get_meds_at_time` RPC 함수

❌ **작동 안 함**:
- 모든 서버 푸시 알림 (환자/보호자 `push_token` null)

### 근본 원인

**`users.push_token` = null**

1. 알림 권한 미요청 또는 거부됨
2. `requestPermissionsAndSaveToken` 함수가 호출되지 않음
3. FCM 서버 키가 EAS에 업로드되지 않았을 가능성
4. `getExpoPushTokenAsync()` 실패 (원인 불명)

### 수정 방안

1. **즉시 조치**: 로그인 직후 권한 요청 함수 호출 추가
2. **디버깅**: 로그 추가하여 권한 상태/토큰 획득 과정 추적
3. **FCM 확인**: `eas credentials`로 서버 키 업로드 확인
4. **테스트**: 수동으로 push_token 삽입 후 서버 크론 작동 확인

---

**문서 작성일**: 2026-04-26  
**분석자**: Agent 00 (Claude Code Orchestrator)
