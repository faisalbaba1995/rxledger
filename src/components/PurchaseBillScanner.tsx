/**
 * PurchaseBillScanner — Full-screen scanner for distributor purchase bills.
 *
 * Uses the CameraScanner to capture images of printed bills,
 * sends them to Gemini OCR for extraction, then presents
 * the extracted items for review before bulk-adding to stock.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Modal,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../constants/theme';
import { PrimaryButton } from './PrimaryButton';
import { CameraScanner } from './CameraScanner';
import { extractPurchaseBillItems } from '../lib/purchaseBillOcrService';
import { supabase } from '../lib/supabase';
import type { PurchaseBillItem, PurchaseBillResult } from '../lib/purchaseBillOcrService';

interface PurchaseBillScannerProps {
  visible: boolean;
  onClose: () => void;
  onStockAdded: () => void;
}

type ScanPhase = 'camera' | 'processing' | 'review';

export function PurchaseBillScanner({ visible, onClose, onStockAdded }: PurchaseBillScannerProps) {
  const [phase, setPhase] = useState<ScanPhase>('camera');
  const [result, setResult] = useState<PurchaseBillResult | null>(null);
  const [editableItems, setEditableItems] = useState<PurchaseBillItem[]>([]);
  const [saving, setSaving] = useState(false);

  const handleCapture = useCallback(async (_uris: string[], base64s: string[]) => {
    setPhase('processing');
    try {
      const billResult = await extractPurchaseBillItems(base64s);
      setResult(billResult);
      setEditableItems(billResult.items);
      setPhase('review');
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('OCR Error', 'Failed to extract data from the bill.');
      setPhase('camera');
    }
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditableItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateItem = useCallback((index: number, field: keyof PurchaseBillItem, value: string) => {
    setEditableItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (field === 'quantity' || field === 'freeQuantity' || field === 'totalStock') {
          const numVal = parseInt(value) || 0;
          const updated = { ...item, [field]: numVal };
          if (field !== 'totalStock') {
            updated.totalStock = updated.quantity + updated.freeQuantity;
          }
          return updated;
        }
        return { ...item, [field]: value };
      })
    );
  }, []);

  const handleConfirmAndAddToStock = useCallback(async () => {
    if (editableItems.length === 0) {
      Alert.alert('No Items', 'There are no items to add to stock.');
      return;
    }

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      for (const item of editableItems) {
        // Step 1: Upsert inventory_items
        const { data: existingItems } = await supabase
          .from('inventory_items')
          .select('id')
          .ilike('item_name', item.productName)
          .limit(1);

        let itemId: string;

        if (existingItems && existingItems.length > 0) {
          itemId = (existingItems[0] as { id: string }).id;
        } else {
          const { data: newItem, error: insertError } = await supabase
            .from('inventory_items')
            .insert({ item_name: item.productName } as Record<string, unknown>)
            .select('id')
            .single();

          if (insertError || !newItem) {
            console.error(`Failed to insert item: ${item.productName}`, insertError);
            continue;
          }
          itemId = (newItem as { id: string }).id;
        }

        // Step 2: Normalize expiry date to ISO format
        let expiryDate = item.expiryDate;
        const mmyyMatch = expiryDate.match(/^(\d{1,2})\/(\d{2,4})$/);
        if (mmyyMatch) {
          const month = mmyyMatch[1].padStart(2, '0');
          let year = mmyyMatch[2];
          if (year.length === 2) year = `20${year}`;
          expiryDate = `${year}-${month}-01`;
        }

        // Step 3: Insert batch_records
        const { error: batchError } = await supabase
          .from('batch_records')
          .insert({
            item_id: itemId,
            batch_number: item.batchNumber,
            mrp: item.mrp,
            purchase_rate: item.purchaseRate,
            expiry_date: expiryDate,
            current_stock: item.totalStock,
          } as Record<string, unknown>);

        if (batchError) {
          console.error(`Failed to insert batch for ${item.productName}:`, batchError);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '✅ Stock Updated',
        `${editableItems.length} item${editableItems.length !== 1 ? 's' : ''} added to inventory from ${result?.supplierName ?? 'purchase bill'}.`,
        [{ text: 'OK', onPress: () => { onStockAdded(); handleReset(); onClose(); } }]
      );
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to save stock. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [editableItems, result, onStockAdded, onClose]);

  const handleReset = useCallback(() => {
    setPhase('camera');
    setResult(null);
    setEditableItems([]);
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  if (!visible) return null;

  // Phase: Camera
  if (phase === 'camera') {
    return (
      <CameraScanner
        onCapture={handleCapture}
        onClose={handleClose}
        modal
      />
    );
  }

  // Phase: Processing
  if (phase === 'processing') {
    return (
      <Modal visible animationType="fade" presentationStyle="fullScreen">
        <View style={styles.processingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.processingTitle}>Extracting Bill Data...</Text>
          <Text style={styles.processingHint}>
            Reading medicine names, batches, quantities, and prices
          </Text>
        </View>
      </Modal>
    );
  }

  // Phase: Review
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose}>
      <View style={styles.reviewContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={16}>
            <Text style={styles.headerCloseText}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Review Purchase Bill</Text>
          <Pressable onPress={handleReset} hitSlop={16}>
            <Text style={styles.headerRetakeText}>↻ Retake</Text>
          </Pressable>
        </View>

        {/* Supplier info */}
        {result && (
          <View style={styles.supplierCard}>
            <Text style={styles.supplierName}>
              {result.supplierName ?? 'Unknown Supplier'}
            </Text>
            <View style={styles.supplierMeta}>
              {result.billNumber && (
                <Text style={styles.supplierDetail}>Bill: {result.billNumber}</Text>
              )}
              {result.billDate && (
                <Text style={styles.supplierDetail}>Date: {result.billDate}</Text>
              )}
            </View>
            <View style={styles.itemCountBadge}>
              <Text style={styles.itemCountText}>
                {editableItems.length} item{editableItems.length !== 1 ? 's' : ''} detected
              </Text>
            </View>
          </View>
        )}

        {/* Item list */}
        <ScrollView style={styles.itemList} contentContainerStyle={styles.itemListContent}>
          {editableItems.map((item, index) => (
            <View key={index} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemIndex}>{index + 1}</Text>
                <TextInput
                  style={styles.itemNameInput}
                  value={item.productName}
                  onChangeText={(v) => handleUpdateItem(index, 'productName', v)}
                  placeholder="Product Name"
                  placeholderTextColor={COLORS.textPlaceholder}
                />
                <Pressable onPress={() => handleRemoveItem(index)} hitSlop={8}>
                  <Text style={styles.itemRemoveText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.itemFieldsRow}>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>Batch</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={item.batchNumber}
                    onChangeText={(v) => handleUpdateItem(index, 'batchNumber', v)}
                  />
                </View>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>Qty</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={String(item.quantity)}
                    onChangeText={(v) => handleUpdateItem(index, 'quantity', v)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>Free</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={String(item.freeQuantity)}
                    onChangeText={(v) => handleUpdateItem(index, 'freeQuantity', v)}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.itemFieldsRow}>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>Expiry</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={item.expiryDate}
                    onChangeText={(v) => handleUpdateItem(index, 'expiryDate', v)}
                  />
                </View>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>MRP</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={item.mrp}
                    onChangeText={(v) => handleUpdateItem(index, 'mrp', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.itemField}>
                  <Text style={styles.fieldLabel}>Rate</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={item.purchaseRate}
                    onChangeText={(v) => handleUpdateItem(index, 'purchaseRate', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              <Text style={styles.stockPreview}>
                Total stock to add: {item.totalStock} units
              </Text>
            </View>
          ))}

          {editableItems.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No items detected</Text>
              <Text style={styles.emptyHint}>
                Try retaking the photo with better lighting and focus.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom actions */}
        <View style={styles.bottomActions}>
          <PrimaryButton
            label={`✅ Confirm & Add ${editableItems.length} Items to Stock`}
            onPress={handleConfirmAndAddToStock}
            loading={saving}
            disabled={editableItems.length === 0}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Processing
  processingContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  processingTitle: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.primary,
  },
  processingHint: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    textAlign: 'center',
  },

  // Review
  reviewContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerCloseText: {
    fontSize: FONT.large,
    color: COLORS.text,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerRetakeText: {
    fontSize: FONT.base,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Supplier card
  supplierCard: {
    backgroundColor: COLORS.surface,
    margin: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  supplierName: {
    fontSize: FONT.large,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  supplierMeta: {
    flexDirection: 'row',
    gap: SPACING.lg,
    marginBottom: SPACING.md,
  },
  supplierDetail: {
    fontSize: 14,
    color: COLORS.textDim,
  },
  itemCountBadge: {
    backgroundColor: COLORS.primary + '20',
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
  },
  itemCountText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Item list
  itemList: {
    flex: 1,
  },
  itemListContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },

  // Item card
  itemCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  itemIndex: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textDim,
    width: 24,
  },
  itemNameInput: {
    flex: 1,
    fontSize: FONT.base,
    fontWeight: '700',
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemRemoveText: {
    fontSize: 16,
    color: COLORS.danger,
    fontWeight: '700',
  },

  // Item fields
  itemFieldsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  itemField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDim,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldInput: {
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.base,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stockPreview: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: SPACING.sm,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl * 2,
  },
  emptyText: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.textDim,
  },
  emptyHint: {
    fontSize: FONT.base,
    color: COLORS.textPlaceholder,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },

  // Bottom actions
  bottomActions: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
