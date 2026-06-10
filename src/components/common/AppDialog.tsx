import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  BackHandler,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';

export type AppDialogButtonStyle =
  | 'default'
  | 'primary'
  | 'cancel'
  | 'destructive';

export interface AppDialogButton {
  text: string;
  /** 'primary'=초록 / 'destructive'=빨강 / 'cancel'=중립 아웃라인 / 'default' */
  style?: AppDialogButtonStyle;
  /** 아이콘은 선택 사항 (텍스트 단독 허용) — 예: '✏️' */
  icon?: string;
  onPress?: () => void;
}

export interface AppDialogProps {
  visible: boolean;
  emoji?: string;
  title?: string;
  /** \n 줄바꿈 지원, 좌측정렬, 18sp 이상 */
  message?: string;
  /** 1~3개, 세로 스택, 각 minHeight 56dp */
  buttons: AppDialogButton[];
  /** 배경탭 / 스와이프다운 / 안드 백버튼 공통 */
  onDismiss: () => void;
  /** 기본 true. false면 배경탭/스와이프/백버튼으로 닫히지 않음 */
  cancelable?: boolean;
  /** 'fade'(기본) | 'slide' */
  animationType?: 'fade' | 'slide';
}

/**
 * 앱 자체 디자인의 범용 다이얼로그.
 *
 * CaregiverConfirmModal의 Modal / 배경딤 / 카드 / 버튼 디자인을 일반화한 것.
 * - DESIGN_SYSTEM 색·radius(24)·제목(22sp Bold)·본문(18sp) 토큰 준수
 * - 60대 타겟: 버튼 세로 스택, 각 minHeight 56dp, 본문 18sp 이상, 고대비
 * - useSwipeDownDismiss로 스와이프 다운 닫기, 안드 하드웨어 백버튼 → onDismiss
 *
 * 명령형 호출은 useDialog()/DialogProvider를 통해 사용한다.
 * 이 컴포넌트는 선언형으로 직접 마운트해서도 쓸 수 있다.
 */
export function AppDialog({
  visible,
  emoji,
  title,
  message,
  buttons,
  onDismiss,
  cancelable = true,
  animationType = 'fade',
}: AppDialogProps) {
  const handleDismiss = () => {
    if (cancelable) onDismiss();
  };

  const { translateY, panHandlers, resetPosition } =
    useSwipeDownDismiss(handleDismiss);

  // 재오픈 시 카드 위치 초기화 (이전 닫힘 애니메이션 잔상 제거)
  useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  // 안드로이드 하드웨어 백버튼 → onDismiss (cancelable일 때만 소비)
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (cancelable) {
        onDismiss();
        return true;
      }
      // cancelable=false면 백버튼 막아서 강제 닫힘 방지
      return true;
    });
    return () => sub.remove();
  }, [visible, cancelable, onDismiss]);

  // 안전장치: 버튼 최대 3개
  const safeButtons = buttons.slice(0, 3);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={handleDismiss}
      statusBarTranslucent
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={handleDismiss}
      />
      <View style={styles.centerContainer} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, { transform: [{ translateY }] }]}
          {...(cancelable ? panHandlers : {})}
        >
          {/* 스와이프 핸들 (시각적 affordance) */}
          {cancelable && <View style={styles.grabber} />}

          {!!emoji && <Text style={styles.emoji}>{emoji}</Text>}
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.btnStack}>
            {safeButtons.map((btn, idx) => {
              const variant = btn.style ?? 'default';
              return (
                <TouchableOpacity
                  key={`${btn.text}-${idx}`}
                  style={[styles.btnBase, btnContainerStyle[variant]]}
                  activeOpacity={0.8}
                  onPress={() => btn.onPress?.()}
                >
                  <Text style={[styles.btnText, btnTextStyle[variant]]}>
                    {btn.icon ? `${btn.icon} ` : ''}
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
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
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    marginBottom: 16,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 10,
  },
  message: {
    // 60대 타겟 최소 본문: 18sp
    fontSize: 18,
    lineHeight: 27,
    color: Colors.text,
    textAlign: 'left',
    alignSelf: 'stretch',
    marginBottom: 24,
  },
  btnStack: {
    width: '100%',
  },
  btnBase: {
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 10,
  },
  btnText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});

// DESIGN_SYSTEM 버튼 토큰 매핑
const btnContainerStyle = StyleSheet.create({
  // 주요 버튼(Primary): 초록 배경
  primary: { backgroundColor: Colors.primary },
  // 삭제/위험: 흰 배경 + 빨강 텍스트 (DESIGN_SYSTEM 삭제 버튼)
  destructive: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.danger },
  // 취소: 중립 아웃라인
  cancel: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.border },
  // 기본: 연한 초록 톤(아웃라인 초록)
  default: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.primary },
});

const btnTextStyle = StyleSheet.create({
  primary: { color: Colors.white },
  destructive: { color: Colors.danger },
  cancel: { color: Colors.textSub },
  default: { color: Colors.primary },
});
