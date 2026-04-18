import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../context/AuthContext';
import { OnboardingNavigator } from './OnboardingNavigator';
import { MainNavigator } from './MainNavigator';
import { LoadingScreen } from '../screens/LoadingScreen';
import { navigationRef } from './navigationRef';

export type RootStackParamList = {
  OnboardingGuest: undefined;
  OnboardingAuth: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // 미로그인: Splash → OnboardingSlide → Login
          <Stack.Screen name="OnboardingGuest" component={OnboardingNavigator} />
        ) : !user.onboarding_done ? (
          // 로그인됐지만 온보딩 미완료: RoleSelect부터 시작
          <Stack.Screen name="OnboardingAuth" component={OnboardingNavigator} />
        ) : (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
