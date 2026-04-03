import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';

type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseVideoPlayer'>['route'];

export function ExerciseVideoPlayerScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation();
  const { videoId } = route.params;

  useEffect(() => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    Linking.openURL(url).finally(() => {
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    });
  }, [videoId]);

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="운동 영상" showBack />
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.text}>유튜브 앱으로 이동 중...</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 18,
    color: Colors.textSub,
  },
});
