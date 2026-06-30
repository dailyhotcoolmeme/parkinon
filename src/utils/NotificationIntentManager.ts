type MedIntent = { mealTime: string | null; doseSlotId?: string | null };

class NotificationIntentManager {
  private pendingIntent: MedIntent | null = null;
  private listener: ((intent: MedIntent) => void) | null = null;

  emit(intent: MedIntent) {
    if (this.listener) {
      // 리스너(MedicationScreen)에서 throw 나도 알림 핸들러/콜드스타트 부팅이 죽지 않게 swallow.
      try {
        this.listener(intent);
      } catch (e) {
        console.warn('[NotificationIntentManager] listener throw(무시):', e);
      }
    } else {
      this.pendingIntent = intent;
    }
  }

  subscribe(listener: (intent: MedIntent) => void): () => void {
    this.listener = listener;
    if (this.pendingIntent) {
      const pending = this.pendingIntent;
      this.pendingIntent = null;
      setTimeout(() => {
        try {
          listener(pending);
        } catch (e) {
          console.warn('[NotificationIntentManager] pending listener throw(무시):', e);
        }
      }, 0);
    }
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }
}

export const notificationIntentManager = new NotificationIntentManager();
