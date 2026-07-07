// AdMob 초기화. 광고 로드(NativeAd.createForAdRequest) 전에 한 번 호출되어야 한다.
// ⚠️ 네이티브 모듈이라 재빌드 후에만 동작. 재빌드 전엔 조용히 no-op(크래시 방지).
// 비개인화(npa=1) 정책이라 ATT 프롬프트는 띄우지 않는다(광고 요청 시 requestNonPersonalizedAdsOnly).
let mobileAds: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mobileAds = require('react-native-google-mobile-ads').default;
} catch {
  mobileAds = null;
}

let started = false;

/** 앱 시작 시 1회 호출. 재빌드 전/실패 시 조용히 무시. */
export async function initAds(): Promise<void> {
  if (!mobileAds || started) return;
  started = true;
  try {
    await mobileAds().initialize();
  } catch (e) {
    if (__DEV__) console.warn('[ads] initialize 실패(재빌드 전이면 정상):', e);
  }
}
