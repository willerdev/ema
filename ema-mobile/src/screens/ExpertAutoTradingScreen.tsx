import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../hooks/useToast';
import { expertService, type ExpertMarketGroup } from '../services/expertService';
import { mt5Service } from '../services/mt5Service';
import type { RootStackParamList } from '../types';
import { palette } from '../theme/colors';
import { withTimeout } from '../utils/withTimeout';

const STORAGE_ACTIVE = 'ema_expert_ea_active';
const STORAGE_MARKET = 'ema_expert_market_group';
const STORAGE_RISK_PER_TRADE = 'ema_expert_risk_per_trade';
const STORAGE_MAX_DRAWDOWN = 'ema_expert_max_drawdown';
const STORAGE_MAX_DAILY_DRAWDOWN = 'ema_expert_max_daily_drawdown';
const STORAGE_RISK_REWARD = 'ema_expert_risk_reward';
const STORAGE_TRADING_NEWS = 'ema_expert_trading_news';
const STORAGE_SWING_TRADES = 'ema_expert_swing_trades';
const STORAGE_DISCLAIMER_ACCEPTED = 'ema_expert_disclaimer_accepted';
const STORAGE_CONFIG_SAVED = 'ema_expert_config_saved';

const DEFAULT_RISK_REWARD = '1:2';

const DISCLAIMER_TEXT =
  'Trading involves substantial risk. Market outcomes are unpredictable — funds on your account can be lost or gained.\n\n' +
  'Airfarms is not responsible for any market deals, trade results, or losses incurred while expert management is active on your MT5 account. ' +
  'By enabling Expert Account Manager you acknowledge that a third-party expert strategy may execute trades on your behalf.\n\n' +
  'You must perform your own due diligence, understand the risks, and only allocate capital you can afford to lose. ' +
  'Past performance does not guarantee future results.';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function parsePercent(value: string, label: string): number | null {
  const n = Number(String(value).replace(/%/g, '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    Alert.alert('Validation', `Enter a valid ${label} between 0 and 100.`);
    return null;
  }
  return n;
}

function parseRiskReward(value: string): string | null {
  const v = value.trim();
  if (!/^\d+\s*:\s*\d+$/.test(v)) {
    Alert.alert('Validation', 'Risk to reward must look like 1:2 (reward relative to risk).');
    return null;
  }
  return v.replace(/\s/g, '');
}

export function ExpertAutoTradingScreen() {
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();
  const [mt5Connected, setMt5Connected] = useState<boolean | null>(null);
  const [mt5CheckDone, setMt5CheckDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [eaActive, setEaActive] = useState(false);
  const [marketGroup, setMarketGroup] = useState<ExpertMarketGroup | null>(null);
  const [cashWallet, setCashWallet] = useState(0);
  const [expertBalance, setExpertBalance] = useState(0);
  const [fundAmount, setFundAmount] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [fundingBusy, setFundingBusy] = useState(false);

  const [riskPerTrade, setRiskPerTrade] = useState('');
  const [maxDrawdown, setMaxDrawdown] = useState('');
  const [maxDailyDrawdown, setMaxDailyDrawdown] = useState('');
  const [riskReward, setRiskReward] = useState(DEFAULT_RISK_REWARD);
  const [tradingNews, setTradingNews] = useState(false);
  const [swingTrades, setSwingTrades] = useState(false);

  const [disclaimerModalOpen, setDisclaimerModalOpen] = useState(false);
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [fundsModalOpen, setFundsModalOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPrefs = useCallback(async () => {
    const keys = [
      STORAGE_ACTIVE,
      STORAGE_MARKET,
      STORAGE_RISK_PER_TRADE,
      STORAGE_MAX_DRAWDOWN,
      STORAGE_MAX_DAILY_DRAWDOWN,
      STORAGE_RISK_REWARD,
      STORAGE_TRADING_NEWS,
      STORAGE_SWING_TRADES,
      STORAGE_DISCLAIMER_ACCEPTED,
      STORAGE_CONFIG_SAVED,
    ];
    const values = await AsyncStorage.multiGet(keys);
    const map = Object.fromEntries(values);
    setEaActive(map[STORAGE_ACTIVE] === '1');
    const storedMarket = map[STORAGE_MARKET];
    if (storedMarket === 'derived' || storedMarket === 'metals') {
      setMarketGroup(storedMarket);
    }
    setRiskPerTrade(map[STORAGE_RISK_PER_TRADE] || '');
    setMaxDrawdown(map[STORAGE_MAX_DRAWDOWN] || '');
    setMaxDailyDrawdown(map[STORAGE_MAX_DAILY_DRAWDOWN] || '');
    setRiskReward(map[STORAGE_RISK_REWARD] || DEFAULT_RISK_REWARD);
    setTradingNews(map[STORAGE_TRADING_NEWS] === '1');
    setSwingTrades(map[STORAGE_SWING_TRADES] === '1');
    setDisclaimerAccepted(map[STORAGE_DISCLAIMER_ACCEPTED] === '1');
    setConfigSaved(map[STORAGE_CONFIG_SAVED] === '1');
    setPrefsLoaded(true);
  }, []);

  const loadExpertSummary = useCallback(async () => {
    try {
      const summary = await withTimeout(expertService.getSummary(), 8000, 'Expert summary');
      setCashWallet(summary.cashWallet);
      setExpertBalance(summary.expertBalance);
      if (summary.marketGroup) {
        setMarketGroup(summary.marketGroup);
        await AsyncStorage.setItem(STORAGE_MARKET, summary.marketGroup);
      }
    } catch {
      // keep last local values
    }
  }, []);

  const checkMt5 = useCallback(async () => {
    setMt5CheckDone(false);
    try {
      const list = await withTimeout(mt5Service.listAccounts(), 5000, 'MT5 accounts');
      const rows = list.accounts || [];
      setMt5Connected(rows.length > 0);
    } catch {
      setMt5Connected(false);
    } finally {
      setMt5CheckDone(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPrefs();
      void checkMt5();
      void loadExpertSummary();
    }, [loadPrefs, checkMt5, loadExpertSummary])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([checkMt5(), loadPrefs(), loadExpertSummary()]);
    setRefreshing(false);
  }, [checkMt5, loadPrefs, loadExpertSummary]);

  const persistBool = async (key: string, value: boolean) => {
    await AsyncStorage.setItem(key, value ? '1' : '0');
  };

  const persistConfig = async (opts: {
    risk: number;
    maxDd: number;
    maxDailyDd: number;
    rr: string;
    news: boolean;
    swing: boolean;
  }) => {
    await AsyncStorage.multiSet([
      [STORAGE_RISK_PER_TRADE, String(opts.risk)],
      [STORAGE_MAX_DRAWDOWN, String(opts.maxDd)],
      [STORAGE_MAX_DAILY_DRAWDOWN, String(opts.maxDailyDd)],
      [STORAGE_RISK_REWARD, opts.rr],
      [STORAGE_TRADING_NEWS, opts.news ? '1' : '0'],
      [STORAGE_SWING_TRADES, opts.swing ? '1' : '0'],
      [STORAGE_DISCLAIMER_ACCEPTED, '1'],
      [STORAGE_CONFIG_SAVED, '1'],
    ]);
    setConfigSaved(true);
    setDisclaimerAccepted(true);
  };

  const validateForm = () => {
    const risk = parsePercent(riskPerTrade, 'risk per trade (%)');
    if (risk == null) return null;
    const maxDd = parsePercent(maxDrawdown, 'max drawdown (%)');
    if (maxDd == null) return null;
    const maxDaily = parsePercent(maxDailyDrawdown, 'max daily drawdown (%)');
    if (maxDaily == null) return null;
    if (maxDaily > maxDd) {
      Alert.alert('Validation', 'Max daily drawdown cannot exceed max drawdown.');
      return null;
    }
    const rr = parseRiskReward(riskReward);
    if (rr == null) return null;
    return { risk, maxDd, maxDaily, rr };
  };

  const onPressSave = () => {
    const parsed = validateForm();
    if (!parsed) return;
    setRiskModalOpen(false);
    setDisclaimerModalOpen(true);
    setDisclaimerAccepted(false);
  };

  const confirmSaveWithDisclaimer = async () => {
    if (!disclaimerAccepted) {
      Alert.alert('Acknowledgement required', 'Please confirm you have read and accept the risk disclosure.');
      return;
    }
    const parsed = validateForm();
    if (!parsed) return;

    setSaving(true);
    try {
      await persistConfig({
        risk: parsed.risk,
        maxDd: parsed.maxDd,
        maxDailyDd: parsed.maxDaily,
        rr: parsed.rr,
        news: tradingNews,
        swing: swingTrades,
      });
      setDisclaimerModalOpen(false);
      setRiskModalOpen(false);
      showToast('Expert Account Manager settings saved');
      Alert.alert('Risk disclosure', DISCLAIMER_TEXT, [{ text: 'I understand' }]);
    } finally {
      setSaving(false);
    }
  };

  const selectMarketGroup = async (group: ExpertMarketGroup) => {
    if (expertBalance > 0 && marketGroup && marketGroup !== group) {
      Alert.alert('Switch market', 'Return expert funds to your cash wallet before changing market type.');
      return;
    }
    setMarketGroup(group);
    await AsyncStorage.setItem(STORAGE_MARKET, group);
  };

  const onFundExpert = async () => {
    if (!marketGroup) {
      Alert.alert('Market', 'Choose Derived or Metals before allocating funds.');
      return;
    }
    const amount = Number(String(fundAmount).trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Amount', 'Enter a valid amount to allocate.');
      return;
    }
    if (amount > cashWallet) {
      Alert.alert('Insufficient balance', 'You do not have enough cash wallet balance for this allocation.');
      return;
    }
    setFundingBusy(true);
    try {
      const summary = await expertService.fund(amount, marketGroup);
      setCashWallet(summary.cashWallet);
      setExpertBalance(summary.expertBalance);
      if (summary.marketGroup) setMarketGroup(summary.marketGroup);
      setFundAmount('');
      setFundsModalOpen(false);
      showToast('Funds allocated for expert trading');
    } catch (e: any) {
      Alert.alert('Allocation failed', e?.message || 'Could not allocate funds.');
    } finally {
      setFundingBusy(false);
    }
  };

  const onReturnToCash = async () => {
    const amount = Number(String(returnAmount).trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Amount', 'Enter a valid amount to return.');
      return;
    }
    if (amount > expertBalance) {
      Alert.alert('Insufficient balance', 'Amount exceeds your expert trading balance.');
      return;
    }
    setFundingBusy(true);
    try {
      const summary = await expertService.returnToCash(amount);
      setCashWallet(summary.cashWallet);
      setExpertBalance(summary.expertBalance);
      setReturnAmount('');
      setFundsModalOpen(false);
      showToast('Funds returned to cash wallet');
    } catch (e: any) {
      Alert.alert('Return failed', e?.message || 'Could not return funds.');
    } finally {
      setFundingBusy(false);
    }
  };

  const setEaActiveSafe = async (next: boolean) => {
    if (!configSaved) {
      Alert.alert('Save settings first', 'Configure risk parameters and save before enabling expert management.');
      return;
    }
    if (next && !marketGroup) {
      Alert.alert('Market', 'Choose Derived or Metals platform pairs before enabling.');
      return;
    }
    if (next && expertBalance <= 0) {
      Alert.alert('Allocate funds', 'Move funds from your cash wallet into expert trading before enabling.');
      return;
    }
    setEaActive(next);
    await persistBool(STORAGE_ACTIVE, next);
    if (next) showToast('Expert Account Manager enabled');
  };

  const goMt5 = () => {
    navigation.navigate('MainTabs', { screen: 'Extra', params: { screen: 'MT5' } });
  };

  const inputStyle = styles.input;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps='handled'
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>Expert Account Manager</Text>
        <Text style={styles.sub}>
          Connect MT5, set your risk limits, then enable expert management. The expert may place trades on your linked account
          within the parameters you define.
        </Text>

        {!mt5CheckDone ? <Text style={styles.checkingMeta}>Checking saved MT5 account…</Text> : null}

        {mt5CheckDone && !mt5Connected ? (
          <Card>
            <Text style={styles.cardTitle}>Save MT5 details first</Text>
            <Text style={styles.meta}>
              Add your MetaTrader 5 login on the MT5 tab (saved offline). Live sync is optional — you can connect later.
            </Text>
            <PrimaryButton label='Open MT5' onPress={goMt5} style={{ marginTop: 12 }} />
          </Card>
        ) : null}

        {!prefsLoaded ? (
          <Card>
            <Text style={styles.meta}>Loading settings…</Text>
          </Card>
        ) : null}

        {prefsLoaded ? (
          <>
            <Card style={styles.heroCard}>
              <Text style={styles.cardTitle}>Expert dashboard</Text>
              <Text style={styles.meta}>
                {eaActive ? 'Active' : 'Inactive'} · {marketGroup === 'derived' ? 'Derived' : marketGroup === 'metals' ? 'Metals' : 'No market selected'}
              </Text>
              <View style={styles.grid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Cash wallet</Text>
                  <Text style={styles.statValue}>${Math.floor(cashWallet).toLocaleString()}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Expert balance</Text>
                  <Text style={styles.statValue}>${Math.floor(expertBalance).toLocaleString()}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Risk / trade</Text>
                  <Text style={styles.statValue}>{configSaved ? `${riskPerTrade}%` : 'Set'}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Max DD</Text>
                  <Text style={styles.statValue}>{configSaved ? `${maxDrawdown}%` : 'Set'}</Text>
                </View>
              </View>
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Setup</Text>
              <View style={styles.actionRow}>
                <PrimaryButton label='Risk settings' onPress={() => setRiskModalOpen(true)} compact style={styles.actionButton} />
                <PrimaryButton label='Funds & market' onPress={() => setFundsModalOpen(true)} compact style={styles.actionButton} />
              </View>
              <Text style={[styles.meta, { marginTop: 10 }]}>
                {configSaved
                  ? `Saved · R:R ${riskReward}${tradingNews ? ' · News on' : ''}${swingTrades ? ' · Swing on' : ''}`
                  : 'Save risk settings before enabling expert management.'}
              </Text>
            </Card>

            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.cardTitle}>Expert management active</Text>
                  <Text style={styles.meta}>
                    {configSaved ? 'Expert may trade within your saved limits.' : 'Save risk settings first.'}
                  </Text>
                </View>
                <Switch
                  value={eaActive}
                  onValueChange={(v) => void setEaActiveSafe(v)}
                  disabled={!configSaved}
                  trackColor={{ false: palette.border, true: palette.success }}
                  thumbColor='#f4f4f5'
                />
              </View>
            </Card>

            {eaActive && configSaved ? (
              <Card style={styles.statusCard}>
                <Text style={styles.statusLine}>
                  Active · {riskPerTrade}% / trade · Max DD {maxDrawdown}% · Daily {maxDailyDrawdown}% · R:R {riskReward}
                </Text>
                <Text style={styles.meta}>
                  {marketGroup === 'derived' ? 'Derived' : marketGroup === 'metals' ? 'Metals' : '—'} · $
                  {Math.floor(expertBalance)} allocated
                </Text>
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <FormModal
        visible={riskModalOpen}
        title='Risk settings'
        onClose={() => setRiskModalOpen(false)}
        footer={
          <View style={{ gap: 8, marginTop: 12 }}>
            <PrimaryButton label='Review and save' onPress={onPressSave} />
            <PrimaryButton label='Cancel' onPress={() => setRiskModalOpen(false)} variant='danger' />
          </View>
        }
      >
        <Text style={styles.meta}>All values are required before enabling expert management.</Text>

        <Text style={styles.fieldLabel}>Risk per trade (%)</Text>
        <TextInput
          style={inputStyle}
          value={riskPerTrade}
          onChangeText={setRiskPerTrade}
          placeholder='e.g. 1'
          placeholderTextColor={palette.textSecondary}
          keyboardType='decimal-pad'
        />

        <Text style={styles.fieldLabel}>Max drawdown (%)</Text>
        <TextInput
          style={inputStyle}
          value={maxDrawdown}
          onChangeText={setMaxDrawdown}
          placeholder='e.g. 20'
          placeholderTextColor={palette.textSecondary}
          keyboardType='decimal-pad'
        />

        <Text style={styles.fieldLabel}>Max daily drawdown (%)</Text>
        <TextInput
          style={inputStyle}
          value={maxDailyDrawdown}
          onChangeText={setMaxDailyDrawdown}
          placeholder='e.g. 5'
          placeholderTextColor={palette.textSecondary}
          keyboardType='decimal-pad'
        />

        <Text style={styles.fieldLabel}>Risk to reward</Text>
        <TextInput
          style={inputStyle}
          value={riskReward}
          onChangeText={setRiskReward}
          placeholder={DEFAULT_RISK_REWARD}
          placeholderTextColor={palette.textSecondary}
          autoCapitalize='none'
        />

        <View style={styles.row}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.rowLabel}>Trade around news events</Text>
            <Text style={styles.rowHint}>Allow trading during high-impact news</Text>
          </View>
          <Switch
            value={tradingNews}
            onValueChange={setTradingNews}
            trackColor={{ false: palette.border, true: palette.primary }}
            thumbColor='#f4f4f5'
          />
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.rowLabel}>Swing trades</Text>
            <Text style={styles.rowHint}>Hold positions over multiple sessions</Text>
          </View>
          <Switch
            value={swingTrades}
            onValueChange={setSwingTrades}
            trackColor={{ false: palette.border, true: palette.primary }}
            thumbColor='#f4f4f5'
          />
        </View>
      </FormModal>

      <FormModal
        visible={fundsModalOpen}
        title='Funds and market'
        onClose={() => setFundsModalOpen(false)}
        footer={<PrimaryButton label='Close' onPress={() => setFundsModalOpen(false)} style={{ marginTop: 12 }} />}
      >
        <Text style={styles.meta}>Choose one market group, then allocate cash for expert trading.</Text>
        <View style={styles.modalStats}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Cash wallet</Text>
            <Text style={styles.statValue}>${Math.floor(cashWallet).toLocaleString()}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Expert balance</Text>
            <Text style={styles.statValue}>${Math.floor(expertBalance).toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Derived</Text>
          <Switch
            value={marketGroup === 'derived'}
            onValueChange={(v) => {
              if (v) void selectMarketGroup('derived');
              else if (marketGroup === 'derived') {
                setMarketGroup(null);
                void AsyncStorage.removeItem(STORAGE_MARKET);
              }
            }}
            trackColor={{ false: palette.border, true: palette.primary }}
            thumbColor='#f4f4f5'
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Metals</Text>
          <Switch
            value={marketGroup === 'metals'}
            onValueChange={(v) => {
              if (v) void selectMarketGroup('metals');
              else if (marketGroup === 'metals') {
                setMarketGroup(null);
                void AsyncStorage.removeItem(STORAGE_MARKET);
              }
            }}
            trackColor={{ false: palette.border, true: palette.primary }}
            thumbColor='#f4f4f5'
          />
        </View>

        <Text style={styles.fieldLabel}>Amount to allocate (USD)</Text>
        <TextInput
          style={inputStyle}
          value={fundAmount}
          onChangeText={setFundAmount}
          placeholder='e.g. 100'
          placeholderTextColor={palette.textSecondary}
          keyboardType='decimal-pad'
        />
        <PrimaryButton
          label={fundingBusy ? 'Working…' : 'Allocate from cash wallet'}
          onPress={() => void onFundExpert()}
          disabled={fundingBusy}
          style={{ marginTop: 8 }}
        />

        {expertBalance > 0 ? (
          <>
            <Text style={styles.fieldLabel}>Return to cash wallet (USD)</Text>
            <TextInput
              style={inputStyle}
              value={returnAmount}
              onChangeText={setReturnAmount}
              placeholder='e.g. 50'
              placeholderTextColor={palette.textSecondary}
              keyboardType='decimal-pad'
            />
            <PrimaryButton
              label={fundingBusy ? 'Working…' : 'Return to cash wallet'}
              onPress={() => void onReturnToCash()}
              disabled={fundingBusy}
              style={{ marginTop: 8 }}
            />
          </>
        ) : null}
      </FormModal>

      <FormModal
        visible={disclaimerModalOpen}
        title='Risk disclosure'
        onClose={() => setDisclaimerModalOpen(false)}
        footer={
          <View style={{ gap: 8, marginTop: 12 }}>
            <View style={styles.row}>
              <Text style={[styles.meta, { flex: 1, marginRight: 8 }]}>
                I accept that Airfarms is not responsible for losses and I will perform due diligence.
              </Text>
              <Switch
                value={disclaimerAccepted}
                onValueChange={setDisclaimerAccepted}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor='#f4f4f5'
              />
            </View>
            <PrimaryButton
              label={saving ? 'Saving…' : 'Accept and save'}
              onPress={() => void confirmSaveWithDisclaimer()}
              disabled={saving || !disclaimerAccepted}
            />
            <PrimaryButton label='Cancel' onPress={() => setDisclaimerModalOpen(false)} />
          </View>
        }
      >
        <Text style={styles.disclaimerBody}>{DISCLAIMER_TEXT}</Text>
      </FormModal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: palette.background },
  content: { padding: 16, paddingBottom: 32 },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 16 },
  cardTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  meta: { color: palette.textSecondary, lineHeight: 20 },
  checkingMeta: { color: palette.textSecondary, fontSize: 12, marginBottom: 10 },
  heroCard: { borderLeftWidth: 3, borderLeftColor: palette.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  statBox: {
    width: '48%',
    backgroundColor: palette.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  statLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  statValue: { color: palette.textPrimary, fontSize: 20, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionButton: { flex: 1 },
  modalStats: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 4 },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 10, marginBottom: 4, fontWeight: '600' },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    color: palette.textPrimary,
    padding: 10,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  rowLabel: { color: palette.textPrimary, fontSize: 16, fontWeight: '600' },
  rowHint: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  statusCard: { borderLeftWidth: 3, borderLeftColor: palette.success },
  statusLine: { color: palette.textPrimary, fontWeight: '600', marginBottom: 4 },
  disclaimerBody: { color: palette.textPrimary, lineHeight: 22, fontSize: 14 },
});
