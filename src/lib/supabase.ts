import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Database } from '../types/database';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// ⚠️ 전역 fetch 타임아웃 (앱 멈춤 방지 · 최우선)
// RN 새 아키텍처에서 supabase-js 요청이 응답 없이 hang 하면, 그 await 를 감싼
// 화면의 finally(로딩/저장 스피너 해제)에 영영 도달하지 못해 → 전체화면 오버레이(Modal/
// absolute)가 안 내려가고 → 스크롤·터치가 막힌 채 "굳는다"(앱 재시작해야 풀림, 오너 보고).
// hang 을 일정 시간 뒤 AbortError(reject)로 전환해 finally 가 반드시 실행되게 한다.
// (DB 쿼리는 수 초 내 응답 · 미디어는 R2 별도 업로드라 supabase fetch 아님 → 20s 는 충분히 넉넉.)
const SUPABASE_FETCH_TIMEOUT_MS = 20000;

// ── 요청 추적(개발 빌드 전용) ────────────────────────────────────────────────
// "화면이 멈췄다"의 원인이 대개 응답 없는 요청 하나인데, 지금은 무엇이 매달려 있는지
// 알 방법이 없다. 진행 중인 요청을 들고 있다가 오래 걸리면 주기적으로 알린다.
//   [net] ... 형태로 Metro 콘솔에 찍히므로, 멈춘 순간의 마지막 로그가 곧 범인이다.
type Pending = { label: string; at: number };
const pending = new Map<number, Pending>();
let netSeq = 0;

/** URL 에서 사람이 알아볼 부분만 남긴다(토큰·키 제외). */
function labelOf(input: RequestInfo | URL, init: RequestInit): string {
  const url = typeof input === 'string' ? input : (input as URL).toString?.() ?? String(input);
  const path = url.replace(SUPABASE_URL, '').split('?')[0];
  const q = url.includes('?') ? url.split('?')[1].slice(0, 80) : '';
  return `${init.method ?? 'GET'} ${path}${q ? ' ?' + q : ''}`;
}

if (__DEV__) {
  // 3초 넘게 응답이 없는 요청을 2초마다 알린다 — 멈춘 순간 무엇이 걸렸는지 바로 보인다.
  setInterval(() => {
    const now = Date.now();
    for (const [, p] of pending) {
      const waited = now - p.at;
      if (waited > 3000) console.warn(`[net] 응답 없음 ${Math.round(waited / 1000)}초 — ${p.label}`);
    }
  }, 2000);
}

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  // 상위(supabase-js)가 준 abort signal 도 존중해 연결한다.
  const upstream = init.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort());
  }

  const id = ++netSeq;
  const started = Date.now();
  if (__DEV__) pending.set(id, { label: labelOf(input, init), at: started });

  return fetch(input, { ...init, signal: controller.signal })
    .then((res) => {
      if (__DEV__) {
        const ms = Date.now() - started;
        const label = pending.get(id)?.label ?? '';
        // 느린 것만 남긴다 — 정상 응답까지 찍으면 로그가 묻힌다.
        if (ms > 1000) console.warn(`[net] ${ms}ms ${res.status} ${label}`);
      }
      return res;
    })
    .catch((e) => {
      if (__DEV__) {
        const ms = Date.now() - started;
        console.error(`[net] 실패 ${ms}ms ${pending.get(id)?.label ?? ''} — ${String(e)}`);
      }
      throw e;
    })
    .finally(() => {
      clearTimeout(timer);
      if (__DEV__) pending.delete(id);
    });
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});
