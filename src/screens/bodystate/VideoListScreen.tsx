import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  ActivityIndicator,
  StatusBar,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import { Video as AVVideo, ResizeMode } from 'expo-av';
import { navigateTo } from '../../navigation/navigationRef';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { resolveMediaUrl, resolveMediaUrlSync, prefetchMediaUrls } from '../../lib/r2Get';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';

function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_WIDTH = 120;
const THUMB_HEIGHT = Math.round(THUMB_WIDTH * (9 / 16));

type FilterType = 'all' | 'this_week' | 'this_month' | 'last_3_months';

interface VideoLog {
  id: string;
  r2_url: string;
  r2_key?: string | null;
  logged_at: string;
  duration_seconds?: number | null;
  source?: string | null;
}

// 영상의 logged_at(UTC ISO) → KST 기준 YYYY-MM-DD (일기 화면 이동용)
function loggedAtToKstDateString(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

interface SectionData {
  title: string;
  data: VideoLog[];
}

// ── 헬퍼 함수들 ──────────────────────────────────────────────────────────────

function formatDateLabel(isoString: string): string {
  const d = new Date(isoString);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (isEnLocale()) {
    const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${month}/${day} (${dayNamesEn[d.getDay()]})`;
  }
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${month}월 ${day}일 (${dayNames[d.getDay()]})`;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  if (isEnLocale()) return `${hour}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}시 ${m.toString().padStart(2, '0')}분`;
}


function getSectionKey(isoString: string): string {
  const d = new Date(isoString);
  if (isEnLocale()) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function groupBySections(logs: VideoLog[]): SectionData[] {
  const map: Map<string, VideoLog[]> = new Map();
  for (const log of logs) {
    const key = getSectionKey(log.logged_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }
  const sections: SectionData[] = [];
  map.forEach((data, title) => sections.push({ title, data }));
  return sections;
}

function getFilterRange(filter: FilterType): { start: string; end: string } | null {
  const now = new Date();
  if (filter === 'all') return null;
  if (filter === 'this_week') {
    const dayOfWeek = now.getDay(); // 0=일, 1=월 ...
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday.toISOString(), end: sunday.toISOString() };
  }
  if (filter === 'this_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
  };
}

// ── 인라인 썸네일 프리뷰 (expo-video) ────────────────────────────────────────

interface VideoPreviewProps {
  uri: string;
  isPlaying: boolean;
  onPreviewPress: () => void;
  durationSeconds?: number | null;
}

function VideoPreview({ uri, isPlaying, onPreviewPress, durationSeconds }: VideoPreviewProps) {
  // 저장값(DB duration_seconds)이 있으면 그 값을 최우선으로 즉시 배지 표시.
  const storedSec = durationSeconds && durationSeconds > 0 ? durationSeconds : null;
  // 저장값이 없는 영상(일기 출처 구버전 등)은 썸네일 플레이어가 마운트 시 로드하는
  // 메타데이터(sourceLoad.duration)에서 길이를 폴백으로 읽어 배지 표시(재생 없이).
  const [metaSec, setMetaSec] = useState<number | null>(null);
  // 재생 중 카운트다운(남은 시간). 정지 상태에서는 저장값/메타 길이로 배지를 표시한다.
  const [remainingSec, setRemainingSec] = useState<number | null>(storedSec);
  // 🔒 비공개(워커) 경유: 캐시 히트면 즉시 워커 URL, 미스면 워커 presigned 발급 후 마운트.
  //    (영상은 비공개 유지 — 공개 URL 즉시 반환 분기는 제거됨.) 같은 key 는 전체화면과 캐시 공유.
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => resolveMediaUrlSync(uri));
  useEffect(() => {
    const s = resolveMediaUrlSync(uri);
    if (s != null) {
      // 캐시 히트: 즉시 확정.
      setResolvedUri(s);
      return;
    }
    // 캐시 미스: 워커 presigned 발급(실패 시 원본 공개 URL 폴백).
    let active = true;
    setResolvedUri(null);
    resolveMediaUrl(uri).then((u) => {
      if (active) setResolvedUri(u || uri);
    });
    return () => {
      active = false;
    };
  }, [uri]);

  const player = useVideoPlayer(resolvedUri ? { uri: resolvedUri } : null, p => {
    p.muted = true;
    p.loop = false;
  });

  // 저장값이 없을 때만 메타 폴백: 썸네일 마운트로 소스 로드가 끝나면(sourceLoad)
  // duration 을 읽어 배지로 표시한다(자동재생 금지 — 음소거 정지 프레임 유지).
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (storedSec != null) return; // 저장값 우선: 메타 무시
    if (typeof duration === 'number' && duration > 0) {
      setMetaSec(Math.round(duration));
    }
  });

  useEffect(() => {
    if (!isPlaying) {
      try { player.pause(); } catch (_) {}
      // 재생 중단 시 남은 시간 유지 (null로 초기화하지 않음)
      return;
    }
    const timer = setTimeout(() => {
      try {
        player.play();
      } catch (err) {
        console.error('[VideoPreview] play error:', err);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [isPlaying]);

  // 재생 중 폴링
  // ⚠️ 남은 시간은 "정지 중에 보이던 길이"를 절대 넘지 않게 상한을 건다.
  //    실제 길이가 22.6초면 Math.round(22.6)=23 이 되어, 저장값 22 를 보고 있던 사용자에게
  //    재생 시작 순간 0:22 → 0:23 으로 1초 늘었다가 줄어드는 것처럼 보였다(오너 제보 2026-07-28).
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      try {
        const pos = player.currentTime ?? 0;
        const dur = player.duration ?? 0;
        if (dur > 0) {
          const cap = storedSec ?? metaSec ?? Math.round(dur);
          setRemainingSec(Math.max(0, Math.min(cap, Math.round(dur - pos))));
        }
      } catch (_) {}
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, storedSec, metaSec]);

  function formatRemaining(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // 배지에 표시할 길이(초):
  //  - 재생 중: 폴링이 갱신하는 remainingSec(남은 시간 카운트다운).
  //    단 재생 시작 직후 첫 폴링 전엔 remainingSec 이 아직 유효하지 않을 수 있어
  //    그 사이 빈 프레임(배지 깜빡임)이 생긴다 → storedSec ?? metaSec 로 메워 깜빡임 제거.
  //  - 정지 중: 저장값 > 메타 폴백 > 직전 폴링값 순. 못 구하면 null(배지 숨김)
  const displaySec = isPlaying
    ? (remainingSec ?? storedSec ?? metaSec)
    : (storedSec ?? metaSec ?? remainingSec);

  return (
    <View style={thumbStyles.container}>
      <VideoView
        player={player}
        style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 8 }}
        nativeControls={false}
        contentFit="cover"
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        surfaceType="textureView"
        pointerEvents="none"
      />
      <TouchableOpacity
        style={thumbStyles.overlay}
        onPress={onPreviewPress}
        activeOpacity={0.85}
      >
        {/* 정지 상태일 때만 play 아이콘 표시 */}
        {!isPlaying && (
          <Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.85)" />
        )}
        {/* 정지/재생 모두 남은 시간(또는 전체 길이) 표시. 길이 미확보 시 숨김(깜빡임 방지). */}
        {displaySec !== null && (
          <View style={thumbStyles.countdownBadge}>
            <Text style={thumbStyles.countdownText}>{formatRemaining(displaySec)}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const thumbStyles = StyleSheet.create({
  container: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
  },
  overlay: {
    position: 'absolute',
    top: 0, left: 0,
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countdownText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

// ── 영상 카드 ─────────────────────────────────────────────────────────────────

interface VideoCardProps {
  item: VideoLog;
  onPress: (item: VideoLog) => void;
  onDelete: (item: VideoLog) => void;
  previewingId: string | null;
  onPreviewPress: (item: VideoLog) => void;
  onOpenDiary: (item: VideoLog) => void;
}

function VideoCard({ item, onPress, onDelete, previewingId, onPreviewPress, onOpenDiary }: VideoCardProps) {
  const { t } = useTranslation();
  const isDiary = item.source === 'diary';
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.topRow}>
        {/* 썸네일: 탭 → 인라인 재생 */}
        <View style={cardStyles.thumb}>
          <VideoPreview
            uri={item.r2_url}
            isPlaying={previewingId === item.id}
            onPreviewPress={() => onPreviewPress(item)}
            durationSeconds={item.duration_seconds}
          />
        </View>
        {/* 텍스트 영역: 탭 → 전체화면 재생 */}
        <TouchableOpacity
          style={cardStyles.info}
          onPress={() => item.r2_url && onPress(item)}
          activeOpacity={0.7}
        >
          <Text style={cardStyles.dateText}>{formatDateLabel(item.logged_at)}</Text>
          <Text style={cardStyles.timeText}>{formatTime(item.logged_at)}</Text>
          {isDiary && (
            <View style={cardStyles.diaryRow}>
              <View style={cardStyles.diaryBadge}>
                <MaterialCommunityIcons name="notebook-edit-outline" size={14} color={Colors.primary} />
                <Text style={cardStyles.diaryBadgeText}>{t('videoList.diaryBadge')}</Text>
              </View>
              <TouchableOpacity
                style={cardStyles.diaryLink}
                onPress={() => onOpenDiary(item)}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={cardStyles.diaryLinkText}>{t('videoList.diaryViewLink')}</Text>
                <Ionicons name="chevron-forward" size={15} color={Colors.textSub} />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={cardStyles.deleteBtn}
          onPress={() => onDelete(item)}
          activeOpacity={0.7}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Ionicons name="trash-outline" size={22} color="#F44336" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  thumb: { position: 'relative', flexShrink: 0 },
  info: { flex: 1, gap: 4, justifyContent: 'center' },
  dateText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  timeText: { fontSize: 18, color: Colors.textSub, fontWeight: '500' },
  deleteBtn: { padding: 8, flexShrink: 0 },
  diaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  diaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Colors.light,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  diaryBadgeText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  diaryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    backgroundColor: 'transparent',
  },
  diaryLinkText: { fontSize: 14, fontWeight: '600', color: Colors.textSub },
});

// ── 풀스크린 플레이어 (expo-av + 네이티브 컨트롤) ──────────────────────────
// ⚠️ expo-video 전환 후 자동재생이 깨지는 회귀로 expo-av 로 복귀(재생 안정성 최우선).
//    <AVVideo useNativeControls shouldPlay> 가 자동재생을 확실히 보장하며,
//    네이티브 컨트롤이 재생바·seek·시간표시를 제공한다.
//    expo-av useNativeControls 특성상 우측 하단 "전체화면" 버튼이 다시 노출되지만
//    재생 안정성을 우선해 감수한다(오너 합의).
//    safe-area 보정(insetTop/insetBottom, navigationBarTranslucent={false},
//    상단 닫기버튼 paddingTop, 하단 안드 내비바 padding)은 그대로 유지한다.

interface VideoPlayerModalProps {
  url: string | null;
  onClose: () => void;
  // 모달 밖(루트 SafeAreaProvider)에서 구한 safe-area inset.
  // RN <Modal> 은 안드에서 별도 윈도우라 내부 useSafeAreaInsets() 의 bottom 이
  // 0/부정확하게 나와 paddingBottom 이 안 먹는 함정이 있다 → 부모에서 받아 쓴다.
  insetTop: number;
  insetBottom: number;
}

// 안드 3버튼 내비바 높이 추정(모달 내부 inset 이 0 으로 떨어질 때의 fallback).
// screen 높이 - window 높이 = (상태바 + 내비바). statusBarTranslucent 모달이라
// 상태바를 분리하기 어려우므로 보수적으로 적정 하단 여백(48dp)을 하한으로 둔다.
function estimateAndroidNavBarPad(insetBottom: number): number {
  if (Platform.OS !== 'android') return insetBottom;
  const screenH = Dimensions.get('screen').height;
  const windowH = Dimensions.get('window').height;
  const diff = Math.max(0, Math.round(screenH - windowH));
  // diff 가 너무 작으면(제스처 내비/측정 실패) 부모 inset 사용, 그래도 0 이면 48dp 하한.
  const candidate = Math.max(insetBottom, diff > 0 ? Math.min(diff, 60) : 0);
  return candidate > 0 ? candidate : 48;
}

function VideoPlayerModal({ url, onClose, insetTop, insetBottom }: VideoPlayerModalProps) {
  const { t } = useTranslation();
  // 모달 밖에서 받은 inset 을 신뢰. 안드에서 0 으로 떨어지면 내비바 높이 추정으로 보강.
  const bottomPad = estimateAndroidNavBarPad(insetBottom);
  const videoRef = useRef<AVVideo>(null);
  // 🔒 비공개(워커) 경유: 캐시 히트면 finalUrl 즉시 채워져 스피너 없이 자동재생,
  //    미스면 짧은 스피너 후 워커 presigned URL 로 마운트(shouldPlay 로 자동재생).
  //    리스트 썸네일이 먼저 같은 key 를 발급해 두면 전체화면은 캐시 히트로 즉시 뜬다.
  const [finalUrl, setFinalUrl] = useState<string | null>(() => (url ? resolveMediaUrlSync(url) : null));
  useEffect(() => {
    if (!url) {
      setFinalUrl(null);
      return;
    }
    const s = resolveMediaUrlSync(url);
    if (s != null) {
      setFinalUrl(s);
      return;
    }
    let active = true;
    setFinalUrl(null);
    resolveMediaUrl(url).then((u) => {
      if (active) setFinalUrl(u || url);
    });
    return () => {
      active = false;
    };
  }, [url]);

  // ⚠️ 전체화면 플레이어는 상태바를 검정+밝은아이콘으로 바꾼다. 닫을 때 되돌리지 않으면
  //   흰 배경 화면에서 흰 아이콘이 되어 시계·와이파이·배터리가 안 보인다(오너 제보 2026-07-27).
  //   RN <StatusBar> 언마운트 복원에만 맡기지 말고 명시적으로 App.tsx 기본값으로 되돌린다.
  useEffect(() => {
    if (!url) return;
    return () => {
      StatusBar.setBarStyle('dark-content');
      if (Platform.OS === 'android') StatusBar.setBackgroundColor('#FFFFFF');
    };
  }, [url]);

  const handleClose = () => {
    // expo-av: 닫기 시 명시적으로 일시정지·언로드(백그라운드 재생/리소스 누수 방지).
    (async () => {
      try {
        await videoRef.current?.pauseAsync();
      } catch (_) {}
      try {
        await videoRef.current?.unloadAsync();
      } catch (_) {}
    })();
    onClose();
  };

  return (
    <Modal
      visible={url !== null}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent={false}
      onRequestClose={handleClose}
    >
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      {/* RN <Modal> 은 안드에서 별도 윈도우라 내부 useSafeAreaInsets() 가 0/부정확.
          → 부모(모달 밖)에서 받은 insetTop/insetBottom 을 직접 사용한다.
          또한 navigationBarTranslucent={false} 로 모달 윈도우가 내비바를 침범하지 않게 해
          영상·네이티브 컨트롤(스크러버)이 안드 3버튼 내비바에 가리지 않게 한다.
          - 상단 닫기 버튼: paddingTop=insetTop → 노치/다이나믹아일랜드 아래에 위치
          - 하단 paddingBottom=bottomPad → 스크러버가 안드 3버튼/홈인디케이터 위로 올라옴 */}
      <View
        style={[
          playerStyles.container,
          { paddingTop: insetTop, paddingBottom: bottomPad },
        ]}
      >
        <View style={[playerStyles.header, { top: insetTop }]}>
          <TouchableOpacity style={playerStyles.closeBtn} onPress={handleClose} activeOpacity={0.8}>
            <Ionicons name="close" size={26} color="#fff" />
            <Text style={playerStyles.closeText}>{t('videoList.closeBtn')}</Text>
          </TouchableOpacity>
        </View>

        {/* presigned 해결 전에는 스피너, 해결되면 finalUrl 하나로 AVVideo 를 마운트.
            shouldPlay 로 자동재생을 보장(expo-video 와 달리 확실히 동작), useNativeControls 가
            재생바·시킹을 제공. useNativeControls 특성상 우측 하단 "전체화면" 버튼이 노출되나
            재생 안정성을 우선해 그대로 둔다. */}
        {finalUrl ? (
          <AVVideo
            ref={videoRef}
            source={{ uri: finalUrl }}
            useNativeControls
            shouldPlay
            resizeMode={ResizeMode.CONTAIN}
            style={playerStyles.video}
          />
        ) : (
          url && (
            <View style={playerStyles.loadingOverlay}>
              <ActivityIndicator size="large" color={Colors.white} />
              <Text style={playerStyles.loadingText}>{i18n.t('loading.loadingVideo')}</Text>
            </View>
          )
        )}
      </View>
    </Modal>
  );
}

const playerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    // top 은 인라인으로 insets.top 적용(노치/다이나믹아일랜드 아래)
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },
  closeText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  video: {
    // flex 로 container 의 padding(top=insets.top / bottom=insets.bottom) 안쪽을 채운다.
    // 일기 FullscreenVideoModal 과 동일 — 네이티브 컨트롤(스크러버)이 영상 뷰 하단에
    // 그려지므로 영상 영역이 시스템 바를 침범하지 않아야 컨트롤이 안 가린다.
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 20,
  },
  loadingText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
});

// ── 메인 화면 ─────────────────────────────────────────────────────────────────

function getFilters(t: (k: string) => string): { key: FilterType; label: string }[] {
  return [
    { key: 'all', label: t('videoList.filterAll') },
    { key: 'this_week', label: t('videoList.filterWeek') },
    { key: 'this_month', label: t('videoList.filterMonth') },
    { key: 'last_3_months', label: t('videoList.filter3Month') },
  ];
}

export function VideoListScreen() {
  const { t } = useTranslation();
  const FILTERS = getFilters(t);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const [filter, setFilter] = useState<FilterType>('all');
  const [excludeDiary, setExcludeDiary] = useState(false);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [loading, setLoading] = useState(false);
  // 미연동 보호자: 보호자인데 연동 환자 없음(해석 완료 후). 본인 빈 목록을 환자처럼 보여주지 않음.
  const [unlinkedCaregiver, setUnlinkedCaregiver] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fabExpanded, setFabExpanded] = useState(true);
  const lastScrollY = useRef(0);
  // 진행 중인(in-flight) 동일 조회 키 — 포커스 재발화 + 필터 변경 직접호출 등 중복 동시호출만 차단.
  const fetchInFlightKey = useRef<string | null>(null);

  const handleScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY > lastScrollY.current && currentY > 60) {
      setFabExpanded(false);
    } else if (currentY < lastScrollY.current) {
      setFabExpanded(true);
    }
    lastScrollY.current = currentY;
  };

  const fetchVideos = useCallback(async (f: FilterType, excludeDiaryArg: boolean) => {
    // 중복 동시호출 가드: 같은 (필터×일기제외) 조합 조회가 이미 진행 중이면 스킵.
    // (포커스 재발화 + handleFilterChange 직접호출이 같은 키로 겹치는 중복만 차단.
    //  다른 조합은 통과 → 필터 전환·갱신 동작 자체는 유지.)
    const reqKey = `${f}|${excludeDiaryArg}`;
    if (fetchInFlightKey.current === reqKey) return;
    fetchInFlightKey.current = reqKey;
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('role, patient_group_id')
        .eq('id', user.id)
        .single();

      // ⚠️ 미연동 보호자는 절대 user.id 로 폴백하지 않는다(본인 빈 영상 목록을 환자처럼 보여주는 버그).
      let patientId: string | null = userData?.role === 'caregiver' ? null : user.id;

      if (userData?.role === 'caregiver' && userData?.patient_group_id) {
        const { data: member } = await supabase
          .from('patient_group_members')
          .select('user_id')
          .eq('group_id', userData.patient_group_id)
          .eq('role', 'patient')
          .single();
        if (member?.user_id) patientId = member.user_id;
      }

      // 보호자인데 연동 환자가 없으면 조회하지 않고 안내 카드로 전환.
      if (!patientId) {
        setUnlinkedCaregiver(true);
        setSections([]);
        return;
      }
      setUnlinkedCaregiver(false);

      let query = supabase
        .from('media_logs')
        .select('id, r2_url, r2_key, logged_at, duration_seconds, source')
        .eq('patient_id', patientId)
        .eq('media_type', 'video')
        .eq('category', 'body_state')
        .order('logged_at', { ascending: false });

      // '일기 기록 영상 제외' 체크 시 source='diary' 행 숨김 (수동 저장분만 표시)
      if (excludeDiaryArg) {
        query = query.neq('source', 'diary');
      }

      const range = getFilterRange(f);
      if (range) {
        query = query.gte('logged_at', range.start).lte('logged_at', range.end);
      }

      const { data, error: queryError } = await query;
      if (queryError) console.error('[VideoListScreen] 조회 오류:', queryError);
      const logs = (data as VideoLog[]) ?? [];
      setSections(groupBySections(logs));
      // 🔒 비공개(워커) 경유 유지: 리스트 로드 직후 영상들의 워커 presigned URL 을
      //    병렬로 미리 발급해 캐시에 채워둔다(동시성 제한). 썸네일·전체화면이 캐시 히트로 즉시 뜸.
      //    기존 캐시/in-flight 합치기 로직이 중복 발급·레이스를 막으며, 실패는 조용히 무시(백그라운드).
      prefetchMediaUrls(logs.map((l) => l.r2_url));
    } catch (e) {
      console.error('[VideoListScreen] fetchVideos 오류:', e);
    } finally {
      setLoading(false);
      if (fetchInFlightKey.current === reqKey) fetchInFlightKey.current = null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchVideos(filter, excludeDiary);
    }, [fetchVideos, filter, excludeDiary])
  );

  const handleFilterChange = (f: FilterType) => {
    setFilter(f);
    fetchVideos(f, excludeDiary);
  };

  const handleToggleExcludeDiary = () => {
    const next = !excludeDiary;
    setExcludeDiary(next);
    fetchVideos(filter, next);
  };

  const handleOpenDiary = (item: VideoLog) => {
    navigateTo('Diary', { date: loggedAtToKstDateString(item.logged_at) });
  };

  const handleCardPress = (item: VideoLog) => {
    if (!item.r2_url) return;
    setPreviewingId(null);
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    setPlayingUrl(item.r2_url);
  };

  const handlePreviewPress = (item: VideoLog) => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    // 이미 재생 중이면 정지, 아니면 이 영상 재생 (다른 영상은 자동 정지)
    setPreviewingId(prev => (prev === item.id ? null : item.id));
  };

  const handleDelete = async (item: VideoLog) => {
    const ok = await dialog.confirm({
      title: t('videoList.deleteVideoTitle'),
      message: t('videoList.deleteVideoMsg'),
      confirmText: t('videoList.delete'),
      cancelText: t('videoList.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      if (item.r2_key) {
        // R2 파일 + DB 행을 Edge Function으로 함께 삭제
        const { error: efError } = await supabase.functions.invoke('delete-r2-file', {
          body: { r2_key: item.r2_key, media_log_id: item.id },
        });
        if (efError) {
          console.error('[VideoListScreen] R2 삭제 오류:', efError);
          // Edge Function 실패 시 DB 행만 삭제 (fallback)
          const { error: dbError } = await supabase.from('media_logs').delete().eq('id', item.id);
          if (dbError) throw dbError;
        }
      } else {
        // r2_key 없으면 DB 행만 삭제
        const { error } = await supabase.from('media_logs').delete().eq('id', item.id);
        if (error) throw error;
      }
      fetchVideos(filter, excludeDiary);
    } catch (e) {
      console.error('[VideoListScreen] 삭제 오류:', e);
      dialog.alert({ title: t('videoList.deleteFailTitle'), message: t('videoList.deleteFailMsg') });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('videoList.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      {unlinkedCaregiver ? (
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>{t('videoList.unlinkedTitle')}</Text>
          <Text style={styles.unlinkedDesc}>{t('videoList.unlinkedDesc')}</Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            onPress={() => navigation.navigate('Main', { screen: 'MyInfo', params: { screen: 'FamilyLink' } })}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>{t('videoList.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRowScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterPill, filter === f.key && styles.filterPillActive]}
            onPress={() => handleFilterChange(f.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]} numberOfLines={1}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 일기 기록 영상 제외 토글 */}
      <TouchableOpacity
        style={styles.excludeRow}
        onPress={handleToggleExcludeDiary}
        activeOpacity={0.7}
      >
        <Ionicons
          name={excludeDiary ? 'checkbox' : 'square-outline'}
          size={26}
          color={excludeDiary ? Colors.primary : Colors.textSub}
        />
        <Text style={styles.excludeText}>{t('videoList.excludeDiaryLabel')}</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="film-outline" size={56} color={Colors.border} />
          <Text style={styles.emptyTitle}>{t('videoList.noVideosTitle')}</Text>
          <Text style={styles.emptyDesc}>{t('videoList.noVideosDesc')}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, section === sections[0] && styles.sectionHeaderFirst]}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <View style={styles.sectionDivider} />
            </View>
          )}
          renderItem={({ item }) => (
            <VideoCard
              item={item}
              onPress={handleCardPress}
              onDelete={handleDelete}
              previewingId={previewingId}
              onPreviewPress={handlePreviewPress}
              onOpenDiary={handleOpenDiary}
            />
          )}
          stickySectionHeadersEnabled={false}
        />
      )}
      </>
      )}

      {/* 미연동 보호자는 대신 기록할 환자가 없으므로 기록 FAB 숨김(환자 본인·연동 보호자는 그대로) */}
      {!unlinkedCaregiver && (
      <TouchableOpacity
        style={[
          styles.fab,
          !fabExpanded && styles.fabCircle,
          { bottom: 28 + insets.bottom },
        ]}
        onPress={() => navigateTo('BodyStateTab', { screen: 'VideoRecord' })}
        activeOpacity={0.85}
      >
        <Ionicons name="videocam-outline" size={24} color={Colors.white} />
        {fabExpanded && <Text style={styles.fabText}>{t('videoList.recordBtn')}</Text>}
      </TouchableOpacity>
      )}

      {deleting && (
        <View style={styles.deletingOverlay}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={styles.deletingText}>{t('videoList.deletingText')}</Text>
        </View>
      )}

      <VideoPlayerModal
        url={playingUrl}
        onClose={() => setPlayingUrl(null)}
        insetTop={insets.top}
        insetBottom={insets.bottom}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  filterRowScroll: {
    // 명시적 높이 없이 <ScrollView horizontal>을 쓰면(RecordsScreen의 일반 <View> 탭줄과
    // 달리) 컨텐츠 높이가 주변 flex 컨텍스트에 따라 화면 절반까지 늘어나 버리는 문제가
    // 있었다(오너 스크린샷으로 확인). 실제 필요한 높이로 명시 고정해 절대 안 늘어나게 한다.
    // ⚠️ 높이는 칩(세로패딩8+글자+테두리≈40) + filterRow 세로패딩을 모두 담을 만큼 커야 한다.
    //    이전 60은 (14×2 + 40 = 68) 을 못 담아 칩 아래(descender)가 잘렸다.
    height: 68,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  filterPill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 16, fontWeight: '600', color: Colors.textSub },
  filterTextActive: { color: Colors.white },
  excludeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  excludeText: { fontSize: 17, fontWeight: '600', color: Colors.text },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionHeaderFirst: { marginTop: 0 },
  sectionHeaderText: { fontSize: 18, fontWeight: '700', color: '#555555', flexShrink: 0 },
  sectionDivider: { flex: 1, height: 1, backgroundColor: Colors.border },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingBottom: 60,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptyDesc: { fontSize: 17, color: Colors.textHint },

  // 미연동 보호자 안내(가족 연동 유도)
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  unlinkedTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  unlinkedDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },
  linkFamilyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: 24, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 24,
  },
  linkFamilyBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  fab: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 30,
    paddingVertical: 15,
    paddingHorizontal: 22,
    gap: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 100,
  },
  fabCircle: {
    width: 60,
    height: 60,
    paddingVertical: 0,
    paddingHorizontal: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.white,
  },
  deletingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    gap: 16,
  },
  deletingText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
});
