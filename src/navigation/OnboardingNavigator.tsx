import React, { useState, useEffect } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SplashScreen } from '../screens/onboarding/SplashScreen';
import { OnboardingSlideScreen } from '../screens/onboarding/OnboardingSlideScreen';
import { LoginScreen } from '../screens/onboarding/LoginScreen';
import { RoleSelectScreen } from '../screens/onboarding/RoleSelectScreen';
import { FamilyCheckScreen } from '../screens/onboarding/FamilyCheckScreen';
import { PatientInfoScreen } from '../screens/onboarding/PatientInfoScreen';
import { CaregiverInfoScreen } from '../screens/onboarding/CaregiverInfoScreen';
import { FamilyInviteScreen } from '../screens/onboarding/FamilyInviteScreen';
import { SensitiveInfoConsentScreen } from '../screens/onboarding/SensitiveInfoConsentScreen';
import { useAuth } from '../context/AuthContext';

export type OnboardingStackParamList = {
  Splash: undefined;
  OnboardingSlide: undefined;
  Login: undefined;
  SensitiveInfoConsent: undefined;
  RoleSelect: undefined;
  FamilyCheck: undefined;
  PatientInfo: { step: number };
  CaregiverInfo: { step: number };
  FamilyInvite: undefined;
};

const Stack = createStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  const { user } = useAuth();
  const [initialRouteName, setInitialRouteName] = useState<keyof OnboardingStackParamList>('Splash');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (user) {
      setInitialRouteName('FamilyCheck');
      setReady(true);
    } else {
      AsyncStorage.getItem('onboarding_slides_seen').then((seen) => {
        setInitialRouteName(seen ? 'Login' : 'Splash');
        setReady(true);
      });
    }
  }, [user]);

  if (!ready) return null;

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="OnboardingSlide" component={OnboardingSlideScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SensitiveInfoConsent" component={SensitiveInfoConsentScreen} />
      <Stack.Screen name="FamilyCheck" component={FamilyCheckScreen} />
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
      <Stack.Screen name="PatientInfo" component={PatientInfoScreen} />
      <Stack.Screen name="CaregiverInfo" component={CaregiverInfoScreen} />
      <Stack.Screen name="FamilyInvite" component={FamilyInviteScreen} />
    </Stack.Navigator>
  );
}
