import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExtraHubScreen } from '../screens/ExtraHubScreen';
import { LocalMoneyScreen } from '../screens/LocalMoneyScreen';
import { P2PScreen } from '../screens/P2PScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ExtraStackParamList } from '../types';
import { palette } from '../theme/colors';

const Stack = createNativeStackNavigator<ExtraStackParamList>();

export function ExtraStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTitleStyle: { color: palette.textPrimary },
        headerTintColor: palette.primary,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name='ExtraHub' component={ExtraHubScreen} options={{ title: 'Extra', headerShown: false }} />
      <Stack.Screen name='P2P' component={P2PScreen} options={{ title: 'P2P' }} />
      <Stack.Screen name='LocalMoney' component={LocalMoneyScreen} options={{ title: 'Mobile money' }} />
      <Stack.Screen name='Settings' component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}
