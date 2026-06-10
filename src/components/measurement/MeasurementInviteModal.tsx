// 약효추적 알림으로 몸상태 기록 직후 표시되는 비강제 컨디션 측정 권유 모달.
//
// 표시 조건(호출측 BodyStateScreen에서 게이트):
//   - 환자 본인(userRole === 'patient')
//   - 약효추적 알림 진입(pendingTriggeredBy === 'notification')
//   - medPhase가 '30m' 또는 '2h' (자율 측정 시점 제외)
//   - 환자 medications에 레보도파 계열이 존재 (비레보도파 단독 환자는 측정 의미 약함)
//   - 게스트 모드 아님 (ensureNotGuest는 호출측에서 별도 처리)
//
// 동작:
//   - [지금 측정]: ensureMeasurementConsent 게이트 통과 후 TapGameScreen 직진입
//     (medPhase + medIntakeId 전달). 미동의 시 ConsentScreen으로.
//   - [다음에]: 단순 닫기.
//
// 디자인: 60대+ 가독성. 본문 17sp 이상, 버튼 56dp 이상, 텍스트+아이콘 함께.

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

interface Props {
  visible: boolean;
  onMeasureNow: () => void;
  onLater: () => void;
}

export function MeasurementInviteModal({ visible, onMeasureNow, onLater }: Props) {
  if (!visible) return null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onLater}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>🖐️</Text>
          <Text style={styles.title}>컨디션 측정 어떠세요?</Text>
          <Text style={styles.body}>
            30초면 끝나요. 천천히 하셔도 돼요.
          </Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={onMeasureNow}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="지금 컨디션 측정 시작"
          >
            <Ionicons name="hand-left" size={22} color={Colors.white} />
            <Text style={styles.primaryBtnText}>지금 측정</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onLater}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="다음에 측정"
          >
            <Text style={styles.secondaryBtnText}>다음에</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 44, marginBottom: 10 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 14,
    textAlign: 'center',
    lineHeight: 30,
  },
  body: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 24,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    width: '100%',
    borderRadius: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
  secondaryBtn: {
    minHeight: 52,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  secondaryBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textSub,
  },
});
