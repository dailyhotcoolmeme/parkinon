# Expo Notifications 패턴

## 설치

```bash
npx expo install expo-notifications expo-device expo-constants
```

---

## 권한 요청 (온보딩 완료 후 1회)

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export const requestNotificationPermission = async () => {
  if (!Device.isDevice) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
};
```

---

## 알림 스케줄링 패턴

### 약 복용 알림 등록
```typescript
import * as Notifications from 'expo-notifications';

export const scheduleMedAlarm = async (
  timeSlot: string,
  hour: number,
  minute: number
) => {
  // 기존 같은 시간대 알림 취소
  await cancelMedAlarm(timeSlot);

  // 매일 반복 알림
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '파킨온',
      body: `${timeSlotLabel(timeSlot)} 약 복용 시간이에요.`,
      data: { type: 'med_alarm', timeSlot },
    },
    trigger: {
      hour,
      minute,
      repeats: true,
    },
  });

  // 재알림 (+10분)
  const reId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '파킨온',
      body: `아직 ${timeSlotLabel(timeSlot)} 약을 드시지 않으셨어요.`,
      data: { type: 'med_realarm', timeSlot },
    },
    trigger: {
      hour,
      minute: minute + 10 >= 60 ? minute + 10 - 60 : minute + 10,
      repeats: true,
    },
  });

  return { id, reId };
};
```

### 약효 추적 알림 등록
```typescript
export const scheduleDrugEffectAlarm = async (
  medLogId: string,
  takenAt: Date,
  minutesAfter: number
) => {
  const triggerAt = new Date(takenAt.getTime() + minutesAfter * 60 * 1000);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '파킨온',
      body: `약 드신 후 ${minutesAfter}분이 지났어요. 몸 상태를 기록해보세요.`,
      data: { type: 'drug_effect', medLogId, minutesAfter },
    },
    trigger: { date: triggerAt },
  });
};
```

### 알림 취소
```typescript
export const cancelMedAlarm = async (timeSlot: string) => {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter(
    (n) => n.content.data?.timeSlot === timeSlot
  );
  await Promise.all(toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
};

export const cancelAllAlarms = async () => {
  await Notifications.cancelAllScheduledNotificationsAsync();
};
```

---

## 알림 수신 핸들러 (App.tsx)

```typescript
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 알림 탭 시 화면 이동
export const useNotificationNavigation = () => {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;

      if (data.type === 'med_alarm' || data.type === 'med_realarm') {
        router.push('/(tabs)/medication');
      } else if (data.type === 'drug_effect') {
        router.push('/(tabs)/bodystate');
      } else if (data.type === 'exercise') {
        router.push('/(tabs)/exercise');
      }
    });
    return () => sub.remove();
  }, []);
};
```

---

## 알림 문구 목록

```
약 복용 알림:      "파킨온 / {시간대} 약 복용 시간이에요."
약 재알림:         "파킨온 / 아직 {시간대} 약을 드시지 않으셨어요."
약효 추적 알림:    "파킨온 / 약 드신 후 {N}분이 지났어요. 몸 상태를 기록해보세요."
운동 알림:         "파킨온 / 오늘 운동할 시간이에요."
```

---

## 보호자 알림 (Supabase Realtime)

보호자 알림은 Expo Notifications가 아닌
Supabase Realtime + Push Notification으로 처리.

```typescript
supabase
  .channel('med_logs')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'med_logs',
    filter: `patient_id=eq.${patientId}`,
  }, (payload) => {
    // 보호자 디바이스에 푸시 알림 발송
    sendPushToCaregiver(payload.new);
  })
  .subscribe();
```
