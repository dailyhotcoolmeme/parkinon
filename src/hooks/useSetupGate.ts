/**
 * useSetupGate.ts
 * 복용 시간대(dose_slot) 미등록 시 기록 차단 게이팅 — 복용 관리 통합 재설계 B차.
 *
 * 정책(스펙 §5,6 + 확정):
 *  - "등록 완료(setupComplete)" 기준 = 그룹/환자에 활성 dose_slot 1개 이상(약 유무 무관).
 *  - 미등록(활성 슬롯 0)인데 약복용·약효추적 기록을 누르면 → 막고 통합 등록(복용 관리)으로 유도.
 *  - 그룹 단위 판정(useSetupComplete → useDoseSlots → usePatientId). 보호자도 그룹 대신 등록 가능.
 *
 * ⚠️ 보수적 판정(멀쩡한 사용자 오차단 금지):
 *  - 아직 로딩 중이면 막지 않는다(통과). 슬롯이 명확히 0으로 확인됐을 때만 막는다.
 *  - useSetupComplete 가 조회 실패해도 useDoseSlots 는 catch 후 빈 배열을 반환하므로
 *    "확정된 0" 과 "조회 실패" 가 외형상 같다. 따라서 게이트는 loading 이 끝나고
 *    setupComplete===false 일 때만 동작하되, 안전을 위해 호출처에서 한 번 더
 *    requireSetup 시점의 loading 을 확인한다(로딩 중이면 통과).
 */
import { useCallback } from 'react';
import { useSetupComplete } from './useDoseSlots';
import { navigateTo } from '../navigation/navigationRef';
import type { DialogApi } from '../context/DialogContext';
import i18n from '../i18n';

export interface UseSetupGateReturn {
  /** 활성 dose_slot 1개 이상이면 true. */
  setupComplete: boolean;
  /** 아직 판정 불가(로딩 중이거나 슬롯 조회 실패) → 게이트는 통과, 배너는 숨김. */
  setupUnknown: boolean;
  /** 통합 복용 관리(시간대+약 등록) 화면으로 이동. */
  goToManage: () => void;
  /**
   * 기록 진행 전 게이트. 등록이 안 됐으면 안내 다이얼로그를 띄우고 false 를 반환(=차단),
   * 등록됐거나(또는 아직 판정 불가) 통과 가능하면 true 를 반환.
   *
   * @returns 기록을 계속 진행해도 되면 true, 막아야 하면 false.
   */
  requireSetup: (dialog: DialogApi) => Promise<boolean>;
}

/**
 * 약복용/약효추적 기록 게이팅 훅.
 * 화면에서 useSetupGate() 후, 기록 진입 직전에 `if (!(await requireSetup(dialog))) return;`.
 */
export function useSetupGate(): UseSetupGateReturn {
  const { setupComplete, setupUnknown } = useSetupComplete();

  const goToManage = useCallback(() => {
    // 통합 복용 관리 화면(MenuStack > MedicationManage)으로 이동.
    navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedicationManage' } });
  }, []);

  const requireSetup = useCallback(
    async (dialog: DialogApi): Promise<boolean> => {
      // 보수적: 판정 불가(로딩 중 또는 조회 실패)면 통과(멀쩡한 사용자 오차단 방지).
      // 조회 실패는 로그만 남기고 막지 않는다(스펙: 실패는 통과, 확정 0 만 차단).
      if (setupUnknown) {
        if (!setupComplete) console.warn('[useSetupGate] cannot determine setup state - letting the gate pass (not blocking)');
        return true;
      }
      // 활성 슬롯이 1개 이상이면 통과.
      if (setupComplete) return true;

      // 명확히 미등록(활성 슬롯 0) → 차단 + 통합 등록 유도.
      const ok = await dialog.confirm({
        title: i18n.t('setupGate.title'),
        message: i18n.t('setupGate.message'),
        confirmText: i18n.t('setupGate.confirmText'),
        cancelText: i18n.t('setupGate.cancelText'),
      });
      if (ok) goToManage();
      return false; // 어느 경우든 이번 기록은 진행하지 않음.
    },
    [setupUnknown, setupComplete, goToManage],
  );

  return { setupComplete, setupUnknown, goToManage, requireSetup };
}
