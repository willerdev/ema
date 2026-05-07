import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from '../screens/HomeScreen';
import { TradesScreen } from '../screens/TradesScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { MT5Screen } from '../screens/MT5Screen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { useAuth } from '../context/AuthContext';
import { palette } from '../theme/colors';
import { RootTabParamList } from '../types';

const Tab = createBottomTabNavigator<RootTabParamList>();

const focusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Trades: 'stats-chart',
  Wallet: 'wallet',
  MT5: 'analytics',
  Settings: 'settings',
};

const unfocusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Trades: 'stats-chart-outline',
  Wallet: 'wallet-outline',
  MT5: 'analytics-outline',
  Settings: 'settings-outline',
};

export function AppNavigator() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

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
      <Tab.Screen name='Home' component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name='Trades' component={TradesScreen} options={{ tabBarLabel: 'Trades' }} />
      <Tab.Screen name='Wallet' component={WalletScreen} options={{ tabBarLabel: 'Wallet' }} />
      <Tab.Screen name='MT5' component={MT5Screen} options={{ tabBarLabel: 'MT5' }} />
      <Tab.Screen name='Settings' component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}
