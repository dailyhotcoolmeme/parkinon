import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MedicationScreen } from '../screens/medication/MedicationScreen';
import { BodyStateScreen } from '../screens/bodystate/BodyStateScreen';
import { VideoRecordScreen } from '../screens/bodystate/VideoRecordScreen';
import { VideoListScreen } from '../screens/bodystate/VideoListScreen';
import { ExerciseNavigator } from './ExerciseNavigator';
import { FeedNavigator } from './FeedNavigator';
import { MenuNavigator } from './MenuNavigator';

export type MainTabParamList = {
  Medication: undefined;
  BodyStateTab: undefined;
  Exercise: undefined;
  Feed: undefined;
  MyInfo: undefined;
};

export type BodyStateStackParamList = {
  BodyState: undefined;
  VideoRecord: undefined;
  VideoList: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const BodyStateStack = createStackNavigator<BodyStateStackParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function BodyStateNavigator() {
  return (
    <BodyStateStack.Navigator screenOptions={{ headerShown: false }}>
      <BodyStateStack.Screen name="BodyState" component={BodyStateScreen} />
      <BodyStateStack.Screen name="VideoRecord" component={VideoRecordScreen} />
      <BodyStateStack.Screen name="VideoList" component={VideoListScreen} />
    </BodyStateStack.Navigator>
  );
}

const TAB_ITEMS: { name: keyof MainTabParamList; icon: IoniconName; iconFocused: IoniconName; label: string; emoji: string }[] = [
  { name: 'Medication',   icon: 'medkit-outline',    iconFocused: 'medkit',    label: '약복용',   emoji: '💊' },
  { name: 'BodyStateTab', icon: 'happy-outline',     iconFocused: 'happy',     label: '몸상태',   emoji: '😊' },
  { name: 'Exercise',     icon: 'fitness-outline',   iconFocused: 'fitness',   label: '운동',     emoji: '🏃' },
  { name: 'Feed',         icon: 'newspaper-outline', iconFocused: 'newspaper', label: '정보·나눔', emoji: '📰' },
  { name: 'MyInfo',       icon: 'person-outline',    iconFocused: 'person',    label: '내 정보',  emoji: '👤' },
];

export function MainNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const item = TAB_ITEMS.find(t => t.name === route.name)!;
        return {
          headerShown: false,
          tabBarStyle: {
            height: 80 + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: Colors.white,
            borderTopWidth: 1,
            borderTopColor: Colors.border,
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 6,
          },
          tabBarItemStyle: {
            paddingTop: 8,
            paddingBottom: 4,
          },
          tabBarIcon: ({ focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Ionicons
                name={focused ? item.iconFocused : item.icon}
                size={28}
                color={focused ? Colors.primary : Colors.textHint}
              />
            </View>
          ),
          tabBarLabel: ({ focused }) => (
            <Text style={[styles.tabLabel, focused ? styles.tabLabelActive : styles.tabLabelInactive]}>
              {item.label}
            </Text>
          ),
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textHint,
        };
      }}
    >
      <Tab.Screen
        name="Medication"
        component={MedicationScreen}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Medication');
          },
        })}
      />
      <Tab.Screen
        name="BodyStateTab"
        component={BodyStateNavigator}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('BodyStateTab', { screen: 'BodyState' });
          },
        })}
      />
      <Tab.Screen
        name="Exercise"
        component={ExerciseNavigator}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Exercise', { screen: 'ExerciseMain' });
          },
        })}
      />
      <Tab.Screen
        name="Feed"
        component={FeedNavigator}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Feed', { screen: 'FeedMain' });
          },
        })}
      />
      <Tab.Screen
        name="MyInfo"
        component={MenuNavigator}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('MyInfo', { screen: 'MenuHome' });
          },
        })}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 56,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  iconWrapActive: {
    backgroundColor: Colors.light,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: Colors.textHint,
  },
});
