// OverlayHost — 오버레이를 "앱 최상단"에서 그리게 해주는 통로.
//
// 왜 필요한가:
//   RN <Modal> 은 어디에 놓든 화면 전체를 덮었다. 그런데 절대배치(absolute)는
//   **가장 가까운 부모 안에서만** 퍼진다. 그래서 <Modal> 을 그냥 오버레이로 바꾸면,
//   작은 카드 안에서 열리는 시트가 그 카드 크기로 잘려버린다(실측: 알림음 선택 시트가
//   복용 시간대 카드 안에 갇힘).
//
// ⚠️ 상태를 Provider 에 두면 안 된다.
//   Provider 의 state 가 바뀌면 그 children(=앱 전체)이 다시 렌더된다. 그런데 오버레이
//   등록 자체가 렌더 중에 일어나므로 → 등록 → 앱 전체 렌더 → 다시 등록 … 무한 루프가 된다.
//   실제로 이 때문에 화면이 버벅이고 스크롤·뒤로가기가 안 먹었다(약관 화면에서 발견).
//   그래서 구독(subscribe) 방식으로 바꿔, **오버레이가 그려지는 뷰만** 다시 렌더되게 한다.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';

type Entry = { id: number; node: React.ReactNode };
type Listener = () => void;

class OverlayStore {
  private entries: Entry[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(): Entry[] {
    return this.entries;
  }

  mount(id: number, node: React.ReactNode): void {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i >= 0) this.entries = [...this.entries.slice(0, i), { id, node }, ...this.entries.slice(i + 1)];
    else this.entries = [...this.entries, { id, node }];
    this.emit();
  }

  unmount(id: number): void {
    if (!this.entries.some((e) => e.id === id)) return; // 없으면 알릴 것도 없다
    this.entries = this.entries.filter((e) => e.id !== id);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

const OverlayCtx = createContext<OverlayStore | null>(null);

/** 오버레이가 실제로 그려지는 뷰. 여기만 다시 렌더된다(앱 전체가 아니라). */
function OverlayOutlet({ store }: { store: OverlayStore }) {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  const entries = store.get();
  if (entries.length === 0) return null; // 아무것도 없을 땐 뷰 자체를 두지 않는다
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {entries.map((e) => (
        <View key={e.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {e.node}
        </View>
      ))}
    </View>
  );
}

/** 앱 루트에 한 번 감싸면, 어디서 연 오버레이든 화면 전체를 덮는다. */
export function OverlayHostProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<OverlayStore | null>(null);
  if (!storeRef.current) storeRef.current = new OverlayStore();
  const store = storeRef.current;
  // store 는 절대 바뀌지 않으므로 children 이 이것 때문에 다시 렌더되는 일이 없다.
  const value = useMemo(() => store, [store]);
  return (
    <OverlayCtx.Provider value={value}>
      {children}
      <OverlayOutlet store={store} />
    </OverlayCtx.Provider>
  );
}

export function useOverlayHost(): OverlayStore | null {
  return useContext(OverlayCtx);
}
