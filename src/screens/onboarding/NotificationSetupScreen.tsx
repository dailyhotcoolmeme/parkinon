import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { requestPermissionsAndSaveToken, scheduleMedicationReminders, scheduleExerciseReminders } from '../../utils/notifications';
import { useSettings, DEFAULT_MED_NOTIFS } from '../../context/SettingsContext';
import type { MedNotif } from '../../context/SettingsContext';
import { buildRecommendedMedNotifs } from '../../utils/recommendUtils';
import { buildSourceMedSignature } from '../../utils/medNotifRecommendationMeta';
import type { DrugClass } from '../../constants/medEffectProfiles';

type Nav = StackNavigationProp<OnboardingStackParamList, 'NotificationSetup'>;

/** 온보딩 약 데이터 형태 (MedicationRegisterScreen이 저장하는 구조) */
interface OnboardingMed {
  name: string;
  dosage?: string;
  times?: string[];
  drugInfo?: { className?: string; itemSeq?: string } | null;
}

/** 화면 상태 분기 */
type ScreenMode =
  | 'levodopa'      // 레보도파 매칭 성공 → 추천 시점
  | 'non_levodopa'  // 약은 있으나 레보도파 0개 → 추적 비대상 안내 + 기본옵션
  | 'no_med'        // 약 0개 → 안내 톤
  | 'fallback';     // 매칭 실패 → 기본 추천 라벨

/** 분(minutes) → 환자 체감 라벨 */
function minutesLabel(m: number): { label: string; desc: string } {
  if (m === 0) return { label: '약 드신 직후', desc: '약을 드신 바로 그때 컨디션을 확인해요' };
  if (m < 60) return { label: `약 드신 ${m}분 후`, desc: '약이 몸에 퍼지기 시작하는 시간이에요' };
  const h = m / 60;
  const hourText = Number.isInteger(h) ? `${h}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return { label: `약 드신 ${hourText} 후`, desc: '약 기운이 가장 잘 도는 시간이에요' };
}

/** 요약 확인용 사람 친화 시점 나열 */
function summaryPhrase(notifs: MedNotif[]): string {
  const on = notifs.filter((n) => n.enabled);
  if (on.length === 0) return '지금은 컨디션 확인 알림을 받지 않아요';
  return on.map((n) => minutesLabel(n.minutes).label.replace('약 드신 ', '복용 ')).join(' · ');
}

export function NotificationSetupScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut, user } = useAuth();
  const { exerciseNotifs, setMedNotifs } = useSettings();
  const { bottom: bottomInset } = useSafeAreaInsets();

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ScreenMode>('fallback');
  const [notifs, setNotifs] = useState<MedNotif[]>(DEFAULT_MED_NOTIFS);
  const [recommendedClasses, setRecommendedClasses] = useState<DrugClass[]>([]);
  const [nonTrackedNotes, setNonTrackedNotes] = useState<string[]>([]);
  const [levodopaItemSeq, setLevodopaItemSeq] = useState<string | null>(null);
  const [levodopaMedName, setLevodopaMedName] = useState<string>('');
  const [showSummary, setShowSummary] = useState(false);
  // 재추천 시그니처 시드용 — 온보딩에서 읽은 약 목록 보관 (§13-6 정합)
  const [loadedMeds, setLoadedMeds] = useState<OnboardingMed[]>([]);

  // ── 진입 시 onboarding_medications 읽어 추천 계산 (§13-2 옵션1) ──
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('onboarding_medications');
        const meds: OnboardingMed[] = raw ? JSON.parse(raw) : [];
        setLoadedMeds(meds ?? []);

        if (!meds || meds.length === 0) {
          setMode('no_med');
          setNotifs(DEFAULT_MED_NOTIFS);
          setReady(true);
          return;
        }

        const result = buildRecommendedMedNotifs(
          meds.map((m) => ({ name: m.name, mfdsClassName: m.drugInfo?.className }))
        );

        // 식약처 원문 링크용: 매칭된 레보도파 약(가능하면 itemSeq 보유) 1개 선택
        const levodopaKeywords = ['시네메트', '퍼킨', '마도파', '레보도파', 'levodopa', 'sinemet', 'madopar', '스타레보', 'stalevo', 'cr정', '서방'];
        const levoMed =
          meds.find((m) => {
            const n = (m.name || '').toLowerCase().replace(/\s+/g, '');
            return levodopaKeywords.some((k) => n.includes(k.toLowerCase())) && m.drugInfo?.itemSeq;
          }) ||
          meds.find((m) => {
            const n = (m.name || '').toLowerCase().replace(/\s+/g, '');
            return levodopaKeywords.some((k) => n.includes(k.toLowerCase()));
          });
        if (levoMed) {
          setLevodopaMedName(levoMed.name);
          setLevodopaItemSeq(levoMed.drugInfo?.itemSeq ?? null);
        }

        if (result.notifs.length > 0) {
          // 레보도파 매칭 성공 → 추천 시점
          setMode('levodopa');
          setNotifs(result.notifs);
          setRecommendedClasses(result.activeClasses);
          setNonTrackedNotes(result.nonTrackedNotes);
        } else if (result.nonTrackedNotes.length > 0) {
          // 약은 있으나 전부 비레보도파 → 추적 비대상 안내 (§7-X.5 상태② "토글 없음")
          // 완전 숨김 대신 기본 OFF: 빈 notifs면 fallback 큐 로직과 일관성 깨질 수 있어
          // 기본 시점은 유지하되 전부 enabled:false로 두고, 원하면 사용자가 켤 수 있게 둔다.
          setMode('non_levodopa');
          setNotifs(DEFAULT_MED_NOTIFS.map((n) => ({ ...n, enabled: false })));
          setNonTrackedNotes(result.nonTrackedNotes);
        } else {
          // 매칭 실패 → 기본 추천
          setMode('fallback');
          setNotifs(DEFAULT_MED_NOTIFS);
        }
      } catch (e) {
        console.warn('[NotificationSetupScreen] 추천 계산 오류:', e);
        setMode('fallback');
        setNotifs(DEFAULT_MED_NOTIFS);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const toggleNotif = (id: string) => {
    setNotifs((prev) =>
      prev.map((n) => (n.id === id ? { ...n, enabled: !n.enabled } : n))
    );
  };

  const enabledCount = notifs.filter((n) => n.enabled).length;

  /** 식약처 원문 직접 보기 (§4-A / 외부 브라우저) */
  const openMfds = () => {
    const url = levodopaItemSeq
      ? `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${levodopaItemSeq}`
      : `https://nedrug.mfds.go.kr/searchDrug?searchYn=true&keyword=${encodeURIComponent(levodopaMedName || '')}`;
    Linking.openURL(url).catch(() => {});
  };

  /** 온보딩 데이터 저장 + medNotifs 반영 + 메타 저장 → 다음 단계 */
  const persistAndContinue = async () => {
    // 1) 기존 onboarding_notifications 호환 저장 (after30/after2h 키 유지)
    const compat: Record<string, boolean> = {
      immediate: notifs.some((n) => n.minutes === 0 && n.enabled),
      after30: notifs.some((n) => n.minutes === 30 && n.enabled),
      after2h: notifs.some((n) => n.minutes === 120 && n.enabled),
    };
    await AsyncStorage.setItem('onboarding_notifications', JSON.stringify(compat));

    // 2) 추천 MedNotif[]를 무손실로 전달 (FamilyInviteScreen 브리지가 그대로 settings_med_notifs로 통과)
    await AsyncStorage.setItem('onboarding_med_notifs', JSON.stringify(notifs));

    // 3) 사용자가 켠 시점만 명시 반영 (자동 강제 아님 — 사용자가 이 화면을 통과하는 명시 동작)
    setMedNotifs(notifs);

    // 4) 추천 메타 저장 (userEdited:false 초기, recommendedFromClasses, sourceMedSignature 시드)
    //    sourceMedSignature 를 온보딩 시점에 시드 → 약 관리 첫 진입 시 불필요한 재추천 제안 방지(§13-6 정합)
    const meta = {
      recommendedFromClasses: recommendedClasses,
      userEdited: false,
      lastAppliedAt: new Date().toISOString(),
      sourceMedSignature: buildSourceMedSignature(
        loadedMeds.map((m) => ({
          name: m.name,
          className: m.drugInfo?.className ?? null,
          dosage: m.dosage ?? null,
        }))
      ),
    };
    await AsyncStorage.setItem('med_notif_recommendation_meta', JSON.stringify(meta));

    // 5) 알림 권한 + 스케줄 (기존 흐름 유지)
    if (user) {
      const { data: { session } } = await (await import('../../lib/supabase')).supabase.auth.getSession();
      const accessToken = session?.access_token;
      await requestPermissionsAndSaveToken(user.id, accessToken);
      await scheduleMedicationReminders();
      await scheduleExerciseReminders(exerciseNotifs);
    }

    navigation.navigate('FamilyInvite');
  };

  // 약 0개 상태에서 다음 단계로 (추적 알림 없이 진행)
  const continueWithoutMeds = async () => {
    await AsyncStorage.setItem(
      'onboarding_notifications',
      JSON.stringify({ immediate: false, after30: false, after2h: false })
    );
    if (user) {
      const { data: { session } } = await (await import('../../lib/supabase')).supabase.auth.getSession();
      const accessToken = session?.access_token;
      await requestPermissionsAndSaveToken(user.id, accessToken);
      await scheduleMedicationReminders();
      await scheduleExerciseReminders(exerciseNotifs);
    }
    navigation.navigate('FamilyInvite');
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>뒤로</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.loadingArea}>
          <Text style={styles.loadingText}>잠시만요...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── 상태 C: 약 0개 (차단이 아닌 안내 톤) ──
  if (mode === 'no_med') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>뒤로</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroArea}>
            <Text style={styles.title}>약을 먼저{'\n'}등록하면 좋아요</Text>
            <Text style={styles.subtitle}>
              복용 후 컨디션 확인 알림은{'\n'}등록하신 약에 맞춰 보내드려요.{'\n\n'}
              지금 약을 등록하시면{'\n'}딱 맞는 시간으로 챙겨드릴게요.
            </Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardText}>
              ⓘ 약은 나중에 설정에서도 등록하실 수 있어요.{'\n'}
              지금 바로 하셔도 되고, 다음에 하셔도 괜찮아요.
            </Text>
          </View>
        </ScrollView>
        <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
          <View style={styles.btnRow}>
            <View style={styles.btnHalf}>
              <PrimaryButton
                title="약 등록하러 가기"
                onPress={() => navigation.navigate('MedicationRegister')}
                variant="primary"
              />
            </View>
            <View style={styles.btnHalf}>
              <PrimaryButton
                title="다음에 할게요"
                onPress={continueWithoutMeds}
                variant="outline"
                style={{ borderColor: Colors.primary }}
              />
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
            <Text style={styles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 요약 확인 1스텝 ──
  if (showSummary) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setShowSummary(false)} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>뒤로</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroArea}>
            <Text style={styles.title}>이렇게{'\n'}받으실 거예요</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLead}>복용 후 컨디션 확인 알림</Text>
            <Text style={styles.summaryValue}>{summaryPhrase(notifs)}</Text>
            <Text style={styles.summaryAsk}>이대로 맞으실까요?</Text>
          </View>
        </ScrollView>
        <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
          <View style={styles.btnRow}>
            <View style={styles.btnHalf}>
              <PrimaryButton
                title="시간 바꿀게요"
                onPress={() => setShowSummary(false)}
                variant="outline"
                style={{ borderColor: Colors.primary }}
              />
            </View>
            <View style={styles.btnHalf}>
              <PrimaryButton
                title="네, 맞아요"
                onPress={persistAndContinue}
                variant="primary"
              />
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
            <Text style={styles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── 메인: 시점 토글 화면 (levodopa / non_levodopa / fallback) ──
  const isBasic = mode === 'fallback' || mode === 'non_levodopa';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContentTop}>
        <View style={styles.heroArea}>
          <Text style={styles.title}>알림을{'\n'}맞춰드릴게요</Text>
          <Text style={styles.subtitle}>
            💊 약 드실 시간(아침·점심·저녁·취침)엔{'\n'}매일 알림이 자동으로 가요.{'\n\n'}
            아래는 약 드신 뒤 컨디션을{'\n'}여쭤보는 알림이에요.
          </Text>
        </View>

        {/* 안심·권한부여 톤 디스클레이머 카드 (§7.4 / §9) */}
        <View style={styles.disclaimerCard}>
          <Text style={styles.disclaimerText}>
            {isBasic
              ? 'ⓘ 미리 맞춰둔 기본 시간이에요. 편하게 바꾸셔도 돼요.'
              : 'ⓘ 등록하신 약에 맞춰 미리 맞춰둔 시간이에요.\n편하게 바꾸셔도 돼요.'}
          </Text>
          <Text style={styles.disclaimerSub}>
            * 일반 참고 안내예요. 환자분 상태에 따라 다를 수 있으니 주치의와 상의해 정해주세요.
          </Text>
        </View>

        {/* 비레보도파 안내 + 안심 문구 */}
        {nonTrackedNotes.length > 0 && (
          <View style={styles.noteCard}>
            {nonTrackedNotes.map((n, i) => (
              <Text key={i} style={styles.noteText}>💬 {n}</Text>
            ))}
            <Text style={styles.noteReassure}>약은 평소대로 잘 챙기시면 돼요.</Text>
          </View>
        )}

        {/* 시점 목록 — 행 전체 탭으로 토글 (손떨림 안전) */}
        <View style={styles.optionList}>
          {notifs.map((n) => {
            const { label, desc } = minutesLabel(n.minutes);
            return (
              <TouchableOpacity
                key={n.id}
                style={[styles.optionCard, n.enabled && styles.optionCardEnabled]}
                onPress={() => toggleNotif(n.id)}
                activeOpacity={0.7}
              >
                <View style={styles.optionInfo}>
                  <Text style={[styles.optionLabel, n.enabled && styles.optionLabelEnabled]}>
                    {label}
                  </Text>
                  <Text style={styles.optionDesc}>{desc}</Text>
                  <Text style={[styles.optionStatus, n.enabled ? styles.optionStatusOn : styles.optionStatusOff]}>
                    {n.enabled ? '받는 중' : '안 받음'}
                  </Text>
                </View>
                <Switch
                  value={n.enabled}
                  onValueChange={() => toggleNotif(n.id)}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                  ios_backgroundColor={Colors.border}
                  style={styles.toggle}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 식약처 원문 — 약한 보조 링크 (18sp 이상, 아이콘+텍스트) */}
        {(mode === 'levodopa' || levodopaMedName) && (
          <TouchableOpacity style={styles.mfdsLink} onPress={openMfds} activeOpacity={0.7}>
            <Text style={styles.mfdsLinkText}>
              📄 식약처에서 이 약 자세히 보기 (인터넷 창이 열려요)
            </Text>
            <Text style={styles.mfdsLinkSub}>
              보고 나면 휴대폰 아래 ◀ 로 돌아오세요
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
        <View style={styles.btnRow}>
          <View style={styles.btnHalf}>
            <PrimaryButton
              title="이대로 받을게요"
              onPress={() => setShowSummary(true)}
              variant="primary"
            />
          </View>
          <View style={styles.btnHalf}>
            <PrimaryButton
              title={enabledCount > 0 ? '시간 바꿀게요' : '그대로 둘게요'}
              onPress={() => setShowSummary(true)}
              variant="outline"
              style={{ borderColor: Colors.primary }}
            />
          </View>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
          <Text style={styles.closeBtnText}>닫기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  backIcon: {
    fontSize: 22,
    color: Colors.text,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
  },
  loadingArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 18,
    color: Colors.textSub,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  scrollContentTop: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
    lineHeight: 38,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 28,
    textAlign: 'center',
  },
  disclaimerCard: {
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
    marginBottom: 16,
  },
  disclaimerText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
    fontWeight: '600',
  },
  disclaimerSub: {
    fontSize: 14,
    color: Colors.textSub,
    lineHeight: 20,
    marginTop: 8,
  },
  noteCard: {
    backgroundColor: Colors.light,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 6,
  },
  noteText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
  },
  noteReassure: {
    fontSize: 18,
    color: Colors.dark,
    fontWeight: '600',
    lineHeight: 26,
    marginTop: 4,
  },
  optionList: {
    gap: 16,
    marginBottom: 20,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    minHeight: 72,
  },
  optionCardEnabled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  optionInfo: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textSub,
  },
  optionLabelEnabled: {
    color: Colors.dark,
  },
  optionDesc: {
    fontSize: 15,
    color: Colors.textSub,
  },
  optionStatus: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  optionStatusOn: {
    color: Colors.primary,
  },
  optionStatusOff: {
    color: Colors.textHint,
  },
  toggle: {
    transform: [{ scaleX: 1.2 }, { scaleY: 1.2 }],
    marginLeft: 12,
  },
  mfdsLink: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  mfdsLinkText: {
    fontSize: 18,
    color: Colors.dark,
    fontWeight: '600',
    lineHeight: 26,
  },
  mfdsLinkSub: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 4,
    lineHeight: 21,
  },
  infoCard: {
    backgroundColor: Colors.light,
    borderRadius: 12,
    padding: 18,
  },
  infoCardText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 27,
  },
  summaryCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    gap: 12,
  },
  summaryLead: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 22,
    color: Colors.dark,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 32,
  },
  summaryAsk: {
    fontSize: 18,
    color: Colors.text,
    marginTop: 4,
  },
  bottomArea: {
    paddingHorizontal: 24,
    gap: 12,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btnHalf: {
    flex: 1,
  },
  closeBtn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
});
