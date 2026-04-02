/**
 * Cloudflare R2 업로드 유틸
 *
 * 아키텍처: 클라이언트 → Supabase Edge Function(r2-upload) → Cloudflare R2
 * 클라이언트에서 R2에 직접 접근하지 않습니다.
 *
 * TODO: Cloudflare Dashboard에서 R2 API 토큰 발급 후 Supabase Edge Function secrets에 등록:
 *   - R2_ACCESS_KEY_ID
 *   - R2_SECRET_ACCESS_KEY
 *   - R2_ENDPOINT: https://4c0f5d706177b84ade4d424a08ec46e8.r2.cloudflarestorage.com
 *   - R2_BUCKET_NAME: parkinon-media
 *   - R2_PUBLIC_URL: (버킷 퍼블릭 도메인 설정 후 입력)
 */

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';

const ACCOUNT_ID = '4c0f5d706177b84ade4d424a08ec46e8';
export const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
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
  // 파일 존재 확인
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error(`파일을 찾을 수 없습니다: ${localUri}`);
  }

  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/videos/${patientId}/${yearMonth}/${uuid}.mp4`;
  const expiresAt = calcExpiresAt();

  // FormData 구성 (React Native FormData)
  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: 'video/mp4',
    name: `${uuid}.mp4`,
  } as unknown as Blob);
  formData.append('patientId', patientId);
  formData.append('type', 'video');
  formData.append('key', key);
  formData.append('category', category);

  // Supabase Edge Function 호출
  const { data, error } = await supabase.functions.invoke('r2-upload', {
    body: formData,
  });

  if (error) {
    throw new Error(`영상 업로드 실패: ${error.message}`);
  }

  if (!data?.url) {
    throw new Error('업로드 응답에 URL이 없습니다.');
  }

  return {
    url: data.url as string,
    key,
    expires_at: expiresAt,
  };
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
  // 파일 존재 확인
  const fileInfo = await FileSystem.getInfoAsync(localUri);
  if (!fileInfo.exists) {
    throw new Error(`파일을 찾을 수 없습니다: ${localUri}`);
  }

  const yearMonth = getYearMonth();
  const uuid = generateUuid();
  const key = `parkinon/photos/${patientId}/${yearMonth}/${uuid}.jpg`;
  const expiresAt = calcExpiresAt();

  // FormData 구성
  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: 'image/jpeg',
    name: `${uuid}.jpg`,
  } as unknown as Blob);
  formData.append('patientId', patientId);
  formData.append('type', 'image');
  formData.append('key', key);

  // Supabase Edge Function 호출
  const { data, error } = await supabase.functions.invoke('r2-upload', {
    body: formData,
  });

  if (error) {
    throw new Error(`사진 업로드 실패: ${error.message}`);
  }

  if (!data?.url) {
    throw new Error('업로드 응답에 URL이 없습니다.');
  }

  return {
    url: data.url as string,
    key,
    expires_at: expiresAt,
  };
}

/**
 * media_logs 테이블에 업로드 기록 저장
 *
 * 사용 예시:
 *   const result = await uploadVideo(uri, patientId, 'body_state');
 *   await saveMediaLog(patientId, result.url, result.key, result.expires_at, 'video', 'body_state');
 */
export async function saveMediaLog(
  patientId: string,
  url: string,
  key: string,
  expiresAt: string,
  mediaType: 'video' | 'image',
  category: string
): Promise<void> {
  const { error } = await supabase.from('media_logs').insert({
    patient_id: patientId,
    logged_by: patientId,
    r2_url: url,
    r2_key: key,
    expires_at: expiresAt,
    media_type: mediaType as 'video' | 'photo',
    category: category as 'body_state' | 'exercise',
    logged_at: new Date().toISOString(),
  });

  if (error) {
    console.error('media_logs 저장 실패:', error);
    // 업로드 자체는 성공했으므로 에러를 throw하지 않음
  }
}
