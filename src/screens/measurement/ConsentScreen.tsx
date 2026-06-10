// 디지털 바이오마커 MVP-A Phase 1 — 첫 측정 동의 화면 (§9.6 + §11)
// 60대+ UI: 본문 18sp+, 버튼 56dp+, 아이콘+텍스트, 색+상태텍스트 동반.
// 동의 시 AsyncStorage 키 measurement_consent_v1 저장 → 두 번째 진입부터 자동 통과.
// 거부 시 이전 화면으로 돌아감(측정 진입 차단).

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { MEASUREMENT_CONSENT_STORAGE_KEY } from '../../utils/measurementConsent';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = StackNavigationProp<RootStackParamList, 'MeasurementConsent'>;
type RouteProps = RouteProp<RootStackParamList, 'MeasurementConsent'>;

export function ConsentScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  // Phase 4 — 알림 액션 '바로 측정하기' 진입 시 동의 완료 후 자동 진입할 후속 라우트
  const next = route.params?.next ?? null;
  const [agreed, setAgreed] = useState(false);

  const handleAgree = async () => {
    if (!agreed) return;
    try {
      await AsyncStorage.setItem(MEASUREMENT_CONSENT_STORAGE_KEY, 'true');
    } catch (e) {
      console.warn('[ConsentScreen] AsyncStorage 저장 실패:', e);
    }
    // Phase 4 — next가 있으면 동의 완료 후 측정 화면으로 자동 replace 진입.
    // (replace로 ConsentScreen을 스택에서 빼서 측정 후 뒤로가기 시 동의 화면이 다시 안 보이게)
    if (next) {
      if (next.screen === 'MeasurementMenu') {
        navigation.replace('MeasurementMenu');
      } else {
        navigation.replace(next.screen, next.params);
      }
      return;
    }
    // 명시 next 없으면 기존 동작: 이전 화면 복귀.
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handleDecline = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerEmoji}>🖐️</Text>
          <Text style={styles.title}>측정 시작 전 한 가지만요</Text>
          <Text style={styles.subtitle}>
            손가락·반응 체크는{'\n'}일상 변화를 보는 기록이에요.
          </Text>
        </View>

        {/* 디스클레이머 카드 (스펙 §11.1 정확 문안) */}
        <View style={styles.disclaimerCard}>
          <View style={styles.disclaimerHeader}>
            <Ionicons name="information-circle" size={24} color="#F57C00" />
            <Text style={styles.disclaimerTitle}>꼭 알아두실 점</Text>
          </View>
          <Text style={styles.disclaimerBody}>
            본 측정 기능은 의료기기가 아닙니다. 측정 결과는 일상 변화 기록을 돕기 위한 참고 정보이며, 파킨슨병의 진단·치료·예방·예후 판정을 목적으로 하지 않습니다. 증상 변화에 대한 의학적 판단과 약물 조정은 반드시 담당 의료진과 상담하시기 바랍니다.
          </Text>
        </View>

        {/* 데이터 처리 안내 카드 */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="people-outline" size={22} color={Colors.primary} />
            <Text style={styles.infoText}>
              측정 기록은 본인과 연결된 보호자만 볼 수 있어요.
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={22} color={Colors.primary} />
            <Text style={styles.infoText}>
              상세한 원본 측정 기록은 6개월 후 자동 삭제돼요.
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name="stopwatch-outline" size={22} color={Colors.primary} />
            <Text style={styles.infoText}>1분 안에 끝나요.</Text>
          </View>
        </View>

        {/* 동의 체크 */}
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setAgreed(!agreed)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            {agreed && (
              <Ionicons name="checkmark" size={22} color={Colors.white} />
            )}
          </View>
          <Text style={styles.checkLabel}>
            위 내용을 읽었고, 동의해요
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 하단 버튼 영역 */}
      <View style={styles.bottomArea}>
        <TouchableOpacity
          style={[styles.agreeBtn, !agreed && styles.agreeBtnDisabled]}
          onPress={handleAgree}
          activeOpacity={agreed ? 0.85 : 1}
          disabled={!agreed}
        >
          <Ionicons
            name="checkmark-circle"
            size={24}
            color={agreed ? Colors.white : '#F5F5F5'}
            style={styles.agreeBtnIcon}
          />
          <Text style={[styles.agreeBtnText, !agreed && styles.agreeBtnTextDisabled]}>
            동의하고 시작하기
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.declineBtn}
          onPress={handleDecline}
          activeOpacity={0.7}
        >
          <Text style={styles.declineBtnText}>다음에 할게요</Text>
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
  scroll: { flex: 1 },
  scrollContent: {
    padding: 24,
    paddingBottom: 16,
  },

  /* 헤더 */
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 8,
  },
  headerEmoji: {
    fontSize: 56,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 28,
  },

  /* 디스클레이머 카드 */
  disclaimerCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  disclaimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  disclaimerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F57C00',
  },
  disclaimerBody: {
    fontSize: 18,
    lineHeight: 28,
    color: Colors.text,
  },

  /* 데이터 처리 안내 카드 */
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  infoText: {
    fontSize: 18,
    color: Colors.text,
    flex: 1,
    lineHeight: 26,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  /* 동의 체크 */
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    flexShrink: 0,
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkLabel: {
    fontSize: 18,
    color: Colors.text,
    flex: 1,
    lineHeight: 26,
    fontWeight: '600',
  },

  /* 하단 버튼 영역 */
  bottomArea: {
    padding: 24,
    paddingBottom: 32,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  agreeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 60,
    marginBottom: 12,
    gap: 8,
  },
  agreeBtnDisabled: {
    backgroundColor: '#BDBDBD',
  },
  agreeBtnIcon: { marginRight: 2 },
  agreeBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  agreeBtnTextDisabled: { color: '#F5F5F5' },
  declineBtn: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
});
