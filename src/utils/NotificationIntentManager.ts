// @deprecated 약복용 mealtime 모달 trigger에서 사용되었으나 race + poison ref guard로
// PiP(YouTube) 환경에서 모달이 영구 미표시되는 결함의 원인이 되어 제거됨 (2026-05).
// 약복용 trigger는 route.params.autoOpen + AsyncStorage pendingMedNotif 2가지로 단순화됨.
// 다른 분기에서 사용 시작 전까지는 import/사용 금지.

type MedIntent = { mealTime: string | null };

class NotificationIntentManager {
  private pendingIntent: MedIntent | null = null;
  private listener: ((intent: MedIntent) => void) | null = null;

  emit(intent: MedIntent) {
    if (this.listener) {
      this.listener(intent);
    } else {
      this.pendingIntent = intent;
    }
  }

  subscribe(listener: (intent: MedIntent) => void): () => void {
    this.listener = listener;
    if (this.pendingIntent) {
      const pending = this.pendingIntent;
      this.pendingIntent = null;
      setTimeout(() => listener(pending), 0);
    }
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }
}

export const notificationIntentManager = new NotificationIntentManager();
