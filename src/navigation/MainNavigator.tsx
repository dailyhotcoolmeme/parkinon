import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { CommonActions, NavigatorScreenParams } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MedicationScreen } from '../screens/medication/MedicationScreen';
import { BodyStateScreen } from '../screens/bodystate/BodyStateScreen';
import { VideoRecordScreen } from '../screens/bodystate/VideoRecordScreen';
import { VideoListScreen } from '../screens/bodystate/VideoListScreen';
import { ExerciseNavigator, ExerciseStackParamList } from './ExerciseNavigator';
import { FeedNavigator, FeedStackParamList } from './FeedNavigator';
import { MenuNavigator, MenuStackParamList } from './MenuNavigator';
import { OverseasMedTabScreen } from '../screens/menu/OverseasMedTabScreen';
import { isOverseasLocale } from '../i18n/detectLocale';
import { useTranslation } from 'react-i18next';

export type MainTabParamList = {
  Medication: undefined;
  BodyStateTab: NavigatorScreenParams<BodyStateStackParamList>;
  Exercise: NavigatorScreenParams<ExerciseStackParamList>;
  Feed: NavigatorScreenParams<FeedStackParamList>;
  OverseasMedTab: undefined;
  MyInfo: NavigatorScreenParams<MenuStackParamList>;
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

function getTabItems(t: (key: string) => string): { name: keyof MainTabParamList; icon: IoniconName; iconFocused: IoniconName; label: string; emoji: string }[] {
  const overseas = isOverseasLocale();
  return [
    { name: 'Medication',   icon: 'medkit-outline',    iconFocused: 'medkit',    label: t('medication.brandTabLabel'),   emoji: '💊' },
    { name: 'BodyStateTab', icon: 'happy-outline',     iconFocused: 'happy',     label: t('bodystate.tabLabel'), emoji: '😊' },
    { name: 'Exercise',     icon: 'fitness-outline',   iconFocused: 'fitness',   label: t('exercise.tabLabel'),     emoji: '🏃' },
    overseas
      ? { name: 'OverseasMedTab', icon: 'time-outline', iconFocused: 'time', label: t('menu.overseasMedTabLabel'), emoji: '⏰' }
      : { name: 'Feed',         icon: 'newspaper-outline', iconFocused: 'newspaper', label: t('menu.feedTabLabel'), emoji: '📰' },
    { name: 'MyInfo',       icon: 'person-outline',    iconFocused: 'person',    label: t('menu.myInfoTabLabel'), emoji: '👤' },
  ];
}

export function MainNavigator() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const TAB_ITEMS = getTabItems(t);
  const overseas = isOverseasLocale();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const item = TAB_ITEMS.find(t => t.name === route.name)!;
        return {
          headerShown: false,
          tabBarStyle: {
            height: 72 + insets.bottom,
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
            paddingTop: 6,
            paddingBottom: 6,
          },
          tabBarIcon: ({ focused }) => (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Ionicons
                name={focused ? item.iconFocused : item.icon}
                size={30}
                color={focused ? Colors.primary : '#767676'}
              />
            </View>
          ),
          tabBarLabel: ({ focused }) => (
            <Text
              allowFontScaling={false}
              maxFontSizeMultiplier={1}
              style={[styles.tabLabel, focused ? styles.tabLabelActive : styles.tabLabelInactive]}
            >
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
      {overseas ? (
        <Tab.Screen
          name="OverseasMedTab"
          component={OverseasMedTabScreen}
        />
      ) : (
        <Tab.Screen
          name="Feed"
          component={FeedNavigator}
          listeners={({ navigation }) => ({
            tabPress: () => {
              navigation.navigate('Feed', { screen: 'FeedMain' });
            },
          })}
        />
      )}
      <Tab.Screen
        name="MyInfo"
        component={MenuNavigator}
        listeners={({ navigation }) => ({
          // 메뉴 탭을 누르면 항상 메뉴 최상단(MenuHome)을 보여준다.
          // 단순 navigate('MyInfo',{screen:'MenuHome'}) 는 MyInfo 스택에 push 돼 잔류한
          // MedicationManage(배너 진입 등) 위로 못 올라가, 로그아웃·탈퇴가 있는 메뉴로
          // 못 돌아가는 '갇힘'이 발생한다. → MyInfo 중첩 스택을 MenuHome 단일로 리셋한다.
          tabPress: (e) => {
            e.preventDefault();
            navigation.dispatch({
              ...CommonActions.navigate({
                name: 'MyInfo',
                params: {
                  state: {
                    index: 0,
                    routes: [{ name: 'MenuHome' }],
                  },
                },
              }),
            });
          },
        })}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 56,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  iconWrapActive: {
    backgroundColor: Colors.light,
  },
  tabLabel: {
    fontSize: 13,
    marginTop: 2,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: '#767676',
  },
});
