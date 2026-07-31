// OverlaySheet — RN <Modal> 을 대체하는 전체화면 오버레이.
//
// 왜 만들었나:
//   RN <Modal> 은 별도 네이티브 창을 띄운다. 그래서 두 가지가 동시에 깨진다.
//     (1) 그 위에서 화면을 옮겨도 모달이 계속 덮어 "아무 반응 없음"으로 보인다
//     (2) 다른 모달과 겹치면 iOS 에서 둘 다 닫히지 않고 굳는다(오늘 사고 다수)
//   덮는 용도라면 창을 새로 만들 이유가 없다 — 부모 트리 안에서 화면 전체를 덮으면 된다.
//
// <Modal> 을 그대로 바꿔 끼울 수 있게 같은 이름의 props 를 받는다.
//   visible / onRequestClose / animationType
//   (transparent · statusBarTranslucent 등 Modal 전용 속성은 필요 없다.)
//
// ⚠️ onRequestClose 는 안드로이드 하드웨어 뒤로가기다. Modal 이 대신 처리해주던 것이라
//    여기서 직접 BackHandler 로 이어줘야 뒤로가기로 닫는 동작이 유지된다.
import React, { useEffect, useRef, useId } from 'react';
import { View, StyleSheet, BackHandler, Animated, Platform, ViewStyle } from 'react-native';
import { useOverlayHost } from './OverlayHost';

export interface OverlaySheetProps {
  visible: boolean;
  /** 안드로이드 하드웨어 뒤로가기 — Modal 의 onRequestClose 와 같은 역할. */
  onRequestClose?: () => void;
  /** 'fade' 면 부드럽게 나타난다. 'none'/'slide' 는 즉시 표시(슬라이드는 각 화면이 자체 처리). */
  animationType?: 'none' | 'slide' | 'fade';
  /** 겹침 순서를 조정해야 할 때만 사용. */
  style?: ViewStyle;
  children: React.ReactNode;
}

export function OverlaySheet({
  visible,
  onRequestClose,
  animationType = 'fade',
  style,
  children,
}: OverlaySheetProps) {
  const opacity = useRef(new Animated.Value(animationType === 'fade' ? 0 : 1)).current;

  useEffect(() => {
    if (animationType !== 'fade') return;
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [visible, animationType, opacity]);

  // 안드로이드 뒤로가기 — 떠 있는 동안만 가로챈다.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android' || !onRequestClose) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  // 실제 그리기는 앱 루트(OverlayHost)에 맡긴다 — 작은 카드 안에서 열려도 화면 전체를 덮는다.
  const host = useOverlayHost();
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = ++seq;

  const content = (
    <Animated.View
      style={[styles.root, style, animationType === 'fade' ? { opacity } : null]}
      pointerEvents="box-none"
    >
      {children}
    </Animated.View>
  );

  // ⚠️ 의존성 배열이 없으면 매 렌더마다 등록이 일어나고, 그 등록이 다시 렌더를 부르는
  //   무한 루프가 된다(실측: 화면이 버벅이고 스크롤·뒤로가기가 안 먹음).
  //   내용이 실제로 바뀔 때만 다시 등록한다.
  useEffect(() => {
    if (!host) return;
    if (visible) host.mount(idRef.current, content);
    else host.unmount(idRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, visible, children, style, animationType, opacity]);

  // 화면에서 사라질 때 반드시 걷어낸다 — 남으면 보이지 않는 막이 터치를 막는다.
  useEffect(() => {
    const id = idRef.current;
    return () => { host?.unmount(id); };
  }, [host]);

  if (!host) return visible ? content : null;
  return null;
}

let seq = 0;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // 화면 내용 위에 확실히 올라오도록. 팝업(AppDialog, 1000)보다는 아래.
    zIndex: 500,
    elevation: 500,
  },
});
