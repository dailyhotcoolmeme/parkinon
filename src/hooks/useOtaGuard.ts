import { useEffect, useId } from 'react';
import { markOtaSafe, markOtaUnsafe } from '../lib/otaGuard';

/**
 * 저장 안 한 입력이 있는 동안 OTA 자동 재시작을 미룬다.
 * unsafe가 true인 동안 등록해뒀다가, false로 바뀌거나 화면이 사라지면(언마운트) 자동 해제.
 *
 * 사용법: useOtaGuard(title.trim().length > 0 || content.trim().length > 0);
 */
export function useOtaGuard(unsafe: boolean): void {
  const id = useId();
  useEffect(() => {
    if (unsafe) markOtaUnsafe(id);
    else markOtaSafe(id);
    return () => markOtaSafe(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsafe, id]);
}
