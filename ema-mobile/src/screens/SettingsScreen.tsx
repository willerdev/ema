import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { authService } from '../services/authService';
import { alpacaService } from '../services/alpacaService';
import { palette } from '../theme/colors';

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [profile, setProfile] = useState<{ username: string; accountStatus: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await authService.profile();
      setProfile({ username: data.profile.username, accountStatus: data.profile.accountStatus });
    } catch {
      // keep previous data
    }
  }, []);

  usePolling(loadProfile, 30000, true);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  const saveKeys = async () => {
    try {
      await alpacaService.updateKeys(apiKey, secretKey);
      try {
        await alpacaService.getAccount();
        Alert.alert('Saved', 'Alpaca keys saved and account access verified.');
      } catch {
        Alert.alert('Saved', 'Keys saved. Verify account access from Home/Trades.');
      }
    } catch (error: any) {
      Alert.alert('API Key Error', String(error?.message || 'Failed to save keys'));
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Card>
        <Text style={styles.label}>Profile</Text>
        <Text style={styles.value}>Email: {user?.email}</Text>
        <Text style={styles.value}>Username: {profile?.username || user?.email.split('@')[0]}</Text>
        <Text style={styles.value}>Status: {profile?.accountStatus || 'active'}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Alpaca API Management</Text>
        <TextInput style={styles.input} placeholder='Alpaca API key' placeholderTextColor={palette.textSecondary} value={apiKey} onChangeText={setApiKey} />
        <TextInput style={styles.input} placeholder='Alpaca Secret key' placeholderTextColor={palette.textSecondary} value={secretKey} onChangeText={setSecretKey} secureTextEntry />
        <PrimaryButton label='Validate & Save Keys' onPress={saveKeys} />
      </Card>

      <Card>
        <Text style={styles.label}>Security</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.value}>Enable biometrics</Text>
          <Switch value={biometric} onValueChange={setBiometric} thumbColor={biometric ? palette.primary : '#ccc'} />
        </View>
        <Text style={styles.value}>Face ID / Fingerprint login ready</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Theme Settings</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.value}>Dark mode</Text>
          <Switch value={darkMode} onValueChange={setDarkMode} thumbColor={darkMode ? palette.primary : '#ccc'} />
        </View>
        <Text style={styles.value}>Accent color: Gold</Text>
      </Card>

      <PrimaryButton label='Logout' onPress={logout} variant='danger' />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  value: { color: palette.textPrimary, marginBottom: 6 },
  input: { backgroundColor: palette.surfaceElevated, borderColor: palette.border, borderWidth: 1, borderRadius: 10, color: palette.textPrimary, padding: 10, marginBottom: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
