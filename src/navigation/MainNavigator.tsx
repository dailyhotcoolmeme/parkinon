import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MedicationScreen } from '../screens/medication/MedicationScreen';
import { BodyStateScreen } from '../screens/bodystate/BodyStateScreen';
import { VideoRecordScreen } from '../screens/bodystate/VideoRecordScreen';
import { ExerciseNavigator } from './ExerciseNavigator';
import { FeedNavigator } from './FeedNavigator';

export type MainTabParamList = {
  Medication: undefined;
  BodyStateTab: undefined;
  Exercise: undefined;
  Feed: undefined;
};

export type BodyStateStackParamList = {
  BodyState: undefined;
  VideoRecord: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const BodyStateStack = createStackNavigator<BodyStateStackParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function BodyStateNavigator() {
  return (
    <BodyStateStack.Navigator screenOptions={{ headerShown: false }}>
      <BodyStateStack.Screen name="BodyState" component={BodyStateScreen} />
      <BodyStateStack.Screen name="VideoRecord" component={VideoRecordScreen} />
    </BodyStateStack.Navigator>
  );
}

const TAB_ITEMS: { name: keyof MainTabParamList; icon: IoniconName; iconFocused: IoniconName; label: string }[] = [
  { name: 'Medication', icon: 'medkit-outline', iconFocused: 'medkit', label: '약복용' },
  { name: 'BodyStateTab', icon: 'happy-outline', iconFocused: 'happy', label: '몸상태' },
  { name: 'Exercise', icon: 'fitness-outline', iconFocused: 'fitness', label: '운동' },
  { name: 'Feed', icon: 'newspaper-outline', iconFocused: 'newspaper', label: '정보·나눔' },
];

export function MainNavigator() {
  const insets = useSafeAreaInsets();
  const TAB_HEIGHT = 68;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          height: TAB_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
        },
        tabBarIcon: ({ focused }) => {
          const item = TAB_ITEMS.find(t => t.name === route.name);
          if (!item) return null;
          return (
            <Ionicons
              name={focused ? item.iconFocused : item.icon}
              size={26}
              color={focused ? Colors.primary : Colors.textHint}
            />
          );
        },
        tabBarLabel: ({ focused }) => {
          const item = TAB_ITEMS.find(t => t.name === route.name);
          return (
            <Text style={[
              styles.tabLabel,
              focused ? styles.tabLabelActive : styles.tabLabelInactive,
            ]}>
              {item?.label}
            </Text>
          );
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textHint,
        tabBarItemStyle: { paddingTop: 6 },
      })}
    >
      <Tab.Screen name="Medication" component={MedicationScreen} />
      <Tab.Screen name="BodyStateTab" component={BodyStateNavigator} />
      <Tab.Screen name="Exercise" component={ExerciseNavigator} />
      <Tab.Screen name="Feed" component={FeedNavigator} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontSize: 14,
    marginTop: 2,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: Colors.textHint,
    fontWeight: '400',
  },
});
