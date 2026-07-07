// 구독 관리 화면 (Phase 5 뼈대).
// 현재 티어 표시 + 프리미엄 혜택 + 가격 안내 + 업그레이드 CTA.
// ⚠️ 실제 결제(RevenueCat)는 네이티브 모듈이라 Phase 6 재빌드에서 연결된다.
//    지금은 업그레이드 버튼이 "출시 준비 중" 안내만 띄운다(handleUpgrade의 Phase 6 지점 참고).
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { Colors } from '../../constants/colors';
import { useSubscription } from '../../context/SubscriptionContext';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';

const BENEFIT_KEYS = [
  'subscription.benefitUnlimitedMedia',
  'subscription.benefitNoAds',
  'subscription.benefitFamily',
] as const;

export function SubscriptionManageScreen() {
  const { t } = useTranslation();
  const { isPremium } = useSubscription();
  const dialog = useDialog();
  const bottomPad = useBottomSheetPadding(20);

  const handleUpgrade = () => {
    // Phase 6(재빌드): 여기서 RevenueCat 페이월/구매 흐름을 호출한다.
    // 지금(Phase 5)은 결제 SDK 미탑재라 출시 준비 중 안내만.
    dialog.alert({
      title: t('subscription.comingSoonTitle'),
      message: t('subscription.comingSoonMsg'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={t('subscription.headerTitle')} showBack />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}>
        {/* 현재 플랜 상태 */}
        <View style={[styles.statusCard, isPremium && styles.statusCardPremium]}>
          <Ionicons
            name={isPremium ? 'star' : 'star-outline'}
            size={28}
            color={isPremium ? '#fff' : Colors.primary}
          />
          <View style={styles.statusTextWrap}>
            <Text style={[styles.statusLabel, isPremium && styles.statusTextOnGreen]}>
              {isPremium ? t('subscription.currentPremium') : t('subscription.currentFree')}
            </Text>
            <Text style={[styles.statusSub, isPremium && styles.statusTextOnGreen]}>
              {isPremium ? t('subscription.currentPremiumSub') : t('subscription.currentFreeSub')}
            </Text>
          </View>
        </View>

        {/* 프리미엄 혜택 */}
        <Text style={styles.sectionTitle}>{t('subscription.benefitsTitle')}</Text>
        <View style={styles.benefitCard}>
          {BENEFIT_KEYS.map((k) => (
            <View key={k} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
              <Text style={styles.benefitText}>{t(k)}</Text>
            </View>
          ))}
        </View>

        {!isPremium && (
          <>
            {/* 가격 */}
            <View style={styles.priceCard}>
              <Text style={styles.priceMain}>{t('subscription.priceAnnual')}</Text>
              <Text style={styles.priceSub}>{t('subscription.priceMonthly')}</Text>
              <Text style={styles.priceTrial}>{t('subscription.priceTrial')}</Text>
            </View>

            <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} activeOpacity={0.85}>
              <Text style={styles.upgradeBtnText}>{t('subscription.upgradeBtn')}</Text>
            </TouchableOpacity>
            <Text style={styles.finePrint}>{t('subscription.finePrint')}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, gap: 16 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusCardPremium: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusTextWrap: { flex: 1 },
  statusLabel: { fontSize: 19, fontWeight: '700', color: Colors.text },
  statusSub: { fontSize: 15, color: Colors.textSub, marginTop: 3, lineHeight: 21 },
  statusTextOnGreen: { color: '#fff' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 4 },
  benefitCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitText: { flex: 1, fontSize: 16, color: Colors.text, lineHeight: 23 },
  priceCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  priceMain: { fontSize: 24, fontWeight: '800', color: Colors.text },
  priceSub: { fontSize: 15, color: Colors.textSub, marginTop: 4 },
  priceTrial: { fontSize: 15, fontWeight: '700', color: Colors.primary, marginTop: 8 },
  upgradeBtn: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeBtnText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  finePrint: { fontSize: 13, color: Colors.textSub, textAlign: 'center', lineHeight: 19 },
});
