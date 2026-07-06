/**
 * Cloudflare R2 업로드 유틸 — Presigned URL 방식
 *
 * 아키텍처:
 *   1. 클라이언트 → Edge Function: { key, contentType } (메타만)
 *   2. Edge Function → 클라이언트: { presignedUrl, publicUrl }
 *   3. 클라이언트 → R2: base64 읽기 후 fetch로 presigned URL에 직접 PUT
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import i18n from '../i18n';

export const R2_BUCKET = 'parkinon-media';

/**
 * 미디어 프록시 워커 호스트(커뮤니티 사진 공개 서빙용).
 * 커뮤니티(정보/나눔) 사진은 이 워커의 /parkinon/community/... 경로로 토큰 없이 공개 서빙된다.
 * 의료/영상은 비공개(서명 URL) 유지 — 이 호스트와 무관하게 r2-get-url 을 탄다.
 */
export const MEDIA_PROXY_HOST = 'parkinon-media-proxy.dailyhotcoolmeme.workers.dev';

/**
 * 저장된 커뮤니티 사진 값(공개 URL 또는 key)을 워커 공개 URL 로 변환.
 * - 이미 워커 공개 URL 이면 그대로.
 * - parkinon/community/... key 또는 (구) r2.dev 공개 URL 이면 워커 공개 URL 로 정규화.
 * - 그 외(유튜브 등 비R2)는 원본 그대로.
 * 서명/엣지함수 왕복 없음 → 즉시 로딩.
 */
export function getCommunityPhotoUrl(input: string | null | undefined): string {
  const s = input ? String(input).trim() : '';
  if (!s) return '';
  // 이미 워커 공개 URL
  if (s.includes(`${MEDIA_PROXY_HOST}/parkinon/community/`)) return s;
  // key 추출(parkinon/community/... 또는 parkinon/...)
  const idx = s.indexOf('parkinon/');
  if (idx < 0) return s; // 비R2
  let key = s.slice(idx);
  const q = key.indexOf('?');
  if (q >= 0) key = key.slice(0, q);
  // 구 데이터 호환: photos/ → community/ 로 매핑(마이그레이션된 키와 일치)
  if (key.startsWith('parkinon/photos/')) {
    key = key.replace('parkinon/photos/', 'parkinon/community/');
  }
  const encoded = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `https://${MEDIA_PROXY_HOST}/${encoded}`;
}

/** 6개월 후 만료일 계산 */
function calcExpiresAt(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString();
}

/** YYYY-MM 형식 반환 */
function getYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** uuid-like 파일명 생성 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface UploadResult {
  url: string;
  key: string;
  expires_at: string;
}

/**
 * Presigned URL 방식으로 R2에 파일 직접 업로드
 * - Edge Function에서 presigned PUT URL 발급
 * - XMLHttpRequest로 R2에 직접 PUT (upload progress 추적 가능)
 */
async function uploadToR2(
  localUri: string,
  mimeType: string,
  key: string,
  timeoutMs?: number,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // presigned URL 발급 — 사용자 세션 토큰으로 인증
  const { data: invokeData, error: invokeError } = await supabase.functions.invoke('r2-upload', {
    body: { key, contentType: mimeType },
  });

  if (invokeError) {
    throw new Error(i18n.t('r2Upload.presignedUrlFailError', { err: invokeError.message }));
  }

  const { presignedUrl, publicUrl } = invokeData;

  // R2에 직접 PUT — XMLHttpRequest로 upload progress 추적
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error(i18n.t('r2Upload.fileNotFoundError'));
  }

  await new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(i18n.t('r2Upload.uploadFailError', { status: xhr.status, err: xhr.responseText })));
      }
    };

    xhr.onerror = () => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(i18n.t('r2Upload.networkError')));
    };

    xhr.ontimeout = () => {
      reject(new Error('UPLOAD_TIMEOUT'));
    };

    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        xhr.abort();
        reject(new Error('UPLOAD_TIMEOUT'));
      }, timeoutMs);
    }

    // fetch blob from local URI and send.
    // 로컬 URI blob 변환이 hang 되면 업로드 자체가 영원히 안 끝나므로
    // AbortController 로 타임아웃 가드(기본 15초). XHR 업로드 타임아웃과 별개.
    const blobController = new AbortController();
    const blobTimeoutMs = timeoutMs ?? 15000;
    const blobTimer = setTimeout(() => blobController.abort(), blobTimeoutMs);
    fetch(localUri, { signal: blobController.signal })
      .then((r) => r.blob())
      .then((blob) => {
        clearTimeout(blobTimer);
        xhr.send(blob);
      })
      .catch((err: any) => {
        clearTimeout(blobTimer);
        if (err?.name === 'AbortError') {
          reject(new Error('UPLOAD_TIMEOUT'));
        } else {
          reject(err);
        }
      });
  });

  return publicUrl;
}

/**
 * 영상 파일을 R2에 업로드합니다.
 *
 * @param localUri  로컬 파일 URI (expo-file-system 경로)
 * @param patientId 환자 ID
 * @param category  카테고리 (예: 'body_state' | 'exercise')
 * @returns 업로드 결과 (url, key, expires_at)
 *
 * 저장 경로: parkinon/videos/{patientId}/{YYYY-MM}/{uuid}.mp4
 * 보관: 6개월 후 자동 삭제 (R2 lifecycle rule + expires_at 필드)
 *
 * 영상 최대 2분 제한 — 호출 전 duration 체크 필수:
 *   const { duration } = await getVideoInfoAsync(localUri);
 *   if (duration > 120000) throw new Error('영상은 최대 2분까지 업로드 가능합니다.');
 */
export async function uploadVideo(
  localUri: string,
  patientId: string,
  category: string = 'general',
  timeoutMs?: number,
): Promise<UploadResult> {
  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/videos/${patientId}/${yearMonth}/${uuid}.mp4`;
  const expiresAt = calcExpiresAt();

  const url = await uploadToR2(localUri, 'video/mp4', key, timeoutMs);

  return { url, key, expires_at: expiresAt };
}

/**
 * 알림음(개인 녹음) R2 업로드. 경로: parkinon/sounds/{uploaderUserId}/{uuid}.{ext}
 * - uploaderUserId(녹음한 사용자=본인)로 경로를 잡아 r2-upload 소유권 검증 통과.
 * - 기본 m4a(expo-av 녹음 기본). 반환 key를 custom_sounds에 저장해 두고, 재생 시 다운로드.
 */
export async function uploadSound(
  localUri: string,
  uploaderUserId: string,
  mimeType: string = 'audio/m4a',
  timeoutMs?: number,
): Promise<UploadResult> {
  const ext = /ogg/.test(mimeType) ? 'ogg'
    : /wav/.test(mimeType) ? 'wav'
    : /caf/.test(mimeType) ? 'caf'
    : 'm4a';
  const key = `parkinon/sounds/${uploaderUserId}/${generateUuid()}.${ext}`;
  const url = await uploadToR2(localUri, mimeType, key, timeoutMs ?? 60000);
  return { url, key, expires_at: calcExpiresAt() };
}

/**
 * 사진 파일을 R2에 업로드합니다.
 *
 * @param localUri  로컬 파일 URI (expo-file-system 경로)
 * @param patientId 환자 ID
 * @returns 업로드 결과 (url, key, expires_at)
 *
 * 저장 경로: parkinon/photos/{patientId}/{YYYY-MM}/{uuid}.jpg
 *
 * 업로드 전 이미지 최적화 권장:
 *   import * as ImageManipulator from 'expo-image-manipulator';
 *   const compressed = await ImageManipulator.manipulateAsync(
 *     localUri,
 *     [{ resize: { width: 1280 } }],
 *     { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
 *   );
 *   await uploadPhoto(compressed.uri, patientId);
 */
export async function uploadPhoto(
  localUri: string,
  patientId: string
): Promise<UploadResult> {
  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/photos/${patientId}/${yearMonth}/${uuid}.jpg`;
  const expiresAt = calcExpiresAt();

  const url = await uploadToR2(localUri, 'image/jpeg', key);

  return { url, key, expires_at: expiresAt };
}

/**
 * 커뮤니티(정보/나눔) 게시판 사진을 R2 에 업로드합니다.
 *
 * 의료 사진과 달리 민감정보가 아니므로 **공개 prefix** 로 올린다:
 *   parkinon/community/{uploaderUserId}/{YYYY-MM}/{uuid}.jpg
 * r2-upload 엣지함수가 이 prefix 를 인식해 워커 공개 URL 을 반환한다(토큰 불필요 → 즉시 로딩).
 *
 * @param localUri 로컬 파일 URI (업로드 전 1280px/quality 0.7 압축 권장 — 기존대로)
 * @param userId   업로더(작성자) user id
 */
export async function uploadCommunityPhoto(
  localUri: string,
  userId: string,
): Promise<UploadResult> {
  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/community/${userId}/${yearMonth}/${uuid}.jpg`;
  const expiresAt = calcExpiresAt();

  const url = await uploadToR2(localUri, 'image/jpeg', key);

  return { url, key, expires_at: expiresAt };
}

/**
 * media_logs 테이블에 업로드 기록 저장
 *
 * 사용 예시:
 *   const result = await uploadVideo(uri, patientId, 'body_state');
 *   await saveMediaLog(patientId, loggedBy, result.url, result.key, result.expires_at, 'video', 'body_state');
 *
 * @param patientId  기록 대상 환자 ID
 * @param loggedBy   실제 입력자 ID (환자 본인 또는 보호자)
 */
export async function saveMediaLog(
  patientId: string,
  loggedBy: string,
  url: string,
  key: string,
  expiresAt: string,
  mediaType: 'video' | 'photo',
  category: string,
  durationSeconds?: number
): Promise<void> {
  const { error } = await supabase.from('media_logs').insert({
    patient_id: patientId,
    logged_by: loggedBy,
    r2_url: url,
    r2_key: key,
    expires_at: expiresAt,
    media_type: mediaType,
    category: category as 'body_state' | 'exercise',
    logged_at: new Date().toISOString(),
    ...(durationSeconds != null ? { duration_seconds: Math.round(durationSeconds) } : {}),
  });

  if (error) {
    console.error('media_logs 저장 실패:', error);
    // 업로드 자체는 성공했으므로 에러를 throw하지 않음
  }
}
