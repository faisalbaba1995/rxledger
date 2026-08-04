import React from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, SPACING, RADIUS } from '../../src/constants/theme';
import { Card } from '../../src/components/Card';
import { ListRow } from '../../src/components/ListRow';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';
import { useDashboard } from '../../src/hooks/useDashboard';

export default function DashboardScreen() {
  const {
    salesToday,
    cashOutToday,
    netCash,
    txCount,
    recentSales,
    loading,
    refresh,
  } = useDashboard();
  const { isPhone } = useResponsiveLayout();

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  // ── Metrics cards panel
  const metricsPanel = (
    <View style={isPhone ? styles.fullCol : styles.leftCol}>
      <Text style={styles.header}>Today&apos;s Summary</Text>

      <View style={[styles.cardGrid, isPhone && styles.cardGridPhone]}>
        <Card
          title="Sales"
          value={`₹${salesToday}`}
          subtitle={`${txCount} transaction${txCount !== 1 ? 's' : ''}`}
          accent={COLORS.primary}
          style={isPhone ? styles.cardPhone : styles.card}
        />
        <Card
          title="Cash Out"
          value={`₹${cashOutToday}`}
          accent={COLORS.danger}
          style={isPhone ? styles.cardPhone : styles.card}
        />
        <Card
          title="Net Cash"
          value={`₹${netCash}`}
          subtitle="Sales − Outlays"
          accent={parseFloat(netCash) >= 0 ? COLORS.primary : COLORS.danger}
          style={isPhone ? styles.cardPhone : styles.card}
        />
        <Card
          title="Transactions"
          value={String(txCount)}
          accent={COLORS.text}
          style={isPhone ? styles.cardPhone : styles.card}
        />
      </View>
    </View>
  );

  // ── Recent sales panel
  const recentPanel = (
    <View style={isPhone ? styles.fullCol : styles.rightCol}>
      <Text style={styles.header}>Recent Sales</Text>
      <FlatList
        data={recentSales}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <ListRow
            title={`₹${item.total_amount}`}
            rightLabel={formatTime(item.timestamp)}
          />
        )}
        refreshing={loading}
        onRefresh={refresh}
        scrollEnabled={!isPhone}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {loading ? 'Loading...' : 'No sales yet today'}
          </Text>
        }
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {isPhone ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.phoneContainer}
        >
          {metricsPanel}
          {recentPanel}
        </ScrollView>
      ) : (
        <View style={styles.tabletContainer}>
          {metricsPanel}
          {recentPanel}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.bg },

  // Tablet layout
  tabletContainer: { flex: 1, flexDirection: 'row', padding: SPACING.lg },
  leftCol: { flex: 1, marginRight: SPACING.lg },
  rightCol: { width: 380, borderLeftWidth: 1, borderLeftColor: COLORS.border, paddingLeft: SPACING.lg },

  // Phone layout
  phoneContainer: { padding: SPACING.lg, paddingBottom: 100 },
  fullCol: { marginBottom: SPACING.xl },

  header: { fontSize: FONT.header, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.lg,
  },
  cardGridPhone: {
    flexDirection: 'column',
  },
  card: {
    flex: 1,
    minWidth: 200,
  },
  cardPhone: {
    width: '100%',
    marginBottom: SPACING.sm,
  },
  emptyText: { fontSize: FONT.base, color: COLORS.textDim, padding: SPACING.xl, textAlign: 'center' },
});
