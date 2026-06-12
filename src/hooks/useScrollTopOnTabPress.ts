import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useNavigation } from '@react-navigation/native';

/**
 * 하단 메인 탭 버튼을 누를 때(다른 탭으로 전환하든, 현재 탭을 다시 누르든)
 * 해당 화면의 스크롤을 항상 맨 위로 리셋한다.
 * - ScrollView(ref.scrollTo) / FlatList·SectionList(ref.scrollToOffset) 모두 지원.
 * - 화면이 탭 직속이든 중첩 스택 안이든 동작하도록 자기/부모/조부모 네비게이터에 모두 구독.
 *   (tabPress 는 탭 네비게이터에서만 발생하므로 나머지 레벨 구독은 호출되지 않아 무해.)
 */
export function useScrollTopOnTabPress(scrollRef: RefObject<any>): void {
  const navigation = useNavigation<any>();

  useEffect(() => {
    const scrollTop = () => {
      const r: any = scrollRef.current;
      if (!r) return;
      if (typeof r.scrollTo === 'function') {
        r.scrollTo({ y: 0, animated: true });
      } else if (typeof r.scrollToOffset === 'function') {
        r.scrollToOffset({ offset: 0, animated: true });
      }
    };

    const navs: any[] = [];
    let nav: any = navigation;
    for (let i = 0; i < 3 && nav; i++) {
      navs.push(nav);
      nav = nav.getParent?.();
    }
    const unsubs = navs
      .map((n) => (typeof n.addListener === 'function' ? n.addListener('tabPress', scrollTop) : null))
      .filter(Boolean) as Array<() => void>;

    return () => unsubs.forEach((u) => u());
  }, [navigation, scrollRef]);
}
