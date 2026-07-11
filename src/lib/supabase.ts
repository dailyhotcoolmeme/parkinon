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
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  // 상위(supabase-js)가 준 abort signal 도 존중해 연결한다.
  const upstream = init.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort());
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
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
