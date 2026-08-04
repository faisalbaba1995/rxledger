import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, ScrollView, KeyboardAvoidingView,
  Platform, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../../src/constants/theme';
import { SearchInput } from '../../src/components/SearchInput';
import { ListRow } from '../../src/components/ListRow';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { NumericInput } from '../../src/components/NumericInput';
import { SegmentToggle } from '../../src/components/SegmentToggle';
import { CameraScanner } from '../../src/components/CameraScanner';
import { useInventory } from '../../src/hooks/useInventory';
import { useSaleCart } from '../../src/hooks/useSaleCart';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';
import { createInventorySearchEngine } from '../../src/utils/fuzzySearch';
import { extractMedicineDetails } from '../../src/lib/ocrService';
import type { OcrResult } from '../../src/lib/ocrService';
import type { BatchRecordRow } from '../../src/types/database';
import type { InventoryDisplayItem } from '../../src/hooks/useInventory';

const QTY_OPTIONS = ['FULL STRIP', 'LOOSE'] as const;

export default function SalesScreen() {
  const { items, loading: invLoading, refresh: refreshInv } = useInventory();
  const { cart, addItem, removeItem, total, submitSale, submitting, clearCart } = useSaleCart();
  const { isPhone } = useResponsiveLayout();

  // ── Camera state
  const [showCamera, setShowCamera] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [lastOcrResult, setLastOcrResult] = useState<OcrResult | null>(null);

  // ── Search engine (rebuild when items change)
  const searchEngine = useMemo(() => {
    if (items.length === 0) return null;
    return createInventorySearchEngine(
      items.map((i) => ({
        id: i.id,
        item_name: i.item_name,
        composition: i.composition,
        base_unit_size: i.base_unit_size,
      }))
    );
  }, [items]);

  // ── Search state
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryDisplayItem | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<BatchRecordRow | null>(null);
  const [qty, setQty] = useState(1);
  const [qtyType, setQtyType] = useState<string>('FULL STRIP');

  // ── Search results
  const searchResults = useMemo(() => {
    if (!searchEngine || query.length < 2) return [];
    const hits = searchEngine.search(query, 8);
    return hits.map((h) => {
      const full = items.find((i) => i.id === h.item.id);
      return full!;
    }).filter(Boolean);
  }, [searchEngine, query, items]);

  // ── Select item → pick first batch by nearest expiry (FEFO)
  const handleSelectItem = useCallback((item: InventoryDisplayItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedItem(item);
    setQuery(item.item_name);
    // FEFO: sort batches by expiry, pick first with stock > 0
    const sorted = [...item.batches]
      .filter((b) => b.current_stock > 0)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    setSelectedBatch(sorted[0] ?? item.batches[0] ?? null);
    setQty(1);
  }, []);

  // ── Computed price
  const computedPrice = useMemo(() => {
    if (!selectedBatch || !selectedItem) return '0.00';
    const mrp = parseFloat(selectedBatch.mrp);
    if (qtyType === 'LOOSE') {
      return ((mrp / selectedItem.base_unit_size) * qty).toFixed(2);
    }
    return (mrp * qty).toFixed(2);
  }, [selectedBatch, selectedItem, qty, qtyType]);

  // ── Add to cart
  const handleAdd = useCallback(() => {
    if (!selectedBatch || !selectedItem) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addItem(
      selectedBatch,
      selectedItem.item_name,
      selectedItem.base_unit_size,
      qty,
      qtyType === 'FULL STRIP' ? 'FULL_STRIP' : 'LOOSE',
    );
    setSelectedItem(null);
    setSelectedBatch(null);
    setQuery('');
    setQty(1);
  }, [selectedBatch, selectedItem, qty, qtyType, addItem]);

  // ── Complete sale
  const handleComplete = useCallback(async () => {
    const result = await submitSale();
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshInv();
      Alert.alert('✓ Sale Recorded', `Total: ₹${total}`);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', result.error ?? 'Failed to save sale');
    }
  }, [submitSale, refreshInv, total]);

  // ── Camera capture handler → sends to Gemini OCR
  const handleCameraCapture = useCallback(async (uri: string, base64: string) => {
    setShowCamera(false);
    setOcrProcessing(true);
    setLastOcrResult(null);

    try {
      const result = await extractMedicineDetails(base64);
      setLastOcrResult(result);

      Haptics.notificationAsync(
        result.confident
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );

      // Build a human-readable summary
      const lines: string[] = [];
      if (result.medicineName) lines.push(`💊  Medicine: ${result.medicineName}`);
      if (result.batchNumber) lines.push(`🏷️  Batch: ${result.batchNumber}`);
      if (result.expiryDate) lines.push(`📅  Expiry: ${result.expiryDate}`);
      if (result.mrp) lines.push(`💰  MRP: ₹${result.mrp}`);
      if (result.composition) lines.push(`🧪  Composition: ${result.composition}`);

      if (lines.length === 0) {
        lines.push('Could not extract medicine details from this image.');
        lines.push('');
        lines.push('Tips:');
        lines.push('• Hold the camera steady and close to the text');
        lines.push('• Ensure good lighting');
        lines.push('• Make sure the medicine name and batch info are in frame');
      }

      if (!result.confident && lines.length > 0) {
        lines.push('');
        lines.push('⚠️ Low confidence — some fields may be inaccurate.');
      }

      Alert.alert(
        result.confident ? '✅ Medicine Detected' : '📷 Scan Result',
        lines.join('\n'),
        [
          { text: 'Scan Again', onPress: () => setShowCamera(true) },
          {
            text: result.medicineName ? 'Search This' : 'OK',
            onPress: () => {
              if (result.medicineName) {
                setQuery(result.medicineName);
              }
            },
          },
        ],
      );
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('OCR Error', 'Failed to process the image. Please try again.');
    } finally {
      setOcrProcessing(false);
    }
  }, []);

  // ── Camera modal (phone) or inline rendering
  if (showCamera) {
    return (
      <CameraScanner
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
        modal={isPhone}
      />
    );
  }

  // ── Item Selection Panel
  const selectionPanel = (
    <View style={isPhone ? styles.fullCol : styles.leftCol}>
      <Text style={styles.header}>New Sale</Text>

      {/* Camera scan button */}
      <PrimaryButton
        label={ocrProcessing ? '🔍 Analyzing...' : '📷 Scan Medicine Strip'}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowCamera(true);
        }}
        variant="ghost"
        style={styles.scanBtn}
        disabled={ocrProcessing}
      />

      {/* OCR Processing overlay */}
      {ocrProcessing && (
        <View style={styles.ocrProcessingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.ocrProcessingText}>
            Analyzing medicine strip with AI...
          </Text>
          <Text style={styles.ocrProcessingHint}>
            This usually takes 2-3 seconds
          </Text>
        </View>
      )}

      <SearchInput value={query} onChangeText={setQuery} placeholder="Search medicine..." />

      {/* Search results dropdown */}
      {query.length >= 2 && !selectedItem && (
        <View style={styles.dropdown}>
          {invLoading ? (
            <Text style={styles.hint}>Loading inventory...</Text>
          ) : searchResults.length === 0 ? (
            <Text style={styles.hint}>No matches found</Text>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <ListRow
                  title={item.item_name}
                  subtitle={item.composition ?? undefined}
                  rightLabel={`${item.total_stock} strips`}
                  rightSublabel={`₹${item.batches[0]?.mrp ?? '—'}`}
                  dimmed={item.total_stock === 0}
                  onPress={() => handleSelectItem(item)}
                />
              )}
            />
          )}
        </View>
      )}

      {/* Selected item — batch, qty, type */}
      {selectedItem && selectedBatch && (
        <View style={styles.selectionBlock}>
          <Text style={styles.selectedName}>{selectedItem.item_name}</Text>
          <Text style={styles.batchInfo}>
            Batch: {selectedBatch.batch_number} · MRP: ₹{selectedBatch.mrp} · Stock: {selectedBatch.current_stock}
          </Text>

          {selectedItem.batches.length > 1 && (
            <View style={styles.batchPicker}>
              {selectedItem.batches
                .filter((b) => b.current_stock > 0)
                .map((b) => (
                  <PrimaryButton
                    key={b.id}
                    label={`${b.batch_number} (₹${b.mrp})`}
                    variant={b.id === selectedBatch.id ? 'primary' : 'ghost'}
                    onPress={() => setSelectedBatch(b)}
                    style={styles.batchBtn}
                  />
                ))}
            </View>
          )}

          <View style={[styles.qtyRow, isPhone && styles.qtyRowPhone]}>
            <NumericInput
              value={qty}
              onChange={setQty}
              min={1}
              max={qtyType === 'FULL STRIP' ? selectedBatch.current_stock : selectedBatch.current_stock * selectedItem.base_unit_size}
              label="Quantity"
            />
            <View style={isPhone ? styles.toggleWrapPhone : styles.toggleWrap}>
              <SegmentToggle
                options={QTY_OPTIONS}
                selected={qtyType}
                onSelect={setQtyType}
              />
            </View>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Price:</Text>
            <Text style={styles.priceValue}>₹{computedPrice}</Text>
          </View>

          <PrimaryButton
            label="Add to Cart"
            onPress={handleAdd}
            disabled={!selectedBatch || qty < 1}
            style={styles.addBtn}
          />
        </View>
      )}
    </View>
  );

  // ── Cart Panel
  const cartPanel = (
    <View style={isPhone ? styles.fullCol : styles.rightCol}>
      <Text style={styles.header}>Cart</Text>

      {cart.length === 0 ? (
        <Text style={styles.hint}>No items added yet</Text>
      ) : (
        <FlatList
          data={cart}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index }) => (
            <ListRow
              title={item.itemName}
              subtitle={`${item.quantityType === 'FULL_STRIP' ? 'Strip' : 'Loose'} × ${item.quantity}`}
              rightLabel={`₹${item.priceCharged}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                removeItem(index);
              }}
            />
          )}
          style={isPhone ? undefined : styles.cartList}
        />
      )}

      <View style={styles.totalBar}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>₹{total}</Text>
      </View>

      <PrimaryButton
        label="Complete Sale"
        onPress={handleComplete}
        disabled={cart.length === 0}
        loading={submitting}
        style={styles.completeBtn}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {isPhone ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.phoneContainer}
            keyboardShouldPersistTaps="handled"
          >
            {selectionPanel}
            {cartPanel}
          </ScrollView>
        ) : (
          <View style={styles.tabletContainer}>
            {selectionPanel}
            {cartPanel}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.bg },

  // Tablet layout (side-by-side)
  tabletContainer: { flex: 1, flexDirection: 'row', padding: SPACING.lg },
  leftCol: { flex: 1, marginRight: SPACING.lg },
  rightCol: { width: 380, borderLeftWidth: 1, borderLeftColor: COLORS.border, paddingLeft: SPACING.lg },

  // Phone layout (stacked)
  phoneContainer: { padding: SPACING.lg, paddingBottom: 100 },
  fullCol: { marginBottom: SPACING.xl },

  header: { fontSize: FONT.header, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.lg },

  scanBtn: {
    marginBottom: SPACING.md,
    borderColor: COLORS.primary,
  },

  ocrProcessingBox: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
    padding: SPACING.xl,
    marginBottom: SPACING.md,
    alignItems: 'center',
    gap: SPACING.md,
  },
  ocrProcessingText: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'center',
  },
  ocrProcessingHint: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    textAlign: 'center',
  },

  dropdown: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 320,
    marginTop: SPACING.sm,
  },
  hint: { fontSize: FONT.base, color: COLORS.textDim, padding: SPACING.lg, textAlign: 'center' },
  selectionBlock: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedName: { fontSize: FONT.large, fontWeight: '700', color: COLORS.text },
  batchInfo: { fontSize: FONT.base, color: COLORS.textDim, marginTop: SPACING.xs },
  batchPicker: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.md, gap: SPACING.sm },
  batchBtn: { paddingHorizontal: SPACING.md, minHeight: 44 },

  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: SPACING.lg, gap: SPACING.xl },
  qtyRowPhone: { flexDirection: 'column', alignItems: 'stretch', gap: SPACING.md },
  toggleWrap: { flex: 1 },
  toggleWrapPhone: { marginTop: SPACING.sm },

  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.lg },
  priceLabel: { fontSize: FONT.large, color: COLORS.textDim, marginRight: SPACING.md },
  priceValue: { fontSize: FONT.header, fontWeight: '800', color: COLORS.primary },
  addBtn: { marginTop: SPACING.lg },
  cartList: { flex: 1 },
  totalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.sm,
  },
  totalLabel: { fontSize: FONT.large, fontWeight: '700', color: COLORS.textDim },
  totalValue: { fontSize: FONT.header, fontWeight: '800', color: COLORS.primary },
  completeBtn: { marginTop: SPACING.md },
});
