import React, { useState, useRef, useEffect } from 'react';
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
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { R2Image } from './R2Image';
import { getCommunityPhotoUrl } from '../../lib/r2Upload';
import { useTranslation } from 'react-i18next';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CONTENT_PADDING = 20;
const IMAGE_WIDTH = SCREEN_WIDTH - CONTENT_PADDING * 2;

interface Props {
  urls: string[];
  // 풀스크린 직행 모드: 값이 있으면(>=0) 인라인 갤러리 단계를 건너뛰고
  // 해당 인덱스부터 풀스크린 뷰어를 바로 연다. 닫히면 onClose 호출.
  // (일기처럼 썸네일 탭 → 곧바로 원본 전체사이즈로 띄울 때 사용)
  // 값이 없으면(undefined) 기존 인라인 갤러리 + 내부 풀스크린 모달 동작(피드 등).
  initialFullscreenIndex?: number;
  onClose?: () => void;
  // 커뮤니티(정보/나눔) 사진처럼 공개 URL 로 즉시 로딩할지 여부.
  //   true  → 워커 공개 URL(getCommunityPhotoUrl) + 일반 Image (서명 왕복 없음, 빠름)
  //   false → R2Image(서명 URL) — 의료/일기 등 비공개 사진 (기본값)
  publicCommunity?: boolean;
  // 이미 RN <Modal> 안에서 열릴 때 true. iOS 는 <Modal> 을 별도 UIViewController 로 띄워
  // 모달 위에 모달을 겹치면 표시 애니메이션과 충돌해 화면이 멈춘 것처럼 보인다
  // (안드는 별도 윈도우라 증상 없음, 오너 제보 2026-07-28).
  // → true 면 <Modal> 대신 절대배치 오버레이로 렌더한다. 리스트 안에서 쓰는 기본(false)은
  //   부모가 화면 전체가 아니라 오버레이가 화면을 못 덮으므로 기존 <Modal> 을 유지한다.
  inline?: boolean;
}

export function ImageGalleryViewer({ urls, initialFullscreenIndex, onClose, publicCommunity, inline }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const directFullscreen = initialFullscreenIndex != null;
  const [modalVisible, setModalVisible] = useState(directFullscreen);
  const [currentIndex, setCurrentIndex] = useState(initialFullscreenIndex ?? 0);
  const [fullscreenIndex, setFullscreenIndex] = useState(initialFullscreenIndex ?? 0);
  const fullscreenScrollRef = useRef<ScrollView>(null);

  // 풀스크린 직행 모드: 마운트/인덱스 변경 시 해당 페이지로 스크롤
  useEffect(() => {
    if (!directFullscreen) return;
    setModalVisible(true);
    setFullscreenIndex(initialFullscreenIndex as number);
    const t = setTimeout(() => {
      fullscreenScrollRef.current?.scrollTo({
        x: (initialFullscreenIndex as number) * SCREEN_WIDTH,
        animated: false,
      });
    }, 50);
    return () => clearTimeout(t);
  }, [directFullscreen, initialFullscreenIndex]);

  if (urls.length === 0) return null;

  // 사진 한 장 렌더: 공개 모드면 일반 Image(공개 URL), 아니면 R2Image(서명 URL).
  const renderImage = (url: string, style: any) =>
    publicCommunity ? (
      <Image source={{ uri: getCommunityPhotoUrl(url) }} style={style} resizeMode="contain" />
    ) : (
      <R2Image uri={url} style={style} resizeMode="contain" />
    );

  const closeFullscreen = () => {
    setModalVisible(false);
    onClose?.();
  };

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
    const pageIdx = Math.round(e.nativeEvent.contentOffset.x / IMAGE_WIDTH);
    setCurrentIndex(pageIdx);
  };

  return (
    <>
      {/* 본문 사진 — 한 장씩 전체 너비 스와이프 (풀스크린 직행 모드에선 인라인 갤러리 생략) */}
      {!directFullscreen && (
        <View style={styles.galleryWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.mediaScroll}
            onMomentumScrollEnd={handleThumbnailScroll}
            scrollEventThrottle={16}
          >
            {urls.map((url, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => handleThumbnailPress(idx)}
                activeOpacity={0.9}
                style={styles.mediaPage}
              >
                {renderImage(url, styles.mediaImage)}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 하단 도트 인디케이터 */}
          {urls.length > 1 && (
            <View style={styles.inlineDotsRow}>
              {urls.map((_, idx) => (
                <View
                  key={idx}
                  style={[styles.inlineDot, idx === currentIndex && styles.inlineDotActive]}
                />
              ))}
            </View>
          )}
        </View>
      )}

      {/* 전체보기 — inline 이면 <Modal> 중첩 없이 오버레이로(iOS 프리즈 회피) */}
      <FullscreenHost
        inline={!!inline}
        visible={modalVisible}
        onRequestClose={closeFullscreen}
      >
        <View style={styles.modalBg}>
          {/* 상단: X닫기 + 인디케이터 — 노치/다이나믹아일랜드 회피를 위해 insets.top 반영
              (Modal 내부 SafeAreaView 는 iOS 에서 불안정해 paddingTop 방식으로 처리) */}
          <View style={[styles.modalHeader, { paddingTop: insets.top }]}>
            <View style={styles.modalHeaderRow}>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeFullscreen}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={28} color="#fff" />
                <Text style={styles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
              <Text style={styles.fullscreenIndicator}>
                {fullscreenIndex + 1}/{urls.length}
              </Text>
            </View>
          </View>

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
                onPress={closeFullscreen}
                activeOpacity={1}
              >
                {renderImage(url, styles.fullscreenImage)}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 하단 도트 인디케이터 */}
          {urls.length > 1 && (
            <View style={[styles.dotsRow, { bottom: insets.bottom + 16 }]}>
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
      </FullscreenHost>
    </>
  );
}

/**
 * 전체보기 컨테이너.
 * - inline=false(기본): 기존대로 RN <Modal>. 리스트/피드 안에서 열려도 화면 전체를 덮는다.
 * - inline=true: 호출부가 이미 <Modal> 안이라 중첩하면 iOS 에서 시트가 안 뜨고 터치가
 *   먹통이 된다 → 절대배치 오버레이로 렌더한다.
 */
function FullscreenHost({
  inline,
  visible,
  onRequestClose,
  children,
}: {
  inline: boolean;
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!inline || !visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [inline, visible, onRequestClose]);

  if (inline) {
    if (!visible) return null;
    return <View style={styles.inlineOverlay}>{children}</View>;
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  galleryWrap: {
    position: 'relative',
    marginTop: 16,
  },
  mediaScroll: {},
  mediaPage: {
    width: IMAGE_WIDTH,
    alignItems: 'center',
  },
  mediaImage: {
    width: IMAGE_WIDTH,
    height: IMAGE_WIDTH * 0.85,
    backgroundColor: '#E0E0E0',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inlineDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 6,
  },
  inlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#CCCCCC',
  },
  inlineDotActive: {
    width: 18,
    borderRadius: 4,
    backgroundColor: '#444444',
  },

  // Modal
  // inline 모드 전용 — <Modal> 중첩 대신 부모 트리 안에서 화면 전체를 덮는다.
  inlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 60,
  },
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
