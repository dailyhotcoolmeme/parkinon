/**
 * 레이아웃 넘침 가드 — 글자가 상자를 넘치면 잡아낸다.
 *
 * 왜 필요한가:
 *   번역이 길어져 버튼 밖으로 삐져나가는 사고("Vidéos enregistrées" 실측)는
 *   내 눈으로 축소 스크린샷을 봐서는 못 잡는다. 판정을 사람 눈에서 렌더러로 옮긴다.
 *   - onTextLayout: 각 줄이 실제로 차지한 폭 (렌더 결과, 추정 아님)
 *   - onLayout:     그 텍스트에 주어진 상자 폭
 *   줄 폭 > 상자 폭 이면 넘친 것이다.
 *
 * 동작:
 *   개발 빌드(__DEV__)에서만 Text.render 를 감싸 두 콜백을 주입한다.
 *   릴리즈 빌드에서는 아무 것도 하지 않는다.
 *
 * 로그 형식(수집 스크립트가 파싱):
 *   [넘침] "문구" 줄폭=W 상자=B (numberOfLines=N)
 *
 * 한계(정직하게):
 *   - adjustsFontSizeToFit 이 걸린 자리(탭바)는 자동 축소되므로 검사에서 뺀다.
 *   - flex 컨테이너가 줄바꿈을 허용하는 자리는 "2줄"이 정상일 수 있다 —
 *     넘침 판정은 numberOfLines 제한이 있거나, 줄 폭이 상자보다 실제로 클 때만.
 */
import { onTextOverflow } from './textHook';
import { qaEvent } from './qaProbe';

const reported = new Set<string>();

export function installLayoutGuard(): void {
  if (!__DEV__) return;

  onTextOverflow(({ text, lineWidth, boxWidth, numberOfLines }) => {
    const key = `${text}|${lineWidth}|${boxWidth}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(
      `[overflow] ${JSON.stringify(text.slice(0, 80))} line=${lineWidth} box=${boxWidth} (numberOfLines=${numberOfLines})`,
    );
    qaEvent({ type: 'overflow', text: text.slice(0, 200), lineW: lineWidth, boxW: boxWidth, numberOfLines });
  });
}
