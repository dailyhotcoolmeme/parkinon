import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useBodyState } from '../../hooks/useBodyState';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { uploadVideo, saveMediaLog } from '../../lib/r2Upload';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const MAX_DURATION_SEC = 120; // 2분

interface SelectedVideo {
  uri: string;
  duration?: number; // 초
  width?: number;
  height?: number;
}

export function VideoRecordScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { getPatientId } = useBodyState();
  const { unreadCount } = useNotificationBadge();
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [loading, setLoading] = useState(false);
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
        Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.');
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
          Alert.alert(
            '영상이 너무 길어요',
            '2분 이하의 영상만 선택할 수 있어요.\n더 짧은 영상을 선택해주세요.',
            [{ text: '확인' }],
          );
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
      Alert.alert('오류', '영상을 불러오는 중 문제가 생겼어요. 다시 시도해주세요.');
    }
  };

  const handleRecordVideo = async () => {
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (!camPerm.granted) {
        Alert.alert('권한 필요', '카메라 접근 권한이 필요해요.');
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
          Alert.alert(
            '영상이 너무 길어요',
            '2분 이하의 영상만 선택할 수 있어요.',
            [{ text: '확인' }],
          );
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
      Alert.alert('오류', '카메라를 열 수 없어요. 다시 시도해주세요.');
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

  const handleSave = async () => {
    if (!selectedVideo || !user) return;
    setLoading(true);
    try {
      // 보호자인 경우 환자 ID를 별도로 가져옴
      const patientId = await getPatientId();
      if (!patientId) {
        Alert.alert('오류', '연동된 환자 정보를 찾을 수 없어요.');
        return;
      }

      // R2 업로드
      const result = await uploadVideo(selectedVideo.uri, patientId, 'body_state');
      await saveMediaLog(patientId, user.id, result.url, result.key, result.expires_at, 'video', 'body_state');

      Alert.alert('저장 완료', '영상이 저장되었어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장 중 문제가 생겼어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
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
    return `${m}분 ${s}초`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar
        title="영상 기록하기"
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
              <Text style={styles.reSelectText}>다시 선택하기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* 영상 없을 때: 안내 문구 + 버튼을 화면 중앙에 표시 */
          <View style={styles.emptyCenter}>
            {/* 2분 제한 강조 안내 문구 */}
            <View style={styles.noticeRow}>
              <Text style={styles.noticeRowText}>최대 </Text>
              <View style={styles.noticePill}>
                <Text style={styles.noticePillText}>2분</Text>
              </View>
              <Text style={styles.noticeRowText}> 이내 영상만 등록할 수 있어요</Text>
            </View>

            {/* 촬영하기 버튼 */}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleRecordVideo}
              activeOpacity={0.8}
            >
              <Ionicons name="camera-outline" size={36} color={Colors.primary} />
              <View>
                <Text style={styles.actionBtnLabel}>지금 촬영하기</Text>
                <Text style={styles.actionBtnSub}>카메라로 바로 촬영해요</Text>
              </View>
            </TouchableOpacity>

            {/* 갤러리 버튼 */}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handlePickFromGallery}
              activeOpacity={0.8}
            >
              <Ionicons name="images-outline" size={36} color={Colors.primary} />
              <View>
                <Text style={styles.actionBtnLabel}>갤러리에서 선택하기</Text>
                <Text style={styles.actionBtnSub}>저장된 영상을 불러와요</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* 버튼 영역 - 영상 있을 때만 저장 버튼 표시 */}
        {selectedVideo && (
          <View style={styles.buttonArea}>
            <PrimaryButton
              title="저장하기"
              onPress={handleSave}
              loading={loading}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    padding: 20,
  },

  // 영상 없을 때 중앙 레이아웃
  emptyCenter: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
    paddingBottom: 40,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    minHeight: 64,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  actionBtnLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  actionBtnSub: {
    fontSize: 14,
    color: Colors.textSub,
  },
});
