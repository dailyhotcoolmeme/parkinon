// 네이티브 광고 자리 (Phase 5 뼈대).
// 해외판 + free 티어일 때만 자리를 잡는다. premium 이면 광고 없음(null), 국내도 없음.
// ⚠️ 실제 AdMob 네이티브 광고(react-native-google-mobile-ads)는 Phase 6 재빌드에서 연결.
//    그 전까지 프로덕션에서는 아무것도 렌더하지 않아(빈 박스 방지) 사용자에게 안 보인다.
//    dev 빌드에서만 배치 확인용 placeholder 를 보여준다.
// 배치 6곳(docs/monetization_plan.md 5.5): medication/bodyState/exercise 탭,
//    remindersMeds/remindersDoseTimes 서브탭, more 메뉴.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSubscription } from '../../context/SubscriptionContext';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { getAdUnitId, type AdPlacement } from '../../constants/adUnitIds';

export function AdSlot({ placement }: { placement: AdPlacement }) {
  const { isPremium } = useSubscription();

  if (!isOverseasLocale()) return null; // 국내판: 광고 없음
  if (isPremium) return null; // 프리미엄: 광고 제거(그룹 전체)

  // Phase 6(재빌드): 여기서 getAdUnitId(placement)로 NativeAd/NativeAdView 렌더 +
  //   그 아래 "Remove ads"(구독 유도) 텍스트 링크(진입점 #3)를 붙인다.
  if (!__DEV__) return null; // 프로덕션은 SDK 탑재 전까지 미노출(빈 박스 방지)

  // dev 전용 배치 확인용 placeholder
  return (
    <View style={styles.devPlaceholder}>
      <Text style={styles.devLabel}>[Ad · {placement}]</Text>
      <Text style={styles.devSub}>native ad → Phase 6 · unit {getAdUnitId(placement).slice(-6)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  devPlaceholder: {
    minHeight: 76,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8C8C8',
    borderStyle: 'dashed',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    marginHorizontal: 16,
    paddingVertical: 12,
  },
  devLabel: { fontSize: 13, fontWeight: '700', color: '#999' },
  devSub: { fontSize: 11, color: '#BBB', marginTop: 2 },
});
