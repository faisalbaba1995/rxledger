/**
 * BillReceipt — Receipt-style card component for the active bill.
 *
 * Displays an RxLedger-branded header with bill number, timestamp,
 * itemized medicine list, and running total.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../constants/theme';
import type { CartItem } from '../hooks/useSaleCart';

interface BillReceiptProps {
  billNumber: string;
  createdAt: Date;
  cart: CartItem[];
  total: string;
  onRemoveItem: (index: number) => void;
}

export function BillReceipt({
  billNumber,
  createdAt,
  cart,
  total,
  onRemoveItem,
}: BillReceiptProps) {
  const formatDate = (d: Date) => {
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderItem = ({ item, index }: { item: CartItem; index: number }) => {
    const qtyLabel =
      item.quantityType === 'FULL_STRIP'
        ? `${item.quantity} strip${item.quantity > 1 ? 's' : ''}`
        : `${item.quantity} tab${item.quantity > 1 ? 's' : ''}`;

    return (
      <Pressable
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onRemoveItem(index);
        }}
        style={styles.lineItem}
      >
        <View style={styles.lineItemLeft}>
          <Text style={styles.lineItemName} numberOfLines={1}>
            {item.itemName}
          </Text>
          <Text style={styles.lineItemMeta}>
            {qtyLabel} · Batch: {item.batch.batch_number}
          </Text>
        </View>
        <View style={styles.lineItemRight}>
          <Text style={styles.lineItemPrice}>₹{item.priceCharged}</Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onRemoveItem(index);
            }}
            style={styles.removeBtn}
            hitSlop={8}
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.receipt}>
      {/* Receipt Header */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Text style={styles.logoIcon}>💊</Text>
          <Text style={styles.logoText}>RX LEDGER</Text>
        </View>
        <View style={styles.billMeta}>
          <Text style={styles.billNumber}>{billNumber}</Text>
          <Text style={styles.billDate}>
            {formatDate(createdAt)} · {formatTime(createdAt)}
          </Text>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Column Headers */}
      <View style={styles.colHeaders}>
        <Text style={[styles.colHeader, { flex: 1 }]}>Item</Text>
        <Text style={[styles.colHeader, { width: 80, textAlign: 'right' }]}>Amount</Text>
      </View>

      {/* Line Items */}
      {cart.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No items yet</Text>
          <Text style={styles.emptyHint}>
            Scan a medicine strip or search to add items
          </Text>
        </View>
      ) : (
        <FlatList
          data={cart}
          renderItem={renderItem}
          keyExtractor={(_, index) => String(index)}
          scrollEnabled={false}
          getItemLayout={(_, index) => ({
            length: TOUCH_TARGET_MIN + SPACING.md,
            offset: (TOUCH_TARGET_MIN + SPACING.md) * index,
            index,
          })}
        />
      )}

      {/* Total Bar */}
      <View style={styles.totalBar}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>₹{total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    flex: 1,
  },

  // Header
  header: {
    padding: SPACING.lg,
    backgroundColor: COLORS.surfaceElevated,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  logoIcon: {
    fontSize: 24,
  },
  logoText: {
    fontSize: FONT.medium,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 3,
  },
  billMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    fontFamily: 'monospace',
  },
  billDate: {
    fontSize: 14,
    color: COLORS.textDim,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.lg,
  },

  // Column headers
  colHeaders: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  colHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Line items
  lineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: TOUCH_TARGET_MIN,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  lineItemLeft: {
    flex: 1,
    marginRight: SPACING.md,
  },
  lineItemName: {
    fontSize: FONT.base,
    fontWeight: '600',
    color: COLORS.text,
  },
  lineItemMeta: {
    fontSize: 14,
    color: COLORS.textDim,
    marginTop: 2,
  },
  lineItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  lineItemPrice: {
    fontSize: FONT.base,
    fontWeight: '700',
    color: COLORS.text,
    minWidth: 70,
    textAlign: 'right',
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(248, 113, 113, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: '700',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxl * 2,
    paddingHorizontal: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.textDim,
    marginBottom: SPACING.sm,
  },
  emptyHint: {
    fontSize: FONT.base,
    color: COLORS.textPlaceholder,
    textAlign: 'center',
  },

  // Total bar
  totalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalLabel: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.textDim,
    letterSpacing: 2,
  },
  totalValue: {
    fontSize: FONT.header,
    fontWeight: '800',
    color: COLORS.primary,
  },
});
