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
// ⚠️ 임시 진단용 — configure() 실패 원인을 화면에서 볼 수 있게 보관. 원인 확인되면 제거할 것.
let lastConfigureError: string | null = null;
let lastConfigureAttempted = false;

/** RevenueCat SDK를 구매자(Supabase user.id)와 연결해 초기화. 재빌드 전엔 조용히 실패. */
export async function initRevenueCat(userId: string | null): Promise<void> {
  if (!Purchases || !userId) return;
  if (configured && configuredUserId === userId) return;
  lastConfigureAttempted = true;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: getRevenueCatKey(), appUserID: userId });
      configured = true;
      lastConfigureError = null;
    } else if (configuredUserId !== userId) {
      await Purchases.logIn(userId); // 계정 전환
    }
    configuredUserId = userId;
  } catch (e: any) {
    lastConfigureError = e?.message ?? e?.code ?? JSON.stringify(e) ?? String(e);
    if (__DEV__) console.warn('[revenueCat] init 실패(재빌드 전이면 정상):', e);
  }
}

// ⚠️ 임시 진단용.
export function getConfigureDebugInfo(): { attempted: boolean; configured: boolean; userId: string | null; error: string | null } {
  return { attempted: lastConfigureAttempted, configured, userId: configuredUserId, error: lastConfigureError };
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

export interface TrialInfo {
  /** 현재 무료 체험(trial) 기간 중인지. */
  isTrial: boolean;
  /** 체험/구독 시작 시각(ms). */
  startedAtMs: number | null;
  /** 만료 시각(ms) — 체험이면 체험 종료(=첫 결제) 시점. */
  expiresAtMs: number | null;
}

/**
 * 현재 활성 프리미엄 entitlement 의 무료 체험 진행 정보.
 * - entitlement 이 없거나(무료) RevenueCat 미탑재(재빌드 전)면 null.
 * - periodType 이 'TRIAL' 일 때만 isTrial=true. (paid 구독은 체험바 미표시)
 */
export async function getTrialInfo(): Promise<TrialInfo | null> {
  if (!Purchases) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    const ent = info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
    if (!ent) return null;
    const period = String(ent.periodType ?? '').toUpperCase();
    const start = ent.latestPurchaseDate ?? ent.originalPurchaseDate ?? null;
    const exp = ent.expirationDate ?? null;
    return {
      isTrial: period === 'TRIAL',
      startedAtMs: start ? new Date(start).getTime() : null,
      expiresAtMs: exp ? new Date(exp).getTime() : null,
    };
  } catch {
    return null;
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

// ⚠️ 임시 진단용 — "coming soon" 원인이 안 보여서 화면에 직접 노출하기 위한 함수.
//   원인 확인되면 제거할 것.
export async function getPremiumPackagesDebug(): Promise<{
  packages: any[];
  moduleLoaded: boolean;
  offeringsRaw: any;
  errorMessage: string | null;
}> {
  if (!Purchases) {
    return { packages: [], moduleLoaded: false, offeringsRaw: null, errorMessage: 'Purchases 네이티브 모듈 로드 실패(require 실패)' };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings?.current?.availablePackages ?? [];
    return { packages, moduleLoaded: true, offeringsRaw: offerings, errorMessage: null };
  } catch (e: any) {
    const msg = e?.message ?? e?.code ?? JSON.stringify(e) ?? String(e);
    return { packages: [], moduleLoaded: true, offeringsRaw: null, errorMessage: msg };
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
