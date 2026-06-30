/**
 * R2 미디어 읽기 — 미디어 URL 리졸버 (워커 프록시 + 폴백 보장)
 *
 * Phase 2 정책(영상 HEAD/Range 정상 + 깨짐 0 보장):
 *   - 영상·오디오·사진 모두 r2-get-url 엣지함수를 타고, 엣지함수는 인가 통과 후
 *     "워커 프록시 URL + HMAC 토큰" 을 반환한다. 워커가 HEAD/GET/Range 를 모두 지원하므로
 *     안드 ExoPlayer 의 HEAD 프리플라이트가 실패하지 않는다(= 영상 정상).
 *   - 리졸버 호출이 실패/지연하면 "기존 값(원본 공개 URL)" 을 그대로 반환해 항상 표시되게 한다.
 *     ⚠️ 이 폴백은 버킷이 아직 공개라 가능한 안전망. 버킷 비공개 전환 시 폴백 제거 예정.
 *   - 저장 값이 공개 URL 이든 key 든 모두 처리.
 *
 * 사용:
 *   const uri = await resolveMediaUrl(savedUrlOrKey);   // 실패해도 항상 표시 가능한 uri
 *   const { uri } = useResolvedMediaUrl(savedUrlOrKey);  // 컴포넌트용 훅
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const RESOLVE_TIMEOUT_MS = 6000;
// presigned 1시간 발급 → 캐시는 50분만 유효 처리(시계 오차 여유)
const CACHE_TTL_MS = 50 * 60 * 1000;

interface CacheEntry {
  url: string;
  at: number;
}
// key(정규화) → presigned url 캐시. 같은 미디어 반복 표시 시 재발급 방지.
const cache = new Map<string, CacheEntry>();
// 동시 요청 합치기: 같은 key 가 동시에 여러 번 요청되면 한 번만 invoke.
const inflight = new Map<string, Promise<string | null>>();

/**
 * 스트리밍 재생/다운로드용 미디어(영상·오디오) 확장자.
 *
 * Phase 2 부터 영상·오디오도 워커 프록시 URL(HEAD/GET/Range 지원) 을 타므로
 * 더 이상 공개 URL 로 우회하지 않는다. (Phase 1 의 presigned HEAD 403 회귀는
 * 워커가 R2 를 바인딩으로 직접 읽어 HEAD 를 정상 처리하면서 해소됨.)
 *
 * 이 판별자는 영상 썸네일/사진과 영상 소스를 구분해야 하는 다른 코드에서 쓰일 수 있어 유지한다.
 */
const STREAMING_MEDIA_EXT = /\.(mp4|mov|m4v|webm|m4a|caf|ogg|mp3|wav|aac)(\?|$)/i;

/** 영상/오디오 등 HEAD 프리플라이트를 쓰는 스트리밍 미디어인지 판별. */
export function isStreamingMedia(input: string | null | undefined): boolean {
  if (!input) return false;
  return STREAMING_MEDIA_EXT.test(String(input));
}

/** 저장 값(공개 URL 또는 key)에서 정규화된 R2 key(parkinon/...) 추출. 실패 시 null. */
export function extractR2Key(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (s.startsWith('parkinon/')) return s;
  const idx = s.indexOf('parkinon/');
  if (idx >= 0) {
    // 쿼리스트링이 붙어있으면 제거
    const tail = s.slice(idx);
    const q = tail.indexOf('?');
    return q >= 0 ? tail.slice(0, q) : tail;
  }
  return null;
}

/**
 * 동기 해석: 엣지함수 왕복 없이 즉시 표시 가능한 URL 을 반환하는 경우만 처리.
 * - R2 미디어가 아니면(유튜브 등) 원본 그대로
 * - R2 미디어(영상·오디오·사진)면:
 *     · 워커 URL 캐시 히트면 즉시 그 URL (재발급 없음 → 빠름)
 *     · 미스면 null → 비동기 resolveMediaUrl 로 워커 presigned 발급 필요
 *
 * ⚠️ 비공개(워커) 경유 복원(2026-06): 영상·오디오도 더 이상 공개 URL 을 즉시 반환하지
 *    않는다(비공개 유지). 캐시 히트면 즉시, 미스면 null 을 돌려 호출부가 짧은 스피너 후
 *    워커 URL 로 마운트하게 한다. 같은 key 가 리스트 썸네일에서 한 번 발급되면 전체화면도
 *    캐시를 공유해 즉시 뜬다.
 */
export function resolveMediaUrlSync(keyOrUrl: string | null | undefined): string | null {
  const key = extractR2Key(keyOrUrl);
  if (!key) return keyOrUrl ? String(keyOrUrl) : ''; // R2 미디어가 아니면(유튜브 등) 원본 그대로
  // 워커 URL 캐시 히트 → 엣지함수 왕복 없이 즉시 반환(영상·사진 공통).
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.url;
  }
  return null; // 미스: 비동기 resolveMediaUrl 로 워커 presigned 발급 필요
}

async function fetchPresigned(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('r2-get-url', {
      body: { key },
    });
    if (error) return null;
    const url = (data as any)?.url;
    return typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/**
 * 저장된 미디어 값을 표시 가능한 URL 로 변환.
 * - presigned 발급 성공 → presigned URL
 * - 실패/타임아웃/key 추출 불가 → 원본 값 그대로(공개 URL 폴백)
 * 절대 throw 하지 않는다. 항상 표시 가능한 문자열을 반환.
 */
export async function resolveMediaUrl(keyOrUrl: string | null | undefined): Promise<string> {
  const original = keyOrUrl ? String(keyOrUrl) : '';
  const key = extractR2Key(keyOrUrl);
  if (!key) return original; // R2 미디어가 아니면(유튜브 링크 등) 그대로

  // 🔒 비공개(워커) 경유 복원(2026-06): 영상·오디오·사진 모두 r2-get-url(→워커 presigned
  //    URL) 을 탄다. 직전 OTA(89145956)에서 영상·오디오를 공개 URL 로 즉시 반환하던 분기를
  //    제거 — 그건 비공개를 풀어버려 잘못. 워커가 HEAD/GET/Range 를 모두 지원하므로
  //    expo-av/ExoPlayer 재생 정상이며, 같은 key 는 한 번만 발급해 캐시 공유로 빠르게 동작.
  //    (워커 URL 발급 실패/지연 시 아래 폴백으로 원본 공개 URL 반환 → 버킷 공개인 동안 안전망.)

  // 캐시 히트
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.url;
  }

  // 동시 요청 합치기 + 타임아웃 폴백
  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchPresigned(key).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS),
  );

  const url = await Promise.race([promise, timeout]);
  if (url) {
    cache.set(key, { url, at: Date.now() });
    return url;
  }
  // 폴백: 원본 공개 URL(또는 key). 버킷이 공개인 동안 항상 표시됨(안전망).
  // ⚠️ 버킷을 비공개로 전환하면 이 폴백은 더 이상 표시되지 않으므로 그때 제거 예정.
  //    (비공개 후에는 워커 URL 발급 실패 = 표시 불가가 정상 동작이 됨.)
  return original;
}

/**
 * 리스트 로드 직후 영상(또는 사진) 워커 URL 을 미리 병렬로 발급해 캐시에 채워둔다.
 * - 각 항목은 resolveMediaUrl 을 그대로 타므로 기존 캐시/in-flight 합치기 로직이 중복 발급·레이스를 막는다.
 *   (이미 캐시에 있거나 발급 중이면 새 요청이 추가로 나가지 않는다.)
 * - 결과는 캐시에만 채우고 반환값은 무시한다(allSettled → 실패는 조용히 무시).
 * - 엣지함수 폭주 방지를 위해 동시성(concurrency)을 제한해 청크 단위로 발급한다.
 * - 절대 throw 하지 않으며 백그라운드로만 동작(렌더/앱 동작을 막지 않음).
 *
 * 사용:
 *   prefetchMediaUrls(videoLogs.map(v => v.r2_url)); // await 불필요(백그라운드)
 */
export function prefetchMediaUrls(
  urlsOrKeys: (string | null | undefined)[],
  concurrency = 6,
): void {
  // R2 미디어이고(=key 추출 가능) 아직 캐시되지 않은 것만 추리고, 중복 key 는 한 번만.
  const seen = new Set<string>();
  const pending: string[] = [];
  for (const raw of urlsOrKeys) {
    const key = extractR2Key(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) continue; // 이미 캐시됨
    pending.push(String(raw)); // resolveMediaUrl 에 원본 값을 그대로 넘김
  }
  if (pending.length === 0) return;

  // 동시성 제한: 청크 단위로 순차 실행, 각 청크 내부는 병렬(allSettled).
  // 실패/타임아웃은 무시(resolveMediaUrl 은 throw 하지 않지만 안전하게 catch).
  (async () => {
    for (let i = 0; i < pending.length; i += concurrency) {
      const chunk = pending.slice(i, i + concurrency);
      try {
        await Promise.allSettled(chunk.map((v) => resolveMediaUrl(v)));
      } catch {
        // 백그라운드 prefetch — 어떤 실패도 무시.
      }
    }
  })();
}

/**
 * 컴포넌트용 훅. 초기값은 원본(폴백)으로 두어 즉시 표시되고,
 * presigned 발급이 끝나면 교체한다. 발급 실패 시에도 원본이 남아 깨지지 않음.
 */
export function useResolvedMediaUrl(keyOrUrl: string | null | undefined): {
  uri: string;
  resolved: boolean;
} {
  const original = keyOrUrl ? String(keyOrUrl) : '';
  // 캐시 히트(같은 key 이미 발급됨)면 즉시 워커 URL → 첫 렌더부터 resolved=true (await 지연 없음).
  const sync = resolveMediaUrlSync(keyOrUrl);
  const [uri, setUri] = useState<string>(sync ?? original);
  const [resolved, setResolved] = useState(sync != null);

  useEffect(() => {
    let active = true;
    const s = resolveMediaUrlSync(keyOrUrl);
    if (s != null) {
      // 캐시 히트: 엣지함수 호출 없이 즉시 워커 URL 확정.
      setUri(s);
      setResolved(true);
      return;
    }
    // 캐시 미스: 비동기 워커 presigned 발급. 발급 전엔 원본(폴백) 표시.
    setUri(original);
    setResolved(false);
    if (!keyOrUrl) return;
    resolveMediaUrl(keyOrUrl).then((u) => {
      if (active) {
        setUri(u);
        setResolved(true);
      }
    });
    return () => {
      active = false;
    };
  }, [keyOrUrl, original]);

  return { uri, resolved };
}
