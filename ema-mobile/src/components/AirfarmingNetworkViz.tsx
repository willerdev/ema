import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Line } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { palette } from '../theme/colors';

const TICK_MS = 2000;
const VIEW = 100;
const CX = 50;
const CY = 50;

type NetworkNode = {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  showLabel: boolean;
};

type NodeLabel = {
  nodeId: string;
  line1: string;
  line2: string;
};

const ASSETS = ['USDT', 'BTC', 'ETH', 'TRX', 'USDT'];
const NETWORKS = ['TRC20', 'ERC20', 'BEP20', 'BTC'];
const STATUSES = ['confirmed', 'settled', 'indexed', 'verified'];

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildNetworkLayout(): { nodes: NetworkNode[]; edges: { x1: number; y1: number; x2: number; y2: number }[] } {
  const nodes: NetworkNode[] = [
    { id: 'hub', x: CX, y: CY, r: 2.8, color: '#F4C542', showLabel: false },
  ];
  const spokes = 8;
  const ringRadii = [11, 19, 27, 35, 43];

  for (let s = 0; s < spokes; s += 1) {
    const angle = (s / spokes) * Math.PI * 2 - Math.PI / 2;
    for (let ri = 0; ri < ringRadii.length; ri += 1) {
      const r = ringRadii[ri];
      const x = CX + Math.cos(angle) * r;
      const y = CY + Math.sin(angle) * r;
      const isOrange = ri <= 1;
      nodes.push({
        id: `${s}-${ri}`,
        x,
        y,
        r: isOrange ? 1.6 : 1.25,
        color: isOrange ? '#fb923c' : ri === 2 ? '#f87171' : '#ef4444',
        showLabel: ri >= 2 && s % 2 === 0,
      });
    }
  }

  for (let s = 0; s < spokes; s += 1) {
    const a1 = (s / spokes) * Math.PI * 2 - Math.PI / 2;
    const a2 = (((s + 0.5) % spokes) / spokes) * Math.PI * 2 - Math.PI / 2;
    for (const rad of [19, 27]) {
      nodes.push({
        id: `b-${s}-${rad}`,
        x: CX + Math.cos(a1) * rad * 0.72 + Math.cos(a2) * rad * 0.28,
        y: CY + Math.sin(a1) * rad * 0.72 + Math.sin(a2) * rad * 0.28,
        r: 1.1,
        color: '#fb923c',
        showLabel: false,
      });
    }
  }

  const hub = nodes[0];
  const edges = nodes
    .filter((n) => n.id !== 'hub' && (n.id.endsWith('-3') || n.id.endsWith('-4')))
    .map((n) => ({ x1: hub.x, y1: hub.y, x2: n.x, y2: n.y }));

  return { nodes, edges };
}

function randomTxLine(seed: number): { line1: string; line2: string } {
  const h = hash32(`tx:${seed}:${Date.now()}`);
  const asset = ASSETS[h % ASSETS.length];
  const net = NETWORKS[(h >> 4) % NETWORKS.length];
  const status = STATUSES[(h >> 8) % STATUSES.length];
  const amt = ((h % 9000) + 100) / 100;
  const hex = (h * 2654435761) >>> 0;
  const a = (hex >>> 16).toString(16).slice(0, 4).padStart(4, '0');
  const b = (hex & 0xffff).toString(16).slice(0, 4).padStart(4, '0');
  return {
    line1: `0x${a}…${b}`,
    line2: `${asset} ${amt.toFixed(2)} · ${net} · ${status}`,
  };
}

function assignLabels(nodes: NetworkNode[], tick: number): NodeLabel[] {
  const labelNodes = nodes.filter((n) => n.showLabel);
  return labelNodes.map((n, i) => {
    const { line1, line2 } = randomTxLine(tick * 997 + i * 131 + hash32(n.id));
    return { nodeId: n.id, line1, line2 };
  });
}

const MATRIX_CHARS = '01ABCDEFabcdefx9';

function randomMatrixColumn(seed: number, rows: number): string {
  let s = '';
  for (let i = 0; i < rows; i += 1) {
    const h = hash32(`m:${seed}:${i}`);
    s += MATRIX_CHARS[h % MATRIX_CHARS.length];
  }
  return s;
}

type AirfarmingNetworkVizProps = {
  height?: number;
  active?: boolean;
};

export function AirfarmingNetworkViz({ height = 220, active = true }: AirfarmingNetworkVizProps) {
  const isFocused = useIsFocused();
  const running = active && isFocused;
  const { nodes, edges } = useMemo(() => buildNetworkLayout(), []);
  const [tick, setTick] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [matrixSeed, setMatrixSeed] = useState(0);
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!running || reduceMotion) {
      pulse.value = 0.5;
      return;
    }
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [running, reduceMotion, pulse]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running || reduceMotion) return;
    const id = setInterval(() => setMatrixSeed((s) => s + 1), 120);
    return () => clearInterval(id);
  }, [running, reduceMotion]);

  const labels = useMemo(() => assignLabels(nodes, tick), [nodes, tick]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.12 + pulse.value * 0.2,
  }));

  const matrixColumns = useMemo(() => {
    if (reduceMotion) return [];
    return Array.from({ length: 10 }, (_, i) => ({
      key: `col-${i}`,
      text: randomMatrixColumn(matrixSeed + i, 18),
    }));
  }, [matrixSeed, reduceMotion]);

  return (
    <View style={[styles.wrap, { height }]}>
      {!reduceMotion ? (
        <Animated.View style={[styles.matrixLayer, glowStyle]} pointerEvents='none'>
          {matrixColumns.map((col) => (
            <Text key={col.key} style={styles.matrixCol}>
              {col.text}
            </Text>
          ))}
        </Animated.View>
      ) : null}

      <Svg width='100%' height='100%' viewBox={`0 0 ${VIEW} ${VIEW}`} style={styles.svg}>
        {edges.map((e, i) => (
          <Line
            key={`e-${i}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke='rgba(244,197,66,0.12)'
            strokeWidth={0.35}
          />
        ))}
        {nodes.map((n) => (
          <Circle key={n.id} cx={n.x} cy={n.y} r={n.r} fill={n.color} opacity={n.id === 'hub' ? 1 : 0.92} />
        ))}
      </Svg>

      {labels.map((lab) => {
        const node = nodes.find((n) => n.id === lab.nodeId);
        if (!node) return null;
        const leftPct = (node.x / VIEW) * 100;
        const topPct = (node.y / VIEW) * 100;
        return (
          <View
            key={lab.nodeId}
            style={[styles.labelBubble, { left: `${leftPct}%`, top: `${topPct}%` }]}
            pointerEvents='none'
          >
            <Text style={styles.labelLine1} numberOfLines={1}>
              {lab.line1}
            </Text>
            <Text style={styles.labelLine2} numberOfLines={1}>
              {lab.line2}
            </Text>
          </View>
        );
      })}

      <View style={styles.captionWrap} pointerEvents='none'>
        <Text style={styles.caption}>Simulated on-chain activity · nodes refresh every 2s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#050810',
    borderWidth: 1,
    borderColor: palette.border,
  },
  matrixLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  matrixCol: {
    flex: 1,
    fontSize: 9,
    lineHeight: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: 'rgba(0,200,5,0.35)',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 28,
  },
  labelBubble: {
    position: 'absolute',
    transform: [{ translateX: -36 }, { translateY: -22 }],
    width: 72,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(17,24,39,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(244,197,66,0.25)',
  },
  labelLine1: {
    color: palette.primary,
    fontSize: 7,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
    textAlign: 'center',
  },
  labelLine2: {
    color: palette.textSecondary,
    fontSize: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    marginTop: 1,
  },
  captionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    alignItems: 'center',
  },
  caption: {
    color: palette.textSecondary,
    fontSize: 10,
    opacity: 0.85,
  },
});
