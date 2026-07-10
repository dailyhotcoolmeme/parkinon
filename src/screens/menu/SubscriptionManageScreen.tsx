// 구독 관리 화면.
// 현재 티어 표시 + 프리미엄 혜택 + 가격 + 구매/복원(RevenueCat).
// ⚠️ RevenueCat 은 네이티브 모듈이라 재빌드 후에만 실제 결제가 된다. 재빌드 전(또는 스토어에
//    구독상품 미등록)엔 패키지가 비어 있어 자동으로 "준비 중" 안내로 폴백한다.
// 구매 성공 → RevenueCat webhook 이 patient_groups.subscription_tier 를 premium 으로 갱신 →
//    refresh() 로 반영. (webhook 은 supabase functions/revenuecat-webhook)
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Platform, Image, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { TopBar } from '../../components/common/TopBar';
import { Colors } from '../../constants/colors';
import { useSubscription } from '../../context/SubscriptionContext';
import { useDialog } from '../../context/DialogContext';
import {
  getPremiumPackages,
  purchasePackage,
  restorePurchases,
  isRevenueCatAvailable,
  getTrialInfo,
  type TrialInfo,
} from '../../lib/revenueCat';

// 혜택 순서(오너 지정, 구독 슬롯과 동일): 가족 연동 → 커스텀 알림음 → 미디어 무제한 → 광고 없음.
const BENEFITS = [
  { key: 'subscription.benefitFamily', icon: 'people' as const },
  { key: 'subscription.benefitAlarmSound', icon: 'musical-notes' as const },
  { key: 'subscription.benefitUnlimitedMedia', icon: 'infinite' as const },
  { key: 'subscription.benefitNoAds', icon: 'ban' as const },
];

// 무료 vs 프리미엄 비교표 행. 항목명(풀네임)은 1회만, 플랜별로 값만 다르게.
const PLAN_ROWS = [
  { label: 'subscription.rowFamily', free: 'subscription.valUnlimited', premium: 'subscription.valUnlimited' },
  { label: 'subscription.rowReport', free: 'subscription.valIncluded', premium: 'subscription.valIncluded' },
  { label: 'subscription.rowAlarm', free: 'subscription.freeValAlarm', premium: 'subscription.valUnlimited' },
  { label: 'subscription.rowPhoto', free: 'subscription.freeValPhoto', premium: 'subscription.valUnlimited' },
  { label: 'subscription.rowAudio', free: 'subscription.freeValAudio', premium: 'subscription.valUnlimited' },
  { label: 'subscription.rowVideo', free: 'subscription.freeValVideo', premium: 'subscription.valUnlimited' },
  { label: 'subscription.rowAds', free: 'subscription.freeValAds', premium: 'subscription.premiumValAds' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// 히어로(초록 배경) 위의 흰색 앱 심볼. 흰 원 배지 없이 초록 배경에 바로. 톱바와 동일한
// Animated 회전(정적 PNG 회전 — GIF 아님, 안드·iOS 모두 OTA 동작).
const HERO_SYMBOL = require('../../../assets/parkinon-symbol-en.png');

export function SubscriptionManageScreen() {
  const { t } = useTranslation();
  const { isPremium, refresh } = useSubscription();
  const dialog = useDialog();

  // 히어로 심볼 회전 (톱바 브랜드 스핀과 동일: 6초 회전 → 3.5초 정지 루프. useNativeDriver, OTA·양 플랫폼).
  const heroSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(heroSpin, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(3500),
        Animated.timing(heroSpin, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [heroSpin]);
  const heroSpinDeg = heroSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const [packages, setPackages] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'ANNUAL' | 'MONTHLY'>('ANNUAL');
  const [trial, setTrial] = useState<TrialInfo | null>(null);

  useEffect(() => {
    if (isPremium) return;
    let cancelled = false;
    getPremiumPackages()
      .then((pkgs) => { if (!cancelled) setPackages(pkgs); })
      .catch(() => { if (!cancelled) setPackages([]); });
    return () => { cancelled = true; };
  }, [isPremium]);

  // 프리미엄 사용자: 무료 체험 진행 정보 조회(체험 중이 아니면 바 미표시).
  useEffect(() => {
    if (!isPremium) { setTrial(null); return; }
    let cancelled = false;
    getTrialInfo()
      .then((ti) => { if (!cancelled) setTrial(ti); })
      .catch(() => { if (!cancelled) setTrial(null); });
    return () => { cancelled = true; };
  }, [isPremium]);

  // 체험 진행률 계산 (체험 중 + 시작/만료 시각이 유효할 때만).
  const trialProgress = (() => {
    if (!trial?.isTrial || !trial.startedAtMs || !trial.expiresAtMs) return null;
    const total = trial.expiresAtMs - trial.startedAtMs;
    if (total <= 0) return null;
    const now = Date.now();
    const elapsed = Math.min(Math.max(now - trial.startedAtMs, 0), total);
    const pct = Math.round((elapsed / total) * 100);
    const totalDays = Math.max(1, Math.round(total / DAY_MS));
    const dayNum = Math.min(totalDays, Math.floor(elapsed / DAY_MS) + 1);
    const daysLeft = Math.max(0, Math.ceil((trial.expiresAtMs - now) / DAY_MS));
    return { pct, dayNum, totalDays, daysLeft };
  })();

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
      <ScrollView contentContainerStyle={styles.content}>
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
        ) : null}

        {/* 무료 체험 진행 바 — 체험 중인 프리미엄 사용자에게만 */}
        {trialProgress && (
          <View style={styles.trialCard}>
            <View style={styles.trialHeaderRow}>
              <Text style={styles.trialTitle}>{t('subscription.trialProgressTitle')}</Text>
              <Text style={styles.trialDaysLeft}>
                {t('subscription.trialDaysLeft', { days: trialProgress.daysLeft })}
              </Text>
            </View>
            <View style={styles.trialBarTrack}>
              <View style={[styles.trialBarFill, { width: `${trialProgress.pct}%` }]} />
            </View>
            <Text style={styles.trialDayLabel}>
              {t('subscription.trialDayOf', { day: trialProgress.dayNum, total: trialProgress.totalDays })}
            </Text>
          </View>
        )}

        {!isPremium && (
          /* 무료 사용자: 업그레이드를 유도하는 히어로 카드 */
          <View style={styles.heroCard}>
            <Animated.Image source={HERO_SYMBOL} style={[styles.heroSymbol, { transform: [{ rotate: heroSpinDeg }] }]} resizeMode="contain" />
            <Text style={styles.heroTitle}>{t('subscription.heroTitle')}</Text>
            <Text style={styles.heroSub}>{t('subscription.heroSub')}</Text>
          </View>
        )}

        {isPremium && (
          <>
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
            <TouchableOpacity style={styles.manageBtn} onPress={openManageSubscription} activeOpacity={0.8}>
              <Ionicons name="settings-outline" size={18} color={Colors.text} />
              <Text style={styles.manageBtnText}>{t('subscription.manageSubscription')}</Text>
            </TouchableOpacity>
            <Text style={styles.manageHint}>{t('subscription.manageHint')}</Text>
          </>
        )}

        {!isPremium && (
          <>
            {/* 플랜 비교 — 흰 카드(제목 + 표), 항목명 1회 + 무료/프리미엄 값 열. */}
            <Text style={styles.sectionTitle}>{t('subscription.compareTitle')}</Text>
            <View style={styles.compareCard}>
            <View style={styles.cmpTable}>
              {/* 헤더: 플랜명/가격 */}
              <View style={styles.cmpRow}>
                <View style={styles.cmpFeatCol} />
                <View style={[styles.cmpValFree, styles.cmpHeadCell]}>
                  <Text style={styles.cmpPlanName}>{t('subscription.comparePlanFree')}</Text>
                  <Text style={styles.cmpPlanPrice}>{t('subscription.comparePriceFree')}</Text>
                </View>
                <View style={[styles.cmpValPrem, styles.cmpHeadCell, styles.cmpPremCol, styles.cmpPremTop]}>
                  <Text style={[styles.cmpPlanName, styles.cmpPlanNameP]}>{t('subscription.comparePlanPremium')}</Text>
                  <Text style={[styles.cmpPlanPrice, styles.cmpPlanPriceP]}>{t('subscription.comparePricePremium')}</Text>
                </View>
              </View>

              {/* 항목 행: 항목명(1회) + 무료값 + 프리미엄값 */}
              {PLAN_ROWS.map((r, i) => {
                const last = i === PLAN_ROWS.length - 1;
                return (
                  <View key={r.label} style={styles.cmpRow}>
                    <View style={[styles.cmpFeatCol, styles.cmpCell, !last && styles.cmpDivider]}>
                      <Text style={styles.cmpFeatText}>{t(r.label)}</Text>
                    </View>
                    <View style={[styles.cmpValFree, styles.cmpCell, !last && styles.cmpDivider]}>
                      <Text style={styles.cmpFreeVal}>{t(r.free)}</Text>
                    </View>
                    <View
                      style={[
                        styles.cmpValPrem,
                        styles.cmpCell,
                        styles.cmpPremCol,
                        !last && styles.cmpDividerP,
                        last && styles.cmpPremBottom,
                      ]}
                    >
                      <Text style={styles.cmpPremVal}>{t(r.premium)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
            </View>

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
  content: { padding: 20, paddingBottom: 40, gap: 16 },
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
  /* 무료 체험 진행 바 */
  trialCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  trialHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trialTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  trialDaysLeft: { fontSize: 15, fontWeight: '800', color: Colors.primary },
  trialBarTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.light,
    overflow: 'hidden',
  },
  trialBarFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  trialDayLabel: { fontSize: 14, color: Colors.textSub, marginTop: 8, fontWeight: '600' },
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
  heroSymbol: { width: 48, height: 48, marginBottom: 12 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  heroSub: { fontSize: 15, color: '#EAF7EC', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 10 },
  /* 플랜 비교 흰 카드 (제목 + 표를 담고, 좌우 패딩) */
  compareCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  compareTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  /* 플랜 비교표 — 항목명 1회(좌) + 무료 값 + 프리미엄 값(강조 열 박스). */
  cmpTable: {},
  cmpRow: { flexDirection: 'row', alignItems: 'stretch' },
  cmpFeatCol: { flex: 1.35, justifyContent: 'center', paddingRight: 6 },
  cmpValFree: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cmpValPrem: { flex: 1.45, alignItems: 'center', justifyContent: 'center' },
  cmpHeadCell: { height: 58, position: 'relative' },
  cmpTrialPill: {
    marginTop: 4,
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cmpTrialPillText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  cmpCell: { minHeight: 48, justifyContent: 'center' },
  cmpPremCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  cmpDivider: { borderBottomWidth: 1, borderBottomColor: '#EFEFEF' },
  // 프리미엄 열(초록 박스) 내부 행 구분선 — 박스 배경 위에 보이는 옅은 초록선
  cmpDividerP: { borderBottomWidth: 1, borderBottomColor: 'rgba(76,175,80,0.22)' },
  /* 프리미엄 강조 열(박스): 좌우 세로선 연속 + 상/하단만 모서리·가로선 */
  cmpPremCol: {
    backgroundColor: '#F4FBF5',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: Colors.primary,
  },
  cmpPremTop: {
    borderTopWidth: 2,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cmpPremBottom: {
    borderBottomWidth: 2,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  cmpBadgeWrap: { position: 'absolute', top: -11, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  cmpBadge: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  cmpBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  cmpPlanName: { fontSize: 15, fontWeight: '800', color: Colors.textSub },
  cmpPlanNameP: { color: Colors.primary },
  cmpPlanPrice: { fontSize: 12, color: Colors.textHint, marginTop: 2, fontWeight: '700' },
  cmpPlanPriceP: { color: Colors.primary },
  cmpFeatText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  cmpFreeVal: { fontSize: 14, color: Colors.textSub, fontWeight: '700', textAlign: 'center' },
  cmpPremVal: { fontSize: 14, color: '#388E3C', fontWeight: '800' },
  planCompareNote: { fontSize: 12.5, color: Colors.textHint, marginTop: 10, textAlign: 'center' },
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
