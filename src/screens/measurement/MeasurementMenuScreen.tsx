// 디지털 바이오마커 MVP-A Phase 2 — 측정 선택(자율 측정) 메뉴
// 두 가지 카드(손가락 두드리기 / 반응속도) 중 선택 → 동의 확인 → 해당 게임 화면 진입
// 보호자 모드 차단(스펙 §5.3 — 보호자 대리 측정 명시적 제외)

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { ensureMeasurementConsent } from '../../utils/measurementConsent';
import { ensureNotGuest } from '../../utils/guestGuard';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import {
  MeasurementInfoModal,
  type MeasurementInfoType,
} from '../../components/measurement/MeasurementInfoModal';

type Nav = StackNavigationProp<RootStackParamList, 'MeasurementMenu'>;

const TAP_ONE_LINER =
  '파킨슨병 표준 평가 척도(UPDRS)를 디지털로 재현한 측정이에요.';
const REACTION_ONE_LINER =
  '약효 변동을 가장 민감하게 잡는 지표 중 하나로 알려진 측정이에요.';

export function MeasurementMenuScreen() {
  const navigation = useNavigation<Nav>();
  const { user, signOut } = useAuth();
  const dialog = useDialog();

  // 임상 공신력 설명 모달
  const [infoType, setInfoType] = useState<MeasurementInfoType | null>(null);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handlePick = async (
    target: 'TapGame' | 'ReactionGame'
  ) => {
    // 보호자 모드 차단(이중 가드) — 진입점 메뉴에서도 노출하지 않지만, 안전 가드.
    if (user?.role === 'caregiver') return;

    // 게스트(테스트로 둘러보기) 차단
    if (await ensureNotGuest(user, dialog, { signOut })) return;

    const ok = await ensureMeasurementConsent(navigation);
    if (!ok) return;
    navigation.navigate(target, {
      medPhase: 'self_initiated',
    });
  };

  // 보호자는 안내만 노출
  const isCaregiver = user?.role === 'caregiver';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* 상단 바 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>컨디션 측정</Text>
        <View style={styles.topRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>오늘 컨디션을 가볍게 체크해볼까요?</Text>
        <Text style={styles.subHeading}>
          1분 안에 끝나요. 결과는 본인 추세에 쌓여요.
        </Text>

        {isCaregiver ? (
          <View style={styles.caregiverCard}>
            <Ionicons name="information-circle" size={24} color="#F57C00" />
            <Text style={styles.caregiverText}>
              컨디션 측정은 환자 본인만 진행할 수 있어요.
              {'\n'}
              보호자는 환자의 측정 결과만 확인하실 수 있어요.
            </Text>
          </View>
        ) : (
          <>
            {/* 손가락 두드리기 카드 */}
            <View style={styles.gameCardWrap}>
              <TouchableOpacity
                style={styles.gameCard}
                onPress={() => handlePick('TapGame')}
                activeOpacity={0.85}
              >
                <View style={styles.gameIconWrap}>
                  <Text style={styles.gameEmoji}>👆</Text>
                </View>
                <View style={styles.gameTextWrap}>
                  <Text style={styles.gameTitle}>손가락 두드리기</Text>
                  <Text style={styles.gameDesc}>
                    양손 검지로 좌·우 동그라미를{'\n'}
                    10초 동안 번갈아 누르세요
                  </Text>
                  <Text style={styles.credibilityNote}>{TAP_ONE_LINER}</Text>
                  <View style={styles.timeBadge}>
                    <Ionicons name="time-outline" size={16} color={Colors.dark} />
                    <Text style={styles.timeBadgeText}>약 10초</Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={26}
                  color={Colors.textHint}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.infoBtn}
                onPress={() => setInfoType('tap')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="손가락 두드리기 측정 자세히 알아보기"
              >
                <Text style={styles.infoBtnText}>📋 자세히 알아보기</Text>
              </TouchableOpacity>
            </View>

            {/* 반응속도 카드 */}
            <View style={styles.gameCardWrap}>
              <TouchableOpacity
                style={styles.gameCard}
                onPress={() => handlePick('ReactionGame')}
                activeOpacity={0.85}
              >
                <View style={styles.gameIconWrap}>
                  <Text style={styles.gameEmoji}>⚡</Text>
                </View>
                <View style={styles.gameTextWrap}>
                  <Text style={styles.gameTitle}>반응속도</Text>
                  <Text style={styles.gameDesc}>
                    동그라미가 초록색이 되면{'\n'}
                    바로 누르세요 (7번)
                  </Text>
                  <Text style={styles.credibilityNote}>{REACTION_ONE_LINER}</Text>
                  <View style={styles.timeBadge}>
                    <Ionicons name="time-outline" size={16} color={Colors.dark} />
                    <Text style={styles.timeBadgeText}>약 1분</Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={26}
                  color={Colors.textHint}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.infoBtn, styles.infoBtnReaction]}
                onPress={() => setInfoType('reaction')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="반응속도 측정 자세히 알아보기"
              >
                <Text style={[styles.infoBtnText, styles.infoBtnTextReaction]}>
                  📋 자세히 알아보기
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.footnote}>
          ⓘ 측정은 진단이 아니에요. 일상 변화 기록이에요.
        </Text>
      </ScrollView>

      {/* 임상 공신력 설명 모달 */}
      <MeasurementInfoModal
        visible={infoType !== null}
        type={infoType ?? 'tap'}
        onClose={() => setInfoType(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 60,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    gap: 2,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
    fontWeight: '600',
  },
  topTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  topRight: { width: 64 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },

  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 8,
    marginBottom: 8,
  },
  subHeading: {
    fontSize: 18,
    color: Colors.textSub,
    marginBottom: 20,
    lineHeight: 26,
  },

  gameCardWrap: {
    marginBottom: 14,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    minHeight: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  credibilityNote: {
    fontSize: 14,
    color: Colors.textSub,
    lineHeight: 20,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  infoBtn: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  infoBtnReaction: {
    borderColor: '#F4A300',
  },
  infoBtnTextReaction: {
    color: '#F4A300',
  },
  gameIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  gameEmoji: { fontSize: 36 },
  gameTextWrap: { flex: 1 },
  gameTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  gameDesc: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 22,
    marginBottom: 8,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Colors.light,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  timeBadgeText: {
    fontSize: 14,
    color: Colors.dark,
    fontWeight: '600',
  },

  caregiverCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: '#FFE082',
    marginBottom: 20,
  },
  caregiverText: {
    flex: 1,
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
  },

  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 16,
    marginTop: 6,
    minHeight: 72,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recentIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  recentEmoji: { fontSize: 24 },
  recentTextWrap: { flex: 1 },
  recentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  recentDesc: {
    fontSize: 14,
    color: Colors.textSub,
  },

  footnote: {
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
    marginTop: 24,
  },
});
