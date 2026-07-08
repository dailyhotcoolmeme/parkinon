// AdMob 초기화. 광고 로드(NativeAd.createForAdRequest) 전에 initialize()가 끝나 있어야
// 광고가 안정적으로 로드된다. AdSlot 은 whenAdsReady() 를 await 한 뒤 광고를 요청한다.
// ⚠️ 네이티브 모듈이라 재빌드 후에만 동작. 재빌드 전엔 조용히 no-op(크래시 방지).
// 비개인화(npa=1) 정책이라 ATT 프롬프트는 띄우지 않는다(광고 요청 시 requestNonPersonalizedAdsOnly).
let mobileAds: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mobileAds = require('react-native-google-mobile-ads').default;
} catch {
  mobileAds = null;
}

let readyPromise: Promise<void> | null = null;

/** 앱 시작 시 1회 호출. initialize() Promise 를 보관해 whenAdsReady() 로 공유. */
export function initAds(): Promise<void> {
  if (readyPromise) return readyPromise;
  const p: Promise<void> = mobileAds
    ? mobileAds()
        .initialize()
        .then(() => {})
        .catch((e: any) => {
          if (__DEV__) console.warn('[ads] initialize 실패(재빌드 전이면 정상):', e);
        })
    : Promise.resolve();
  readyPromise = p;
  return p;
}

/** SDK 초기화 완료를 기다린다(광고 요청 직전 await). */
export function whenAdsReady(): Promise<void> {
  return readyPromise ?? initAds();
}
