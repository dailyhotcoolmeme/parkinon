import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExerciseScreen } from '../screens/exercise/ExerciseScreen';
import { ExerciseRecordScreen } from '../screens/exercise/ExerciseRecordScreen';
import { ExerciseDurationScreen } from '../screens/exercise/ExerciseDurationScreen';
import { ExerciseVideoScreen } from '../screens/exercise/ExerciseVideoScreen';
import { ExerciseVideoPlayerScreen } from '../screens/exercise/ExerciseVideoPlayerScreen';

export type ExerciseStackParamList = {
  ExerciseMain: undefined;
  ExerciseRecord: undefined;
  // exerciseId: 사전 정의 운동의 언어 무관 키(walk 등). 커스텀 입력이면 null.
  // exerciseName: 화면 표시용(현재 언어). 저장은 exerciseId 를 우선 사용한다.
  ExerciseDuration: { exerciseName: string; exerciseId?: string | null };
  ExerciseVideo: undefined;
  ExerciseVideoPlayer: { videoId: string; title: string; description: string };
};

const Stack = createNativeStackNavigator<ExerciseStackParamList>();

export function ExerciseNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ExerciseMain" component={ExerciseScreen} />
      <Stack.Screen name="ExerciseRecord" component={ExerciseRecordScreen} />
      <Stack.Screen name="ExerciseDuration" component={ExerciseDurationScreen} />
      <Stack.Screen name="ExerciseVideo" component={ExerciseVideoScreen} />
      <Stack.Screen name="ExerciseVideoPlayer" component={ExerciseVideoPlayerScreen} />
    </Stack.Navigator>
  );
}
