// 사용자 행동 로그 (admin '사용자 현황' 대시보드용)
//  - 화면 이동 + 의미있는 액션을 user_activity_log 테이블에 기록.
//  - 배치(버퍼) 전송: 이벤트마다 insert 하지 않고 모아서 한 번에 → DB IO 최소화.
//  - 완전 비침습: 실패해도 UX에 영향 없음(조용히 버림, 무한 재시도 없음).
import { Platform, AppState } from 'react-native';
import { supabase } from '../lib/supabase';

type Ctx = { userId: string | null; patientGroupId: string | null; role: string | null };

let ctx: Ctx = { userId: null, patientGroupId: null, role: null };
let currentScreen: string | null = null;
let buffer: any[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let appVersion = '';
try {
  // app.json version (expo-constants). 실패해도 무시.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  appVersion = require('expo-constants').default?.expoConfig?.version ?? '';
} catch {}

/** 로그인 시 호출: 이후 로그의 주체(사용자/세트/역할)를 세팅. */
export function setActivityUser(u: Partial<Ctx>): void {
  ctx = { ...ctx, ...u };
}

/** 로그아웃 시: 남은 버퍼 flush 후 주체 초기화. */
export function clearActivityUser(): void {
  void flush();
  ctx = { userId: null, patientGroupId: null, role: null };
}

/** 현재 화면 이름 갱신(내비게이션에서 호출) — 이후 액션 로그의 screen 필드에 쓰임. */
export function setActivityScreen(name: string | null): void {
  currentScreen = name;
}

/** 액션 1건 기록(버퍼에 쌓고 배치 전송). action=이벤트키, detail=부가정보. */
export function logActivity(action: string, detail?: Record<string, any> | null): void {
  if (!ctx.userId) return; // 로그인 전엔 스킵(RLS insert 는 auth.uid 필요)
  buffer.push({
    user_id: ctx.userId,
    patient_group_id: ctx.patientGroupId,
    role: ctx.role,
    action,
    screen: currentScreen,
    detail: detail ?? null,
    platform: Platform.OS,
    app_version: appVersion,
    created_at: new Date().toISOString(),
  });
  if (buffer.length >= 20) void flush();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flush();
  }, 12000);
}

/** 버퍼를 한 번에 insert. */
export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await (supabase as any).from('user_activity_log').insert(batch);
  } catch {
    // 조용히 버림(UX 영향 없음). 무한 버퍼 방지 위해 재시도하지 않는다.
  }
}

let inited = false;
/** 앱 시작 시 1회: 백그라운드 진입 시 버퍼 flush 등록. */
export function initActivityLog(): void {
  if (inited) return;
  inited = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'active') logActivity('app_foreground');
    if (s === 'background' || s === 'inactive') void flush();
  });
}
