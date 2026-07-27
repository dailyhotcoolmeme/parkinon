// AdMob 초기화 + 광고 동의(UMP). 광고 로드(NativeAd.createForAdRequest) 전에
// (1) 동의 수집 (2) initialize() 가 끝나 있어야 한다. AdSlot 은 whenAdsReady() 를 await 한다.
// ⚠️ 네이티브 모듈이라 재빌드 후에만 동작. 재빌드 전엔 조용히 no-op(크래시 방지).
// 비개인화(npa=1) 정책이라 ATT 프롬프트는 띄우지 않는다(광고 요청 시 requestNonPersonalizedAdsOnly).
//
// 왜 동의(UMP)가 필요한가:
//   유럽·영국(EEA/UK) 사용자에게 광고를 내보내려면 구글 인증 동의 메시지가 필수다.
//   비개인화 광고여도 면제되지 않는다 — 기기 정보 접근 자체에 동의가 필요하다.
//   없으면 그 지역엔 광고가 아예 안 나가거나 AdMob 계정에 경고가 붙는다.
//   광고는 해외 로케일에서만 노출되므로(AdSlot), 동의 수집도 해외에서만 수행해
//   국내 사용자에겐 아무 변화가 없게 한다.
import { isOverseasLocale } from '../i18n/detectLocale';

let mobileAds: any = null;
let AdsConsent: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const gma = require('react-native-google-mobile-ads');
  mobileAds = gma.default;
  AdsConsent = gma.AdsConsent ?? null;
} catch {
  mobileAds = null;
  AdsConsent = null;
}

let readyPromise: Promise<void> | null = null;

/**
 * 광고를 요청해도 되는지(동의 결과).
 * 국내는 광고 자체를 띄우지 않으므로 항상 true 로 두고, 해외는 UMP 결과를 따른다.
 * 조회 실패 시 false — 동의 없이 광고를 내보내는 것보다 안 띄우는 편이 안전하다.
 */
let adsAllowed = !isOverseasLocale();
/** 사용자에게 "광고 동의 다시 보기" 진입점을 제공해야 하는 지역인지(EEA 등). */
let privacyOptionsRequired = false;

/** 동의 수집 — 해외 로케일에서만. 실패해도 앱 흐름을 막지 않는다. */
async function gatherConsent(): Promise<void> {
  if (!isOverseasLocale()) {
    adsAllowed = true; // 국내: 광고 미노출이라 동의 대상 아님
    return;
  }
  if (!AdsConsent) {
    adsAllowed = false; // 재빌드 전 등 모듈 없음 → 광고 요청하지 않음
    return;
  }
  try {
    await AdsConsent.requestInfoUpdate();
    // 필요한 지역에서만 폼이 뜬다. 그 외 지역은 즉시 통과.
    await AdsConsent.loadAndShowConsentFormIfRequired();
    const info = await AdsConsent.getConsentInfo();
    adsAllowed = !!info?.canRequestAds;
    privacyOptionsRequired = info?.privacyOptionsRequirementStatus === 'REQUIRED';
  } catch (e) {
    // 폼 로드 실패·네트워크 오류 등. 광고만 포기하고 앱은 그대로 진행한다.
    adsAllowed = false;
    if (__DEV__) console.warn('[ads] 동의 수집 실패:', e);
  }
}

/** 앱 시작 시 1회 호출. 동의 → initialize 순서로 진행하고 Promise 를 공유한다. */
export function initAds(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await gatherConsent();
    if (!mobileAds) return;
    try {
      await mobileAds().initialize();
    } catch (e: any) {
      if (__DEV__) console.warn('[ads] initialize 실패(재빌드 전이면 정상):', e);
    }
  })();
  return readyPromise;
}

/** SDK 초기화 완료를 기다린다(광고 요청 직전 await). */
export function whenAdsReady(): Promise<void> {
  return readyPromise ?? initAds();
}

/** 광고 요청 가능 여부(동의 반영). AdSlot 이 요청 직전에 확인한다. */
export function canRequestAds(): boolean {
  return adsAllowed;
}

/** "광고 동의 다시 보기"를 메뉴에 노출해야 하는지(EEA 등에서 구글이 요구). */
export function isPrivacyOptionsRequired(): boolean {
  return privacyOptionsRequired;
}

/** 사용자가 동의 선택을 바꾸도록 폼을 다시 띄운다. 성공 시 동의 상태를 갱신한다. */
export async function showAdsPrivacyOptions(): Promise<void> {
  if (!AdsConsent) return;
  try {
    await AdsConsent.showPrivacyOptionsForm();
    const info = await AdsConsent.getConsentInfo();
    adsAllowed = !!info?.canRequestAds;
    privacyOptionsRequired = info?.privacyOptionsRequirementStatus === 'REQUIRED';
  } catch (e) {
    if (__DEV__) console.warn('[ads] 동의 옵션 폼 실패:', e);
  }
}
