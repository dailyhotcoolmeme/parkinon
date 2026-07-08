// 네이티브 광고 자리.
// 해외판 + free 티어일 때만 노출. premium/국내는 없음.
// AdMob 네이티브 광고(react-native-google-mobile-ads)를 앱 카드 스타일 자체 템플릿으로 렌더.
// 비개인화(npa=1) 고정. 정책상 "Ad" 표시 필수. 아래에 "Remove ads" 구독 유도 링크(진입점 #3).
// ⚠️ 네이티브 모듈이라 재빌드 후에만 실제 광고가 뜬다. 재빌드 전엔 광고 로드가 실패해도
//    크래시 없이 dev=자리표시 / prod=미노출로 폴백한다. dev 빌드(재빌드 후)에서는
//    getAdUnitId 가 구글 테스트 ID를 반환하므로 테스트 광고가 뜬다.
import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../context/SubscriptionContext';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { getAdUnitId, FORCE_TEST_ADS, type AdPlacement } from '../../constants/adUnitIds';
import { navigateTo } from '../../navigation/navigationRef';
import { Colors } from '../../constants/colors';
import { whenAdsReady } from '../../lib/ads';

// 네이티브 모듈 lazy 로드(패키지 JS는 있으나 실제 광고 요청은 네이티브 필요).
let GMA: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  GMA = require('react-native-google-mobile-ads');
} catch {
  GMA = null;
}

export function AdSlot({ placement }: { placement: AdPlacement }) {
  const { isPremium } = useSubscription();
  const { t } = useTranslation();
  const [nativeAd, setNativeAd] = useState<any>(null);

  const active = isOverseasLocale() && !isPremium; // 국내·premium 제외

  useEffect(() => {
    if (!active || !GMA?.NativeAd?.createForAdRequest) return;
    let ad: any = null;
    let cancelled = false;
    // SDK 초기화 완료를 기다린 뒤 광고 요청(init 레이스 방지).
    whenAdsReady()
      .then(() =>
        GMA.NativeAd.createForAdRequest(getAdUnitId(placement), {
          requestNonPersonalizedAdsOnly: true, // 비개인화 고정
        }),
      )
      .then((a: any) => {
        if (cancelled) { a?.destroy?.(); return; }
        ad = a;
        setNativeAd(a);
      })
      .catch(() => { /* 재빌드 전/로드 실패: 조용히 폴백 */ });
    return () => { cancelled = true; ad?.destroy?.(); };
  }, [active, placement]);

  if (!active) return null;

  // 실제 광고 준비됨 → 자체 템플릿 렌더
  if (nativeAd && GMA?.NativeAdView) {
    const { NativeAdView, NativeAsset, NativeAssetType } = GMA;
    return (
      <View style={styles.wrap}>
        {/* NativeAdView(네이티브 뷰)는 자체 borderRadius/overflow가 안 먹으므로,
            일반 View(cardClip)로 감싸 부모가 둥근 모서리로 클립하게 한다(안드 핵심). */}
        <View style={styles.cardClip}>
          <NativeAdView nativeAd={nativeAd} style={styles.cardInner}>
          <View style={styles.row}>
            {!!nativeAd.icon?.url && (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} />
              </NativeAsset>
            )}
            <View style={styles.textCol}>
              <View style={styles.headlineRow}>
                <Text style={styles.adBadge}>{t('ads.sponsored')}</Text>
                <NativeAsset assetType={NativeAssetType.HEADLINE}>
                  <Text style={styles.headline} numberOfLines={1}>{nativeAd.headline}</Text>
                </NativeAsset>
              </View>
              {!!nativeAd.body && (
                <NativeAsset assetType={NativeAssetType.BODY}>
                  <Text style={styles.body} numberOfLines={2}>{nativeAd.body}</Text>
                </NativeAsset>
              )}
            </View>
            {!!nativeAd.callToAction && (
              <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                <View style={styles.cta}>
                  <Text style={styles.ctaText} numberOfLines={1}>{nativeAd.callToAction}</Text>
                </View>
              </NativeAsset>
            )}
          </View>
          </NativeAdView>
        </View>
        <TouchableOpacity onPress={() => navigateTo('SubscriptionManage')} activeOpacity={0.7}>
          <Text style={styles.removeAds}>{t('ads.removeAds')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 아직 광고 없음(로딩/실패): 테스트 단계(__DEV__ 또는 FORCE_TEST_ADS)에선 슬롯 위치
  // 확인용 자리표시를 보여준다(광고 네트워크가 늦거나 실패해도 슬롯이 안 보이지 않도록).
  // 실제 출시(FORCE_TEST_ADS=false)에선 미노출 → 빈 박스 없음.
  if (__DEV__ || FORCE_TEST_ADS) {
    return (
      <View style={styles.devPlaceholder}>
        <Text style={styles.devLabel}>[Ad · {placement}]</Text>
        <Text style={styles.devSub}>native ad · unit {getAdUnitId(placement).slice(-6)}</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  // 좌우 여백 0 — 이미 좌우 패딩 있는 컨테이너 안에 배치되므로, 부모 폭을 꽉 채워
  // 위아래 박스(카드)와 가로폭을 정확히 맞춘다.
  wrap: { marginVertical: 8, marginHorizontal: 0 },
  // 일반 View — 둥근 모서리로 자식(NativeAdView)을 클립하는 실제 클리핑 컨테이너
  cardClip: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 2,
  },
  // NativeAdView — 클립은 부모가 하므로 여기선 패딩만
  cardInner: {
    padding: 12,
    backgroundColor: Colors.white,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#EEE' },
  textCol: { flex: 1 },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  adBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A8A8A',
    borderWidth: 1,
    borderColor: '#CFCFCF',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  headline: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  body: { fontSize: 13, color: Colors.textSub, marginTop: 2, lineHeight: 18 },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ctaText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  removeAds: {
    fontSize: 12,
    color: Colors.textSub,
    textAlign: 'right',
    marginTop: 6,
    textDecorationLine: 'underline',
  },
  devPlaceholder: {
    minHeight: 76,
    borderRadius: 16, // 주변 카드와 동일
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D8D8D8',
    // 안드로이드는 점선+둥근모서리를 함께 못 그려 직사각형이 됨 → 실선 사용
    borderStyle: 'solid',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    marginHorizontal: 0,
    paddingVertical: 12,
  },
  devLabel: { fontSize: 13, fontWeight: '700', color: '#999' },
  devSub: { fontSize: 11, color: '#BBB', marginTop: 2 },
});
