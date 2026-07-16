import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { MainTabNavigator } from './MainTabNavigator';
import { AirfarmingTradeScreen } from '../screens/AirfarmingTradeScreen';
import { VipFarmersTradeScreen } from '../screens/VipFarmersTradeScreen';
import { VipLoanScreen } from '../screens/VipLoanScreen';
import { ContractsTradeScreen } from '../screens/ContractsTradeScreen';
import { ExpertAutoTradingScreen } from '../screens/ExpertAutoTradingScreen';
import { TradeHistoryScreen } from '../screens/TradeHistoryScreen';
import { LiveTradingScreen } from '../screens/LiveTradingScreen';
import { LiveTradingCreateBotScreen } from '../screens/LiveTradingCreateBotScreen';
import { LiveTradingCreateSetupScreen } from '../screens/LiveTradingCreateSetupScreen';
import { LiveTradingAccountScreen } from '../screens/LiveTradingAccountScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { TransactionHistoryScreen } from '../screens/TransactionHistoryScreen';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';
import { CryptoDepositPaymentScreen } from '../screens/CryptoDepositPaymentScreen';
import { SupportScreen } from '../screens/SupportScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { ActivityTracker } from '../components/ActivityTracker';
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
    <ActivityTracker>
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTitleStyle: { color: palette.textPrimary },
        headerTintColor: palette.primary,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name='MainTabs' component={MainTabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name='AirfarmingTrade' component={AirfarmingTradeScreen} options={{ title: 'Airfarmers' }} />
      <Stack.Screen name='VipFarmersTrade' component={VipFarmersTradeScreen} options={{ title: 'Live VIP Farmers' }} />
      <Stack.Screen name='VipLoan' component={VipLoanScreen} options={{ title: 'VIP Farmers loan' }} />
      <Stack.Screen name='ContractsTrade' component={ContractsTradeScreen} options={{ title: 'Contracts' }} />
      <Stack.Screen name='ExpertAutoTrading' component={ExpertAutoTradingScreen} options={{ title: 'Expert Account Manager' }} />
      <Stack.Screen name='TradeHistory' component={TradeHistoryScreen} options={{ title: 'Trade history' }} />
      <Stack.Screen name='LiveTrading' component={LiveTradingScreen} options={{ title: 'Live trading' }} />
      <Stack.Screen name='LiveTradingCreateBot' component={LiveTradingCreateBotScreen} options={{ title: 'New account' }} />
      <Stack.Screen name='LiveTradingCreateSetup' component={LiveTradingCreateSetupScreen} options={{ title: 'Setup' }} />
      <Stack.Screen name='LiveTradingAccount' component={LiveTradingAccountScreen} options={{ title: 'Account' }} />
      <Stack.Screen name='Notifications' component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name='TransactionHistory' component={TransactionHistoryScreen} options={{ title: 'Asset history' }} />
      <Stack.Screen
        name='TransactionDetail'
        component={TransactionDetailScreen}
        options={({ route }) => ({
          title:
            route.params.row.category === 'withdraw'
              ? 'Withdrawal details'
              : route.params.row.category === 'deposit'
                ? 'Deposit details'
                : 'Transaction details',
        })}
      />
      <Stack.Screen
        name='CryptoDepositPayment'
        component={CryptoDepositPaymentScreen}
        options={{ title: 'Complete payment' }}
      />
      <Stack.Screen name='Support' component={SupportScreen} options={{ title: 'Help & support' }} />
    </Stack.Navigator>
    </ActivityTracker>
  );
}
