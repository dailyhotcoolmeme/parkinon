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
