import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useRecordsData } from '../../hooks/useRecordsData';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';
import { navigateTo } from '../../navigation/navigationRef';
import { triggerLabelToText } from '../../utils/medUtils';
import { supabase } from '../../lib/supabase';
import { PcCodeModal } from '../../components/records/PcCodeModal';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { SkeletonList } from '../../components/common/SkeletonCard';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'Records'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Period = 'week' | 'month' | 'quarter';
type ItemKey = 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';

const PERIODS: Period[] = ['week', 'month', 'quarter'];

const ITEMS: { key: ItemKey; icon: IoniconName; label: string; accentColor: string }[] = [
  { key: 'medication', icon: 'medkit-outline', label: i18n.t('records.itemMedication'), accentColor: Colors.primary },
  { key: 'bodyState', icon: 'happy-outline', label: i18n.t('records.itemBodyState'), accentColor: '#E65100' },
  { key: 'mood', icon: 'happy', label: i18n.t('records.itemMood'), accentColor: '#FF8F00' },
  { key: 'sleep', icon: 'moon-outline', label: i18n.t('records.itemSleep'), accentColor: '#7B1FA2' },
  { key: 'constipation', icon: 'water-outline', label: i18n.t('records.itemConstipation'), accentColor: '#0277BD' },
  { key: 'exercise', icon: 'fitness-outline', label: i18n.t('records.itemExercise'), accentColor: '#BF360C' },
];

// trigger_time_label → 표시용 텍스트 (공용 유틸 사용)
function triggerLabelToDisplay(label: string): string {
  return triggerLabelToText(label) || label;
}

// Build rows of 2 from flat ITEMS list
const ITEM_ROWS: ItemKey[][] = ITEMS.reduce<ItemKey[][]>((rows, item, i) => {
  if (i % 2 === 0) rows.push([item.key]);
  else rows[rows.length - 1].push(item.key);
  return rows;
}, []);

export function RecordsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const [period, setPeriod] = useState<Period>('week');
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();

  const periodLabel = (p: Period): string =>
    p === 'week' ? t('records.periodWeek') : p === 'month' ? t('records.periodMonth') : t('records.period3Month');
  const prevLabelDisplay = (p: Period): string =>
    p === 'week' ? t('records.prevWeek') : p === 'month' ? t('records.prevMonth') : t('records.prev3Month');

  // Supabase 실제 데이터
  const { summary, loading, error, refresh, unlinkedCaregiver } = useRecordsData(period);

  // 화면 포커스 시 데이터 재조회
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleItemPress = (key: ItemKey) => {
    navigation.navigate('RecordDetail', { type: key, period });
  };

  // "웹에서 보기" — 이 기기 브라우저로 바로 열기
  const [webLoading, setWebLoading] = useState(false);
  const handleWebOpen = async () => {
    if (webLoading) return;
    setWebLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-web-token');
      if (fnError || !data?.url) throw new Error(fnError?.message || t('records.linkGenFailMsg'));
      // 웹의 로딩 화면은 토큰 교환(계정 확인) 전이라 언어를 모른다 → 앱이 URL 로 알려준다.
      // 없으면 이전 방문 값/브라우저 언어를 써서 영어 사용자에게 한국어 로딩이 보인다.
      const webUrl = String(data.url);
      // ko/en 이분법이면 fr/ja 사용자가 영어 웹을 본다 — 실제 언어를 그대로 싣는다(웹이 4개 언어 지원).
      const lang = (i18n.language || 'en').split('-')[0];
      const urlWithLang = webUrl + (webUrl.includes('?') ? '&' : '?') + `lang=${lang}`;
      await Linking.openURL(urlWithLang);
    } catch (e: any) {
      dialog.alert({ title: t('records.errorTitle'), message: e?.message || t('records.genericRetryMsg') });
    } finally {
      setWebLoading(false);
    }
  };

  // "PC에서 보기" — 6자리 코드 발급 후 안내 모달에 표시
  const [pcModalVisible, setPcModalVisible] = useState(false);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcCode, setPcCode] = useState<string | null>(null);
  const [pcExpiresAt, setPcExpiresAt] = useState<string | null>(null);
  const [pcError, setPcError] = useState<string | null>(null);

  const issuePcCode = useCallback(async () => {
    setPcLoading(true);
    setPcError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-web-token');
      if (fnError || !data?.code) throw new Error(fnError?.message || t('records.pcCodeGenFailMsg'));
      setPcCode(data.code as string);
      setPcExpiresAt((data.expires_at as string) ?? null);
    } catch (e: any) {
      setPcCode(null);
      setPcExpiresAt(null);
      setPcError(e?.message || t('records.pcCodeGenFailMsg2'));
    } finally {
      setPcLoading(false);
    }
  }, []);

  const handlePcOpen = () => {
    setPcCode(null);
    setPcExpiresAt(null);
    setPcError(null);
    setPcModalVisible(true);
    issuePcCode();
  };

  // ── 표시값 계산 (실제 데이터 기반) ─────────────────────────────────────────
  function getDisplayValue(key: ItemKey): { value: string; subLabel?: string } {
    if (!summary) return { value: '-' };

    if (key === 'medication') {
      return { value: `${summary.medication.current}%` };
    }
    if (key === 'bodyState') {
      const entries = Object.values(summary.bodyState);
      if (entries.length === 0) return { value: '-' };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const midLabel = Object.keys(summary.bodyState)[midIdx] ?? '';
      return {
        value: midData.current > 0 ? t('records.pointSuffix', { n: midData.current.toFixed(1) }) : '-',
        subLabel: midLabel ? t('records.basisSuffix', { label: triggerLabelToDisplay(midLabel) }) : undefined,
      };
    }
    if (key === 'mood') {
      const entries = Object.values(summary.mood);
      if (entries.length === 0) return { value: '-' };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const midLabel = Object.keys(summary.mood)[midIdx] ?? '';
      return {
        value: midData.current > 0 ? t('records.pointSuffix', { n: midData.current.toFixed(1) }) : '-',
        subLabel: midLabel ? t('records.basisSuffix', { label: triggerLabelToDisplay(midLabel) }) : undefined,
      };
    }
    if (key === 'sleep') {
      return {
        value: summary.sleep.current > 0 ? t('records.pointSuffix', { n: summary.sleep.current.toFixed(1) }) : '-',
      };
    }
    if (key === 'constipation') {
      return { value: t('records.daysSuffix', { n: summary.constipation.currentDays }) };
    }
    if (key === 'exercise') {
      return {
        value: t('records.exerciseValue', { count: summary.exercise.currentCount, minutes: summary.exercise.currentMinutes }),
      };
    }
    return { value: '-' };
  }

  // ── 변화 정보 계산 (실제 데이터 기반) ──────────────────────────────────────
  function getChangeInfo(key: ItemKey): { text: string; positive: boolean | null } {
    if (!summary) return { text: '', positive: null };
    const prevLabel = prevLabelDisplay(period);

    if (key === 'medication') {
      const diff = summary.medication.current - summary.medication.prev;
      if (diff === 0) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.medUpFromPrev', { prevLabel, diff }), positive: true }
        : { text: t('records.medDownFromPrev', { prevLabel, diff: Math.abs(diff) }), positive: false };
    }
    if (key === 'bodyState') {
      const entries = Object.values(summary.bodyState);
      if (entries.length === 0) return { text: '', positive: null };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const diff = midData.current - midData.prev;
      if (midData.current === 0 && midData.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.scoreUpFromPrev', { prevLabel, diff: diff.toFixed(1) }), positive: true }
        : { text: t('records.scoreDownFromPrevWorse', { prevLabel, diff: Math.abs(diff).toFixed(1) }), positive: false };
    }
    if (key === 'mood') {
      const entries = Object.values(summary.mood);
      if (entries.length === 0) return { text: '', positive: null };
      const midIdx = Math.floor(entries.length / 2);
      const midData = entries[midIdx] ?? entries[0];
      const diff = midData.current - midData.prev;
      if (midData.current === 0 && midData.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.scoreUpFromPrev', { prevLabel, diff: diff.toFixed(1) }), positive: true }
        : { text: t('records.scoreDownFromPrevWorse', { prevLabel, diff: Math.abs(diff).toFixed(1) }), positive: false };
    }
    if (key === 'sleep') {
      const diff = summary.sleep.current - summary.sleep.prev;
      if (summary.sleep.current === 0 && summary.sleep.prev === 0) return { text: '', positive: null };
      if (Math.abs(diff) < 0.01) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.sleepUpFromPrev', { prevLabel, diff: diff.toFixed(1) }), positive: true }
        : { text: t('records.sleepDownFromPrev', { prevLabel, diff: Math.abs(diff).toFixed(1) }), positive: false };
    }
    if (key === 'constipation') {
      const diff = summary.constipation.currentDays - summary.constipation.prevDays;
      if (diff === 0) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.constipationUpFromPrev', { prevLabel, diff }), positive: true }
        : { text: t('records.constipationDownFromPrev', { prevLabel, diff: Math.abs(diff) }), positive: false };
    }
    if (key === 'exercise') {
      const diff = summary.exercise.currentCount - summary.exercise.prevCount;
      if (diff === 0) return { text: t('records.sameAsPrev', { prevLabel }), positive: null };
      return diff > 0
        ? { text: t('records.exerciseUpFromPrev', { prevLabel, diff }), positive: true }
        : { text: t('records.exerciseDownFromPrev', { prevLabel, diff: Math.abs(diff) }), positive: false };
    }
    return { text: '', positive: null };
  }

  // 요약 배너 약 복용률
  const medCurrent = summary?.medication.current ?? 0;
  const medDiff = summary ? summary.medication.current - summary.medication.prev : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('records.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
      />

      {/* 미연동 보호자: 환자 기록 대신 가족 연동 안내만 노출(본인 빈 기록을 환자처럼 보여주지 않음) */}
      {unlinkedCaregiver ? (
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>{t('records.unlinkedTitle')}</Text>
          <Text style={styles.unlinkedDesc}>{t('records.unlinkedDesc')}</Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            onPress={() => navigation.navigate('FamilyLink' as never)}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>{t('records.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>
      {/* 웹에서 보기 */}
      <View style={styles.webRow}>
        <TouchableOpacity
          style={[styles.webBtn, webLoading && styles.webBtnDisabled]}
          onPress={handleWebOpen}
          activeOpacity={0.85}
          disabled={webLoading}
        >
          <Ionicons name="globe-outline" size={20} color={Colors.primary} />
          <Text style={styles.webBtnText}>{t('records.viewOnWeb')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.webBtn}
          onPress={handlePcOpen}
          activeOpacity={0.85}
        >
          <Ionicons name="desktop-outline" size={20} color={Colors.primary} />
          <Text style={styles.webBtnText}>{t('records.viewOnPc')}</Text>
        </TouchableOpacity>
      </View>

      {/* 기간 탭 */}
      <View style={styles.tabRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.tabBtn, period === p && styles.tabBtnActive]}
            onPress={() => setPeriod(p)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabBtnText, period === p && styles.tabBtnTextActive]} numberOfLines={1}>
              {periodLabel(p)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 로딩 / 에러 상태 */}
      {loading && (
        <SkeletonList count={4} visible={loading} style={styles.skeletonWrap} />
      )}
      {!loading && !!error && (
        <View style={styles.stateBox}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>{error}</Text>
        </View>
      )}

      {!loading && !error && !summary && (
        <View style={styles.stateBox}>
          <Ionicons name="bar-chart-outline" size={40} color={Colors.textHint} />
          <Text style={styles.stateText}>{t('records.noDataYet')}</Text>
        </View>
      )}

      {!loading && !error && !!summary && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 요약 배너 */}
          <View style={styles.banner}>
            <Ionicons name="medkit" size={24} color={Colors.primary} />
            <Text style={styles.bannerText}>
              {t('records.medRateBanner', { period: periodLabel(period) })} <Text style={styles.bannerHighlight}>{medCurrent}%</Text>
              {summary && medDiff !== 0
                ? ` ${medDiff >= 0
                    ? t('records.medBannerDiffUp', { prevLabel: prevLabelDisplay(period), diff: Math.abs(medDiff) })
                    : t('records.medBannerDiffDown', { prevLabel: prevLabelDisplay(period), diff: Math.abs(medDiff) })}`
                : ''}
            </Text>
          </View>

          {/* 2열 그리드 */}
          <View style={styles.grid}>
            {ITEM_ROWS.map((rowKeys, ri) => (
              <View key={ri} style={styles.gridRow}>
                {rowKeys.map(key => {
                  const item = ITEMS.find(it => it.key === key)!;
                  const display = getDisplayValue(key);
                  const change = getChangeInfo(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.gridCard}
                      onPress={() => handleItemPress(key)}
                      activeOpacity={0.7}
                    >
                      {/* 헤더 */}
                      <View style={styles.cardHeader}>
                        <View
                          style={[
                            styles.cardIconBg,
                            { backgroundColor: item.accentColor + '20' },
                          ]}
                        >
                          <Ionicons name={item.icon} size={20} color={item.accentColor} />
                        </View>
                        <Text style={styles.cardLabel} numberOfLines={2}>
                          {item.label}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={Colors.textHint}
                        />
                      </View>

                      {/* 값 */}
                      <Text
                        style={[styles.cardValue, { color: item.accentColor }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {display.value}
                      </Text>
                      {display.subLabel ? (
                        <Text style={styles.cardSubLabel}>{display.subLabel}</Text>
                      ) : null}

                      {/* 변화 설명 */}
                      {!!change.text && (
                        <Text
                          style={[
                            styles.cardChange,
                            change.positive === true
                              ? styles.changePos
                              : change.positive === false
                              ? styles.changeNeg
                              : styles.changeNeutral,
                          ]}
                          numberOfLines={2}
                        >
                          {change.text}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {/* 홀수 마지막 행 빈 칸 */}
                {rowKeys.length === 1 && <View style={styles.gridCardPlaceholder} />}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      </>
      )}

      {/* PC에서 보기 — 6자리 코드 안내 모달 */}
      <PcCodeModal
        visible={pcModalVisible}
        code={pcCode}
        expiresAt={pcExpiresAt}
        loading={pcLoading}
        errorMsg={pcError}
        onReissue={issuePcCode}
        onClose={() => setPcModalVisible(false)}
      />

      {/* 웹에서 보기 — 토큰 발급 동안 브랜드 프로그레스 오버레이 */}
      <BrandProgressOverlay
        visible={webLoading}
        title={i18n.t('loading.webPreparing')}
        subtitle={t('records.webBrowserOpeningSoon')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  // ── 웹에서 보기 ──
  webRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: Colors.white,
    gap: 8,
  },
  webBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  webBtnDisabled: { opacity: 0.5 },
  webBtnText: { fontSize: 15, fontWeight: '600', color: Colors.primary },

  // ── 기간 탭 ──
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  // 전역 필터칩 표준 = 영상목록 필터(오너 확정): 작은 알약, padV8/padH18, radius20, 테두리1.5, 선택=초록.
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabBtnText: { fontSize: 16, fontWeight: '600', color: Colors.textSub },
  tabBtnTextActive: { color: Colors.white },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  skeletonWrap: { paddingHorizontal: 16, paddingTop: 16 },

  // ── 요약 배너 ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  bannerText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 26,
  },
  bannerHighlight: {
    color: Colors.primary,
    fontWeight: '800',
  },

  // ── 그리드 ──
  grid: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },

  gridCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  gridCardPlaceholder: { flex: 1 },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardIconBg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },

  cardValue: {
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 2,
  },
  cardSubLabel: {
    fontSize: 16,
    color: Colors.textHint,
    marginBottom: 6,
  },
  cardChange: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
    marginTop: 6,
  },
  changePos: { color: '#388E3C' },
  changeNeg: { color: '#C62828' },
  changeNeutral: { color: Colors.textHint },

  // ── 로딩 / 에러 ──
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  stateText: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },

  // 미연동 보호자 안내(가족 연동 유도)
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  unlinkedTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  unlinkedDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },
  linkFamilyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: 24, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 24,
  },
  linkFamilyBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
