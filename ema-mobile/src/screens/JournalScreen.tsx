import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { journalService, type JournalDayResponse, type JournalMonthResponse } from '../services/journalService';
import { palette } from '../theme/colors';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function sourceLabel(source: string) {
  if (source === 'airfarming') return 'Airfarming';
  if (source === 'vip') return 'VIP Farmers';
  if (source === 'contracts') return 'Contracts';
  return source;
}

export function JournalScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [monthData, setMonthData] = useState<JournalMonthResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState(now.toISOString().slice(0, 10));
  const [dayData, setDayData] = useState<JournalDayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const calendarCells = useMemo(() => {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const startDow = (first.getUTCDay() + 6) % 7;
    const cells: Array<{ key: string; day: number | null; ymd: string | null }> = [];
    for (let i = 0; i < startDow; i += 1) cells.push({ key: `pad-${i}`, day: null, ymd: null });
    for (let d = 1; d <= daysInMonth; d += 1) {
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ key: ymd, day: d, ymd });
    }
    return cells;
  }, [year, month]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, d] = await Promise.all([
        journalService.getMonth(year, month),
        journalService.getDay(selectedDate),
      ]);
      setMonthData(m);
      setDayData(d);
    } catch (e: any) {
      setError(e?.message || 'Failed to load journal');
    }
  }, [year, month, selectedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
    const ymd = `${y}-${String(m).padStart(2, '0')}-01`;
    setSelectedDate(ymd);
  };

  const onSelectDay = (ymd: string) => {
    setSelectedDate(ymd);
    void journalService.getDay(ymd).then(setDayData).catch((e: any) => setError(e?.message));
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Journal</Text>
      <Text style={styles.sub}>Daily earnings (UTC). Green = profit day.</Text>

      {error ? (
        <Card style={styles.errCard}>
          <Text style={styles.err}>{error}</Text>
        </Card>
      ) : null}

      {monthData ? (
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryText}>
            Month total {fmtUsd(monthData.monthTotalUsd)} · {monthData.profitDays} profit day
            {monthData.profitDays === 1 ? '' : 's'}
            {monthData.bestDay ? ` · Best ${fmtUsd(monthData.bestDay.totalUsd)}` : ''}
          </Text>
        </Card>
      ) : null}

      <Card>
        <View style={styles.monthHeader}>
          <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}>
            <Ionicons name='chevron-back' size={24} color={palette.primary} />
          </Pressable>
          <Text style={styles.monthTitle}>{monthLabel(year, month)}</Text>
          <Pressable onPress={() => shiftMonth(1)} hitSlop={12}>
            <Ionicons name='chevron-forward' size={24} color={palette.primary} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAYS.map((w) => (
            <Text key={w} style={styles.weekLabel}>
              {w}
            </Text>
          ))}
        </View>

        <View style={styles.grid}>
          {calendarCells.map((cell) => {
            if (!cell.day || !cell.ymd) {
              return <View key={cell.key} style={styles.cellEmpty} />;
            }
            const dayInfo = monthData?.days?.[cell.ymd];
            const hasProfit = Boolean(dayInfo?.hasProfit);
            const selected = cell.ymd === selectedDate;
            return (
              <Pressable
                key={cell.key}
                style={[
                  styles.cell,
                  hasProfit && styles.cellProfit,
                  selected && styles.cellSelected,
                ]}
                onPress={() => onSelectDay(cell.ymd!)}
              >
                <Text style={[styles.cellDay, hasProfit && styles.cellDayProfit]}>{cell.day}</Text>
                {hasProfit ? (
                  <Text style={styles.cellAmt} numberOfLines={1}>
                    {fmtUsd(dayInfo!.totalUsd).replace('$', '')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={styles.detailCard}>
        <Text style={styles.detailTitle}>{selectedDate} (UTC)</Text>
        {dayData ? (
          <>
            <Text style={styles.detailTotal}>
              {dayData.hasProfit ? fmtUsd(dayData.totalUsd) : 'No earnings this day'}
            </Text>
            {dayData.hasProfit ? (
              <Text style={styles.breakdown}>
                Airfarming {fmtUsd(dayData.breakdown.airfarming)} · VIP {fmtUsd(dayData.breakdown.vip)} ·
                Contracts {fmtUsd(dayData.breakdown.contracts)}
              </Text>
            ) : null}
            {dayData.items.length ? (
              dayData.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    <Text style={styles.itemMeta}>{sourceLabel(item.source)}</Text>
                  </View>
                  <Text style={styles.itemAmt}>{fmtUsd(item.amountUsd)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.meta}>No line items for this date.</Text>
            )}
          </>
        ) : (
          <Text style={styles.meta}>Loading day…</Text>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 12 },
  errCard: { marginBottom: 12, borderColor: '#b45309' },
  err: { color: '#fbbf24' },
  summaryCard: { marginBottom: 12 },
  summaryText: { color: palette.textSecondary, fontSize: 13 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  monthTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: { flex: 1, textAlign: 'center', color: palette.textSecondary, fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellEmpty: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellProfit: { backgroundColor: 'rgba(34, 197, 94, 0.18)', borderColor: 'rgba(34, 197, 94, 0.45)' },
  cellSelected: { borderColor: palette.primary, borderWidth: 2 },
  cellDay: { color: palette.textPrimary, fontWeight: '700', fontSize: 14 },
  cellDayProfit: { color: '#86efac' },
  cellAmt: { color: '#86efac', fontSize: 9, marginTop: 2 },
  detailCard: { marginTop: 12 },
  detailTitle: { color: palette.textSecondary, fontWeight: '700', marginBottom: 6 },
  detailTotal: { color: palette.primary, fontSize: 28, fontWeight: '800', marginBottom: 8 },
  breakdown: { color: palette.textSecondary, fontSize: 12, marginBottom: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  itemLabel: { color: palette.textPrimary, fontWeight: '600' },
  itemMeta: { color: palette.textSecondary, fontSize: 11, marginTop: 2 },
  itemAmt: { color: palette.primary, fontWeight: '800', fontSize: 16 },
  meta: { color: palette.textSecondary },
});
