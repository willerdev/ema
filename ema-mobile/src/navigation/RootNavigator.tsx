import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { MainTabNavigator } from './MainTabNavigator';
import { AlpacaTradeScreen } from '../screens/AlpacaTradeScreen';
import { AirfarmingTradeScreen } from '../screens/AirfarmingTradeScreen';
import { ContractsTradeScreen } from '../screens/ContractsTradeScreen';
import { ExpertAutoTradingScreen } from '../screens/ExpertAutoTradingScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { useAuth } from '../context/AuthContext';
import { palette } from '../theme/colors';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTitleStyle: { color: palette.textPrimary },
        headerTintColor: palette.primary,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name='MainTabs' component={MainTabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name='AlpacaTrade' component={AlpacaTradeScreen} options={{ title: 'Forex market' }} />
      <Stack.Screen name='AirfarmingTrade' component={AirfarmingTradeScreen} options={{ title: 'Airfarming' }} />
      <Stack.Screen name='ContractsTrade' component={ContractsTradeScreen} options={{ title: 'Contracts' }} />
      <Stack.Screen name='ExpertAutoTrading' component={ExpertAutoTradingScreen} options={{ title: 'Expert auto trading' }} />
    </Stack.Navigator>
  );
}
