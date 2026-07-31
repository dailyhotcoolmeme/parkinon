// 측정 임상 공신력 설명 — 공용 정보 모달
//
// 손가락 두드리기·반응속도 측정의 "어떤 측정인가요? / 어디에 쓰이나요? / 주의"를
// type에 따라 보여준다. 60대 가독성(글씨 18sp+, 버튼 56dp+) 준수.
//
// 의학 안전 표현 가이드(스펙 §6.6) 준수:
// - 진단·이상·OFF·악화 같은 단어 사용 금지.
// - "UPDRS / Roche / WATCH-PD"는 사실 기반 출처 인용으로 허용.
//
// type별 accent: 탭핑은 녹색(Colors.primary), 반응속도는 주황 #F4A300.
// 스와이프 다운 닫기 + 안드 백버튼 + 배경탭 닫기 지원.

import React, { useEffect } from 'react';
import { OverlaySheet } from '../common/OverlaySheet';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  BackHandler,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';

export type MeasurementInfoType = 'tap' | 'reaction';

export interface MeasurementInfoModalProps {
  visible: boolean;
  type: MeasurementInfoType;
  onClose: () => void;
}

interface InfoContent {
  emoji: string;
  title: string;
  oneLiner: string;
  whatRows: string[];
  whereRows: string[];
  caution: string;
  accent: string;
}

const TAP_ACCENT = Colors.primary; // 녹색
const REACTION_ACCENT = '#F4A300'; // 주황

const CONTENT: Record<MeasurementInfoType, InfoContent> = {
  tap: {
    emoji: '👆',
    title: '손가락 두드리기',
    oneLiner:
      '파킨슨병 표준 평가 척도(UPDRS)를 디지털로 재현한 측정이에요.',
    whatRows: [
      '양손 손가락으로 빠르고 일정하게 두드리는 동작은 통합 파킨슨병 평가 척도(UPDRS)의 표준 항목이에요.',
      '동작 속도와 일정함이 약효 변화에 따라 어떻게 달라지는지 보여줘요.',
    ],
    whereRows: [
      '다국적 제약사 로슈(Roche)·미국 미시간대 등 임상시험에서 같은 방식으로 사용되고 있어요.',
    ],
    caution:
      '객관적인 보조 기록이에요. 진단·치료 판단은 주치의와 상의해주세요.',
    accent: TAP_ACCENT,
  },
  reaction: {
    emoji: '⚡',
    title: '반응속도',
    oneLiner:
      '약효 변동을 가장 민감하게 잡는 지표 중 하나로 알려진 측정이에요.',
    whatRows: [
      '신호가 뜨면 빠르게 반응하는 데 걸리는 시간을 재요.',
      '약효의 시작·유지·떨어짐에 따라 변화가 잘 보이는 지표예요.',
    ],
    whereRows: [
      '미국 파킨슨병 디지털 측정 연구(WATCH-PD) 등 임상시험에서 약효 시간대 변화를 추적할 때 활용돼요.',
    ],
    caution:
      '객관적인 보조 기록이에요. 진단·치료 판단은 주치의와 상의해주세요.',
    accent: REACTION_ACCENT,
  },
};

export function MeasurementInfoModal({
  visible,
  type,
  onClose,
}: MeasurementInfoModalProps) {
  const { translateY, panHandlers, resetPosition } =
    useSwipeDownDismiss(onClose);

  // 재오픈 시 카드 위치 초기화
  useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  // 안드 백버튼 처리
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const content = CONTENT[type];

  return (
    <OverlaySheet visible={visible} onRequestClose={onClose} animationType="fade">
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={styles.centerContainer} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, { transform: [{ translateY }] }]}
          {...panHandlers}
        >
          {/* 스와이프 핸들 */}
          <View style={styles.grabber} />

          {/* 헤더 */}
          <View style={styles.headerWrap}>
            <View
              style={[
                styles.emojiWrap,
                { backgroundColor: withAlpha(content.accent, 0.12) },
              ]}
            >
              <Text style={styles.emoji}>{content.emoji}</Text>
            </View>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={[styles.oneLiner, { color: content.accent }]}>
              {content.oneLiner}
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 어떤 측정인가요? */}
            <View style={styles.sectionBlock}>
              <View
                style={[
                  styles.sectionBadge,
                  { backgroundColor: withAlpha(content.accent, 0.12) },
                ]}
              >
                <Text
                  style={[styles.sectionBadgeText, { color: content.accent }]}
                >
                  어떤 측정인가요?
                </Text>
              </View>
              {content.whatRows.map((row, i) => (
                <View key={`what-${i}`} style={styles.bulletRow}>
                  <Text
                    style={[styles.bulletDot, { color: content.accent }]}
                  >
                    •
                  </Text>
                  <Text style={styles.bulletText}>{row}</Text>
                </View>
              ))}
            </View>

            {/* 어디에 쓰이나요? */}
            <View style={styles.sectionBlock}>
              <View
                style={[
                  styles.sectionBadge,
                  { backgroundColor: withAlpha(content.accent, 0.12) },
                ]}
              >
                <Text
                  style={[styles.sectionBadgeText, { color: content.accent }]}
                >
                  어디에 쓰이나요?
                </Text>
              </View>
              {content.whereRows.map((row, i) => (
                <View key={`where-${i}`} style={styles.bulletRow}>
                  <Text
                    style={[styles.bulletDot, { color: content.accent }]}
                  >
                    •
                  </Text>
                  <Text style={styles.bulletText}>{row}</Text>
                </View>
              ))}
            </View>

            {/* 주의 */}
            <View style={styles.cautionCard}>
              <Text style={styles.cautionLabel}>ⓘ 주의</Text>
              <Text style={styles.cautionText}>{content.caution}</Text>
            </View>
          </ScrollView>

          {/* 닫기 버튼 */}
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: content.accent }]}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="설명 닫기"
          >
            <Text style={styles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </OverlaySheet>
  );
}

/** hex(#RRGGBB) + alpha(0~1) → rgba 문자열 */
function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const full =
    m.length === 3
      ? m
          .split('')
          .map((c) => c + c)
          .join('')
      : m;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  emojiWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emoji: { fontSize: 40 },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  oneLiner: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 4,
  },

  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 8,
  },

  sectionBlock: {
    marginBottom: 16,
  },
  sectionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginBottom: 10,
  },
  sectionBadgeText: {
    fontSize: 16,
    fontWeight: '800',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  bulletDot: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    marginRight: 8,
    marginTop: -2,
  },
  bulletText: {
    flex: 1,
    fontSize: 18,
    lineHeight: 27,
    color: Colors.text,
  },

  cautionCard: {
    backgroundColor: Colors.light,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 6,
  },
  cautionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.dark,
    marginBottom: 6,
  },
  cautionText: {
    fontSize: 17,
    lineHeight: 25,
    color: Colors.text,
  },

  closeBtn: {
    marginTop: 14,
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
});
