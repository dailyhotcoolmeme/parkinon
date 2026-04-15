import React, { useState, useRef } from 'react';
import {
  View,
  Image,
  Modal,
  TouchableOpacity,
  ScrollView,
  Text,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  urls: string[];
}

export function ImageGalleryViewer({ urls }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const fullscreenScrollRef = useRef<ScrollView>(null);

  if (urls.length === 0) return null;

  const handleThumbnailPress = (idx: number) => {
    setFullscreenIndex(idx);
    setCurrentIndex(idx);
    setModalVisible(true);
    // setTimeout으로 ScrollView가 마운트 된 후 스크롤
    setTimeout(() => {
      fullscreenScrollRef.current?.scrollTo({
        x: idx * SCREEN_WIDTH,
        animated: false,
      });
    }, 50);
  };

  const handleFullscreenScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageIdx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setFullscreenIndex(pageIdx);
  };

  const handleThumbnailScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageIdx = Math.round(e.nativeEvent.contentOffset.x / (SCREEN_WIDTH * 0.72 + 10));
    setCurrentIndex(pageIdx);
  };

  return (
    <>
      {/* 썸네일 가로 스크롤 + N장 인디케이터 */}
      <View style={styles.galleryWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.mediaScroll}
          contentContainerStyle={styles.mediaScrollContent}
          onMomentumScrollEnd={handleThumbnailScroll}
          scrollEventThrottle={16}
        >
          {urls.map((url, idx) => (
            <TouchableOpacity
              key={idx}
              onPress={() => handleThumbnailPress(idx)}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: url }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* "N장" 뱃지 */}
        {urls.length > 1 && (
          <View style={styles.countBadge}>
            <Ionicons name="images-outline" size={13} color="#fff" />
            <Text style={styles.countBadgeText}>{urls.length}장</Text>
          </View>
        )}
      </View>

      {/* 전체보기 Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBg}>
          {/* 상단: X닫기 + 인디케이터 */}
          <SafeAreaView edges={['top']} style={styles.modalHeader}>
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={28} color="#fff" />
                <Text style={styles.closeBtnText}>닫기</Text>
              </TouchableOpacity>
              <Text style={styles.fullscreenIndicator}>
                {fullscreenIndex + 1}/{urls.length}
              </Text>
            </View>
          </SafeAreaView>

          {/* 이미지 페이지 스와이프 */}
          <ScrollView
            ref={fullscreenScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleFullscreenScroll}
            scrollEventThrottle={16}
            style={styles.fullscreenScroll}
          >
            {urls.map((url, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.fullscreenPage}
                onPress={() => setModalVisible(false)}
                activeOpacity={1}
              >
                <Image
                  source={{ uri: url }}
                  style={styles.fullscreenImage}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 하단 도트 인디케이터 */}
          {urls.length > 1 && (
            <View style={styles.dotsRow}>
              {urls.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    idx === fullscreenIndex && styles.dotActive,
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  galleryWrap: {
    position: 'relative',
    marginTop: 16,
    marginHorizontal: -20,
  },
  mediaScroll: {},
  mediaScrollContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  mediaImage: {
    width: SCREEN_WIDTH * 0.72,
    height: SCREEN_WIDTH * 0.72,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
  },
  countBadge: {
    position: 'absolute',
    top: 10,
    right: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  countBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // Modal
  modalBg: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  modalHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 28,
    minHeight: 56,
    minWidth: 90,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  fullscreenIndicator: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 20,
  },
  fullscreenScroll: {
    flex: 1,
  },
  fullscreenPage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
  },
  dotsRow: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#fff',
    width: 20,
    borderRadius: 4,
  },
});
