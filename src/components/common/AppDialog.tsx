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
  | 'soft'
  | 'cancel'
  | 'destructive'
  | 'destructiveSolid';

export interface AppDialogButton {
  text: string;
  /** 'primary'=초록 / 'destructive'=빨강 / 'cancel'=중립 아웃라인 / 'default' */
  style?: AppDialogButtonStyle;
  /** 아이콘은 선택 사항 (텍스트 단독 허용) — 예: '✏️' */
  icon?: string;
  /**
   * opt-in 가로 배치 플래그. 연속된 row:true 버튼들은 한 줄에 가로로 나란히
   * (각 flex:1, min 56dp 유지) 렌더된다. 미지정/false면 기존처럼 세로 풀폭.
   * 기존 다이얼로그는 이 플래그를 쓰지 않으므로 세로 스택 동작이 그대로 보존된다.
   */
  row?: boolean;
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

  // 안전장치: 버튼 최대 4개(선택지 3 + 취소/닫기). 그 이상은 60대 가독성 위해 자름.
  const safeButtons = buttons.slice(0, 4);

  // 연속된 row:true 버튼은 가로 한 줄로 묶는다. 나머지는 각자 세로 풀폭.
  // (row 플래그를 안 쓰는 기존 다이얼로그는 전부 길이 1 그룹 → 기존 세로 스택과 동일.)
  const btnGroups: AppDialogButton[][] = [];
  safeButtons.forEach((btn) => {
    const last = btnGroups[btnGroups.length - 1];
    if (btn.row && last && last[0].row) {
      last.push(btn);
    } else {
      btnGroups.push([btn]);
    }
  });

  // ⚠️ RN <Modal> 을 쓰지 않는다.
  //   전역 팝업이라 어떤 화면 위에서든 뜰 수 있어 겹칠 확률이 가장 높다. RN Modal 은 별도
  //   네이티브 창이라 다른 모달과 겹치면 iOS 에서 둘 다 안 닫히고 굳는다(실측 다수).
  //   → 화면 전체를 덮는 절대배치로 렌더한다. DialogHost 가 앱 최상단에 있어 전체를 덮는다.
  //   (화면급 모달을 전부 오버레이로 바꾼 뒤라, 이 팝업이 가려질 일이 없다.)
  if (!visible) return null;
  return (
    <View style={styles.root} pointerEvents="box-none">
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
            {btnGroups.map((group, gIdx) => {
              // 가로 묶음(2개 이상): 한 줄에 flex:1 로 나란히.
              if (group.length > 1) {
                return (
                  <View key={`row-${gIdx}`} style={styles.btnRow}>
                    {group.map((btn, idx) => {
                      const variant = btn.style ?? 'default';
                      return (
                        <TouchableOpacity
                          key={`${btn.text}-${idx}`}
                          style={[
                            styles.btnBase,
                            styles.btnRowItem,
                            idx > 0 && styles.btnRowItemGap,
                            btnContainerStyle[variant],
                          ]}
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
                );
              }
              // 세로 풀폭(기존 동작).
              const btn = group[0];
              const variant = btn.style ?? 'default';
              return (
                <TouchableOpacity
                  key={`${btn.text}-${gIdx}`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  // 앱 최상단을 덮는 팝업 루트 — Modal 대신 쓴다.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
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
  // 가로 묶음 행: 자식 버튼이 화면 절반씩 차지하도록.
  btnRow: {
    flexDirection: 'row',
    width: '100%',
  },
  btnRowItem: {
    flex: 1,
    width: undefined,
  },
  // 가로 묶음 내 버튼 사이 간격(첫 버튼 제외).
  btnRowItemGap: {
    marginLeft: 12,
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
  // 삭제/위험(강조): 빨강 배경 + 흰 텍스트 (꽉 채운 빨강)
  destructiveSolid: { backgroundColor: Colors.danger },
  // 취소: 중립 아웃라인
  cancel: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.border },
  // 기본: 연한 초록 톤(아웃라인 초록)
  default: { backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.primary },
  // soft: primary(초록)와 default(흰) 중간 — 연한 초록 배경
  soft: { backgroundColor: Colors.light },
});

const btnTextStyle = StyleSheet.create({
  primary: { color: Colors.white },
  destructive: { color: Colors.danger },
  destructiveSolid: { color: Colors.white },
  cancel: { color: Colors.textSub },
  default: { color: Colors.primary },
  soft: { color: Colors.dark },
});
