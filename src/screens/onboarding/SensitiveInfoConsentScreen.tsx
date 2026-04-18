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
import type { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Nav = StackNavigationProp<OnboardingStackParamList, 'SensitiveInfoConsent'>;

export function SensitiveInfoConsentScreen() {
  const navigation = useNavigation<Nav>();
  const [agreed, setAgreed] = useState(false);

  const handleAgree = async () => {
    if (!agreed) return;
    await AsyncStorage.setItem('sensitive_info_consented', 'true');
    navigation.replace('FamilyCheck');
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
          <Ionicons name="shield-checkmark" size={48} color={Colors.primary} />
          <Text style={styles.title}>건강 정보 수집 동의</Text>
          <Text style={styles.subtitle}>
            서비스 이용을 위해 아래 건강 정보 수집에{'\n'}동의해 주세요.
          </Text>
        </View>

        {/* 수집 항목 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>수집하는 건강 정보</Text>
          <View style={styles.itemList}>
            {[
              '복용 약물 및 처방 내역',
              '약효 반응 기록',
              '몸 상태 (증상, 운동 기능)',
              '파킨슨병 진단 정보',
            ].map((item) => (
              <View key={item} style={styles.listItem}>
                <View style={styles.bullet} />
                <Text style={styles.listItemText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 처리 방침 카드 */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>수집 목적</Text>
            <Text style={styles.infoValue}>약 복용 관리 및 몸 상태 기록 서비스</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>보유 기간</Text>
            <Text style={styles.infoValue}>회원 탈퇴 시 즉시 삭제</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>제3자 제공</Text>
            <Text style={styles.infoValue}>없음</Text>
          </View>
        </View>

        {/* 민감정보 안내 배너 */}
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={22} color="#F57C00" />
          <Text style={styles.warningText}>
            건강 정보는 민감정보로 분류되어{'\n'}별도 동의가 필요합니다.
          </Text>
        </View>

        {/* 동의 체크박스 */}
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setAgreed(!agreed)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
            {agreed && (
              <Ionicons name="checkmark" size={20} color={Colors.white} />
            )}
          </View>
          <Text style={styles.checkLabel}>
            위 건강 정보 수집 및 이용에 동의합니다.{' '}
            <Text style={styles.required}>(필수)</Text>
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
          <Text style={[styles.agreeBtnText, !agreed && styles.agreeBtnTextDisabled]}>
            동의하고 계속하기
          </Text>
        </TouchableOpacity>
        <Text style={styles.noticeText}>동의하지 않으시면 서비스 이용이 불가합니다.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 16,
  },

  /* 헤더 */
  header: {
    alignItems: 'center',
    marginBottom: 28,
    paddingTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 14,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 28,
  },

  /* 카드 */
  card: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
  },

  /* 리스트 아이템 */
  itemList: {
    gap: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    flexShrink: 0,
  },
  listItemText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
    flex: 1,
  },

  /* 처리 방침 행 */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    width: 80,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 16,
    color: Colors.text,
    flex: 1,
    lineHeight: 24,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  /* 경고 배너 */
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 14,
    gap: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  warningText: {
    fontSize: 16,
    color: '#F57C00',
    lineHeight: 24,
    flex: 1,
  },

  /* 체크박스 행 */
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
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
  },
  required: {
    color: Colors.danger,
    fontWeight: '700',
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
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  agreeBtnDisabled: {
    backgroundColor: '#BDBDBD',
  },
  agreeBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  agreeBtnTextDisabled: {
    color: '#F5F5F5',
  },
  noticeText: {
    fontSize: 14,
    color: Colors.textHint,
    textAlign: 'center',
    lineHeight: 20,
  },
});
