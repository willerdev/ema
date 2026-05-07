import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'ema_auth_token';

export const authStorage = {
  async setToken(token: string) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },
  async getToken() {
    return AsyncStorage.getItem(TOKEN_KEY);
  },
  async clear() {
    await AsyncStorage.removeItem(TOKEN_KEY);
  },
};
