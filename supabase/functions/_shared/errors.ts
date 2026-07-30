/**
 * 서버 오류 응답 — 문장이 아니라 **코드**를 돌려준다.
 *
 * 왜:
 *   서버가 한국어 문장을 돌려주면 그 문장이 그대로 앱 팝업에 뜬다. 프랑스 사용자가
 *   "오늘 업로드 한도를 모두 사용했습니다." 를 보게 된다. 그렇다고 서버가 문장을
 *   번역해 보내면, 어떤 문장이 나올 수 있는지 검사할 방법이 없다.
 *
 *   그래서 DB 규칙과 같은 방식으로 통일한다(2026-07-30 오너 확정):
 *   **서버는 코드를 보내고, 화면에 보일 문장은 앱의 번역 파일에서 꺼낸다.**
 *   나올 수 있는 값이 아래 목록으로 정해지므로, 그 코드들이 네 언어에 다 있는지
 *   검사기가 확인할 수 있다.
 *
 * 응답 형태:
 *   { code: 'QUOTA_EXCEEDED', error: 'daily upload quota exceeded' }
 *   - code  : 앱이 번역 키로 쓰는 값
 *   - error : 원인 파악용 영어 설명(로그·문의 대응용). 화면에 그대로 띄우지 않는다.
 */

export const ErrorCode = {
  // 요청이 잘못됨
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_IMAGE_TYPE: 'INVALID_IMAGE_TYPE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',

  // 권한
  FORBIDDEN_PATH: 'FORBIDDEN_PATH',
  FORBIDDEN_UPLOAD: 'FORBIDDEN_UPLOAD',
  FORBIDDEN_MEDIA: 'FORBIDDEN_MEDIA',
  FORBIDDEN_DELETE: 'FORBIDDEN_DELETE',
  FORBIDDEN_RECIPIENT: 'FORBIDDEN_RECIPIENT',
  UNKNOWN_TOKEN: 'UNKNOWN_TOKEN',

  // 한도
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // 처리 실패
  PRESIGN_FAILED: 'PRESIGN_FAILED',
  DB_DELETE_FAILED: 'DB_DELETE_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  SEND_FAILED: 'SEND_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  CONVERT_UNAVAILABLE: 'CONVERT_UNAVAILABLE',

  // 서버 설정 문제 — 사용자가 손쓸 수 없다. 원인은 로그에만 남긴다.
  SERVER_MISCONFIGURED: 'SERVER_MISCONFIGURED',
} as const;

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

/** 오류 응답을 만든다. detail 은 영어로 — 로그와 문의 대응에서 읽어야 한다. */
export function errorResponse(
  code: ErrorCodeValue,
  status: number,
  detail: string,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ code, error: detail }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
