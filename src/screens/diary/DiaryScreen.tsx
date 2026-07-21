import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Animated,
  BackHandler,
  Dimensions,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { navigateTo } from '../../navigation/navigationRef';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video as AVVideo, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Video as VideoCompressor } from 'react-native-compressor';
import { ImageGalleryViewer } from '../../components/common/ImageGalleryViewer';
import { R2Image } from '../../components/common/R2Image';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useSubscription } from '../../context/SubscriptionContext';
import {
  countTodayGroupMedia,
  FREE_DAILY_LIMITS,
  EMPTY_USAGE,
  type DailyMediaUsage,
} from '../../lib/mediaQuota';
import { supabase } from '../../lib/supabase';
import { useDiary, DiaryEntry, AutoSummary, fetchDiaryEntryDates } from '../../hooks/useDiary';
import { uploadPhoto, uploadVideo, uploadSound } from '../../lib/r2Upload';
import { resolveMediaUrl, resolveMediaUrlSync, useResolvedMediaUrl, prefetchMediaUrls } from '../../lib/r2Get';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { translateRawExerciseType } from '../../constants/exerciseTypes';
import {
  PHOTO_PREFIX,
  VIDEO_TOKEN,
  AUDIO_TOKEN,
  normalizeMediaOrder,
} from '../../utils/diaryMedia';

// ─── 일기장 로컬 팔레트 §11-1 (DiaryScreen 전용, 전역 Colors 미변경 / 녹색 0%) ──────
const Journal = {
  page: '#F4EEDF', // 화면 전체(부드러운 크림 종이) — 한 장의 페이지
  pageDeep: '#EFE7D3', // 작성 모달 배경
  surface: '#FAF5E9', // 첨부 프레임/음성칩 등 살짝 밝은 면 (카드 아님)
  rule: '#E0D4BC', // 괘선·구분선·날짜 밑줄 (은은)
  ink: '#3A3128', // 본문 잉크(따뜻한 진갈색)
  inkSoft: '#7A6E5C', // 저자명·보조
  inkFaint: '#A99B82', // 하단 각주(건강데이터)·플레이스홀더보다 진함
  placeholder: '#BBAd92', // 에디터 플레이스홀더
  accent: '#B5613E', // 세피아 테라코타 — 아주 가끔(추세보기·저장·녹음중)
  accentSoft: '#ECDDCB', // 악센트 옅은 배경
  mine: '#B89A52', // 내 글 표시(작은 점/마크)
} as const;

// 'Georgia'/'serif'엔 한글 글리프가 없어 한국어는 원래도 OS가 자동으로 다른
// 폰트로 대체해 그려왔다(=RULE_SPACING 괘선 정렬은 그 대체 폰트 기준으로 맞춰짐).
// 영어는 실제로 Georgia가 적용되는데, 폰트마다 줄 안에서 글자가 앉는 높이(베이스라인)
// 비율이 달라 같은 lineHeight=RULE_SPACING이어도 글이 괘선 위에 안 앉고 어긋난다.
// 해외 로케일은 한국어와 동일하게 시스템 기본 폰트를 쓰게 해 정렬을 맞춘다.
const SERIF = isOverseasLocale() ? undefined : Platform.select({ ios: 'Georgia', android: 'serif' });

const WEEKDAYS_FULL = isOverseasLocale()
  ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  : ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_VIDEO_DURATION_SEC = 120;
const UPLOAD_TIMEOUT_MS = 180_000;
// 보기(읽기) 모드 첨부 썸네일 정사각 크기 — 사진/영상/음성 모두 동일. (에디터는 104px로 별도)
// 한 줄에 정확히 3개가 꽉 차도록 반응형 계산:
//   가용폭 = 화면폭 - scrollContent 좌우 패딩(22*2)   ← entryBlock 자체 패딩 0
//   썸네일 = floor((가용폭 - thumbGrid gap(12) * 2) / 3)
//   (gap이 썸네일 사이 2군데 들어가므로 gap*2를 뺀 뒤 3등분 → 4번째는 다음 줄로 wrap)
const ENTRY_GRID_H_PADDING = 22; // scrollContent.paddingHorizontal
const ENTRY_GRID_GAP = 12; // thumbGrid.gap
const ENTRY_THUMB_SIZE = Math.floor(
  (Dimensions.get('window').width - ENTRY_GRID_H_PADDING * 2 - ENTRY_GRID_GAP * 2) / 3
);

// KST(UTC+9) 기준 YYYY-MM-DD 문자열 반환
function toKstDateString(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// YYYY-MM-DD(KST) → 정오 기준 Date (DatePicker/표시용, 날짜 경계 안전)
function dateStrToDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function shiftDate(dateStr: string, days: number): string {
  const dt = dateStrToDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return toKstDateString(new Date(dt.getTime() - 9 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
}

// 엔트리 작성시각 → KST 기준 "요일 오전/오후 H:MM" 컴팩트 표기 (예: "금 오후 9:14")
// 출처는 created_at(없으면 updated_at). 요일은 한글 단축(일~토).
const WEEKDAYS_MINI = ['일', '월', '화', '수', '목', '금', '토'];
function formatEntryStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  // KST(UTC+9)로 옮긴 뒤 getUTC* 로 KST 시각/요일을 읽는다 (디바이스 TZ 무관).
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  const dow = WEEKDAYS_MINI[kst.getUTCDay()];
  const h24 = kst.getUTCHours();
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  if (isOverseasLocale()) {
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return `${h12}:${min} ${ampm}`;
  }
  const ampm = h24 < 12 ? '오전' : '오후';
  return `${ampm} ${h12}:${min}`;
}

// mm:ss 포맷 (음성 플레이어 시간 라벨)
function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── 일기장 로컬 헤더 (공용 TopBar 대체, 배경=본문색) §11 ──────────────────────
// 좌=뒤로/back, 중앙=제목(serif), 우=액션 버튼들. 배경이 본문과 같아야 함.
function DiaryHeader({
  title,
  bg,
  onLeftPress,
  rightComponent,
}: {
  title: string;
  bg: string;
  onLeftPress: () => void;
  rightComponent?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.diaryHeader, { backgroundColor: bg }]}>
      <TouchableOpacity
        style={styles.diaryHeaderBack}
        onPress={onLeftPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Ionicons name="arrow-back" size={24} color={Journal.inkSoft} />
        <Text style={styles.diaryHeaderBackText}>{t('common.back')}</Text>
      </TouchableOpacity>
      <Text style={styles.diaryHeaderTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.diaryHeaderRight}>{rightComponent}</View>
    </View>
  );
}

// ─── 일기 달력 팝업 (빈티지 일기지 톤 커스텀 월 달력) §11 ─────────────────────
// 날짜 헤더 가운데 날짜를 탭하면 열린다. 월 그리드 + 이전/다음 달 + 작성이력 점.
// 날짜 탭 → 그 날짜 onSelect(기존 dateStr 이동 로직 재사용) + 닫힘.
// 스와이프 다운 / 배경탭 / 안드 백버튼으로 닫힘(useSwipeDownDismiss 재사용).
const WEEKDAYS_SHORT = isOverseasLocale()
  ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  : ['일', '월', '화', '수', '목', '금', '토'];

function DiaryCalendarModal({
  visible,
  selectedDateStr,
  todayStr,
  patientId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selectedDateStr: string;
  todayStr: string;
  patientId: string | null;
  onSelect: (dateStr: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sy, sm] = selectedDateStr.split('-').map(Number);
  const [viewYear, setViewYear] = useState(sy);
  const [viewMonth, setViewMonth] = useState(sm - 1); // 0~11
  // 작성 이력 있는 날짜(YYYY-MM-DD) Set. 보고 있는 월이 바뀌면 재조회.
  const [entryDates, setEntryDates] = useState<Set<string>>(new Set());

  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);

  // 열릴 때마다 선택 날짜의 월로 맞추고 위치 리셋
  useEffect(() => {
    if (!visible) return;
    const [y, m] = selectedDateStr.split('-').map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
    resetPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 보고 있는 월의 작성 이력 조회
  useEffect(() => {
    if (!visible || !patientId) {
      setEntryDates(new Set());
      return;
    }
    let alive = true;
    fetchDiaryEntryDates(patientId, viewYear, viewMonth).then((dates) => {
      if (alive) setEntryDates(dates);
    });
    return () => {
      alive = false;
    };
  }, [visible, patientId, viewYear, viewMonth]);

  // 안드 백버튼 닫기
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else setViewMonth((m) => m - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else setViewMonth((m) => m + 1);
  };

  const pad = (n: number) => String(n).padStart(2, '0');
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const handleDayPress = (day: number) => {
    onSelect(`${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableOpacity style={styles.calOverlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[styles.calSheet, { transform: [{ translateY }] }]}
          {...panHandlers}
        >
          {/* 스와이프 그립 */}
          <View style={styles.calGrip} />
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            {/* 월 탐색 헤더 */}
            <View style={styles.calMonthNav}>
              <TouchableOpacity style={styles.calNavArrow} onPress={goPrev} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={24} color={Journal.inkSoft} />
              </TouchableOpacity>
              <Text style={styles.calMonthTitle}>
                {isOverseasLocale() ? `${MONTH_NAMES_EN[viewMonth]} ${viewYear}` : `${viewYear}년 ${viewMonth + 1}월`}
              </Text>
              <TouchableOpacity style={styles.calNavArrow} onPress={goNext} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-forward" size={24} color={Journal.inkSoft} />
              </TouchableOpacity>
            </View>

            {/* 요일 헤더 */}
            <View style={styles.calWeekRow}>
              {WEEKDAYS_SHORT.map((w, i) => (
                <Text
                  key={w}
                  style={[
                    styles.calWeekLabel,
                    i === 0 && styles.calSunday,
                    i === 6 && styles.calSaturday,
                  ]}
                >
                  {w}
                </Text>
              ))}
            </View>

            {/* 날짜 그리드 */}
            <View style={styles.calGrid}>
              {cells.map((day, idx) => {
                if (!day) return <View key={`e-${idx}`} style={styles.calDayCell} />;
                const ds = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
                const isSel = ds === selectedDateStr;
                const isToday = ds === todayStr;
                const hasEntry = entryDates.has(ds);
                const col = idx % 7;
                return (
                  <TouchableOpacity
                    key={day}
                    style={[styles.calDayCell, isSel && styles.calDaySelected]}
                    onPress={() => handleDayPress(day)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.calDayText,
                        col === 0 && styles.calSunday,
                        col === 6 && styles.calSaturday,
                        isToday && !isSel && styles.calTodayText,
                        isSel && styles.calDayTextSelected,
                      ]}
                    >
                      {day}
                    </Text>
                    {/* 작성 이력 점 (선택된 셀은 흰 점으로 대비) */}
                    {hasEntry && (
                      <View style={[styles.calEntryDot, isSel && styles.calEntryDotOnSel]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 범례 + 닫기 */}
            <View style={styles.calFooter}>
              <View style={styles.calLegend}>
                <View style={styles.calEntryDot} />
                <Text style={styles.calLegendText}>{t('diary.calendarLegend')}</Text>
              </View>
              <TouchableOpacity style={styles.calCloseBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={styles.calCloseText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── 음성 플레이어 (재생/일시정지 + 진행바 + 시간) — 읽기·에디터 공용 §11 ──────
function AudioPlayer({ uri }: { uri: string }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  // uri가 바뀌면(다시 녹음 등) 기존 사운드 정리
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlaying(false);
      setPosition(0);
      setDuration(0);
    };
  }, [uri]);

  const onStatus = (s: any) => {
    if (!s.isLoaded) return;
    if (typeof s.positionMillis === 'number') setPosition(s.positionMillis);
    if (typeof s.durationMillis === 'number' && s.durationMillis > 0) setDuration(s.durationMillis);
    if (s.didJustFinish) {
      setPlaying(false);
      setPosition(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
      soundRef.current?.pauseAsync().catch(() => {});
    }
  };

  const handleToggle = async () => {
    try {
      if (soundRef.current) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await soundRef.current.pauseAsync();
          setPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setPlaying(true);
        }
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      // presigned GET URL 로 변환(로컬 uri/비R2면 원본 그대로, 실패 시 폴백)
      const playUri = await resolveMediaUrl(uri);
      const { sound } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(onStatus);
      setPlaying(true);
    } catch (e) {
      setPlaying(false);
      dialog.alert({ title: t('diary.playFailTitle'), message: t('diary.genericRetryMsg') });
    }
  };

  const pct = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.audioPlayer}>
      <TouchableOpacity style={styles.audioPlayCircle} onPress={handleToggle} activeOpacity={0.85}>
        <Ionicons name={playing ? 'pause' : 'play'} size={15} color="#fff" />
      </TouchableOpacity>
      <View style={styles.audioBarTrack}>
        <View style={[styles.audioBarFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.audioTimeText}>
        {formatMs(position)} / {formatMs(duration)}
      </Text>
    </View>
  );
}

// 에디터(작성/수정)용 음성 타일 — 사진/영상 썸네일과 동일한 104px 정사각.
// 진행바 없이 가운데 재생/일시정지 버튼 + 하단 시간 텍스트만. 탭하면 그 자리서 재생/일시정지.
function AudioTile({ uri, size }: { uri: string; size?: number }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  // uri가 바뀌면(다시 녹음 등) 기존 사운드 정리
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlaying(false);
      setPosition(0);
      setDuration(0);
    };
  }, [uri]);

  const onStatus = (s: any) => {
    if (!s.isLoaded) return;
    if (typeof s.positionMillis === 'number') setPosition(s.positionMillis);
    if (typeof s.durationMillis === 'number' && s.durationMillis > 0) setDuration(s.durationMillis);
    if (s.didJustFinish) {
      setPlaying(false);
      setPosition(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
      soundRef.current?.pauseAsync().catch(() => {});
    }
  };

  // 마운트 시 재생하지 않고 길이(메타데이터)만 미리 로드 → 재생 전부터 총 길이 표시
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (!uri) return;
        // 이미 로드돼 있으면(예: 재생 후) 중복 로드 방지
        if (soundRef.current) return;
        // presigned GET URL 로 변환(로컬 uri/비R2면 원본 그대로, 실패 시 폴백)
        const metaUri = await resolveMediaUrl(uri);
        const { sound, status } = await Audio.Sound.createAsync(
          { uri: metaUri },
          { shouldPlay: false },
        );
        if (!isMounted) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        // 재생에도 재사용 — handleToggle이 기존 soundRef를 그대로 재생
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate(onStatus);
        let st: any = status;
        if (!st?.isLoaded) {
          st = await sound.getStatusAsync().catch(() => null);
        }
        if (
          isMounted &&
          st?.isLoaded &&
          typeof st.durationMillis === 'number' &&
          st.durationMillis > 0
        ) {
          setDuration(st.durationMillis);
        }
      } catch {
        // 일부 포맷에서 길이를 못 읽어도 조용히 무시 (0:00 유지)
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [uri]);

  const handleToggle = async () => {
    try {
      if (soundRef.current) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await soundRef.current.pauseAsync();
          setPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setPlaying(true);
        }
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      // presigned GET URL 로 변환(로컬 uri/비R2면 원본 그대로, 실패 시 폴백)
      const playUri = await resolveMediaUrl(uri);
      const { sound } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(onStatus);
      setPlaying(true);
    } catch (e) {
      setPlaying(false);
      dialog.alert({ title: t('diary.playFailTitle'), message: t('diary.genericRetryMsg') });
    }
  };

  // 재생 중이면 경과/총 시간, 정지 상태면 총 길이만 표시
  const timeLabel = playing ? `${formatMs(position)} / ${formatMs(duration)}` : formatMs(duration);

  return (
    <TouchableOpacity
      style={[styles.audioTile, size != null && { width: size, height: size }]}
      activeOpacity={0.85}
      onPress={handleToggle}
    >
      {/* 배경에 은은한 "음성" 글자 (영상 썸네일의 프레임 대응) */}
      <View style={styles.audioTileLabelWrap} pointerEvents="none">
        <Text style={styles.audioTileLabel}>{t('diary.audioTileLabel')}</Text>
      </View>
      {/* 영상 재생버튼과 동일한 정중앙 반투명 ▶ 오버레이 */}
      <View style={styles.thumbPlayWrap} pointerEvents="none">
        <View style={styles.thumbPlayOverlay}>
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={Journal.accent} />
        </View>
      </View>
      <Text style={styles.audioTileTime} numberOfLines={1}>
        {timeLabel}
      </Text>
    </TouchableOpacity>
  );
}

// 영상 썸네일 + (총 길이) 시간 라벨. 음성 타일(AudioTile)과 동일 톤으로 mm:ss 표시.
// 길이는 ① DB에 저장된 길이(durationSeconds, 몸상태 영상과 동일 방식)를 최우선으로 쓴다 →
//   재생(메타 로드) 전에도 즉시 배지 표시. ② 저장값이 없는 구버전 영상만 expo-av AVVideo
//   onLoad(durationMillis)로 폴백한다. 못 구하면(둘 다 없음) 라벨은 숨김 — 0:00 강제 표시 안 함.
function VideoThumb({
  uri,
  durationSeconds,
  tileStyle,
  onPress,
}: {
  uri: string;
  durationSeconds?: number | null;
  tileStyle: any;
  onPress: () => void;
}) {
  // 저장값(초)이 있으면 그 값을 ms로 환산해 즉시 표시(폴백 onLoad 불필요).
  const storedMs =
    durationSeconds != null && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null;
  const [loadedMs, setLoadedMs] = useState<number | null>(null);
  const displayMs = storedMs ?? loadedMs;
  // presigned GET URL 로 변환(실패 시 원본 공개 URL 폴백)
  const { uri: resolvedUri } = useResolvedMediaUrl(uri);

  return (
    <TouchableOpacity style={tileStyle} activeOpacity={0.9} onPress={onPress}>
      <AVVideo
        source={{ uri: resolvedUri }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay={false}
        isMuted
        onLoad={(status: any) => {
          // 저장값이 이미 있으면 메타 길이는 무시(불필요한 setState 방지).
          if (storedMs != null) return;
          if (
            status?.isLoaded &&
            typeof status.durationMillis === 'number' &&
            status.durationMillis > 0
          ) {
            setLoadedMs(status.durationMillis);
          }
        }}
      />
      <View style={styles.videoScrim} />
      <View style={styles.thumbPlayWrap} pointerEvents="none">
        <View style={styles.thumbPlayOverlay}>
          <Ionicons name="play" size={18} color={Journal.accent} />
        </View>
      </View>
      {displayMs != null && (
        <Text style={styles.videoTileTime} numberOfLines={1}>
          {formatMs(displayMs)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function DiaryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();

  const todayStr = toKstDateString(new Date());
  const initialDate: string = route.params?.date ?? todayStr;
  const [dateStr, setDateStr] = useState<string>(initialDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const { autoSummary, entries, loading, patientId, saveMyEntry, deleteMyEntry } = useDiary(dateStr);

  // 미연동 보호자: 보호자인데 환자 해석이 끝났고(=loading false) 연동 환자 없음.
  // useDiary.loading 은 환자 해석(pidLoading)을 포함하므로 깜빡임 없이 판정된다.
  // (환자 본인 경로는 patientId=본인 id 이므로 영향 없음)
  const caregiverUnlinked = user?.role === 'caregiver' && !loading && patientId == null;

  // 미래 날짜로는 이동 금지
  const isToday = dateStr === todayStr;
  const canGoNext = dateStr < todayStr;

  const myEntry = entries.find((e) => e.author_id === user?.id) ?? null;

  // 🔒 비공개(워커) 경유 유지: 일기 항목 로드 직후 영상(video_url)들의 워커 presigned URL 을
  //    병렬로 미리 발급해 캐시에 채워둔다. 인라인 썸네일·전체화면이 캐시 히트로 즉시 뜸.
  //    기존 캐시/in-flight 합치기 로직이 중복 발급·레이스를 막으며, 실패는 조용히 무시(백그라운드).
  useEffect(() => {
    prefetchMediaUrls(entries.map((e) => e.video_url).filter(Boolean) as string[]);
  }, [entries]);

  const dt = dateStrToDate(dateStr);
  const dateTitle = isOverseasLocale()
    ? `${MONTH_NAMES_EN[dt.getMonth()]} ${dt.getDate()}, ${WEEKDAYS_FULL[dt.getDay()]}`
    : `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WEEKDAYS_FULL[dt.getDay()]}`;

  // 내 글 인라인 삭제 — 톱바에 있던 삭제 기능을 엔트리 줄로 옮긴 것.
  // 기존 삭제 확인 다이얼로그·deleteMyEntry를 그대로 재사용한다.
  const handleInlineDelete = async () => {
    const ok = await dialog.confirm({
      title: t('diary.deletePostTitle'),
      message: t('diary.deletePostMsg'),
      destructive: true,
      confirmText: t('medManage.delete'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await deleteMyEntry();
    } catch (e: any) {
      dialog.alert({ title: t('diary.deleteFailTitle'), message: e?.message ?? t('diary.genericRetryMsg') });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <DiaryHeader
        title={t('diary.headerTitle')}
        bg={Journal.page}
        onLeftPress={() => navigation.goBack()}
        rightComponent={
          // 내 글이 있으면 수정/삭제는 해당 엔트리 줄(인라인)로 옮겼다.
          // 아직 내 글이 없을 때만 "작성" 진입점을 톱바에 둔다.
          // 미연동 보호자는 환자가 없어 작성 자체가 불가하므로 진입점을 숨긴다.
          (myEntry || caregiverUnlinked) ? undefined : (
            <TouchableOpacity
              onPress={() => setShowEditor(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.headerActionBtn}
            >
              <Ionicons name="create-outline" size={20} color={Journal.accent} />
              <Text style={styles.headerActionText}>{t('diary.writeBtn')}</Text>
            </TouchableOpacity>
          )
        }
      />

      {/* ── 날짜 헤더 (우아한 serif, 한 장의 페이지) §11-3 ── */}
      <View style={styles.dateHeader}>
        <View style={styles.dateHeaderRow}>
          <TouchableOpacity
            style={styles.navArrowBtn}
            onPress={() => setDateStr(shiftDate(dateStr, -1))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={Journal.inkSoft} />
          </TouchableOpacity>

          {/* 가운데 날짜 — 탭하면 달력 팝업(작성 이력 점 표시) */}
          <TouchableOpacity
            style={styles.dateCenter}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={styles.dateTopRow}>
              <Text style={[styles.dateTitle, isToday && { color: Journal.accent }]}>{dateTitle}</Text>
            </View>
            <View style={[styles.dateRule, isToday && { backgroundColor: Journal.accent }]} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navArrowBtn, !canGoNext && styles.navArrowDisabled]}
            onPress={() => canGoNext && setDateStr(shiftDate(dateStr, 1))}
            disabled={!canGoNext}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={26} color={canGoNext ? Journal.inkSoft : Journal.rule} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={[styles.scrollContent, { paddingTop: 14 }]}>
          {/* 오늘의 기록 박스 자리 더미 */}
          <View style={styles.skelRecBox}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.skelRecLine, i === 3 && { width: '50%' }]} />
            ))}
          </View>
          {/* 본문 글 자리 더미 */}
          <View style={[styles.skelEntryLine, { width: '35%' }]} />
          <View style={[styles.skelEntryLine, { marginTop: 16 }]} />
          <View style={[styles.skelEntryLine, { width: '80%' }]} />
          <View style={[styles.skelEntryLine, { width: '60%' }]} />
        </View>
      ) : caregiverUnlinked ? (
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Journal.inkSoft} />
          <Text style={styles.unlinkedTitle}>{t('diary.unlinkedTitle')}</Text>
          <Text style={styles.unlinkedDesc}>{t('diary.unlinkedDesc')}</Text>
          <TouchableOpacity
            style={styles.unlinkedBtn}
            onPress={() => navigation.navigate('Main', { screen: 'MyInfo', params: { screen: 'FamilyLink' } })}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color="#fff" />
            <Text style={styles.unlinkedBtnText}>{t('diary.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ── */}
          <TodayRecordBox summary={autoSummary} dialog={dialog} />

          {/* ── 한마디 (본문, 주연) — 한 장의 페이지, 블록 사이 rule 1px §11-3 ── */}
          {entries.length === 0 && (
            <View style={styles.emptyEntryWrap}>
              <Text style={styles.emptyEntryText}>{t('diary.noEntryYet')}</Text>
              <TouchableOpacity
                onPress={() => setShowEditor(true)}
                style={styles.emptyWriteBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
                <Text style={styles.emptyWriteBtnText}>{t('diary.writeBtn')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {entries.map((entry, idx) => (
            <View key={entry.id}>
              {idx > 0 && <View style={styles.entryRule} />}
              <EntryBlock
                entry={entry}
                isMine={entry.author_id === user?.id}
                onEdit={() => setShowEditor(true)}
                onDelete={handleInlineDelete}
              />
            </View>
          ))}

          {/* 이미 (다른 가족의) 글이 있고 내 글은 아직 없을 때 — 톱바 대신 내용 아래 잘 보이는 작성 버튼. */}
          {entries.length > 0 && !myEntry && !caregiverUnlinked && (
            <View style={styles.belowWriteWrap}>
              <TouchableOpacity
                onPress={() => setShowEditor(true)}
                style={styles.emptyWriteBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="create-outline" size={22} color="#fff" />
                <Text style={styles.emptyWriteBtnText}>{t('diary.writeBtn')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      <DiaryCalendarModal
        visible={showDatePicker}
        selectedDateStr={dateStr}
        todayStr={todayStr}
        patientId={patientId}
        onSelect={(picked) => {
          // 미래 날짜 클램프 (기존 날짜 이동 로직과 동일하게 dateStr 갱신 → useDiary 재조회)
          setDateStr(picked > todayStr ? todayStr : picked);
          setShowDatePicker(false);
        }}
        onClose={() => setShowDatePicker(false)}
      />

      {showEditor && patientId && (
        <DiaryEditorModal
          visible={showEditor}
          dateStr={dateStr}
          patientId={patientId}
          existing={myEntry}
          parentInsetTop={insets.top}
          parentInsetBottom={insets.bottom}
          onClose={() => setShowEditor(false)}
          onSaved={async (input) => {
            await saveMyEntry(input);
            setShowEditor(false);
          }}
          onDeleted={async () => {
            await deleteMyEntry();
            setShowEditor(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ─────────────────────────────
// 약복용/몸상태/기분/운동을 시간대별 평균으로 한 줄씩. 데이터 없는 줄은 통째로 생략.

function TodayRecordBox({ summary, dialog }: { summary: AutoSummary | null; dialog: ReturnType<typeof useDialog> }) {
  const { t } = useTranslation();
  if (!summary) return null;

  const hasMed = summary.med.count > 0;
  const hasBody = summary.bodyByTime.length > 0;
  const hasMood = summary.moodByTime.length > 0;
  const hasExercise = summary.exercise.length > 0;
  const hasSleep = summary.sleep != null;
  const hasConstipation = summary.constipation != null;

  // 모든 항목은 기록이 없으면 '기록없음'으로 통일 표시.
  return (
    <View style={styles.recBox}>
      {/* 헤더: 좌=• 오늘의 기록 • / 우=추세보기 › */}
      <View style={styles.recHead}>
        <Text style={styles.recTitle}>{t('diary.todayRecordTitle')}</Text>
        <WebTrendLink dialog={dialog} />
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.medLabel')}</Text>
        {hasMed ? (
          <Text style={styles.recVal}>{t('diary.timesSuffix', { n: summary.med.count })} · {summary.med.times.join(' · ')}</Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.bodyLabel')}</Text>
        {hasBody ? (
          <Text style={styles.recVal}>
            {summary.bodyByTime.map((s) => `${s.label} ${t('diary.pointSuffix', { n: s.avg })}`).join(' · ')}
          </Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.moodLabel')}</Text>
        {hasMood ? (
          <Text style={styles.recVal}>
            {summary.moodByTime.map((s) => `${s.label} ${t('diary.pointSuffix', { n: s.avg })}`).join(' · ')}
          </Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.exerciseLabel')}</Text>
        {hasExercise ? (
          <Text style={styles.recVal}>
            {t('diary.timesSuffix', { n: summary.exerciseCount })} · {summary.exercise.map((e) => `${translateRawExerciseType(e.type)} ${t('diary.minutesSuffix', { n: e.minutes })}`).join(' | ')}
          </Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.sleepLabel')}</Text>
        {hasSleep ? (
          <Text style={styles.recVal}>{t('diary.pointSuffix', { n: summary.sleep })}</Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>

      <View style={styles.recRow}>
        <Text style={styles.recLab}>{t('diary.constipationLabel')}</Text>
        {hasConstipation ? (
          <Text style={styles.recVal}>{summary.constipation ? t('diary.constipationYes') : t('diary.constipationNo')}</Text>
        ) : (
          <Text style={styles.recEmpty}>{t('diary.noRecord')}</Text>
        )}
      </View>
    </View>
  );
}

// ─── 웹 추세 보기 — 작은 텍스트 링크 (각주 우측 끝) ─────────────────────────────

function WebTrendLink({ dialog }: { dialog: ReturnType<typeof useDialog> }) {
  const { t } = useTranslation();
  // "추세보기" → 이 기기(모바일) 브라우저로 웹 추세뷰를 바로 연다(자동로그인 URL).
  // 앱은 대부분 모바일이라 PC 코드 대신 현재 기기에서 바로 열림. (PC 입력용 코드는 기록보기의
  // 'PC에서 보기'에 별도로 있음.)
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-web-token');
      if (error || !data?.url) throw new Error(error?.message || t('diary.pcTokenGenFail'));
      await Linking.openURL(data.url as string);
    } catch (e: any) {
      dialog.alert({ title: t('diary.errorTitle'), message: e?.message || t('diary.genericRetryMsg') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={styles.trendLink}
      onPress={handleOpen}
      activeOpacity={0.7}
      disabled={loading}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.trendLinkText}>{t('diary.trendViewLink')}</Text>
      <Ionicons name="chevron-forward" size={14} color={Journal.accent} />
    </TouchableOpacity>
  );
}

// ─── 한마디 글 블록 (본문, 주연) §11-3 ────────────────────────────────────────

function EntryBlock({
  entry,
  isMine,
  onEdit,
  onDelete,
}: {
  entry: DiaryEntry;
  isMine: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [showVideo, setShowVideo] = useState(false);
  // EntryBlock 은 <Modal> 밖 일반 컴포넌트라 inset 이 정확 → 풀스크린 영상 모달에 전달.
  const insets = useSafeAreaInsets();

  const roleLabel = entry.author_role === 'caregiver' ? t('diary.roleCaregiver') : t('diary.rolePatient');
  // 표시 시각 + 요일 (KST). 수정한 경우 마지막 수정 시각을 보이도록 updated_at 우선, 없으면 created_at.
  const stamp = formatEntryStamp(entry.updated_at ?? entry.created_at);
  // 사진 전체보기: 탭한 사진 인덱스(entry.photo_urls 기준). null이면 닫힘.
  // 썸네일 탭 → 곧바로 풀스크린 원본(중간 인라인 갤러리 단계 없음).
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  // media_order(저장된 순서)대로 첨부를 렌더한다. null이면 기본 순서(사진→영상→음성)로 폴백.
  // 저장 값이 현재 첨부와 어긋나도(구버전·부분삭제) normalizeMediaOrder로 정합화한다.
  const orderedTokens = normalizeMediaOrder(entry.media_order, {
    photoUrls: entry.photo_urls,
    hasVideo: !!entry.video_url,
    hasAudio: !!entry.audio_url,
  });

  return (
    <View style={styles.entryBlock}>
      {/* 저자명 한 줄: 왼쪽=내글점·이름·역할 / 오른쪽=작성시각요일 + (내 글만) 수정·삭제 아이콘 */}
      <View style={styles.entryHeader}>
        {/* 좌측 그룹: 점·이름·역할. 길어지면 줄여서 우측 자리 확보 */}
        <View style={styles.entryHeaderLeft}>
          <Text style={styles.entryAuthor} numberOfLines={1}>
            {entry.author_name}
          </Text>
        </View>

        {/* 우측 그룹: 작성시각·요일(작은 글씨) + 본인 글에 한해 수정/삭제 아이콘 */}
        <View style={styles.entryHeaderRight}>
          {!!stamp && (
            <Text style={styles.entryStamp} numberOfLines={1}>
              {stamp}
            </Text>
          )}
          {isMine && (
            <>
              <TouchableOpacity
                onPress={onEdit}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 8 }}
                style={styles.entryActionBtn}
                activeOpacity={0.7}
                accessibilityLabel={t('diary.a11yEditPost')}
              >
                <Ionicons name="create-outline" size={20} color={Journal.inkSoft} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onDelete}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 10 }}
                style={styles.entryActionBtn}
                activeOpacity={0.7}
                accessibilityLabel={t('diary.a11yDeletePost')}
              >
                <Ionicons name="trash-outline" size={20} color={Journal.inkSoft} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {!!entry.text && <Text style={styles.entryText}>{entry.text}</Text>}

      {/* 첨부: media_order 순서대로. 썸네일(사진/영상)·음성 플레이어 같은 흐름에 한 줄 wrap */}
      {orderedTokens.length > 0 && (
        <View style={styles.thumbGrid}>
          {orderedTokens.map((token, idx) => {
            if (token === AUDIO_TOKEN && entry.audio_url) {
              // 보기 모드 음성: 사진·영상 썸네일과 동일한 정사각 AudioTile(재생/일시정지 + 시간, 바 없음)
              return <AudioTile key={`a-${idx}`} uri={entry.audio_url} size={ENTRY_THUMB_SIZE} />;
            }
            if (token === VIDEO_TOKEN && entry.video_url) {
              return (
                <VideoThumb
                  key={`v-${idx}`}
                  uri={entry.video_url}
                  durationSeconds={entry.video_duration_seconds}
                  tileStyle={styles.thumbSquare}
                  onPress={() => setShowVideo(true)}
                />
              );
            }
            if (token.startsWith(PHOTO_PREFIX)) {
              const url = token.slice(PHOTO_PREFIX.length);
              const photoIdx = entry.photo_urls.indexOf(url);
              return (
                <TouchableOpacity
                  key={`p-${idx}`}
                  style={styles.thumbSquare}
                  activeOpacity={0.85}
                  onPress={() => setPhotoViewerIndex(photoIdx >= 0 ? photoIdx : 0)}
                >
                  <R2Image uri={url} style={styles.thumbSquareImg} />
                </TouchableOpacity>
              );
            }
            return null;
          })}
        </View>
      )}

      {/* 사진 썸네일 탭 → 곧바로 풀스크린 원본 뷰어 (인라인 갤러리 중간단계 없음) */}
      {entry.photo_urls.length > 0 && photoViewerIndex !== null && (
        <ImageGalleryViewer
          urls={entry.photo_urls}
          initialFullscreenIndex={photoViewerIndex}
          onClose={() => setPhotoViewerIndex(null)}
        />
      )}

      {entry.video_url && showVideo && (
        <FullscreenVideoModal
          url={entry.video_url}
          onClose={() => setShowVideo(false)}
          insetTop={insets.top}
          insetBottom={insets.bottom}
        />
      )}
    </View>
  );
}

// ─── 풀스크린 영상 재생 (expo-av AVVideo) ────────────────────────────────
// ⚠️ expo-video 전환 후 자동재생이 깨지는 회귀로 expo-av 로 복귀(재생 안정성 최우선).
//    <AVVideo useNativeControls shouldPlay> 가 자동재생을 확실히 보장한다.
//    useNativeControls 특성상 우측 하단 "전체화면" 버튼이 다시 노출되나 재생 우선으로 감수.

// 안드 3버튼 내비바 높이 추정(모달 내부 inset 이 0 으로 떨어질 때의 fallback).
// VideoListScreen.VideoPlayerModal 과 동일 로직 — 영상 전체보기 하단 재생바 가림 방지.
function estimateAndroidNavBarPad(insetBottom: number): number {
  if (Platform.OS !== 'android') return insetBottom;
  const screenH = Dimensions.get('screen').height;
  const windowH = Dimensions.get('window').height;
  const diff = Math.max(0, Math.round(screenH - windowH));
  const candidate = Math.max(insetBottom, diff > 0 ? Math.min(diff, 60) : 0);
  return candidate > 0 ? candidate : 48;
}

function FullscreenVideoModal({
  url,
  onClose,
  insetTop,
  insetBottom,
}: {
  url: string;
  onClose: () => void;
  // 모달 밖(루트 SafeAreaProvider)에서 구한 inset. RN <Modal> 은 안드에서 별도
  // 윈도우라 내부 useSafeAreaInsets() 의 bottom 이 0/부정확 → 부모에서 받아 쓴다.
  insetTop: number;
  insetBottom: number;
}) {
  const { t } = useTranslation();
  // 모달 밖에서 받은 inset 신뢰. 안드에서 0 으로 떨어지면 내비바 높이 추정으로 보강.
  const bottomPad = estimateAndroidNavBarPad(insetBottom);
  const videoRef = useRef<AVVideo>(null);
  // 🔒 비공개(워커) 경유: 캐시 히트면 finalUrl 즉시 채워져 스피너 없이 자동재생,
  //    미스면 짧은 스피너 후 워커 presigned URL 로 마운트(shouldPlay 로 자동재생).
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
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent={false}
      onRequestClose={handleClose}
    >
      {/* RN <Modal> 은 안드에서 별도 윈도우라 내부 inset 이 0/부정확.
          → 부모(모달 밖)에서 받은 insetTop/insetBottom 을 직접 쓴다.
          navigationBarTranslucent={false} 로 모달 윈도우가 내비바를 침범하지 않게 해
          영상·네이티브 컨트롤(스크러버)이 안드 3버튼 내비바에 가리지 않게 한다. */}
      <View style={[styles.videoModalBg, { paddingBottom: bottomPad }]}>
        <View style={[styles.videoModalHeader, { paddingTop: insetTop }]}>
          <TouchableOpacity style={styles.videoCloseBtn} onPress={handleClose} activeOpacity={0.8}>
            <Ionicons name="close" size={26} color="#fff" />
            <Text style={styles.videoCloseText}>{t('diary.videoCloseBtn')}</Text>
          </TouchableOpacity>
        </View>
        {/* finalUrl 해결 전 스피너, 해결되면 AVVideo 마운트.
            shouldPlay 로 자동재생 보장, useNativeControls 가 재생바·시킹 제공.
            useNativeControls 특성상 우측 하단 "전체화면" 버튼이 노출되나 재생 우선으로 감수. */}
        {finalUrl ? (
          <AVVideo
            ref={videoRef}
            source={{ uri: finalUrl }}
            useNativeControls
            shouldPlay
            resizeMode={ResizeMode.CONTAIN}
            style={styles.fullscreenVideo}
          />
        ) : (
          <View style={[styles.fullscreenVideo, styles.videoLoadingBox]}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── 작성/수정 에디터 (펼친 일기장) ───────────────────────────────────────────

interface EditorProps {
  visible: boolean;
  dateStr: string;
  patientId: string;
  existing: DiaryEntry | null;
  onClose: () => void;
  onSaved: (input: {
    text: string;
    audioUrl: string | null;
    audioR2Key: string | null;
    photoUrls: string[];
    videoMediaId: string | null;
    mediaOrder: string[] | null;
  }) => Promise<void>;
  onDeleted: () => Promise<void>;
  // 모달 밖(DiaryScreen 본문)에서 구한 정확한 inset — 에디터 내부 풀스크린 영상
  // 미리보기 모달의 안드 3버튼 내비바 가림 방지에 사용(모달 내부 inset 은 0/부정확).
  parentInsetTop: number;
  parentInsetBottom: number;
}

// ─── 괘선 종이 (시안 §paper) ───────────────────────────────────────────────────
// RN엔 repeating-linear-gradient가 없으므로, 콘텐츠 높이를 onLayout으로 재서
// 32px 간격마다 1px 가로선 View를 절대배치로 깔고, 그 위에 글·첨부를 얹는다.
const RULE_SPACING = 32;
const PAPER_PT = 14; // paperContent 상단 패딩 = 첫 글줄 시작 y

function RuledPaper({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  // 줄은 각 글줄 박스의 '하단'에 그어서 글이 줄 위에 앉게 한다(노트 괘선).
  const lineCount = Math.max(0, Math.ceil((height - PAPER_PT) / RULE_SPACING));
  return (
    <View
      style={styles.paperFill}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {/* 괘선 레이어 (글·첨부 뒤) */}
      <View style={styles.ruleLayer} pointerEvents="none">
        {Array.from({ length: lineCount }).map((_, i) => (
          <View key={i} style={[styles.ruleLine, { top: PAPER_PT + (i + 1) * RULE_SPACING }]} />
        ))}
      </View>
      {/* 콘텐츠 (글 + 첨부 미리보기) — 괘선 위 */}
      <View style={styles.paperContent}>{children}</View>
    </View>
  );
}

function DiaryEditorModal({ visible, dateStr, patientId, existing, onClose, onSaved, onDeleted, parentInsetTop, parentInsetBottom }: EditorProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dialog = useDialog();
  const { isPremium } = useSubscription();
  const insets = useSafeAreaInsets();

  // ── 그룹 하루 미디어 풀 게이팅 (국내·해외 동일 기준) ──
  // 사진5·영상2·음성1을 그룹당 하루 공유 풀로 제한(국내·해외 free 동일). 남들이 오늘 쓴 양
  // (내 글 제외)을 불러와 내 작성기 잔여 한도를 계산. 해외 premium 만 무제한.
  // 한도 도달 안내: 해외=구독 유도(업셀), 국내=결제 문구 없는 담백한 안내.
  const overseas = isOverseasLocale();
  const unlimited = overseas && isPremium; // 해외 프리미엄만 무제한
  const [groupOthers, setGroupOthers] = useState<DailyMediaUsage>(EMPTY_USAGE);
  useEffect(() => {
    if (!visible || unlimited || !patientId) { setGroupOthers(EMPTY_USAGE); return; }
    let cancelled = false;
    countTodayGroupMedia(patientId, user?.timezone, user?.id)
      .then((u) => { if (!cancelled) setGroupOthers(u); })
      .catch(() => { if (!cancelled) setGroupOthers(EMPTY_USAGE); });
    return () => { cancelled = true; };
  }, [visible, unlimited, patientId, user?.id, user?.timezone]);

  const photoCapNum = unlimited ? 999 : Math.max(0, FREE_DAILY_LIMITS.photo - groupOthers.photo);
  const videoPoolFull = !unlimited && groupOthers.video >= FREE_DAILY_LIMITS.video;
  const voicePoolFull = !unlimited && groupOthers.voice >= FREE_DAILY_LIMITS.voice;

  const showQuotaReached = (kind: 'photo' | 'video' | 'voice') => {
    if (overseas) {
      // 해외: 구독 유도
      const msgKey =
        kind === 'photo' ? 'diary.quotaPhotoMsg' : kind === 'video' ? 'diary.quotaVideoMsg' : 'diary.quotaVoiceMsg';
      dialog
        .confirm({
          title: t('diary.quotaReachedTitle'),
          message: t(msgKey),
          confirmText: t('subscription.upgradeBtn'),
          cancelText: t('common.cancel'),
        })
        .then((ok) => { if (ok) navigateTo('Main', { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } }); });
    } else {
      // 국내: 결제/구독 문구 없이 담백하게 안내
      const msgKey =
        kind === 'photo' ? 'diary.quotaPlainPhotoMsg' : kind === 'video' ? 'diary.quotaPlainVideoMsg' : 'diary.quotaPlainVoiceMsg';
      dialog.alert({ title: t('diary.quotaReachedTitlePlain'), message: t(msgKey) });
    }
  };
  // 하단 도구막대(키보드 위 고정) 하단 패딩 — 안드 3버튼/홈인디케이터 잘림 방지(글로벌 규칙).
  const toolbarBottomPad = useBottomSheetPadding(20);

  // ── 본문 키보드 가림 방지 (PostDetailScreen 댓글 입력 패턴과 동일) ──
  // 일기는 본문이 가장 길어지는 화면. 안드 edge-to-edge(Expo SDK54+)에서는 키보드가 inset으로 들어와
  // KeyboardAvoidingView(behavior=undefined)만으로는 커서가 키보드 아래로 가려진다.
  // → 키보드 높이를 직접 받아 ScrollView 맨 아래 스페이서 + 본문 커서 줄을 키보드 위로 scrollTo.
  const editorScrollRef = useRef<ScrollView>(null);
  const bodyInputRef = useRef<TextInput>(null);
  const [editorKbHeight, setEditorKbHeight] = useState(0);
  const editorKbRef = useRef(0);
  const bodyFocused = useRef(false);
  // 현재 ScrollView 스크롤 오프셋(onScroll로 추적) — 화면 절대좌표 측정값을 오프셋 델타로 환산하기 위함.
  const editorScrollY = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      const h = e.endCoordinates?.height ?? 0;
      setEditorKbHeight(h);
      editorKbRef.current = h;
      if (bodyFocused.current) setTimeout(scrollBodyCursorIntoView, 60);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setEditorKbHeight(0);
      editorKbRef.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 본문 커서 줄(=입력칸 하단 근사)을 키보드 바로 위로 끌어올린다.
  // RuledPaper 중첩 패딩이 있어 onLayout 상대 y는 부정확 → 입력칸을 화면 절대좌표(measureInWindow)로 측정하고,
  // 키보드 윗선보다 아래로 내려간 만큼(overflow)을 현재 스크롤 오프셋에 더해 스크롤한다.
  const scrollBodyCursorIntoView = () => {
    if (Platform.OS !== 'android' || editorKbRef.current === 0) return;
    const node = bodyInputRef.current as any;
    if (!node?.measureInWindow) return;
    node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const keyboardTop = Dimensions.get('window').height - editorKbRef.current;
      const cursorScreenY = y + h; // 입력칸 하단(= 마지막 줄/커서 근사)의 화면 절대 Y
      const overflow = cursorScreenY - keyboardTop + 24; // 24 = 키보드 윗선과의 여유
      if (overflow > 0) {
        editorScrollRef.current?.scrollTo({ y: editorScrollY.current + overflow, animated: true });
      }
    });
  };

  const [text, setText] = useState(existing?.text ?? '');
  // 사진: 기존 url + 신규로 추가한 로컬 uri 를 함께 관리
  const [photoUrls, setPhotoUrls] = useState<string[]>(existing?.photo_urls ?? []);
  const [newPhotoUris, setNewPhotoUris] = useState<string[]>([]);
  // 첨부 표시 순서 토큰(에디터 로컬 키 기준).
  //   사진: 'photo:<url|로컬uri>'  / 영상: 'video'  / 음성: 'audio'
  // 저장 시 신규 사진의 로컬 uri 토큰을 업로드된 url 토큰으로 치환해 최종 media_order를 만든다.
  // 초기값: 기존 행의 media_order(있으면) → 현재 첨부에 맞춰 정합화. 없으면 기본 순서.
  const [mediaOrder, setMediaOrder] = useState<string[]>(() =>
    normalizeMediaOrder(existing?.media_order ?? null, {
      photoUrls: existing?.photo_urls ?? [],
      hasVideo: !!existing?.video_media_id,
      hasAudio: !!existing?.audio_url,
    }),
  );
  // 음성
  const [audioUrl, setAudioUrl] = useState<string | null>(existing?.audio_url ?? null);
  const [audioR2Key, setAudioR2Key] = useState<string | null>(existing?.audio_r2_key ?? null);
  const [recordedAudioUri, setRecordedAudioUri] = useState<string | null>(null);
  // 영상
  const [videoMediaId, setVideoMediaId] = useState<string | null>(existing?.video_media_id ?? null);
  const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(existing?.video_url ?? null);
  const [newVideoUri, setNewVideoUri] = useState<string | null>(null);
  // 신규 첨부 영상 길이(초). 갤러리/촬영 결과의 asset.duration(ms)에서 캡처해
  // 저장 시 media_logs.duration_seconds 로 기록 → 재생 전에도 길이 배지 표시.
  const [newVideoDurationSec, setNewVideoDurationSec] = useState<number | null>(null);

  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 음성 녹음 안내 시트 (안내 → 녹음중 → 정지 흐름을 담음)
  const [showRecordSheet, setShowRecordSheet] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // 사진/동영상 첨부 방식 선택 바텀시트 (촬영 / 갤러리에서 선택)
  const [showPhotoSheet, setShowPhotoSheet] = useState(false);
  const [showVideoSheet, setShowVideoSheet] = useState(false);

  // 첨부 영상 미리보기(풀스크린)
  const [showVideoPreview, setShowVideoPreview] = useState(false);
  // 첨부 사진 전체보기(풀스크린 라이트박스). null이면 닫힘, 숫자면 해당 인덱스부터 표시.
  const [photoViewerIndex, setPhotoViewerIndex] = useState<number | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  // 녹음 중 경과시간 카운트 (1초마다)
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // 첨부 음성 미리듣기 uri (로컬 녹음 uri 우선, 없으면 기존 audio_url)
  const previewUri = recordedAudioUri ?? audioUrl;

  // ── 사진 추가 ──
  // [사진] 버튼 → 바로 갤러리를 열지 않고 "촬영/갤러리에서 선택" 시트를 연다.
  const handleOpenPhotoSheet = () => {
    const total = photoUrls.length + newPhotoUris.length;
    if (total >= photoCapNum) {
      showQuotaReached('photo');
      return;
    }
    setShowPhotoSheet(true);
  };

  // 갤러리 선택 / 카메라 촬영 결과를 동일하게 처리 (5장 제한·newPhotoUris 추가)
  // 다중 선택(갤러리)도 지원 — 결과의 여러 장을 남은 장수만큼 한 번에 추가한다.
  const addPhotoFromResult = (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || result.assets.length === 0) return;
    const total = photoUrls.length + newPhotoUris.length;
    const remaining = photoCapNum - total;
    if (remaining <= 0) {
      showQuotaReached('photo');
      return;
    }
    const picked = result.assets.slice(0, remaining).map((a) => a.uri);
    setNewPhotoUris((prev) => [...prev, ...picked]);
    // 선택 장수가 남은 자리를 초과한 경우 안내
    if (result.assets.length > remaining) {
      dialog.alert({ title: t('diary.photoMax5TitleAlt'), message: t('diary.photoMax5PartialMsg', { remaining }) });
    }
  };

  // "갤러리에서 선택" — 기존 갤러리 로직 (5장 제한·quality 0.7 그대로)
  const handlePickPhotoFromLibrary = async () => {
    setShowPhotoSheet(false);
    const total = photoUrls.length + newPhotoUris.length;
    if (total >= photoCapNum) {
      showQuotaReached('photo');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('diary.permRequiredTitle'), message: t('diary.galleryPermMsg') });
      return;
    }
    const remaining = photoCapNum - total;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: remaining, // 남은 장수까지만 선택 가능
    });
    addPhotoFromResult(result);
  };

  // "촬영" — 카메라로 사진 촬영 후 갤러리와 동일한 처리 경로로 흘려보냄
  const handleTakePhoto = async () => {
    setShowPhotoSheet(false);
    const total = photoUrls.length + newPhotoUris.length;
    if (total >= photoCapNum) {
      showQuotaReached('photo');
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('diary.permRequiredTitle'), message: t('diary.cameraPermMsg') });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    addPhotoFromResult(result);
  };

  const handleRemovePhoto = (index: number, isExisting: boolean) => {
    if (isExisting) {
      setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      setNewPhotoUris((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // ── 영상 선택 ──
  // [동영상] 버튼 → "촬영/갤러리에서 선택" 시트를 연다.
  const handleOpenVideoSheet = () => {
    if (videoPoolFull) { showQuotaReached('video'); return; }
    setShowVideoSheet(true);
  };

  const handlePickVideo = async () => {
    setShowVideoSheet(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('diary.permRequiredTitle'), message: t('diary.galleryPermMsg') });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const durSec = asset.duration ? asset.duration / 1000 : 0;
      if (durSec > MAX_VIDEO_DURATION_SEC) {
        dialog.alert({ title: t('diary.videoTooLongTitle'), message: t('diary.videoTooLongMsg') });
        return;
      }
      setNewVideoUri(asset.uri);
      setNewVideoDurationSec(durSec > 0 ? Math.round(durSec) : null);
      setExistingVideoUrl(null);
      setVideoMediaId(null);
    }
  };

  const handleRecordVideo = async () => {
    setShowVideoSheet(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('diary.permRequiredTitle'), message: t('diary.cameraPermMsg') });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const durSec = asset.duration ? asset.duration / 1000 : 0;
      if (durSec > MAX_VIDEO_DURATION_SEC) {
        dialog.alert({ title: t('diary.videoTooLongTitle'), message: t('diary.videoTooLongMsg') });
        return;
      }
      setNewVideoUri(asset.uri);
      setNewVideoDurationSec(durSec > 0 ? Math.round(durSec) : null);
      setExistingVideoUrl(null);
      setVideoMediaId(null);
    }
  };

  const handleRemoveVideo = () => {
    setShowVideoPreview(false);
    setNewVideoUri(null);
    setNewVideoDurationSec(null);
    setExistingVideoUrl(null);
    setVideoMediaId(null);
  };

  // ── 음성 녹음 ──
  // [음성] 버튼 → 바로 녹음하지 않고 안내 시트를 연다.
  const handleOpenRecordSheet = () => {
    if (voicePoolFull) { showQuotaReached('voice'); return; }
    setRecordSeconds(0);
    setShowRecordSheet(true);
  };

  // 안내 시트의 "녹음 시작" → 실제 녹음 시작
  const handleStartRecord = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setShowRecordSheet(false);
        dialog.alert({ title: t('diary.micPermTitle'), message: t('diary.micPermMsg') });
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setRecordSeconds(0);
      setRecording(true);
    } catch (e) {
      setRecording(false);
      setShowRecordSheet(false);
      dialog.alert({ title: t('diary.recordStartFailTitle'), message: t('diary.genericRetryMsg') });
    }
  };

  // 안내 시트의 "정지" → 기존 중지/저장 로직 후 시트 닫기
  const handleStopRecord = async () => {
    try {
      const rec = recordingRef.current;
      if (rec) {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        recordingRef.current = null;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        if (uri) {
          setRecordedAudioUri(uri);
          setAudioUrl(null);
          setAudioR2Key(null);
        }
      }
    } catch (e) {
      dialog.alert({ title: t('diary.recordFailTitle'), message: t('diary.genericRetryMsg') });
    } finally {
      setRecording(false);
      setShowRecordSheet(false);
    }
  };

  // 안내 시트 닫기 요청(취소/스와이프/백버튼). 녹음 중이면 정지 여부 확인.
  const handleCloseRecordSheet = async () => {
    if (recording) {
      const stop = await dialog.confirm({
        title: t('diary.stopRecordingTitle'),
        message: t('diary.stopRecordingMsg'),
        confirmText: t('diary.stopAndSave'),
        cancelText: t('diary.continueRecording'),
      });
      if (!stop) return;
      await handleStopRecord();
      return;
    }
    setShowRecordSheet(false);
  };

  const handleRemoveAudio = () => {
    setRecordedAudioUri(null);
    setAudioUrl(null);
    setAudioR2Key(null);
  };

  const hasAudio = !!recordedAudioUri || !!audioUrl;
  const hasVideo = !!newVideoUri || !!existingVideoUrl;

  // 에디터 로컬 사진 키 목록(기존 url + 신규 로컬 uri를 순서대로). mediaOrder의 'photo:' 토큰 식별자.
  const editorPhotoKeys = [...photoUrls, ...newPhotoUris];

  // 첨부 구성이 바뀌면(추가/삭제) mediaOrder를 정합화한다.
  //   - 사라진 토큰 제거 / 새로 생긴 토큰은 기본 위치(사진→영상→음성)대로 끝에 append
  //   - 사용자가 바꾼 기존 순서는 유지
  useEffect(() => {
    setMediaOrder((prev) =>
      normalizeMediaOrder(prev, {
        photoUrls: editorPhotoKeys,
        hasVideo,
        hasAudio,
      }),
    );
    // editorPhotoKeys는 매 렌더 새 배열이라 join으로 안정화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorPhotoKeys.join('|'), hasVideo, hasAudio]);

  // mediaOrder의 한 토큰을 위/아래로 한 칸 이동
  const moveMediaToken = (index: number, dir: -1 | 1) => {
    setMediaOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // ── 저장 ──
  const handleSave = async () => {
    if (!user) return;
    if (recording) {
      dialog.alert({ title: t('diary.recordingInProgressTitle'), message: t('diary.recordingInProgressMsg') });
      return;
    }
    setSaving(true);
    try {
      // 1) 신규 사진 업로드
      setSaveStage(i18n.t('loading.savingPhoto'));
      const uploadedPhotos: string[] = [...photoUrls];
      for (const uri of newPhotoUris) {
        const compressed = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1280 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
        );
        const res = await uploadPhoto(compressed.uri, patientId);
        uploadedPhotos.push(res.url);
      }

      // 2) 신규 음성 업로드
      let finalAudioUrl = audioUrl;
      let finalAudioKey = audioR2Key;
      if (recordedAudioUri) {
        setSaveStage(i18n.t('loading.savingAudio'));
        const res = await uploadSound(recordedAudioUri, user.id, 'audio/m4a', UPLOAD_TIMEOUT_MS);
        finalAudioUrl = res.url;
        finalAudioKey = res.key;
      }

      // 3) 신규 영상 업로드 + media_logs(source='diary') 행 생성
      let finalVideoMediaId = videoMediaId;
      if (newVideoUri) {
        setSaveStage(i18n.t('loading.savingVideoShort'));
        let videoUri = newVideoUri;
        try {
          videoUri = await VideoCompressor.compress(newVideoUri, {
            compressionMethod: 'manual',
            maxSize: 1280,
            bitrate: 1500000,
          });
        } catch (_) {
          // 압축 실패 시 원본 사용
        }
        const res = await uploadVideo(videoUri, patientId, 'body_state', UPLOAD_TIMEOUT_MS);
        const { data: inserted, error: mlError } = await supabase
          .from('media_logs')
          .insert({
            patient_id: patientId,
            logged_by: user.id,
            r2_url: res.url,
            r2_key: res.key,
            expires_at: res.expires_at,
            media_type: 'video',
            category: 'body_state',
            logged_at: new Date(`${dateStr}T12:00:00.000+09:00`).toISOString(),
            source: 'diary',
            // 길이(초) 저장 → 썸네일에서 재생 전에도 길이 배지 표시(몸상태와 동일 방식)
            duration_seconds:
              newVideoDurationSec != null && newVideoDurationSec > 0 ? newVideoDurationSec : null,
          } as any)
          .select('id')
          .single();
        if (mlError) throw new Error(mlError.message);
        finalVideoMediaId = (inserted as any)?.id ?? null;
      }

      setSaveStage(i18n.t('loading.savingShort'));

      // ── 최종 media_order 만들기 ──
      // 에디터 사진 키(기존 url + 신규 로컬 uri)와 업로드된 최종 url을 인덱스로 매핑.
      // uploadedPhotos = [...photoUrls, ...신규 업로드 url] 이고
      // editorPhotoKeys = [...photoUrls, ...newPhotoUris] 라 인덱스가 1:1로 정렬된다.
      const keyToFinalUrl: Record<string, string> = {};
      editorPhotoKeys.forEach((key, i) => {
        if (uploadedPhotos[i]) keyToFinalUrl[key] = uploadedPhotos[i];
      });
      const finalMediaOrder = mediaOrder
        .map((token) => {
          if (token.startsWith(PHOTO_PREFIX)) {
            const key = token.slice(PHOTO_PREFIX.length);
            const url = keyToFinalUrl[key];
            return url ? `${PHOTO_PREFIX}${url}` : null;
          }
          if (token === VIDEO_TOKEN) return finalVideoMediaId ? VIDEO_TOKEN : null;
          if (token === AUDIO_TOKEN) return finalAudioUrl ? AUDIO_TOKEN : null;
          return null;
        })
        .filter((t): t is string => t !== null);

      await onSaved({
        text: text.trim(),
        audioUrl: finalAudioUrl,
        audioR2Key: finalAudioKey,
        photoUrls: uploadedPhotos,
        videoMediaId: finalVideoMediaId,
        mediaOrder: finalMediaOrder,
      });
    } catch (e: any) {
      dialog.alert({
        title: t('diary.saveFailTitle'),
        message:
          e?.message === 'UPLOAD_TIMEOUT'
            ? t('diary.slowInternetMsg')
            : e?.message ?? t('diary.genericRetryMsg'),
      });
    } finally {
      setSaving(false);
      setSaveStage(null);
    }
  };

  // ── 삭제 (내가 쓴 글) ──
  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: t('diary.deletePostTitle'),
      message: t('diary.deletePostMsg'),
      destructive: true,
      confirmText: t('medManage.delete'),
      cancelText: t('common.cancel'),
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await onDeleted();
    } catch (e: any) {
      dialog.alert({ title: t('diary.deleteFailTitle'), message: e?.message ?? t('diary.genericRetryMsg') });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal 안에서는 react-native-safe-area-context의 SafeAreaView가 iOS 상단 인셋을
          신뢰성 있게 반영하지 못해(노치/다이나믹 아일랜드 아래로 안 내려감) 헤더 버튼이
          상태바에 가려 탭이 안 되는 문제가 있었다. useSafeAreaInsets()의 top을 직접
          paddingTop으로 적용해 헤더가 항상 노치 아래에 오도록 한다. (작성/수정 모드 전용) */}
      <View style={[styles.editorSafe, { paddingTop: insets.top }]}>
        <DiaryHeader
          title={existing ? t('diary.editTitle') : t('diary.writeTitle')}
          bg={Journal.pageDeep}
          onLeftPress={onClose}
          rightComponent={
            <View style={styles.headerRightRow}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || deleting}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={styles.headerActionBtn}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Journal.accent} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={20} color={Journal.accent} />
                    <Text style={styles.headerActionText}>{t('diary.saveBtn')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          }
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={editorScrollRef}
            style={styles.flex1}
            contentContainerStyle={styles.editorContentFill}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => { editorScrollY.current = e.nativeEvent.contentOffset.y; }}
            // iOS는 키보드 높이만큼 자동으로 하단 인셋을 잡아 커서가 가려지지 않게 함 (RN 0.70+)
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            {/* 괘선 종이: 글 + 첨부 미리보기가 한 장의 괘선 위에 (시안 §paper) */}
            <RuledPaper>
              <TextInput
                ref={bodyInputRef}
                style={styles.editorInput}
                value={text}
                onChangeText={setText}
                placeholder={t('diary.bodyPlaceholder')}
                placeholderTextColor={Journal.placeholder}
                multiline
                textAlignVertical="top"
                // 본문이 길어지며 커서 줄이 키보드 아래로 내려가면 그만큼 스크롤해 항상 키보드 위에 보이게.
                onContentSizeChange={() => {
                  if (bodyFocused.current) scrollBodyCursorIntoView();
                }}
                onSelectionChange={() => {
                  if (bodyFocused.current) scrollBodyCursorIntoView();
                }}
                onFocus={() => {
                  bodyFocused.current = true;
                  setTimeout(scrollBodyCursorIntoView, 250);
                }}
                onBlur={() => {
                  bodyFocused.current = false;
                }}
              />

              {/* 첨부 미리보기 묶음 — media_order 순서대로 세로 리스트.
                  각 항목: 썸네일/플레이어 + [위로]/[아래로] 순서 버튼 + ✕ 제거. */}
              {mediaOrder.length > 0 && (
                <View style={styles.attBlock}>
                  {mediaOrder.length > 1 && (
                    <Text style={styles.orderHint}>{t('diary.reorderHint')}</Text>
                  )}
                  {mediaOrder.map((token, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === mediaOrder.length - 1;

                    // 항목 콘텐츠(썸네일/플레이어)와 제거 동작을 토큰별로 결정
                    let content: React.ReactNode = null;
                    let onRemove: (() => void) | null = null;

                    if (token === AUDIO_TOKEN) {
                      if (recording || !previewUri) return null;
                      content = <AudioTile uri={previewUri} />;
                      onRemove = handleRemoveAudio;
                    } else if (token === VIDEO_TOKEN) {
                      const vUri = newVideoUri ?? existingVideoUrl;
                      if (!vUri) return null;
                      content = (
                        <VideoThumb
                          uri={vUri}
                          tileStyle={styles.thumbSquareEditor}
                          onPress={() => setShowVideoPreview(true)}
                        />
                      );
                      onRemove = handleRemoveVideo;
                    } else if (token.startsWith(PHOTO_PREFIX)) {
                      const key = token.slice(PHOTO_PREFIX.length);
                      const existingIdx = photoUrls.indexOf(key);
                      const newIdx = newPhotoUris.indexOf(key);
                      if (existingIdx < 0 && newIdx < 0) return null;
                      const photoIdx = editorPhotoKeys.indexOf(key);
                      content = (
                        <TouchableOpacity
                          style={styles.thumbSquareEditor}
                          activeOpacity={0.85}
                          onPress={() => setPhotoViewerIndex(photoIdx >= 0 ? photoIdx : 0)}
                        >
                          <R2Image uri={key} style={styles.thumbSquareImg} />
                        </TouchableOpacity>
                      );
                      onRemove =
                        existingIdx >= 0
                          ? () => handleRemovePhoto(existingIdx, true)
                          : () => handleRemovePhoto(newIdx, false);
                    } else {
                      return null;
                    }

                    return (
                      <View key={`mo-${token}-${idx}`} style={styles.attItemRow}>
                        <View style={styles.attItemThumbWrap}>
                          {content}
                          {onRemove && (
                            <TouchableOpacity style={styles.attRemoveX} onPress={onRemove}>
                              <Ionicons name="close" size={14} color={Journal.accent} />
                            </TouchableOpacity>
                          )}
                        </View>
                        {/* 순서 변경: 아이콘 + 텍스트 (60대 접근성) */}
                        {mediaOrder.length > 1 && (
                          <View style={styles.orderBtnCol}>
                            <TouchableOpacity
                              style={[styles.orderBtn, isFirst && styles.orderBtnDisabled]}
                              onPress={() => moveMediaToken(idx, -1)}
                              disabled={isFirst}
                              activeOpacity={0.8}
                            >
                              <Ionicons name="arrow-up" size={16} color={isFirst ? Journal.inkFaint : Journal.accent} />
                              <Text style={[styles.orderBtnText, isFirst && styles.orderBtnTextDisabled]}>{t('diary.moveUp')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.orderBtn, isLast && styles.orderBtnDisabled]}
                              onPress={() => moveMediaToken(idx, 1)}
                              disabled={isLast}
                              activeOpacity={0.8}
                            >
                              <Ionicons name="arrow-down" size={16} color={isLast ? Journal.inkFaint : Journal.accent} />
                              <Text style={[styles.orderBtnText, isLast && styles.orderBtnTextDisabled]}>{t('diary.moveDown')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </RuledPaper>

            {/* 안드 edge-to-edge 키보드 가림 방지용 하단 스페이서 — 키보드 높이만큼 공간을 줘
                본문 커서 줄이 키보드 위로 스크롤될 수 있게 한다. (PostDetailScreen 패턴과 동일) */}
            {editorKbHeight > 0 && <View style={{ height: editorKbHeight }} />}
          </ScrollView>

          {/* 첨부 조건 안내 (도구막대 바로 위)
              해외 premium=무제한이라 숨김 / 해외 free=구독 유도 문구 / 국내=담백한 한도 안내(결제문구 없음) */}
          {!unlimited && (
            overseas ? (
              /* 해외 무료: 실제 결제 유도 CTA — 탭하면 구독(결제) 페이지로 이동 */
              <TouchableOpacity
                style={styles.toolbarUpsell}
                onPress={() => navigateTo('Main', { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } })}
                activeOpacity={0.85}
              >
                <Ionicons name="star" size={15} color={Journal.accent} />
                <View style={styles.toolbarUpsellTextCol}>
                  <Text style={styles.toolbarUpsellText}>{t('diary.attachHintUpsellInfo')}</Text>
                  <Text style={styles.toolbarUpsellCta}>{t('diary.attachHintUpsellCta')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Journal.accent} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.toolbarHint}>{t('diary.attachHint')}</Text>
            )
          )}

          {/* 도구막대 (키보드 위 고정) — [사진] [동영상] [음성] */}
          <View style={[styles.toolbarBar, { paddingBottom: toolbarBottomPad }]}>
            <TouchableOpacity style={styles.tool} onPress={handleOpenPhotoSheet} activeOpacity={0.8}>
              <Ionicons name="image-outline" size={20} color={Journal.inkSoft} />
              <Text style={styles.toolText}>{t('diary.photoToolLabel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tool}
              onPress={
                hasVideo
                  ? () =>
                      dialog.alert({
                        title: t('diary.videoOnlyOneTitle'),
                        message: t('diary.videoOnlyOneMsg'),
                      })
                  : handleOpenVideoSheet
              }
              activeOpacity={0.8}
            >
              <Ionicons name="videocam-outline" size={20} color={Journal.inkSoft} />
              <Text style={styles.toolText}>{t('diary.videoToolLabel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tool}
              onPress={
                hasAudio
                  ? () =>
                      dialog.alert({
                        title: t('diary.audioOnlyOneTitle'),
                        message: t('diary.audioOnlyOneMsg'),
                      })
                  : handleOpenRecordSheet
              }
              activeOpacity={0.8}
            >
              <Ionicons name="mic-outline" size={20} color={Journal.inkSoft} />
              <Text style={styles.toolText}>{t('diary.audioToolLabel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* 첨부 영상 미리보기 (풀스크린) — 로컬 신규 uri 우선, 없으면 기존 url */}
        {showVideoPreview && (newVideoUri || existingVideoUrl) && (
          <FullscreenVideoModal
            url={(newVideoUri ?? existingVideoUrl) as string}
            onClose={() => setShowVideoPreview(false)}
            insetTop={parentInsetTop}
            insetBottom={parentInsetBottom}
          />
        )}

        {/* 첨부 사진 썸네일 탭 → 곧바로 풀스크린 원본 뷰어 (인라인 갤러리 중간단계 없음) */}
        {photoViewerIndex !== null && editorPhotoKeys.length > 0 && (
          <ImageGalleryViewer
            urls={editorPhotoKeys}
            initialFullscreenIndex={photoViewerIndex}
            onClose={() => setPhotoViewerIndex(null)}
          />
        )}

        {/* 음성 녹음 안내 시트 (안내 → 녹음중 → 정지) */}
        <RecordSheet
          visible={showRecordSheet}
          recording={recording}
          seconds={recordSeconds}
          onStart={handleStartRecord}
          onStop={handleStopRecord}
          onClose={handleCloseRecordSheet}
        />

        {/* 사진 첨부 방식 선택 시트 (촬영 / 갤러리에서 선택) */}
        <AttachSheet
          visible={showPhotoSheet}
          title={t('diary.addPhotoTitle')}
          captureLabel={t('diary.captureLabel')}
          captureIcon="camera"
          libraryLabel={t('diary.libraryLabel')}
          libraryIcon="images"
          onCapture={handleTakePhoto}
          onLibrary={handlePickPhotoFromLibrary}
          onClose={() => setShowPhotoSheet(false)}
        />

        {/* 동영상 첨부 방식 선택 시트 (촬영 / 갤러리에서 선택) */}
        <AttachSheet
          visible={showVideoSheet}
          title={t('diary.addVideoTitle')}
          captureLabel={t('diary.captureLabel')}
          captureIcon="videocam"
          libraryLabel={t('diary.libraryLabel')}
          libraryIcon="images"
          onCapture={handleRecordVideo}
          onLibrary={handlePickVideo}
          onClose={() => setShowVideoSheet(false)}
        />

        {/* 저장 중 오버레이 — 전체 화면 덮고 터치 차단(중복 조작 방지).
            expo-blur 미포함이라 진짜 블러 대신 빈티지 톤 반투명 딤으로 대체.
            (진짜 배경 블러는 expo-blur 추가 + 새 빌드 필요) */}
        {saving && (
          <View style={styles.savingOverlay} pointerEvents="auto">
            <View style={styles.savingCard}>
              <ActivityIndicator size="large" color={Journal.accent} />
              <Text style={styles.savingText}>{saveStage ?? i18n.t('loading.savingShort')}</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── 음성 녹음 안내 바텀시트 (안내 → 녹음중 → 정지) ───────────────────────────
// [음성] 버튼은 바로 녹음하지 않고 이 시트를 연다. "녹음 시작"을 눌러야 녹음됨.
// 녹음 중에는 실수로 닫혀 녹음이 날아가지 않도록, 스와이프-닫기/백버튼은
// 부모의 onClose(확인 후 정지·저장)로만 처리한다.
function RecordSheet({
  visible,
  recording,
  seconds,
  onStart,
  onStop,
  onClose,
}: {
  visible: boolean;
  recording: boolean;
  seconds: number;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);

  useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  // 안드 백버튼: 부모 onClose(녹음 중이면 확인)로 위임
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.recSheetBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.recSheetContainer} pointerEvents="box-none">
        <Animated.View
          style={[styles.recSheetCard, { paddingBottom: insets.bottom + 18, transform: [{ translateY }] }]}
          {...panHandlers}
        >
          <View style={styles.recSheetGrabber} />

          <Text style={styles.recSheetTitle}>{t('diary.recordSheetTitle')}</Text>

          {!recording ? (
            <>
              <Text style={styles.recSheetGuide}>
                {t('diary.recordSheetGuideLong')}
              </Text>
              <TouchableOpacity style={styles.recSheetStartBtn} onPress={onStart} activeOpacity={0.85}>
                <Ionicons name="mic" size={20} color="#FAF5E9" />
                <Text style={styles.recSheetStartText}>{t('diary.recordStart')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.recSheetCancelBtn} onPress={onClose} activeOpacity={0.8}>
                <Text style={styles.recSheetCancelText}>{t('diary.cancel')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.recSheetLiveRow}>
                <View style={styles.recSheetDot} />
                <Text style={styles.recSheetLiveText}>{t('diary.recordingLive')}</Text>
                <Text style={styles.recSheetTimer}>
                  {mm}:{ss}
                </Text>
              </View>
              <Text style={styles.recSheetGuide}>{t('diary.recordSheetGuideShort')}</Text>
              <TouchableOpacity style={styles.recSheetStopBtn} onPress={onStop} activeOpacity={0.85}>
                <Ionicons name="stop" size={20} color="#FAF5E9" />
                <Text style={styles.recSheetStartText}>{t('diary.recordStop')}</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── 사진/동영상 첨부 방식 선택 바텀시트 (촬영 / 갤러리에서 선택) ────────────────
// [사진]/[동영상] 버튼은 바로 갤러리/카메라를 열지 않고 이 시트를 연다.
// 음성 녹음 시트(RecordSheet)와 동일한 시트/버튼 스타일을 재사용해 시각적으로 일관되게 한다.
function AttachSheet({
  visible,
  title,
  captureLabel,
  captureIcon,
  libraryLabel,
  libraryIcon,
  onCapture,
  onLibrary,
  onClose,
}: {
  visible: boolean;
  title: string;
  captureLabel: string;
  captureIcon: React.ComponentProps<typeof Ionicons>['name'];
  libraryLabel: string;
  libraryIcon: React.ComponentProps<typeof Ionicons>['name'];
  onCapture: () => void;
  onLibrary: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);

  useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  // 안드 백버튼: 시트 닫기
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.recSheetBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.recSheetContainer} pointerEvents="box-none">
        <Animated.View
          style={[styles.recSheetCard, { paddingBottom: insets.bottom + 18, transform: [{ translateY }] }]}
          {...panHandlers}
        >
          <View style={styles.recSheetGrabber} />

          <Text style={styles.recSheetTitle}>{title}</Text>

          <TouchableOpacity style={styles.recSheetStartBtn} onPress={onCapture} activeOpacity={0.85}>
            <Ionicons name={captureIcon} size={20} color="#FAF5E9" />
            <Text style={styles.recSheetStartText}>{captureLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachLibraryBtn} onPress={onLibrary} activeOpacity={0.85}>
            <Ionicons name={libraryIcon} size={20} color={Journal.accent} />
            <Text style={styles.attachLibraryText}>{libraryLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.recSheetCancelBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.recSheetCancelText}>{t('diary.cancel')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Journal.page },
  flex1: { flex: 1 },

  // ── 일기장 로컬 헤더 (TopBar 대체) §11 ──
  diaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Journal.rule,
  },
  diaryHeaderBack: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 64 },
  diaryHeaderBackText: { fontSize: 18, fontWeight: '600', color: Journal.inkSoft },
  diaryHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: SERIF,
    fontSize: 19,
    fontWeight: '600',
    color: Journal.ink,
  },
  diaryHeaderRight: { minWidth: 64, alignItems: 'flex-end' },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, justifyContent: 'center' },
  headerActionText: { fontSize: 18, fontWeight: '700', color: Journal.accent },
  headerActionTextSoft: { fontSize: 18, fontWeight: '700', color: Journal.inkSoft },

  // ── 음성 플레이어 (재생/일시정지 + 진행바 + 시간) 공용 ──
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
  },
  audioBarTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: Journal.rule,
    overflow: 'hidden',
  },
  audioBarFill: { height: 5, borderRadius: 3, backgroundColor: Journal.accent },
  audioTimeText: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft, minWidth: 78, textAlign: 'right' },
  audioReadWrap: { marginTop: 14, alignSelf: 'stretch' },
  attAudioWrap: { alignSelf: 'stretch', position: 'relative' },
  // 읽기 화면에서 음성이 thumbGrid(한 줄 wrap) 안에 올 때 — 한 줄을 통째로 차지
  entryAudioInline: { width: '100%' },

  // ── 정사각 썸네일 (읽기 90×90 = ENTRY_THUMB_SIZE) — 사진/영상/음성 동일 크기 ──
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  thumbSquareWrap: { position: 'relative', width: ENTRY_THUMB_SIZE, height: ENTRY_THUMB_SIZE },
  thumbSquare: {
    width: ENTRY_THUMB_SIZE,
    height: ENTRY_THUMB_SIZE,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.rule,
  },
  // 에디터(작성/수정)용 — 더 큰 썸네일(사진·영상 동일 크기). ✕ 삭제버튼이 잘 구분되도록 큼직하게.
  thumbSquareEditor: {
    width: 104,
    height: 104,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.rule,
  },
  thumbSquareImg: { width: '100%', height: '100%' },
  // 에디터용 음성 타일 — 사진/영상 썸네일(thumbSquareEditor)과 동일한 104px 정사각.
  // 가운데 재생/일시정지 오버레이(thumbPlayOverlay 재사용) + 하단 시간 텍스트. 진행바 없음.
  audioTile: {
    width: 104,
    height: 104,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.surface,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  audioTileTime: {
    fontSize: 13,
    fontWeight: '600',
    color: Journal.inkSoft,
    textAlign: 'center',
  },
  // 영상 썸네일 총 길이 라벨 — 몸상태 영상 리스트 썸네일(VideoListScreen countdownBadge)과
  // 시각적으로 동일하게 통일: 우측 하단, rgba(0,0,0,0.65) 배경, 13px/700, borderRadius 4.
  videoTileTime: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  // 음성 타일 배경 "음성" 라벨 — 정중앙에 은은하게(빈티지 톤). 위에 재생 ▶ 오버레이가 얹힌다.
  audioTileLabelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioTileLabel: {
    fontFamily: SERIF,
    fontSize: 36,
    fontWeight: '600',
    color: Journal.inkFaint,
    letterSpacing: 2,
  },
  // 재생 삼각형 오버레이 — 썸네일 정중앙. 절대 풀필 + flex 중앙정렬로 크기와 무관하게 항상 중앙.
  thumbPlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlayOverlay: {
    width: 32,
    height: 32,
    borderRadius: 16,
    // 더 투명하게(반투명) — 썸네일이 비치도록
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 첨부 제거 ✕ 오버레이 (사진/영상/음성 공용) — 큰 썸네일에서도 잘 보이도록 그림자/대비 강화
  attRemoveX: {
    position: 'absolute',
    top: -9,
    right: -9,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    // 그림자(시인성)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  scroll: { flex: 1, backgroundColor: Journal.page },
  scrollContent: { paddingHorizontal: 22, paddingTop: 18 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Journal.page },

  /* ── 로딩 스켈레톤 (빈티지 종이 톤 더미) ── */
  skelRecBox: {
    backgroundColor: '#EBDFC2',
    borderWidth: 1,
    borderColor: '#D8C9A4',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  skelRecLine: {
    height: 14,
    borderRadius: 5,
    backgroundColor: '#DBCBA4',
    marginBottom: 12,
  },
  skelEntryLine: {
    height: 14,
    borderRadius: 5,
    backgroundColor: Journal.rule,
    marginBottom: 10,
  },

  // ── 날짜 헤더 §11-3 (우아한 serif, 한 장의 페이지) ──
  dateHeader: {
    backgroundColor: Journal.page,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  dateHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  navArrowBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowDisabled: { opacity: 0.4 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateTitle: { fontFamily: SERIF, fontSize: 22, fontWeight: '600', lineHeight: 30, color: Journal.ink },
  todayChip: {
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 11,
  },
  todayChipText: { fontFamily: SERIF, fontSize: 13, fontWeight: '600', color: Journal.accent },
  dateRule: { height: 1, width: '40%', backgroundColor: Journal.rule, marginTop: 9 },

  // ── 일기 달력 팝업 (빈티지 일기지 톤) ──
  calOverlay: {
    flex: 1,
    backgroundColor: 'rgba(58,49,40,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  calSheet: {
    backgroundColor: Journal.page,
    borderRadius: 22,
    width: '100%',
    maxWidth: 360,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Journal.rule,
  },
  calGrip: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Journal.rule,
    marginBottom: 12,
  },
  calMonthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  calNavArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Journal.surface,
  },
  calMonthTitle: { fontFamily: SERIF, fontSize: 21, fontWeight: '700', color: Journal.ink },
  calWeekRow: { flexDirection: 'row', marginBottom: 6 },
  calWeekLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: SERIF,
    fontSize: 15,
    fontWeight: '600',
    color: Journal.inkSoft,
    paddingVertical: 4,
  },
  calSunday: { color: '#B5613E' },
  calSaturday: { color: '#7A6E5C' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDayCell: {
    width: `${100 / 7}%`,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDaySelected: {
    backgroundColor: Journal.accent,
    borderRadius: 23,
  },
  calDayText: { fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: Journal.ink },
  calTodayText: { color: Journal.accent, fontWeight: '700' },
  calDayTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  calEntryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Journal.accent,
    marginTop: 2,
  },
  calEntryDotOnSel: { backgroundColor: '#FFFFFF' },
  calFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
  },
  calLegend: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  calLegendText: { fontFamily: SERIF, fontSize: 14, color: Journal.inkSoft },
  calCloseBtn: {
    paddingHorizontal: 22,
    height: 48,
    borderRadius: 12,
    backgroundColor: Journal.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calCloseText: { fontFamily: SERIF, fontSize: 17, fontWeight: '700', color: Journal.accent },

  // ── 한마디 비어있음 ──
  emptyEntryWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  belowWriteWrap: { alignItems: 'center', marginTop: 24 },
  emptyEntryText: { fontFamily: SERIF, fontSize: 17, lineHeight: 26, color: Journal.inkSoft, textAlign: 'center', marginBottom: 16 },
  emptyWriteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Journal.accent,
  },
  emptyWriteBtnText: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: '#fff' },

  // ── 미연동 보호자 안내(가족 연동 유도) ──
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: Journal.page },
  unlinkedTitle: { fontFamily: SERIF, fontSize: 20, fontWeight: '700', color: Journal.inkSoft, marginTop: 16 },
  unlinkedDesc: { fontFamily: SERIF, fontSize: 17, lineHeight: 26, color: Journal.inkSoft, textAlign: 'center', marginTop: 8 },
  unlinkedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Journal.accent,
    marginTop: 24,
  },
  unlinkedBtnText: { fontFamily: SERIF, fontSize: 18, fontWeight: '700', color: '#fff' },

  // ── 한마디 글 블록 §11-3 (카드 아님, 페이지 안의 글) ──
  entryRule: { height: 1, backgroundColor: Journal.rule, marginVertical: 28 },
  entryBlock: {},
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  // 좌측 그룹(점·이름·역할) — 길어지면 우측 자리 양보(flexShrink)
  entryHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  // 우측 그룹(작성시각요일 + 수정/삭제 아이콘) — 줄지 않게 고정
  entryHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  mineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Journal.mine },
  entryAuthor: {
    fontFamily: SERIF,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: Journal.inkSoft,
    flexShrink: 1,
    textDecorationLine: 'underline',
    textDecorationColor: Journal.rule,
  },
  entryRole: { fontSize: 12, fontWeight: '500', color: Journal.inkFaint },
  // 작성시각·요일 (작은 각주 톤)
  entryStamp: { fontSize: 12, fontWeight: '500', color: Journal.inkFaint },
  // 인라인 수정/삭제 아이콘 버튼 (본인 글 한정, 아이콘만) — 충분한 터치영역
  entryActionBtn: { paddingHorizontal: 2, paddingVertical: 2, minWidth: 28, alignItems: 'center', justifyContent: 'center' },
  entryText: { fontFamily: SERIF, fontSize: 16, fontWeight: '400', lineHeight: 26, color: Journal.ink },

  // ── 사진 2열 그리드 (시안) ──
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  gridPhoto: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.rule,
  },
  gridPhotoImg: { width: '100%', height: '100%' },

  // ── 음성: 원형 ▶ + 파형 + 라벨 pill (시안) ──
  audioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    marginTop: 14,
  },
  audioPlayCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioWave: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  audioWaveBar: { width: 3, borderRadius: 2, backgroundColor: Journal.inkFaint },
  audioPillText: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft },

  // ── 영상: 62% 포스터 + 스크림 + 흰 재생버튼 (시안) ──
  videoPoster: {
    width: '62%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.ink,
    marginTop: 14,
  },
  videoScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(38,28,18,0.32)' },
  videoPlayBig: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    margin: 'auto',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 사진·영상 액자 프레임 §11-3 (surface 매트 + 옅은 그림자, radius 3) ──
  frameRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  photoFrame: {
    width: 74,
    height: 74,
    backgroundColor: Journal.surface,
    padding: 5,
    borderRadius: 3,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  photoFrameImg: { flex: 1, borderRadius: 1, backgroundColor: Journal.rule },
  photoCountBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    backgroundColor: 'rgba(58,49,40,0.72)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  photoCountText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  videoFrame: {
    width: 74,
    height: 74,
    backgroundColor: Journal.surface,
    padding: 5,
    borderRadius: 3,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  videoFrameInner: {
    flex: 1,
    borderRadius: 1,
    backgroundColor: Journal.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 사진 라이트박스 모달 (ImageGalleryViewer 호스팅) ──
  photoModalBg: { flex: 1, backgroundColor: '#000' },
  photoModalHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  photoModalBody: { flex: 1, justifyContent: 'center' },
  photoCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    margin: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    minWidth: 90,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  photoCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // ── 저장 중 오버레이 (빈티지 톤 반투명 딤 + 가운데 카드) ──
  // 전체 화면을 덮어 저장 중 중복 조작을 막는다. position absolute 풀스크린(스크롤 sticky와 무관).
  savingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(58,49,40,0.32)', // ink 톤으로 살짝 어둡게 (빈티지)
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  savingCard: {
    minWidth: 160,
    paddingVertical: 28,
    paddingHorizontal: 32,
    borderRadius: 18,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    gap: 14,
  },
  savingText: { fontSize: 18, fontWeight: '700', color: Journal.ink },

  // ── 풀스크린 영상 ──
  videoModalBg: { flex: 1, backgroundColor: '#000' },
  videoModalHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  videoCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    margin: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    minWidth: 90,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  videoCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  fullscreenVideo: { flex: 1 },
  videoLoadingBox: { alignItems: 'center', justifyContent: 'center' },

  // ── 쓰기/수정 진입 §11-3 (조용한 한 줄) ──
  writeEntryLink: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 24,
  },
  writeEntryText: { fontFamily: SERIF, fontSize: 15, fontWeight: '600', color: Journal.accent },

  // ── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ──
  recBox: {
    backgroundColor: '#EBDFC2',
    borderWidth: 1,
    borderColor: '#D8C9A4',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  recHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  recTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    color: Journal.inkSoft,
  },
  recRow: {
    flexDirection: 'row',
    // 값(점수들)만 줄바꿈되고 라벨은 고정 → top 정렬로 행잉 인덴트
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 9,
  },
  // 라벨: 고정 폭 칼럼. 84였을 땐 한글은 안 잘렸지만 영문 최장 라벨("🚽 Constipation")은
  // 여전히 줄바뀜했다(오너 재지적, 2026-07-05) — 132로 확장해 영문 최장 라벨도 한 줄에 맞춤.
  recLab: { width: 132, flexShrink: 0, fontSize: 13, fontWeight: '700', lineHeight: 20, color: Journal.ink },
  // 값: 남은 폭 차지 → 줄바뀐 줄도 값 칼럼 왼쪽(첫 값 아래)에 정렬
  recVal: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 20, color: Journal.inkSoft },
  recEmpty: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 20, color: Journal.inkFaint },

  trendLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingVertical: 4,
  },
  trendLinkText: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  // 상단 우측 작성/수정 버튼
  topWriteBtn: { paddingHorizontal: 8, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  topWriteText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  // ── 에디터 (펼친 일기장) §11-4 ──
  editorSafe: { flex: 1, backgroundColor: Journal.pageDeep },
  editorContent: { padding: 20 },
  // Fix 9: flexGrow로 RuledPaper(flex:1)가 남은 높이를 모두 채우게 함
  editorContentFill: { flexGrow: 1, padding: 20 },

  // 괘선 종이 (시안 §paper) — 글+첨부가 한 장의 괘선 위
  paper: {
    position: 'relative',
    backgroundColor: Journal.surface,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 224,
  },
  // 괘선 종이가 헤더~툴바 사이 전체 높이를 채움 (Fix 9)
  paperFill: {
    flex: 1,
    position: 'relative',
    backgroundColor: Journal.surface,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 224,
  },
  ruleLayer: { ...StyleSheet.absoluteFillObject },
  ruleLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Journal.rule,
  },
  // 콘텐츠 패딩: 상단 14px → 첫 줄 글이 첫 괘선(32px) 위에 앉도록
  paperContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  // 첨부 미리보기 묶음 — 괘선 위에 그냥 얹힘. 순서 변경 리스트.
  attBlock: { marginTop: 14, gap: 12 },
  orderHint: {
    fontFamily: SERIF,
    fontSize: 13,
    lineHeight: 18,
    color: Journal.inkSoft,
  },
  // 첨부 한 줄: 썸네일/플레이어 + 위로/아래로 버튼
  attItemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  attItemThumbWrap: { position: 'relative', alignSelf: 'flex-start' },
  orderBtnCol: { flexDirection: 'row', gap: 8, flex: 1, justifyContent: 'flex-start' },
  orderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Journal.rule,
    backgroundColor: Journal.surface,
  },
  orderBtnDisabled: { opacity: 0.45 },
  orderBtnText: { fontSize: 15, fontWeight: '600', color: Journal.accent },
  orderBtnTextDisabled: { color: Journal.inkFaint },

  editorInput: {
    fontFamily: SERIF,
    fontSize: 16,
    lineHeight: RULE_SPACING, // 괘선 간격과 동일 → 글이 줄에 맞음
    color: Journal.ink,
    minHeight: RULE_SPACING * 5,
    padding: 0,
  },
  attachChipRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  attachChip: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: Journal.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachChipActive: { backgroundColor: Journal.accent },
  attachChipText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft },
  attachChipTextActive: { color: '#FAF5E9' },

  // 상단 우측 저장 버튼 (에디터)
  topSaveBtn: { paddingHorizontal: 8, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  topSaveText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  // 첨부 조건 안내 (도구막대 바로 위)
  toolbarHint: {
    fontFamily: SERIF,
    fontSize: 12,
    lineHeight: 18,
    color: Journal.inkFaint,
    textAlign: 'center',
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: Journal.pageDeep,
  },
  // 해외 무료: 결제 유도 CTA 바 (탭 → 구독 페이지). 눈에 띄게 테라코타 강조.
  toolbarUpsell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Journal.accentSoft,
    borderWidth: 1,
    borderColor: Journal.accent,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  toolbarUpsellTextCol: {
    flex: 1,
  },
  toolbarUpsellText: {
    fontFamily: SERIF,
    fontSize: 12.5,
    lineHeight: 17,
    color: Journal.ink,
    fontWeight: '700',
  },
  // '프리미엄 무제한' 줄 — 녹색 강조로 결제 유도 (별도 줄)
  toolbarUpsellCta: {
    fontFamily: SERIF,
    fontSize: 12.5,
    lineHeight: 17,
    color: '#388E3C',
    fontWeight: '800',
    marginTop: 2,
  },

  // 도구막대 (키보드 위 고정)
  toolbarBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: Journal.pageDeep,
  },
  tool: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    borderRadius: 10,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { fontSize: 15, fontWeight: '600', color: Journal.inkSoft },
  toolActive: { backgroundColor: Journal.accent, borderColor: Journal.accent },
  toolTextActive: { color: '#FAF5E9' },

  // 음성 첨부 pill (에디터, 시안)
  attAudio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    alignSelf: 'flex-start',
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attAudioPlay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attAudioLabel: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft },
  attAudioAction: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  // 영상 첨부 프레임 (에디터, 시안)
  attVidWrap: { width: 120, height: 74, alignSelf: 'flex-start' },
  attVid: {
    width: 120,
    height: 74,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Journal.rule,
    backgroundColor: Journal.ink,
  },
  attVidPlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    margin: 'auto',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attVidX: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordVideoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingVertical: 10,
    marginTop: 12,
  },
  recordVideoLinkText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  attachedText: { fontSize: 14, fontWeight: '600', color: Journal.ink, flex: 1 },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, justifyContent: 'center' },
  removeBtnText: { fontSize: 14, fontWeight: '700', color: Journal.accent },

  // 음성 미리듣기 버튼 (에디터 내부, surface 톤)
  audioPreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
  },
  audioPreviewText: { fontSize: 14, fontWeight: '600', color: Journal.accent },

  // 첨부 영상 미리보기 작은 액자 프레임
  videoPreviewFrame: {
    width: 56,
    height: 56,
    backgroundColor: Journal.surface,
    padding: 4,
    borderRadius: 3,
  },
  videoPreviewInner: {
    flex: 1,
    borderRadius: 1,
    backgroundColor: Journal.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 조용한 삭제 링크 (에디터 하단)
  deleteEntryLink: {
    alignSelf: 'center',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 28,
  },
  deleteEntryText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft, textDecorationLine: 'underline' },

  thumbRow: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  editorThumbWrap: { position: 'relative' },
  editorThumb: {
    width: 76,
    height: 76,
    borderRadius: 4,
    backgroundColor: Journal.rule,
  },
  thumbRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: Journal.surface, borderRadius: 12 },

  editorBottom: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
    backgroundColor: Journal.pageDeep,
  },
  saveBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FAF5E9' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // ── 음성 녹음 안내 바텀시트 (안내 → 녹음중 → 정지) ──
  recSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  recSheetContainer: { flex: 1, justifyContent: 'flex-end' },
  recSheetCard: {
    backgroundColor: Journal.pageDeep,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 12,
  },
  recSheetGrabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Journal.rule,
    alignSelf: 'center',
    marginBottom: 16,
  },
  recSheetTitle: {
    fontFamily: SERIF,
    fontSize: 20,
    fontWeight: '700',
    color: Journal.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  recSheetGuide: {
    fontSize: 16,
    lineHeight: 24,
    color: Journal.inkSoft,
    textAlign: 'center',
    marginBottom: 20,
  },
  recSheetStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Journal.accent,
  },
  recSheetStartText: { fontSize: 18, fontWeight: '700', color: '#FAF5E9' },
  // 첨부 시트의 보조 버튼 ("갤러리에서 선택") — 빈티지 톤 외곽선 버튼
  attachLibraryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Journal.accent,
    backgroundColor: Journal.surface,
    marginTop: 12,
  },
  attachLibraryText: { fontSize: 18, fontWeight: '700', color: Journal.accent },
  recSheetStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Journal.accent,
  },
  recSheetCancelBtn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  recSheetCancelText: { fontSize: 16, fontWeight: '600', color: Journal.inkSoft },
  recSheetLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 14,
  },
  recSheetDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Journal.accent },
  recSheetLiveText: { fontSize: 17, fontWeight: '700', color: Journal.accent },
  recSheetTimer: {
    fontFamily: SERIF,
    fontSize: 20,
    fontWeight: '700',
    color: Journal.ink,
    minWidth: 64,
    textAlign: 'center',
  },
});
