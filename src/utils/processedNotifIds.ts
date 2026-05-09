import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'processedNotifIds';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { notifId: string; processedAt: number };

export async function isProcessed(notifId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;
    const entries: Entry[] = JSON.parse(raw);
    const now = Date.now();
    return entries.some(
      (e) => e.notifId === notifId && now - e.processedAt < TTL_MS,
    );
  } catch {
    return false;
  }
}

export async function markProcessed(notifId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const entries: Entry[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const filtered = entries.filter((e) => now - e.processedAt < TTL_MS);
    filtered.push({ notifId, processedAt: now });
    const unique = Array.from(
      new Map(filtered.map((e) => [e.notifId, e])).values(),
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(unique));
  } catch {
    // silent
  }
}
