import { useCallback, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { alpacaService } from '../services/alpacaService';
import { useTradingStore } from '../store/useTradingStore';
import { OrderType, TradeSide } from '../types';
import { palette } from '../theme/colors';

export function AlpacaTradeScreen() {
  const insets = useSafeAreaInsets();
  const { quote, positions, orders, setQuoteSymbol, refreshTrades, tradesError } = useTradingStore();
  const [search, setSearch] = useState('AAPL');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [side, setSide] = useState<TradeSide>('buy');
  const [qty, setQty] = useState('1');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [ticketOpen, setTicketOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alpacaConfigured, setAlpacaConfigured] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const status = await alpacaService.getStatus();
    setAlpacaConfigured(status.configured);
    if (!status.configured) {
      setLastUpdatedAt(null);
      return;
    }
    await Promise.all([setQuoteSymbol(search), refreshTrades()]);
    setLastUpdatedAt(Date.now());
  }, [search, setQuoteSymbol, refreshTrades]);

  usePolling(refresh, 5000, true);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onSearch = async (value: string) => {
    const upper = value.toUpperCase();
    setSearch(upper);
    if (value.length < 1) return setSuggestions([]);
    try {
      const [stocks, crypto] = await Promise.all([
        alpacaService.searchAssets(value, 'us_equity'),
        alpacaService.searchAssets(value, 'crypto'),
      ]);
      setSuggestions([...stocks, ...crypto].slice(0, 8));
    } catch {
      setSuggestions([]);
    }
  };

  const executeTrade = async () => {
    try {
      await alpacaService.placeOrder({
        symbol: search,
        qty: Number(qty),
        side,
        type: orderType,
        limit_price: limitPrice ? Number(limitPrice) : undefined,
        stop_price: stopPrice ? Number(stopPrice) : undefined,
        stop_loss: stopLoss ? Number(stopLoss) : undefined,
        take_profit: takeProfit ? Number(takeProfit) : undefined,
      });
      Alert.alert('Success', 'Order submitted to Alpaca');
      setTicketOpen(false);
      refresh();
    } catch (error: any) {
      Alert.alert('Trade Error', error.message);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Card>
        <Text style={styles.label}>Search Stocks / Crypto</Text>
        <TextInput style={styles.input} value={search} onChangeText={onSearch} autoCapitalize='characters' />
        {suggestions.map((asset) => (
          <Text key={asset.id || asset.symbol} style={styles.suggestion} onPress={() => setSearch(asset.symbol)}>
            {asset.symbol} - {asset.name || asset.class}
          </Text>
        ))}
      </Card>

      <Card>
        <Text style={styles.label}>Live Market Data</Text>
        {tradesError && <Text style={styles.error}>{tradesError}</Text>}
        <Text style={styles.meta}>{lastUpdatedAt ? `Feed: ${Date.now() - lastUpdatedAt > 15000 ? 'stale' : 'live'}` : 'Feed unavailable'}</Text>
        <Text style={styles.big}>${Number(quote?.price || 0).toFixed(2)}</Text>
        <Text style={styles.meta}>Bid: ${Number(quote?.bid || 0).toFixed(2)} / Ask: ${Number(quote?.ask || 0).toFixed(2)}</Text>
        <Text style={styles.meta}>Spread: ${Number(quote?.spread || 0).toFixed(4)}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Quick trade</Text>
        <Text style={styles.meta}>Market order for current symbol ({search}).</Text>
        <View style={styles.row}>
          <PrimaryButton label='Buy' onPress={() => { setSide('buy'); setOrderType('market'); setTicketOpen(true); }} variant='success' disabled={!alpacaConfigured} style={{ flex: 1 }} />
          <View style={{ width: 8 }} />
          <PrimaryButton label='Sell' onPress={() => { setSide('sell'); setOrderType('market'); setTicketOpen(true); }} variant='danger' disabled={!alpacaConfigured} style={{ flex: 1 }} />
        </View>
        <PrimaryButton label='Advanced ticket' onPress={() => setTicketOpen(true)} disabled={!alpacaConfigured} style={{ marginTop: 8 }} />
      </Card>

      <Card>
        <Text style={styles.label}>Open Positions</Text>
        {positions.map((p) => (
          <View key={p.symbol} style={styles.positionRow}>
            <Text style={styles.positionText}>
              {p.symbol} ({p.qty})
            </Text>
            <Text style={{ color: Number(p.unrealized_pl || 0) >= 0 ? palette.success : palette.danger }}>${Number(p.unrealized_pl || 0).toFixed(2)}</Text>
          </View>
        ))}
        {!positions.length && <Text style={styles.meta}>No open positions</Text>}
      </Card>

      <Card>
        <Text style={styles.label}>Order History</Text>
        {orders.slice(0, 10).map((o) => (
          <Text key={o.id} style={styles.meta}>
            {o.symbol} {o.side} x{o.qty} ({o.status})
          </Text>
        ))}
        {!orders.length && <Text style={styles.meta}>No orders yet</Text>}
      </Card>

      <Modal
        visible={ticketOpen}
        animationType='slide'
        transparent
        onRequestClose={() => {
          Keyboard.dismiss();
          setTicketOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
        >
          <View style={{ flex: 1 }}>
            <Pressable
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
              onPress={() => {
                Keyboard.dismiss();
                setTicketOpen(false);
              }}
            />
            <View pointerEvents='box-none' style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}>
              <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Trade Ticket ({search})</Text>
            <View style={styles.row}>
              <PrimaryButton label='BUY' onPress={() => setSide('buy')} variant='success' style={{ flex: 1 }} />
              <View style={{ width: 8 }} />
              <PrimaryButton label='SELL' onPress={() => setSide('sell')} variant='danger' style={{ flex: 1 }} />
            </View>
            <View style={styles.rowPills}>
              <Text style={[styles.pill, orderType === 'market' && styles.active]} onPress={() => setOrderType('market')}>
                Market
              </Text>
              <Text style={[styles.pill, orderType === 'limit' && styles.active]} onPress={() => setOrderType('limit')}>
                Limit
              </Text>
              <Text style={[styles.pill, orderType === 'stop' && styles.active]} onPress={() => setOrderType('stop')}>
                Stop
              </Text>
            </View>
            <TextInput style={styles.input} value={qty} onChangeText={setQty} placeholder='Quantity' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
            {(orderType === 'limit' || orderType === 'stop') && (
              <TextInput
                style={styles.input}
                value={orderType === 'limit' ? limitPrice : stopPrice}
                onChangeText={orderType === 'limit' ? setLimitPrice : setStopPrice}
                placeholder={orderType === 'limit' ? 'Limit price' : 'Stop price'}
                placeholderTextColor={palette.textSecondary}
                keyboardType='numeric'
              />
            )}
            <TextInput style={styles.input} value={stopLoss} onChangeText={setStopLoss} placeholder='Stop loss (optional)' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
            <TextInput style={styles.input} value={takeProfit} onChangeText={setTakeProfit} placeholder='Take profit (optional)' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
            <View style={styles.row}>
              <PrimaryButton label='Submit Order' onPress={executeTrade} disabled={!alpacaConfigured} style={{ flex: 1 }} />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Cancel' onPress={() => setTicketOpen(false)} variant='danger' style={{ flex: 1 }} />
            </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  input: { backgroundColor: palette.surfaceElevated, borderWidth: 1, borderColor: palette.border, color: palette.textPrimary, borderRadius: 12, padding: 10, marginBottom: 8 },
  suggestion: { color: palette.textPrimary, marginBottom: 4 },
  big: { color: palette.textPrimary, fontSize: 30, fontWeight: '800' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 8 },
  rowPills: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pill: { color: palette.textPrimary, borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  active: { borderColor: palette.primary, color: palette.primary },
  positionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  positionText: { color: palette.textPrimary },
  modalContent: { backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  modalTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 10 },
  error: { color: palette.danger, marginBottom: 8 },
});
