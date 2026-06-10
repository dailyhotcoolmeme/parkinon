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
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { navigateTo } from '../../navigation/navigationRef';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';

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
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${month}월 ${day}일 (${dayNames[d.getDay()]})`;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}시 ${m.toString().padStart(2, '0')}분`;
}


function getSectionKey(isoString: string): string {
  const d = new Date(isoString);
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
  const [remainingSec, setRemainingSec] = useState<number | null>(
    durationSeconds && durationSeconds > 0 ? durationSeconds : null
  );

  const player = useVideoPlayer({ uri }, p => {
    p.muted = true;
    p.loop = false;
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
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      try {
        const pos = player.currentTime ?? 0;
        const dur = player.duration ?? 0;
        if (dur > 0) {
          setRemainingSec(Math.max(0, Math.round(dur - pos)));
        }
      } catch (_) {}
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  function formatRemaining(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

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
        {/* 정지/재생 모두 남은 시간(또는 전체 길이) 표시 */}
        {remainingSec !== null && (
          <View style={thumbStyles.countdownBadge}>
            <Text style={thumbStyles.countdownText}>{formatRemaining(remainingSec)}</Text>
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
}

function VideoCard({ item, onPress, onDelete, previewingId, onPreviewPress }: VideoCardProps) {
  return (
    <View style={cardStyles.card}>
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
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  thumb: { position: 'relative', flexShrink: 0 },
  info: { flex: 1, gap: 4, justifyContent: 'center' },
  dateText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  timeText: { fontSize: 18, color: Colors.textSub, fontWeight: '500' },
  deleteBtn: { padding: 8, flexShrink: 0 },
});

// ── 풀스크린 플레이어 (expo-video) ───────────────────────────────────────────

interface VideoPlayerModalProps {
  url: string | null;
  onClose: () => void;
}

function formatTimeMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function VideoPlayerModal({ url, onClose }: VideoPlayerModalProps) {
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekRatio, setSeekRatio] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const sliderWidthRef = useRef(0);
  const sliderXRef = useRef(0);
  const sliderRef = useRef<View>(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const isSeekingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // stale closure 방지: PanResponder가 최신 player를 참조하도록 seekRef 사용
  const seekRef = useRef<(sec: number) => void>(() => {});

  const player = useVideoPlayer(url ? { uri: url } : null, p => {
    if (url) {
      p.muted = false;
      p.loop = false;
      p.play();
    }
  });

  // player 또는 url이 바뀔 때마다 seekRef 갱신 (stale closure 방지)
  useEffect(() => {
    seekRef.current = (sec: number) => {
      try {
        const wasPlaying = player.playing;
        // seekBy(delta)는 ExoPlayer 내부적으로 SEEK_TO_CLOSEST_SYNC 모드를 사용해
        // 절대 위치 설정(currentTime =)보다 가장 가까운 키프레임으로 빠르게 이동함
        const delta = sec - player.currentTime;
        player.seekBy(delta);
        if (wasPlaying) {
          try { player.play(); } catch (_) {}
        }
      } catch (e) {
        console.error('[Seek]', e);
      }
    };
  }, [player, url]);

  const triggerShowControls = () => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (player.playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  };

  // 재생 위치 폴링 (expo-video는 timeUpdate 이벤트 지원)
  useEffect(() => {
    if (!url) return;
    setPositionMs(0);
    setDurationMs(0);
    setIsSeeking(false);
    setSeekRatio(0);
    setShowControls(true);
    positionRef.current = 0;
    durationRef.current = 0;
    isSeekingRef.current = false;

    let prevPlaying = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    intervalId = setInterval(() => {
      try {
        if (player) {
          const pos = (player.currentTime ?? 0) * 1000;
          const dur = (player.duration ?? 0) * 1000;
          if (!isSeekingRef.current) {
            // seek 직후 플레이어가 아직 이전 위치를 반환하는 경우 보정
            const expectedMs = positionRef.current;
            const diff = Math.abs(pos - expectedMs);
            // 500ms 이상 차이나면 seek 중이므로 무시 (플레이어가 seek 완료 전)
            if (diff < 500 || pos > expectedMs) {
              setPositionMs(pos);
              setDurationMs(dur);
              positionRef.current = pos;
              durationRef.current = dur;
            }
          }
          const playing = player.playing ?? false;
          if (playing !== prevPlaying) {
            setIsPlaying(playing);
            if (playing) {
              // 재생 시작 → 3초 후 컨트롤 숨김
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
            } else {
              // 일시정지 → 컨트롤 항상 표시
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
              setShowControls(true);
            }
            prevPlaying = playing;
          }
        }
      } catch (_) {}
    }, 250);

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [url]);

  const handleTogglePlay = () => {
    try {
      if (player.playing) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch (_) {}
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        isSeekingRef.current = true;
        setIsSeeking(true);
        setBuffering(true);
        const x = evt.nativeEvent.pageX - sliderXRef.current;
        const w = sliderWidthRef.current;
        if (w > 0) setSeekRatio(Math.min(Math.max(x / w, 0), 1));
      },
      onPanResponderMove: (evt, gestureState) => {
        const x = gestureState.moveX - sliderXRef.current;
        const w = sliderWidthRef.current;
        if (w > 0) setSeekRatio(Math.min(Math.max(x / w, 0), 1));
      },
      onPanResponderRelease: (evt, gestureState) => {
        const x = gestureState.moveX - sliderXRef.current;
        const w = sliderWidthRef.current;
        if (w > 0) {
          const ratio = Math.min(Math.max(x / w, 0), 1);
          setSeekRatio(ratio);
          const targetSec = ratio * (durationRef.current / 1000);
          const targetMs = targetSec * 1000;
          setPositionMs(targetMs);
          positionRef.current = targetMs;
          setBuffering(true);
          seekRef.current(targetSec);
          setTimeout(() => setBuffering(false), 1500);
        }
        // seek 완료 대기 후 폴링 재개 (race condition 방지)
        setTimeout(() => {
          isSeekingRef.current = false;
          setIsSeeking(false);
        }, 500);
      },
      onPanResponderTerminate: () => {
        isSeekingRef.current = false;
        setIsSeeking(false);
      },
    })
  ).current;

  const displayRatio = durationMs > 0
    ? (isSeeking ? seekRatio : positionMs / durationMs)
    : 0;

  return (
    <Modal
      visible={url !== null}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      <View style={playerStyles.container}>
        {url && (
          <VideoView
            player={player}
            style={playerStyles.video}
            nativeControls={false}
            contentFit="contain"
            allowsFullscreen={false}
          />
        )}

        {/* 로딩 오버레이: 영상 duration이 0이면 아직 로딩 중 */}
        {durationMs === 0 && url && (
          <View style={playerStyles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.white} />
            <Text style={playerStyles.loadingText}>영상 불러오는 중...</Text>
          </View>
        )}

        {/* seek 버퍼링 오버레이 */}
        {buffering && durationMs > 0 && (
          <View style={playerStyles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.white} />
            <Text style={playerStyles.loadingText}>이동 중...</Text>
          </View>
        )}

        {/* 배경 탭 영역 - controls 토글만 담당 */}
        <TouchableOpacity
          style={playerStyles.playOverlay}
          onPress={() => {
            if (showControls) {
              setShowControls(false);
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            } else {
              triggerShowControls();
            }
          }}
          activeOpacity={1}
        />

        {/* 가운데 재생/일시정지 버튼 - 재생 토글만 담당 */}
        {showControls && (
          <TouchableOpacity
            style={playerStyles.centerPlayBtn}
            onPress={() => {
              handleTogglePlay();
              triggerShowControls();
            }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPlaying ? 'pause-circle' : 'play-circle'}
              size={64}
              color="rgba(255,255,255,0.85)"
            />
          </TouchableOpacity>
        )}

        {/* 타임라인 슬라이더 */}
        {showControls && (
          <View style={playerStyles.timelineContainer}>
            <View style={playerStyles.timeRow}>
              <Text style={playerStyles.timeText}>
                {formatTimeMs(isSeeking ? seekRatio * durationMs : positionMs)}
              </Text>
              <Text style={playerStyles.timeText}>{formatTimeMs(durationMs)}</Text>
            </View>
            <View
              ref={sliderRef}
              style={playerStyles.sliderTrack}
              onLayout={() => {
                sliderRef.current?.measure((_x, _y, width, _height, pageX) => {
                  sliderWidthRef.current = width;
                  sliderXRef.current = pageX;
                });
              }}
              {...panResponder.panHandlers}
            >
              <View style={[playerStyles.sliderFill, { width: `${displayRatio * 100}%` }]} />
              <View style={[playerStyles.sliderHandle, { left: `${displayRatio * 100}%` }]} />
            </View>
          </View>
        )}

        <TouchableOpacity style={playerStyles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Ionicons name="close-circle" size={40} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const playerStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  timelineContainer: {
    position: 'absolute',
    bottom: 60,
    left: 20,
    right: 20,
    zIndex: 10,
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },
  sliderTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 3,
    position: 'relative',
    justifyContent: 'center',
    marginVertical: 12,
  },
  sliderFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
    position: 'absolute',
    left: 0,
    top: 0,
  },
  sliderHandle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    position: 'absolute',
    top: -9,
    marginLeft: -12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  centerPlayBtn: {
    position: 'absolute',
    zIndex: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
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

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'this_week', label: '이번 주' },
  { key: 'this_month', label: '이번 달' },
  { key: 'last_3_months', label: '최근 3개월' },
];

export function VideoListScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const [filter, setFilter] = useState<FilterType>('all');
  const [sections, setSections] = useState<SectionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fabExpanded, setFabExpanded] = useState(true);
  const lastScrollY = useRef(0);

  const handleScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY > lastScrollY.current && currentY > 60) {
      setFabExpanded(false);
    } else if (currentY < lastScrollY.current) {
      setFabExpanded(true);
    }
    lastScrollY.current = currentY;
  };

  const fetchVideos = useCallback(async (f: FilterType) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('role, patient_group_id')
        .eq('id', user.id)
        .single();

      let patientId = user.id;

      if (userData?.role === 'caregiver' && userData?.patient_group_id) {
        const { data: member } = await supabase
          .from('patient_group_members')
          .select('user_id')
          .eq('group_id', userData.patient_group_id)
          .eq('role', 'patient')
          .single();
        if (member?.user_id) patientId = member.user_id;
      }

      let query = supabase
        .from('media_logs')
        .select('id, r2_url, r2_key, logged_at, duration_seconds')
        .eq('patient_id', patientId)
        .eq('media_type', 'video')
        .eq('category', 'body_state')
        .order('logged_at', { ascending: false });

      const range = getFilterRange(f);
      if (range) {
        query = query.gte('logged_at', range.start).lte('logged_at', range.end);
      }

      const { data, error: queryError } = await query;
      if (queryError) console.error('[VideoListScreen] 조회 오류:', queryError);
      setSections(groupBySections((data as VideoLog[]) ?? []));
    } catch (e) {
      console.error('[VideoListScreen] fetchVideos 오류:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchVideos(filter);
    }, [fetchVideos, filter])
  );

  const handleFilterChange = (f: FilterType) => {
    setFilter(f);
    fetchVideos(f);
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
      title: '영상 삭제',
      message: '영상을 삭제하시겠어요?\n삭제된 영상은 복구할 수 없어요.',
      confirmText: '삭제',
      cancelText: '취소',
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
      fetchVideos(filter);
    } catch (e) {
      console.error('[VideoListScreen] 삭제 오류:', e);
      dialog.alert({ title: '삭제 실패', message: '영상 삭제에 실패했어요. 다시 시도해 주세요.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar
        title="영상 기록"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterPill, filter === f.key && styles.filterPillActive]}
            onPress={() => handleFilterChange(f.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="film-outline" size={56} color={Colors.border} />
          <Text style={styles.emptyTitle}>아직 기록된 영상이 없어요</Text>
          <Text style={styles.emptyDesc}>몸상태 탭에서 영상을 기록해보세요.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
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
            />
          )}
          stickySectionHeadersEnabled={false}
        />
      )}

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
        {fabExpanded && <Text style={styles.fabText}>기록하기</Text>}
      </TouchableOpacity>

      {deleting && (
        <View style={styles.deletingOverlay}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={styles.deletingText}>삭제 중...</Text>
        </View>
      )}

      <VideoPlayerModal url={playingUrl} onClose={() => setPlayingUrl(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionHeaderText: { fontSize: 18, fontWeight: '700', color: '#555555', flexShrink: 0 },
  sectionDivider: { flex: 1, height: 1, backgroundColor: Colors.border },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 12, paddingBottom: 60,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  emptyDesc: { fontSize: 17, color: Colors.textHint },
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
