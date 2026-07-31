import { useEffect, useRef, useState } from 'react';

/**
 * 로딩 표시(스켈레톤·스피너)가 "번쩍" 스치는 것을 막는 훅.
 *
 * 왜 필요한가:
 *   응답이 0.2초 만에 오면 회색 바가 잠깐 보였다가 글자로 바뀐다. 이 깜빡임이
 *   기다림보다 더 거슬린다. 차라리 그 짧은 순간은 아무것도 바꾸지 않는 편이 낫다.
 *
 * 어떻게 동작하나:
 *   - 로딩이 시작돼도 `delayMs` 동안은 false 를 유지한다 → 빨리 끝나면 아예 안 보인다.
 *   - 한 번 보이기 시작하면 최소 `minShowMs` 는 유지한다 → 뜨자마자 사라지는 두 번째
 *     깜빡임을 막는다.
 *
 * @param active   실제 로딩 여부
 * @param delayMs  이 시간 안에 끝나면 표시하지 않는다(기본 250ms)
 * @param minShowMs 한 번 표시되면 최소 이만큼은 유지한다(기본 400ms)
 */
export function useDelayedFlag(active: boolean, delayMs = 250, minShowMs = 400): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    if (active) {
      // 아직 안 보이는 상태라면 delayMs 뒤에 켠다(그 전에 끝나면 안 켜짐).
      if (!visible) {
        showTimer = setTimeout(() => {
          shownAtRef.current = Date.now();
          setVisible(true);
        }, delayMs);
      }
    } else if (visible) {
      // 이미 떠 있으면 최소 표시 시간을 채우고 끈다.
      const shownFor = shownAtRef.current ? Date.now() - shownAtRef.current : minShowMs;
      const remain = Math.max(0, minShowMs - shownFor);
      hideTimer = setTimeout(() => {
        shownAtRef.current = null;
        setVisible(false);
      }, remain);
    }

    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [active, visible, delayMs, minShowMs]);

  return visible;
}
