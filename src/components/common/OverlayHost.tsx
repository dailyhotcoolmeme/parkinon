// OverlayHost — 오버레이를 "앱 최상단"에서 그리게 해주는 통로.
//
// 왜 필요한가:
//   RN <Modal> 은 어디에 놓든 화면 전체를 덮었다. 그런데 절대배치(absolute)는
//   **가장 가까운 부모 안에서만** 퍼진다. 그래서 <Modal> 을 그냥 오버레이로 바꾸면,
//   작은 카드 안에서 열리는 시트가 그 카드 크기로 잘려버린다(실측: 알림음 선택 시트가
//   복용 시간대 카드 안에 갇힘).
//
//   그래서 오버레이를 "그 자리"가 아니라 앱 루트로 옮겨서 그린다.
//   React 트리상 위치만 바뀌므로 창을 새로 만들지 않는다 — 겹침 프리즈는 여전히 없다.
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';

type Entry = { id: number; node: React.ReactNode };
type Ctx = { mount: (id: number, node: React.ReactNode) => void; unmount: (id: number) => void };

const OverlayCtx = createContext<Ctx | null>(null);

/** 앱 루트에 한 번 감싸면, 어디서 연 오버레이든 화면 전체를 덮는다. */
export function OverlayHostProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  const mount = useCallback((id: number, node: React.ReactNode) => {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.id !== id);
      return [...rest, { id, node }];
    });
  }, []);

  const unmount = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const api = useMemo(() => ({ mount, unmount }), [mount, unmount]);

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {/* 오버레이가 그려지는 자리 — 앱의 가장 위. box-none 이라 빈 곳의 터치는 아래로 통과한다. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {entries.map((e) => (
          <View key={e.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {e.node}
          </View>
        ))}
      </View>
    </OverlayCtx.Provider>
  );
}

export function useOverlayHost(): Ctx | null {
  return useContext(OverlayCtx);
}
