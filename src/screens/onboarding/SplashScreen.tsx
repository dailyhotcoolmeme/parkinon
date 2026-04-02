import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';

type Nav = StackNavigationProp<OnboardingStackParamList, 'Splash'>;

export function SplashScreen() {
  const navigation = useNavigation<Nav>();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('OnboardingSlide');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>💊</Text>
      <Text style={styles.title}>파킨온</Text>
      <Text style={styles.subtitle}>ParkinON</Text>
      <Text style={styles.desc}>파킨슨 환자와 가족을 위한{'\n'}케어 앱이에요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 36, fontWeight: '700', color: Colors.white, marginBottom: 4 },
  subtitle: { fontSize: 20, color: Colors.white, opacity: 0.8, marginBottom: 24 },
  desc: { fontSize: 18, color: Colors.white, textAlign: 'center', lineHeight: 28, opacity: 0.9 },
});
