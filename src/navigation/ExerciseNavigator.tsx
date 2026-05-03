import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExerciseScreen } from '../screens/exercise/ExerciseScreen';
import { ExerciseRecordScreen } from '../screens/exercise/ExerciseRecordScreen';
import { ExerciseDurationScreen } from '../screens/exercise/ExerciseDurationScreen';
import { ExerciseVideoScreen } from '../screens/exercise/ExerciseVideoScreen';
import { ExerciseVideoPlayerScreen } from '../screens/exercise/ExerciseVideoPlayerScreen';

export type ExerciseStackParamList = {
  // triggerTs: 알림 진입 시 ExerciseScreen에서 ExerciseRecord로 자동 push 트리거용
  ExerciseMain: { triggerTs?: number } | undefined;
  ExerciseRecord: undefined;
  ExerciseDuration: { exerciseName: string };
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
