import { Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TradesHubScreen } from '../screens/TradesHubScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { navigateToTransactionHistory } from '../utils/navigationHelpers';
import { palette } from '../theme/colors';
import { RootTabParamList } from '../types';

const Tab = createBottomTabNavigator<RootTabParamList>();

const focusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Wallet: 'wallet',
  Trades: 'stats-chart',
  Settings: 'settings',
};

const unfocusedIconMap: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Wallet: 'wallet-outline',
  Trades: 'stats-chart-outline',
  Settings: 'settings-outline',
};

export function MainTabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName='Wallet'
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
        name='Wallet'
        component={WalletScreen}
        options={({ navigation }) => ({
          title: 'Wallet',
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
      <Tab.Screen name='Trades' component={TradesHubScreen} options={{ title: 'Products', tabBarLabel: 'Products' }} />
      <Tab.Screen name='Settings' component={SettingsScreen} options={{ title: 'Settings', tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}
