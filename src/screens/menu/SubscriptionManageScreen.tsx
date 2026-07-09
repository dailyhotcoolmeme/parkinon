// 구독 관리 화면.
// 현재 티어 표시 + 프리미엄 혜택 + 가격 + 구매/복원(RevenueCat).
// ⚠️ RevenueCat 은 네이티브 모듈이라 재빌드 후에만 실제 결제가 된다. 재빌드 전(또는 스토어에
//    구독상품 미등록)엔 패키지가 비어 있어 자동으로 "준비 중" 안내로 폴백한다.
// 구매 성공 → RevenueCat webhook 이 patient_groups.subscription_tier 를 premium 으로 갱신 →
//    refresh() 로 반영. (webhook 은 supabase functions/revenuecat-webhook)
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { Colors } from '../../constants/colors';
import { useSubscription } from '../../context/SubscriptionContext';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import {
  getPremiumPackages,
  purchasePackage,
  restorePurchases,
  isRevenueCatAvailable,
} from '../../lib/revenueCat';

const BENEFITS = [
  { key: 'subscription.benefitUnlimitedMedia', icon: 'infinite' as const },
  { key: 'subscription.benefitNoAds', icon: 'ban' as const },
  { key: 'subscription.benefitFamily', icon: 'people' as const },
];

export function SubscriptionManageScreen() {
  const { t } = useTranslation();
  const { isPremium, refresh } = useSubscription();
  const dialog = useDialog();
  const bottomPad = useBottomSheetPadding(20);

  const [packages, setPackages] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'ANNUAL' | 'MONTHLY'>('ANNUAL');

  useEffect(() => {
    if (isPremium) return;
    let cancelled = false;
    getPremiumPackages()
      .then((pkgs) => { if (!cancelled) setPackages(pkgs); })
      .catch(() => { if (!cancelled) setPackages([]); });
    return () => { cancelled = true; };
  }, [isPremium]);

  const purchasable = isRevenueCatAvailable() && packages.length > 0;

  const doPurchase = async (type: 'ANNUAL' | 'MONTHLY') => {
    const pkg = packages.find((p) => p.packageType === type) ?? packages[0];
    if (!purchasable || !pkg) {
      dialog.alert({ title: t('subscription.comingSoonTitle'), message: t('subscription.comingSoonMsg') });
      return;
    }
    setBusy(true);
    const { ok, cancelled } = await purchasePackage(pkg);
    setBusy(false);
    if (cancelled) return;
    if (ok) {
      await refresh(); // 서버 webhook 반영엔 몇 초 걸릴 수 있음
      dialog.alert({ title: t('subscription.purchaseDoneTitle'), message: t('subscription.purchaseDoneMsg') });
    } else {
      dialog.alert({ title: t('subscription.purchaseFailTitle'), message: t('subscription.purchaseFailMsg') });
    }
  };

  // 구독 해지·다운그레이드는 앱에서 직접 못 하고(스토어 정책) OS 구독 설정으로 보낸다.
  const openManageSubscription = () => {
    const url = Platform.select({
      ios: 'https://apps.apple.com/account/subscriptions',
      android: 'https://play.google.com/store/account/subscriptions?package=com.ourmine.parkinon',
    });
    if (url) Linking.openURL(url).catch(() => {});
  };

  const doRestore = async () => {
    if (!isRevenueCatAvailable()) {
      dialog.alert({ title: t('subscription.comingSoonTitle'), message: t('subscription.comingSoonMsg') });
      return;
    }
    setBusy(true);
    const ok = await restorePurchases();
    setBusy(false);
    await refresh();
    dialog.alert(
      ok
        ? { title: t('subscription.restoreDoneTitle'), message: t('subscription.restoreDoneMsg') }
        : { title: t('subscription.restoreNoneTitle'), message: t('subscription.restoreNoneMsg') },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={t('subscription.headerTitle')} showBack />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}>
        {isPremium ? (
          /* 프리미엄 사용자: 현재 상태 카드 */
          <View style={[styles.statusCard, styles.statusCardPremium]}>
            <Ionicons name="star" size={28} color="#fff" />
            <View style={styles.statusTextWrap}>
              <Text style={[styles.statusLabel, styles.statusTextOnGreen]}>
                {t('subscription.currentPremium')}
              </Text>
              <Text style={[styles.statusSub, styles.statusTextOnGreen]}>
                {t('subscription.currentPremiumSub')}
              </Text>
            </View>
          </View>
        ) : (
          /* 무료 사용자: 업그레이드를 유도하는 히어로 카드 */
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Ionicons name="star" size={26} color={Colors.primary} />
            </View>
            <Text style={styles.heroTitle}>{t('subscription.heroTitle')}</Text>
            <Text style={styles.heroSub}>{t('subscription.heroSub')}</Text>
          </View>
        )}

        {/* 프리미엄 혜택 */}
        <Text style={styles.sectionTitle}>{t('subscription.benefitsTitle')}</Text>
        <View style={styles.benefitCard}>
          {BENEFITS.map((b) => (
            <View key={b.key} style={styles.benefitRow}>
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon} size={20} color={Colors.primary} />
              </View>
              <Text style={styles.benefitText}>{t(b.key)}</Text>
            </View>
          ))}
        </View>

        {isPremium && (
          <>
            <TouchableOpacity style={styles.manageBtn} onPress={openManageSubscription} activeOpacity={0.8}>
              <Ionicons name="settings-outline" size={18} color={Colors.text} />
              <Text style={styles.manageBtnText}>{t('subscription.manageSubscription')}</Text>
            </TouchableOpacity>
            <Text style={styles.manageHint}>{t('subscription.manageHint')}</Text>
          </>
        )}

        {!isPremium && (
          <>
            {/* 플랜 선택 — 연간(추천)·월간 두 카드 */}
            <Text style={styles.sectionTitle}>{t('subscription.choosePlanTitle')}</Text>

            {/* 연간 (추천) */}
            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'ANNUAL' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('ANNUAL')}
              activeOpacity={0.85}
              disabled={busy}
            >
              <View style={styles.bestBadge}>
                <Text style={styles.bestBadgeText}>{t('subscription.planBestValue')}</Text>
              </View>
              <View style={styles.planRadioCol}>
                <Ionicons
                  name={selectedPlan === 'ANNUAL' ? 'radio-button-on' : 'radio-button-off'}
                  size={24}
                  color={selectedPlan === 'ANNUAL' ? Colors.primary : '#C4C4C4'}
                />
              </View>
              <View style={styles.planInfo}>
                <Text style={styles.planTitle}>{t('subscription.planAnnualTitle')}</Text>
                <View style={styles.planPriceRow}>
                  <Text style={styles.planPriceOriginal}>{t('subscription.planAnnualOriginal')}</Text>
                  <Text style={styles.planPrice}>{t('subscription.planAnnualPrice')}</Text>
                </View>
                <Text style={styles.planTrialNote}>{t('subscription.planTrialNote')}</Text>
              </View>
              <View style={styles.saveTag}>
                <Text style={styles.saveTagText}>{t('subscription.planAnnualSave')}</Text>
              </View>
            </TouchableOpacity>

            {/* 월간 */}
            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'MONTHLY' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('MONTHLY')}
              activeOpacity={0.85}
              disabled={busy}
            >
              <View style={styles.planRadioCol}>
                <Ionicons
                  name={selectedPlan === 'MONTHLY' ? 'radio-button-on' : 'radio-button-off'}
                  size={24}
                  color={selectedPlan === 'MONTHLY' ? Colors.primary : '#C4C4C4'}
                />
              </View>
              <View style={styles.planInfo}>
                <Text style={styles.planTitle}>{t('subscription.planMonthlyTitle')}</Text>
                <Text style={styles.planPrice}>{t('subscription.planMonthlyPrice')}</Text>
                <Text style={styles.planTrialNote}>{t('subscription.planTrialNote')}</Text>
              </View>
            </TouchableOpacity>

            {/* 결제 CTA — 선택한 플랜으로 */}
            <TouchableOpacity
              style={[styles.upgradeBtn, busy && styles.btnDisabled]}
              onPress={() => doPurchase(selectedPlan)}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.upgradeBtnText}>{t('subscription.trialCta')}</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.finePrint}>{t('subscription.finePrint')}</Text>

            <TouchableOpacity onPress={doRestore} disabled={busy} activeOpacity={0.7}>
              <Text style={styles.restoreLink}>{t('subscription.restoreBtn')}</Text>
            </TouchableOpacity>
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
  /* 무료 사용자 히어로 카드 */
  heroCard: {
    backgroundColor: Colors.primary,
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  heroBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  heroSub: { fontSize: 15, color: '#EAF7EC', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 4 },
  benefitCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, fontSize: 16, color: Colors.text, lineHeight: 23 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  planCardSelected: { borderColor: Colors.primary, backgroundColor: '#F4FBF5' },
  bestBadge: {
    position: 'absolute',
    top: -10,
    left: 16,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bestBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  planRadioCol: { width: 26, alignItems: 'center' },
  planInfo: { flex: 1 },
  planTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  planPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  planPriceOriginal: {
    fontSize: 15,
    color: Colors.textSub,
    textDecorationLine: 'line-through',
  },
  planPrice: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 2 },
  planTrialNote: { fontSize: 13, fontWeight: '700', color: Colors.primary, marginTop: 4 },
  saveTag: {
    backgroundColor: '#E8F6EA',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  saveTagText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  upgradeBtn: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeBtnText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  btnDisabled: { opacity: 0.6 },
  secondaryLink: { fontSize: 15, fontWeight: '700', color: Colors.primary, textAlign: 'center', paddingVertical: 6 },
  finePrint: { fontSize: 13, color: Colors.textSub, textAlign: 'center', lineHeight: 19 },
  restoreLink: { fontSize: 14, color: Colors.textSub, textAlign: 'center', textDecorationLine: 'underline', paddingVertical: 8 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  manageBtnText: { fontSize: 16, fontWeight: '700', color: Colors.text },
  manageHint: { fontSize: 13, color: Colors.textSub, textAlign: 'center', lineHeight: 19, marginTop: -4 },
});
