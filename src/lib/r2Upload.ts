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

export const R2_BUCKET = 'parkinon-media';

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
 * - 순수 fetch로 로컬 파일을 blob으로 읽어 R2에 직접 PUT
 */
async function uploadToR2(localUri: string, mimeType: string, key: string): Promise<string> {
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  // presigned URL 발급
  const res = await fetch(`${SUPABASE_URL}/functions/v1/r2-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ key, contentType: mimeType }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`presigned URL 발급 실패 (${res.status}): ${errText}`);
  }

  const { presignedUrl, publicUrl } = await res.json();

  // R2에 직접 PUT (legacy API 사용)
  const uploadResult = await FileSystem.uploadAsync(presignedUrl, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error(`R2 업로드 실패: HTTP ${uploadResult.status} - ${uploadResult.body}`);
  }

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
  category: string = 'general'
): Promise<UploadResult> {
  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/videos/${patientId}/${yearMonth}/${uuid}.mp4`;
  const expiresAt = calcExpiresAt();

  const url = await uploadToR2(localUri, 'video/mp4', key);

  return { url, key, expires_at: expiresAt };
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
  category: string
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
  });

  if (error) {
    console.error('media_logs 저장 실패:', error);
    // 업로드 자체는 성공했으므로 에러를 throw하지 않음
  }
}
