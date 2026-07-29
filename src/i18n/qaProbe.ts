/**
 * 번역 검수 프로브 — 화면에 "실제로 그려진 문자열"을 수집기(맥)로 보낸다.
 *
 * 왜 필요한가:
 *   파일 검사(i18n-check)는 번역 파일 안만 본다. 정작 사고는 파일 밖에서 났다 —
 *   DB 값('아침')이나 코드에 박힌 문장이 화면에 나온 경우다. 그건 렌더 결과를
 *   봐야만 잡힌다. 그리고 더 중요한 건 커버리지다: 어떤 키가 아직 한 번도
 *   화면에 안 떴는지를 알아야 "다 봤다"를 사람 기억이 아니라 숫자로 말할 수 있다.
 *
 * 역할 분담(의도적):
 *   앱은 "무엇이 그려졌는가"만 보낸다. 그 문자열이 어느 키인지, 커버리지가 몇 %인지
 *   따지는 일은 맥의 scripts/qa-report.mjs 가 한다. 매칭 규칙을 고칠 때마다
 *   앱을 다시 빌드하지 않기 위해서다.
 *
 * 수집기가 안 떠 있어도 앱은 정상 동작한다(전송 실패는 조용히 버린다).
 */
import { navigationRef } from '../navigation/navigationRef';
import { onTextRendered } from './textHook';

const ENDPOINT = 'http://localhost:8799/ev';
const FLUSH_MS = 1200;

type QaEvent = {
  type: 'text' | 'hangul' | 'overflow' | 'mark';
  route: string;
  text: string;
  /** overflow 전용 */
  lineW?: number;
  boxW?: number;
  numberOfLines?: number;
};

let queue: QaEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

/** 같은 (종류·문구·화면)은 한 번만 보낸다 — 렌더는 초당 수백 번 일어난다. */
const seen = new Set<string>();

function currentRoute(): string {
  try {
    return navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.name ?? '?') : '?';
  } catch {
    return '?';
  }
}

function flush(): void {
  timer = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  }).catch(() => {
    /* 수집기가 없으면 그냥 버린다 — 검수 설비가 앱을 방해하면 안 된다. */
  });
}

export function qaEvent(ev: Omit<QaEvent, 'route'> & { route?: string }): void {
  if (!enabled) return;
  const route = ev.route ?? currentRoute();
  const key = `${ev.type}|${route}|${ev.text}`;
  if (seen.has(key)) return;
  seen.add(key);
  queue.push({ ...ev, route });
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** 검수 구간에 표식을 남긴다(예: 'SCENARIO:약 복용 저장'). 리포트에서 구간별로 갈린다. */
export function qaMark(label: string): void {
  seen.delete(`mark|${currentRoute()}|${label}`);
  qaEvent({ type: 'mark', text: label });
  flush();
}

export function installQaProbe(): void {
  if (!__DEV__) return;
  enabled = true;
  onTextRendered((text) => {
    // 한 글자짜리(아이콘 대체 문자 등)는 키 매칭에 쓸모가 없다.
    if (text.length > 1) qaEvent({ type: 'text', text });
  });
}
