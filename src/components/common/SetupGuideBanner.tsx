/**
 * SetupGuideBanner.tsx
 * 첫 로그인/미등록 유도 배너 — 복용 관리 통합 재설계 B차.
 *
 * 활성 dose_slot 이 0개(setupComplete=false)일 때만 노출. 환자/보호자 모두(그룹 기준, 역할 무관).
 * "복용 시간대를 먼저 등록해 주세요" + [복용 관리로 가기] → 통합 복용 관리 화면.
 *
 * 60대 톤: 큰 글씨/버튼(최소 56dp), 고대비, 아이콘+텍스트, 표준어.
 * 로딩 중이거나 등록 완료면 null 반환(아무것도 안 보임).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { useSetupGate } from '../../hooks/useSetupGate';

export function SetupGuideBanner() {
  const { t } = useTranslation();
  const { setupComplete, setupUnknown, goToManage } = useSetupGate();

  // 판정 불가(로딩/조회 실패)거나 이미 등록 완료면 표시하지 않는다(멀쩡한 사용자에게 안 보임).
  if (setupUnknown || setupComplete) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="alarm-outline" size={28} color={Colors.accent} />
        <Text style={styles.title}>{t('setupGuide.title')}</Text>
      </View>
      <Text style={styles.body}>{t('setupGuide.body')}</Text>
      <TouchableOpacity style={styles.cta} onPress={goToManage} activeOpacity={0.85}>
        <Ionicons name="medkit" size={24} color={Colors.white} />
        <Text style={styles.ctaText}>{t('setupGuide.cta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFF8E1',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.accent,
    padding: 20,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    lineHeight: 28,
  },
  body: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 27,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 56,
  },
  ctaText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.white,
  },
});
