import { Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from '../screens/HomeScreen';
import { JournalScreen } from '../screens/JournalScreen';
import { TradesHubScreen } from '../screens/TradesHubScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { navigateToTransactionHistory } from '../utils/navigationHelpers';
import { ExtraStackNavigator } from './ExtraStackNavigator';
import { palette } from '../theme/colors';
import { RootTabParamList } from '../types';

const Tab = createBottomTabNavigator<RootTabParamList>();

const focusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Journal: 'calendar',
  Trades: 'stats-chart',
  Wallet: 'wallet',
  Extra: 'grid',
};

const unfocusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Journal: 'calendar-outline',
  Trades: 'stats-chart-outline',
  Wallet: 'wallet-outline',
  Extra: 'grid-outline',
};

export function MainTabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: palette.surface },
        headerTitleStyle: { color: palette.textPrimary },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: Math.max(8, insets.bottom),
          height: 64 + Math.max(0, insets.bottom - 4),
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarShowLabel: true,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? focusedIconMap[route.name] : unfocusedIconMap[route.name]} color={color} size={size} />
        ),
      })}
    >
      <Tab.Screen
        name='Home'
        component={HomeScreen}
        options={({ navigation }) => ({
          tabBarLabel: 'Home',
          headerRight: () => (
            <Pressable
              onPress={() => navigation.getParent()?.navigate('Notifications')}
              style={{ marginRight: 14, padding: 4 }}
              hitSlop={12}
            >
              <Ionicons name='notifications-outline' size={24} color={palette.primary} />
            </Pressable>
          ),
        })}
      />
      <Tab.Screen name='Journal' component={JournalScreen} options={{ tabBarLabel: 'Journal', title: 'Journal' }} />
      <Tab.Screen name='Trades' component={TradesHubScreen} options={{ tabBarLabel: 'Trades' }} />
      <Tab.Screen
        name='Wallet'
        component={WalletScreen}
        options={({ navigation }) => ({
          tabBarLabel: 'Wallet',
          headerRight: () => (
            <Pressable
              onPress={() => navigateToTransactionHistory(navigation)}
              style={{ marginRight: 14, padding: 4 }}
              hitSlop={12}
              accessibilityLabel='Transaction history'
            >
              <Ionicons name='receipt-outline' size={24} color={palette.primary} />
            </Pressable>
          ),
        })}
      />
      <Tab.Screen
        name='Extra'
        component={ExtraStackNavigator}
        options={{ tabBarLabel: 'Extra', headerShown: false }}
      />
    </Tab.Navigator>
  );
}
