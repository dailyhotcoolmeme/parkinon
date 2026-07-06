import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';

const SCREEN_WIDTH = Dimensions.get('window').width;

// 텍스트는 렌더 시 t()로 해석. icon과 번역 키만 보관.
const SLIDES = [
  { icon: '💊', key: 'slide1' },
  { icon: '👨‍👩‍👧', key: 'slide2' },
  { icon: '📊', key: 'slide3' },
] as const;

type Nav = StackNavigationProp<OnboardingStackParamList, 'OnboardingSlide'>;

export function OnboardingSlideScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const { top: topInset } = useSafeAreaInsets();
  const bottomPadding = useBottomSheetPadding(24);

  const handleNext = async () => {
    if (currentIndex < SLIDES.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      setTimeout(() => setCurrentIndex(nextIndex), 350);
    } else {
      await AsyncStorage.setItem('onboarding_slides_seen', '1');
      navigation.replace('Login');
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem('onboarding_slides_seen', '1');
    navigation.replace('Login');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={[styles.skipBtn, { top: topInset + 8 }]} onPress={handleSkip}>
        <Text style={styles.skipText}>{t('onboardingSlide.skip')}</Text>
      </TouchableOpacity>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        keyExtractor={(_, i) => String(i)}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={styles.title}>{t(`onboardingSlide.${item.key}.title`)}</Text>
            <Text style={styles.desc}>{t(`onboardingSlide.${item.key}.desc`)}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.btnWrapper, { paddingBottom: bottomPadding, paddingTop: 16 }]}>
        <PrimaryButton
          title={currentIndex < SLIDES.length - 1 ? t('onboardingSlide.next') : t('onboardingSlide.start')}
          onPress={handleNext}
          variant="outline"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  skipBtn: { position: 'absolute', right: 24, zIndex: 10, padding: 8 },
  skipText: { fontSize: 16, color: '#FFFFFF' },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: { fontSize: 80, marginBottom: 40 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', lineHeight: 36, marginBottom: 16 },
  desc: { fontSize: 18, color: '#FFFFFF', textAlign: 'center', lineHeight: 28 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 24 },
  btnWrapper: { paddingHorizontal: 24 },
});
