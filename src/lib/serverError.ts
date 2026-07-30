/**
 * 서버 오류 코드 → 사용자에게 보여줄 문장.
 *
 * 서버는 문장이 아니라 코드를 돌려준다(supabase/functions/_shared/errors.ts).
 * 문장은 여기서 앱의 번역 파일로부터 꺼낸다 — DB 표시값과 같은 규칙이다
 * (2026-07-30 오너 확정: "키로 보내고 표시명은 번역 파일에서").
 *
 * 이렇게 하면 화면에 나올 수 있는 문구가 serverError.* 키 목록으로 정해지므로,
 * 그 키들이 네 언어에 다 있는지 검사기가 확인할 수 있다. 서버가 문장을 만들어
 * 보내면 어떤 문장이 나올 수 있는지 검사할 방법이 없다.
 */
import i18n from '../i18n';

/** Edge Function 응답 본문에서 코드를 꺼낸다. supabase-js 는 오류 본문을 context 에 담아준다. */
export async function serverErrorCode(invokeError: unknown): Promise<string | null> {
  try {
    const res = (invokeError as { context?: { json?: () => Promise<unknown> } })?.context;
    if (!res || typeof res.json !== 'function') return null;
    const body = (await res.json()) as { code?: unknown } | null;
    const code = body?.code;
    return typeof code === 'string' && code ? code : null;
  } catch {
    return null; // 본문이 JSON 이 아니면 코드 없음으로 본다
  }
}

/**
 * 코드에 해당하는 문장. 모르는 코드면 null 을 돌려주고, 호출부가 일반 문구로 처리한다.
 * (모르는 코드에 코드 문자열을 그대로 띄우면 사용자가 'FORBIDDEN_PATH' 를 보게 된다.)
 */
export function serverErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const key = `serverError.${code}`;
  const text = i18n.t(key);
  return text && text !== key ? text : null;
}

/** invokeError → 사용자에게 보여줄 문장(모르면 null). */
export async function messageForServerError(invokeError: unknown): Promise<string | null> {
  return serverErrorMessage(await serverErrorCode(invokeError));
}
