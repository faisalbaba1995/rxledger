import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../../src/constants/theme';
import { ListRow } from '../../src/components/ListRow';
import { PurchaseBillScanner } from '../../src/components/PurchaseBillScanner';
import { useInventory } from '../../src/hooks/useInventory';
import type { InventoryDisplayItem } from '../../src/hooks/useInventory';

export default function StockScreen() {
  const { items, loading, error, refresh } = useInventory();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBillScanner, setShowBillScanner] = useState(false);

  const toggleExpand = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const isExpiringSoon = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const expiry = new Date(dateStr);
    const now = new Date();
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 60 && diffDays > 0;
  };

  const isExpired = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const renderItem = useCallback(({ item }: { item: InventoryDisplayItem }) => {
    const expanded = expandedId === item.id;
    const expiringSoon = isExpiringSoon(item.nearest_expiry);
    const expired = isExpired(item.nearest_expiry);

    return (
      <View>
        <ListRow
          title={item.item_name}
          subtitle={item.composition ?? `${item.batches.length} batch${item.batches.length > 1 ? 'es' : ''}`}
          rightLabel={`${item.total_stock} strips`}
          rightSublabel={expired ? '⚠ EXPIRED' : expiringSoon ? '⚠ Expiring soon' : item.nearest_expiry ? `Exp: ${item.nearest_expiry}` : 'No batches'}
          onPress={() => toggleExpand(item.id)}
          highlighted={expired || expiringSoon}
          dimmed={item.total_stock === 0}
        />
        {expanded && (
          <View style={styles.batchList}>
            {item.batches.map((b) => (
              <View key={b.id} style={styles.batchRow}>
                <Text style={styles.batchText}>
                  Batch: {b.batch_number}
                </Text>
                <Text style={styles.batchText}>
                  MRP: ₹{b.mrp} · Cost: ₹{b.purchase_rate}
                </Text>
                <Text style={[
                  styles.batchText,
                  isExpired(b.expiry_date) && styles.expiredText,
                ]}>
                  Stock: {b.current_stock} · Exp: {b.expiry_date}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }, [expandedId, toggleExpand]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.header}>Inventory</Text>
          <Text style={styles.count}>{items.length} medicines</Text>
        </View>
        <Pressable
          style={styles.scanBillBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowBillScanner(true);
          }}
        >
          <Text style={styles.scanBillBtnText}>📄 Scan Purchase Bill</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          refreshing={loading}
          onRefresh={refresh}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {loading ? 'Loading inventory...' : 'No medicines found. Import from Marg first.'}
            </Text>
          }
        />
      )}

      <PurchaseBillScanner
        visible={showBillScanner}
        onClose={() => setShowBillScanner(false)}
        onStockAdded={refresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  header: { fontSize: FONT.header, fontWeight: '800', color: COLORS.text },
  count: { fontSize: FONT.base, color: COLORS.textDim, marginTop: 2 },
  scanBillBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  scanBillBtnText: {
    fontSize: FONT.base,
    fontWeight: '700',
    color: COLORS.bg,
  },
  list: { paddingBottom: 100 },
  batchList: {
    backgroundColor: COLORS.surfaceElevated,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  batchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    flexWrap: 'wrap',
    gap: SPACING.lg,
  },
  batchText: { fontSize: FONT.base, color: COLORS.textDim },
  expiredText: { color: COLORS.danger },
  errorText: { fontSize: FONT.base, color: COLORS.danger, padding: SPACING.xl, textAlign: 'center' },
  emptyText: { fontSize: FONT.base, color: COLORS.textDim, padding: SPACING.xl, textAlign: 'center' },
});
