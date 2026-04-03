import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
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
import { saveMediaLog } from '../../lib/r2Upload';
import { supabase } from '../../lib/supabase';
import * as FileSystem from 'expo-file-system';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const MAX_DURATION_SEC = 120; // 2분

interface SelectedVideo {
  uri: string;
  duration?: number; // 초
  width?: number;
  height?: number;
}

export function VideoRecordScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { getPatientId } = useBodyState();
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<Video>(null);

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

      // Supabase Storage 업로드
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const uuid = Math.random().toString(36).slice(2);
      const storagePath = `${patientId}/${yearMonth}/${uuid}.mp4`;

      const base64 = await FileSystem.readAsStringAsync(selectedVideo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const { error: uploadError } = await supabase.storage
        .from('body-videos')
        .upload(storagePath, buffer, { contentType: 'video/mp4', upsert: false });

      if (uploadError) throw new Error(`영상 업로드 실패: ${uploadError.message}`);

      const { data: publicData } = supabase.storage.from('body-videos').getPublicUrl(storagePath);
      const videoUrl = publicData.publicUrl;

      const expiresAt = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
      await saveMediaLog(patientId, user.id, videoUrl, storagePath, expiresAt, 'video', 'body_state');

      Alert.alert('저장 완료', '영상이 저장되었어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장 중 문제가 생겼어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}분 ${s}초`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="영상 기록하기" showBack />

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
            <TouchableOpacity
              style={styles.reSelectBtn}
              onPress={() => {
                setSelectedVideo(null);
                setIsPlaying(false);
              }}
            >
              <Text style={styles.reSelectText}>다시 선택하기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.emptyArea}
            onPress={() => {
              Alert.alert(
                '영상 선택',
                '영상을 어떻게 준비할까요?',
                [
                  { text: '지금 촬영하기', onPress: handleRecordVideo },
                  { text: '갤러리에서 선택', onPress: handlePickFromGallery },
                  { text: '취소', style: 'cancel' },
                ],
              );
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="videocam-outline" size={64} color={Colors.textHint} />
            <Text style={styles.emptyTitle}>영상을 선택해주세요</Text>
            <Text style={styles.emptyDesc}>여기를 탭하면 선택할 수 있어요</Text>
            <Text style={styles.emptyDescSub}>최대 2분까지 기록할 수 있어요</Text>
          </TouchableOpacity>
        )}

        {/* 버튼 영역 */}
        <View style={styles.buttonArea}>
          {!selectedVideo ? (
            <>
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

              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  최대 2분까지 기록할 수 있어요
                </Text>
              </View>
            </>
          ) : (
            <PrimaryButton
              title="저장하기"
              onPress={handleSave}
              loading={loading}
            />
          )}
        </View>
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
    justifyContent: 'space-between',
  },

  // 미리보기 없을 때
  emptyArea: {
    height: SCREEN_HEIGHT * 0.4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    gap: 14,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 16,
    color: Colors.textSub,
  },
  emptyDescSub: {
    fontSize: 14,
    color: Colors.textHint,
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

  // 액션 버튼
  buttonArea: {
    gap: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
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
    fontSize: 13,
    color: Colors.textSub,
  },
  notice: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  noticeText: {
    fontSize: 14,
    color: Colors.textHint,
  },
});
