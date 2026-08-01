import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  PanResponder,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { navigateTo } from '../../navigation/navigationRef';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useBodyState } from '../../hooks/useBodyState';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { uploadVideo, saveMediaLog } from '../../lib/r2Upload';
import { Video as VideoCompressor } from 'react-native-compressor';
import { useDialog } from '../../context/DialogContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { countTodayGroupMedia, FREE_DAILY_LIMITS } from '../../lib/mediaQuota';
import { isOverseasLocale } from '../../i18n/detectLocale';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const MAX_DURATION_SEC = 120; // 2분

interface SelectedVideo {
  uri: string;
  duration?: number; // 초
  width?: number;
  height?: number;
}

export function VideoRecordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { getPatientId } = useBodyState();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();
  const { isPremium } = useSubscription();
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadStage, setUploadStage] = useState<'compressing' | 'uploading' | 'saving' | 'done' | null>(null);
  const cancelledRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const videoRef = useRef<Video>(null);
  const sliderWidthRef = useRef(0);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);

  const handlePickFromGallery = async () => {
    try {
      const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permResult.granted) {
        dialog.alert({ title: t('videoRecord.permRequiredTitle'), message: t('videoRecord.galleryPermMsg') });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 0.7,
        videoMaxDuration: MAX_DURATION_SEC,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const durationSec = asset.duration ? asset.duration / 1000 : 0;

        if (durationSec > MAX_DURATION_SEC) {
          dialog.alert({
            title: t('videoRecord.videoTooLongTitle'),
            message: t('videoRecord.videoTooLongSelectMsg'),
          });
          return;
        }

        setSelectedVideo({
          uri: asset.uri,
          duration: durationSec,
          width: asset.width,
          height: asset.height,
        });
        setCurrentTime(0);
        setDuration(0);
      }
    } catch (e) {
      dialog.alert({ title: t('videoRecord.errorTitle'), message: t('videoRecord.loadVideoFailMsg') });
    }
  };

  const handleRecordVideo = async () => {
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (!camPerm.granted) {
        dialog.alert({ title: t('videoRecord.permRequiredTitle'), message: t('videoRecord.cameraPermMsg') });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: MAX_DURATION_SEC,
        quality: 0.7,
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        const durationSec = asset.duration ? asset.duration / 1000 : 0;

        if (durationSec > MAX_DURATION_SEC) {
          dialog.alert({
            title: t('videoRecord.videoTooLongTitle'),
            message: t('videoRecord.videoTooLongSelectMsgShort'),
          });
          return;
        }

        setSelectedVideo({
          uri: asset.uri,
          duration: durationSec,
          width: asset.width,
          height: asset.height,
        });
        setCurrentTime(0);
        setDuration(0);
      }
    } catch (e) {
      dialog.alert({ title: t('videoRecord.errorTitle'), message: t('videoRecord.cameraOpenFailMsg') });
    }
  };

  const handleTogglePlay = async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await videoRef.current.playAsync();
      setIsPlaying(true);
    }
  };

  const UPLOAD_TIMEOUT_MS = 180_000; // 3분 타임아웃

  const handleCancelUpload = () => {
    cancelledRef.current = true;
    setUploadStage(null);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!selectedVideo || !user) return;
    cancelledRef.current = false;
    setLoading(true);

    // 환자·하루한도 체크는 업로드 오버레이(Modal) 표시 전에 먼저 수행한다.
    // 오버레이가 떠 있는 상태에서 안내 다이얼로그를 열면 iOS Modal 적층 교착으로
    // 다이얼로그가 안 떠 "저장 눌러도 무반응"처럼 보인다.
    let patientId: string | null = null;
    try {
      patientId = await getPatientId();
    } catch {
      patientId = null;
    }
    if (!patientId) {
      setLoading(false);
      dialog.alert({ title: t('videoRecord.errorTitle'), message: t('videoRecord.noPatientLinkMsg') });
      return;
    }

    // 그룹 하루 영상 풀(일기 영상 포함 2개) 게이팅 — 국내·해외 동일. 해외 premium 만 무제한.
    const overseasVR = isOverseasLocale();
    if (!(overseasVR && isPremium)) {
      let over = false;
      try {
        const usage = await countTodayGroupMedia(patientId, user.timezone);
        over = usage.video >= FREE_DAILY_LIMITS.video;
      } catch {
        over = false; // 카운트 실패 시 저장은 진행(서버 정책이 최종 방어)
      }
      if (over) {
        setLoading(false);
        if (overseasVR) {
          // 해외: 구독 유도
          dialog
            .confirm({
              title: t('videoRecord.quotaReachedTitle'),
              message: t('videoRecord.quotaVideoMsg'),
              confirmText: t('subscription.upgradeBtn'),
              cancelText: t('common.cancel'),
            })
            .then((ok) => { if (ok) navigateTo('Main', { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } }); });
        } else {
          // 국내: 결제 문구 없이 담백하게
          dialog.alert({
            title: t('videoRecord.quotaReachedTitlePlain'),
            message: t('videoRecord.quotaVideoPlainMsg'),
          });
        }
        return;
      }
    }

    // 여기서부터 실제 업로드 — 이제 오버레이(Modal) 표시.
    setUploadStage('compressing');
    try {
      // 영상 압축 (720p H.264, ~1500kbps)
      let videoUri = selectedVideo.uri;
      try {
        const compressed = await VideoCompressor.compress(
          selectedVideo.uri,
          {
            compressionMethod: 'manual',
            maxSize: 1280,
            bitrate: 1500000,
          },
        );
        videoUri = compressed;
      } catch (compressErr) {
        // 압축 실패 시 원본으로 fallback
        console.warn('video compression failed, using the original:', compressErr);
      }

      if (cancelledRef.current) return;
      setUploadStage('uploading');

      const result = await uploadVideo(videoUri, patientId, 'body_state', UPLOAD_TIMEOUT_MS);
      if (cancelledRef.current) return;

      setUploadStage('saving');
      await saveMediaLog(patientId, user.id, result.url, result.key, result.expires_at, 'video', 'body_state', selectedVideo.duration);

      if (cancelledRef.current) return;
      setUploadStage('done');

      // 1.5초 후 자동 닫힘 및 화면 이동
      setTimeout(() => {
        if (!cancelledRef.current) {
          setUploadStage(null);
          setLoading(false);
          navigation.replace('VideoList');
        }
      }, 1500);
    } catch (e: any) {
      if (cancelledRef.current) return;
      setUploadStage(null);
      if (e?.message === 'UPLOAD_TIMEOUT') {
        dialog
          .show({
            title: t('videoRecord.uploadTimeoutTitle'),
            message: t('videoRecord.uploadTimeoutMsg'),
            buttons: [
              { id: 'retry', text: t('videoRecord.retry'), style: 'primary' },
              { id: 'cancel', text: t('videoRecord.cancel'), style: 'cancel' },
            ],
          })
          .then((picked) => {
            if (picked === 'retry') handleSave();
          });
      } else {
        dialog.alert({ title: t('videoRecord.errorTitle'), message: e.message ?? t('videoRecord.saveFailMsg') });
      }
    } finally {
      if (!cancelledRef.current && uploadStage !== 'done') setLoading(false);
    }
  };

  // 타임라인용 mm:ss 포맷
  const formatTime = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 슬라이더 PanResponder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsSeeking(true);
        const x = evt.nativeEvent.locationX;
        const width = sliderWidthRef.current;
        if (width > 0) {
          const ratio = Math.min(Math.max(x / width, 0), 1);
          setSeekPosition(ratio);
        }
      },
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX;
        const width = sliderWidthRef.current;
        if (width > 0) {
          const ratio = Math.min(Math.max(x / width, 0), 1);
          setSeekPosition(ratio);
        }
      },
      onPanResponderRelease: async (evt) => {
        const x = evt.nativeEvent.locationX;
        const width = sliderWidthRef.current;
        if (width > 0 && videoRef.current) {
          const ratio = Math.min(Math.max(x / width, 0), 1);
          const targetMs = Math.floor(ratio * durationRef.current);
          setSeekPosition(ratio);
          setCurrentTime(targetMs);
          currentTimeRef.current = targetMs;
          try {
            await videoRef.current.setPositionAsync(targetMs);
          } catch (_) {}
        }
        setIsSeeking(false);
      },
      onPanResponderTerminate: () => {
        setIsSeeking(false);
      },
    })
  ).current;

  const formatDuration = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return t('videoRecord.minSecDuration', { m, s });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar
        title={t('videoRecord.headerTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      <View style={styles.container}>
        {/* 영상 미리보기 또는 안내 영역 */}
        {selectedVideo ? (
          <View style={styles.previewArea}>
            <View style={styles.videoPreview}>
              <Video
                ref={videoRef}
                source={{ uri: selectedVideo.uri }}
                style={styles.videoPlayer}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
                isLooping={false}
                onPlaybackStatusUpdate={(status) => {
                  if (status.isLoaded) {
                    setIsPlaying(status.isPlaying);
                    if (!isSeeking) {
                      const pos = status.positionMillis || 0;
                      const dur = status.durationMillis || 0;
                      setCurrentTime(pos);
                      setDuration(dur);
                      currentTimeRef.current = pos;
                      durationRef.current = dur;
                    }
                  }
                }}
              />
              <TouchableOpacity
                style={styles.playBtn}
                onPress={handleTogglePlay}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={56}
                  color="rgba(255,255,255,0.9)"
                />
              </TouchableOpacity>
              {selectedVideo.duration !== undefined && selectedVideo.duration > 0 && (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationBadgeText}>
                    {formatDuration(selectedVideo.duration)}
                  </Text>
                </View>
              )}
            </View>
            {/* 타임라인 슬라이더 */}
            <View style={styles.progressContainer}>
              <View style={styles.timeContainer}>
                <Text style={styles.timeText}>
                  {formatTime(isSeeking ? seekPosition * duration : currentTime)}
                </Text>
                <Text style={styles.timeText}>
                  {formatTime(duration)}
                </Text>
              </View>
              <View
                style={styles.sliderTrack}
                onLayout={(e) => { sliderWidthRef.current = e.nativeEvent.layout.width; }}
                {...panResponder.panHandlers}
              >
                <View
                  style={[
                    styles.sliderFill,
                    {
                      width: `${
                        duration > 0
                          ? (isSeeking ? seekPosition : currentTime / duration) * 100
                          : 0
                      }%`,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.sliderHandle,
                    {
                      left: `${
                        duration > 0
                          ? (isSeeking ? seekPosition : currentTime / duration) * 100
                          : 0
                      }%`,
                    },
                  ]}
                />
              </View>
            </View>
            <TouchableOpacity
              style={styles.reSelectBtn}
              onPress={() => {
                setSelectedVideo(null);
                setIsPlaying(false);
                setCurrentTime(0);
                setDuration(0);
                setIsSeeking(false);
                setSeekPosition(0);
                currentTimeRef.current = 0;
                durationRef.current = 0;
              }}
            >
              <Text style={styles.reSelectText}>{t('videoRecord.reselect')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* 영상 없을 때: 안내 문구 + 버튼을 화면 중앙에 표시 */
          <View style={styles.emptyCenter}>
            {/* 2분 제한 강조 안내 문구 */}
            <View style={styles.noticeRow}>
              <Text style={styles.noticeRowText}>{t('videoRecord.maxPrefix')}</Text>
              <View style={styles.noticePill}>
                <Text style={styles.noticePillText}>{t('videoRecord.maxDuration')}</Text>
              </View>
              <Text style={styles.noticeRowText}>{t('videoRecord.maxSuffix')}</Text>
            </View>

            {/* 촬영하기 버튼 */}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleRecordVideo}
              activeOpacity={0.85}
            >
              <Ionicons name="camera-outline" size={52} color="#fff" />
              <Text style={styles.actionBtnLabel}>{t('videoRecord.recordNowTitle')}</Text>
              <Text style={styles.actionBtnSub}>{t('videoRecord.recordNowSub')}</Text>
            </TouchableOpacity>

            {/* 갤러리 버튼 */}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handlePickFromGallery}
              activeOpacity={0.85}
            >
              <Ionicons name="images-outline" size={52} color="#fff" />
              <Text style={styles.actionBtnLabel}>{t('videoRecord.galleryTitle')}</Text>
              <Text style={styles.actionBtnSub}>{t('videoRecord.gallerySub')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 버튼 영역 - 영상 있을 때만 저장 버튼 표시 */}
        {selectedVideo && (
          <View style={styles.buttonArea}>
            <PrimaryButton
              title={t('videoRecord.saveBtn')}
              onPress={handleSave}
              loading={loading}
            />
          </View>
        )}
      </View>
      <UploadOverlay stage={uploadStage} onCancel={handleCancelUpload} />
    </SafeAreaView>
  );
}

// ─── 업로드 로딩 오버레이 ─────────────────────────────────────────────────────

function getTips(t: (k: string) => string) {
  return [
    { icon: 'people-outline', title: t('videoRecord.tip1Title'), desc: t('videoRecord.tip1Desc') },
    { icon: 'bar-chart-outline', title: t('videoRecord.tip2Title'), desc: t('videoRecord.tip2Desc') },
    { icon: 'time-outline', title: t('videoRecord.tip3Title'), desc: t('videoRecord.tip3Desc') },
    { icon: 'medical-outline', title: t('videoRecord.tip4Title'), desc: t('videoRecord.tip4Desc') },
    { icon: 'walk-outline', title: t('videoRecord.tip5Title'), desc: t('videoRecord.tip5Desc') },
    { icon: 'analytics-outline', title: t('videoRecord.tip6Title'), desc: t('videoRecord.tip6Desc') },
  ] as const;
}

function getStages(t: (k: string) => string) {
  return [
    { key: 'compressing', label: t('videoRecord.stageCompressing') },
    { key: 'uploading',   label: t('videoRecord.stageUploading') },
    { key: 'saving',      label: t('videoRecord.stageSaving') },
    { key: 'done',        label: t('videoRecord.stageDone') },
  ] as const;
}

function UploadOverlay({
  stage,
  onCancel,
}: {
  stage: 'compressing' | 'uploading' | 'saving' | 'done' | null;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const TIPS = getTips(t);
  const STAGES = getStages(t);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // 팁 7초마다 전환
  useEffect(() => {
    if (!stage) { setElapsed(0); return; }
    const tipInterval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start();
      setTipIndex(i => (i + 1) % TIPS.length);
    }, 7000);
    return () => clearInterval(tipInterval);
  }, [stage]);

  // 경과 시간 1초마다
  useEffect(() => {
    if (!stage) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  if (!stage) return null;

  const isDone = stage === 'done';
  const currentStageIdx = STAGES.findIndex(s => s.key === stage);
  const tip = TIPS[tipIndex];
  const elapsedStr = elapsed < 60
    ? t('videoRecord.secOnly', { s: elapsed })
    : t('videoRecord.minSecDuration', { m: Math.floor(elapsed / 60), s: elapsed % 60 });

  return (
    // ⚠️ Modal이 아니라 전체화면 오버레이 View — 이 컴포넌트는 stage=null이면 언마운트되는데,
    //    Modal이면 닫힘 애니 도중 언마운트돼 iOS에서 모달 뷰가 남아 터치를 막는다(간헐 무반응).
    //    View는 언마운트가 깔끔하고, 위에 뜨는 에러 dialog(Modal)도 정상 표시된다.
    <View style={ovStyles.overlayRoot}>
      <View style={ovStyles.backdrop}>
        <View style={ovStyles.card}>
          {isDone ? (
            /* 완료 상태 */
            <>
              <View style={ovStyles.checkCircle}>
                <Ionicons name="checkmark-circle-sharp" size={80} color="#4CAF50" />
              </View>
              <Text style={ovStyles.stageTitleLarge}>{t('videoRecord.saveDoneTitle')}</Text>
            </>
          ) : (
            <>
              {/* 타이틀 + 경과시간 */}
              <View style={ovStyles.titleRow}>
                <Text style={ovStyles.stageTitle}>{i18n.t('loading.savingVideo')}</Text>
                <Text style={ovStyles.stageElapsed}> · {elapsedStr}</Text>
              </View>

              {/* 에너지바 단계 표시 */}
              <View style={ovStyles.stepsRow}>
                {STAGES.map((s, i) => {
                  const done = i < currentStageIdx;
                  const active = i === currentStageIdx;
                  return (
                    <React.Fragment key={s.key}>
                      <View style={ovStyles.stepItem}>
                        <View style={[
                          ovStyles.stepDot,
                          done && ovStyles.stepDotDone,
                          active && ovStyles.stepDotActive,
                        ]}>
                          {done ? (
                            <Ionicons name="checkmark-sharp" size={16} color="#fff" />
                          ) : active ? (
                            <View style={ovStyles.stepPulse} />
                          ) : null}
                        </View>
                        <Text
                          style={[ovStyles.stepLabel, active && ovStyles.stepLabelActive]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {s.label}
                        </Text>
                      </View>
                      {i < STAGES.length - 1 && (
                        <View style={[ovStyles.stepLine, (done || active) && ovStyles.stepLineFilled]} />
                      )}
                    </React.Fragment>
                  );
                })}
              </View>

              {/* 팁 카드 */}
              <Animated.View style={[ovStyles.tipCard, { opacity: fadeAnim }]}>
                <View style={ovStyles.tipIconWrap}>
                  <Ionicons name={tip.icon} size={22} color="#4CAF50" />
                </View>
                <Text style={ovStyles.tipTitle}>{tip.title}</Text>
                <Text style={ovStyles.tipDesc}>{tip.desc}</Text>
              </Animated.View>

              {/* 취소 버튼 */}
              <TouchableOpacity style={ovStyles.cancelBtn} onPress={onCancel}>
                <Text style={ovStyles.cancelBtnText}>{t('videoRecord.cancelSaveBtn')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const ovStyles = StyleSheet.create({
  overlayRoot: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,17,17,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    gap: 16,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 24,
    elevation: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stageTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111111',
  },
  stageElapsed: {
    fontSize: 14,
    fontWeight: '400',
    color: '#666666',
  },

  // 완료 체크마크
  checkCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stageTitleLarge: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E7D32',
    textAlign: 'center',
  },

  // 에너지바
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 8,
  },
  stepItem: {
    width: 58,
    alignItems: 'center',
    gap: 6,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: '#4CAF50' },
  stepDotActive: { backgroundColor: '#4CAF50' },
  stepPulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  stepLabel: {
    fontSize: 13,
    color: '#999',
    fontWeight: '500',
    width: 58,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: '#4CAF50',
    fontWeight: '700',
  },
  stepLine: {
    flex: 1,
    minWidth: 12,
    height: 3,
    backgroundColor: '#E0E0E0',
    marginBottom: 18,
    marginHorizontal: 4,
    borderRadius: 2,
  },
  stepLineFilled: { backgroundColor: '#4CAF50' },

  // 팁 카드
  tipCard: {
    backgroundColor: '#F8FFF8',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E8F5E9',
  },
  tipIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111111',
    textAlign: 'center',
  },
  tipDesc: {
    fontSize: 14,
    fontWeight: '400',
    color: '#666666',
    textAlign: 'center',
    lineHeight: 20,
  },

  // 취소 버튼
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#BDBDBD',
  },
  cancelBtnText: {
    fontSize: 18,
    color: '#888',
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    padding: 20,
  },

  // 영상 없을 때 레이아웃
  emptyCenter: {
    flex: 1,
    gap: 16,
    paddingBottom: 8,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  noticeRowText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  noticePill: {
    backgroundColor: '#FF6B00',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginHorizontal: 2,
  },
  noticePillText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },

  // 미리보기 있을 때
  previewArea: {
    marginBottom: 24,
  },
  videoPreview: {
    height: SCREEN_HEIGHT * 0.4,
    backgroundColor: '#000',
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  playBtn: {
    position: 'absolute',
    alignSelf: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  durationBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  reSelectBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reSelectText: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // 타임라인 슬라이더
  progressContainer: {
    marginTop: 12,
    gap: 10,
    paddingHorizontal: 4,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 14,
    color: Colors.textSub,
    fontWeight: '600',
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#E0E0E0',
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
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },

  // 저장 버튼 영역 (영상 있을 때만)
  buttonArea: {
    gap: 12,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  actionBtnLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  actionBtnSub: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
});
