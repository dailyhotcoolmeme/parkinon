import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FeedScreen, PostItem } from '../screens/feed/FeedScreen';
import { PostWriteScreen } from '../screens/feed/PostWriteScreen';
import { PostDetailScreen } from '../screens/feed/PostDetailScreen';

export type FeedStackParamList = {
  FeedMain: undefined;
  PostWrite: undefined;
  PostDetail: { post: PostItem };
};

const Stack = createNativeStackNavigator<FeedStackParamList>();

export function FeedNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="FeedMain" component={FeedScreen} />
      <Stack.Screen name="PostWrite" component={PostWriteScreen} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} />
    </Stack.Navigator>
  );
}
