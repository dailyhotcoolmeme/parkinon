// RevenueCat(구독 결제) 클라이언트 래퍼.
// ⚠️ react-native-purchases 는 네이티브 모듈이라 "재빌드 후"에만 실제 동작한다.
//    재빌드 전(기존 dev 빌드)에서 호출되면 네이티브가 없어 throw → 여기서 전부 try/catch 로
//    감싸 앱이 크래시하지 않고 조용히 no-op 하도록 한다(구독=기존 그룹 티어 로직으로 동작).
// 구독 상태의 정본은 서버(patient_groups.subscription_tier, revenuecat-webhook 갱신)다.
//   이 래퍼는 (1) 구매자와 RevenueCat 사용자 연결, (2) 페이월 상품 조회/구매만 담당한다.
import { getRevenueCatKey, REVENUECAT_ENTITLEMENT_ID } from '../constants/revenueCat';

// 네이티브 모듈 로드(패키지 JS는 있으므로 require 자체는 성공, 실제 호출 시 네이티브 필요).
let Purchases: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Purchases = require('react-native-purchases').default;
} catch {
  Purchases = null;
}

let configured = false;
let configuredUserId: string | null = null;

/** RevenueCat SDK를 구매자(Supabase user.id)와 연결해 초기화. 재빌드 전엔 조용히 실패. */
export async function initRevenueCat(userId: string | null): Promise<void> {
  if (!Purchases || !userId) return;
  if (configured && configuredUserId === userId) return;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: getRevenueCatKey(), appUserID: userId });
      configured = true;
    } else if (configuredUserId !== userId) {
      await Purchases.logIn(userId); // 계정 전환
    }
    configuredUserId = userId;
  } catch (e) {
    if (__DEV__) console.warn('[revenueCat] init 실패(재빌드 전이면 정상):', e);
  }
}

/** 현재 premium entitlement 활성 여부(RevenueCat 기준, 구매 직후 즉시 확인용). */
export async function hasPremiumEntitlement(): Promise<boolean> {
  if (!Purchases) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
  } catch {
    return false;
  }
}

/** 페이월용 구독 상품(패키지) 목록. 없으면 빈 배열. */
export async function getPremiumPackages(): Promise<any[]> {
  if (!Purchases) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings?.current?.availablePackages ?? [];
  } catch (e) {
    if (__DEV__) console.warn('[revenueCat] offerings 조회 실패:', e);
    return [];
  }
}

/** 패키지 구매. 성공 시 premium entitlement 활성 여부 반환. 사용자가 취소하면 false. */
export async function purchasePackage(pkg: any): Promise<{ ok: boolean; cancelled: boolean }> {
  if (!Purchases || !pkg) return { ok: false, cancelled: false };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const ok = !!customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
    return { ok, cancelled: false };
  } catch (e: any) {
    return { ok: false, cancelled: !!e?.userCancelled };
  }
}

/** 구매 복원(기기 변경·재설치 시). 성공 시 premium 여부 반환. */
export async function restorePurchases(): Promise<boolean> {
  if (!Purchases) return false;
  try {
    const info = await Purchases.restorePurchases();
    return !!info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
  } catch {
    return false;
  }
}

/** 네이티브 모듈 사용 가능 여부(재빌드 완료 후 true). UI에서 "준비 중" 판단에 사용. */
export function isRevenueCatAvailable(): boolean {
  return !!Purchases;
}
