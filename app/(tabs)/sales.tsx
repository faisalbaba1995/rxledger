/**
 * SalesScreen — Multi-tab billing interface with receipt-style layout.
 *
 * Supports concurrent customer bills via tabs, medicine scanning
 * (MLKit auto-capture + Gemini OCR), fuzzy search, and a full
 * checkout flow with Print/WhatsApp/Email sharing.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, KeyboardAvoidingView,
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
import { BillTabBar } from '../../src/components/BillTabBar';
import { BillReceipt } from '../../src/components/BillReceipt';
import { CheckoutSheet } from '../../src/components/CheckoutSheet';
import { OcrReviewModal } from '../../src/components/OcrReviewModal';
import { useInventory } from '../../src/hooks/useInventory';
import { useBillTabs } from '../../src/hooks/useBillTabs';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';
import { createInventorySearchEngine } from '../../src/utils/fuzzySearch';
import { extractMedicineDetails } from '../../src/lib/ocrService';
import { recordSale } from '../../src/lib/salesService';
import type { OcrResult } from '../../src/lib/ocrService';
import type { BatchRecordRow, QuantityType } from '../../src/types/database';
import type { InventoryDisplayItem } from '../../src/hooks/useInventory';
import type { FinalOcrData } from '../../src/components/OcrReviewModal';
import type { CartItem } from '../../src/hooks/useSaleCart';

const QTY_OPTIONS = ['FULL STRIP', 'LOOSE'] as const;

// ─── Price Helpers ──────────────────────────────────────────────────

function computePrice(
  mrp: string | number,
  baseUnitSize: number,
  quantity: number,
  quantityType: QuantityType,
): string {
  const cleanMrp = String(mrp ?? 0).replace(/[^\d.]/g, '');
  const mrpNum = parseFloat(cleanMrp) || 0;
  if (quantityType === 'FULL_STRIP') return (mrpNum * quantity).toFixed(2);
  return ((mrpNum / (baseUnitSize || 10)) * quantity).toFixed(2);
}

// ─── Main Screen ────────────────────────────────────────────────────

export default function SalesScreen() {
  const { items, loading: invLoading, refresh: refreshInv } = useInventory();
  const { isPhone } = useResponsiveLayout();

  // Multi-tab billing state
  const {
    tabs, activeTabId, activeTab,
    createTab, closeTab, switchTab,
    addItemToTab, removeItemFromTab,
    updateCustomerInfo, getTabTotal, clearTabCart,
  } = useBillTabs();

  // ── Camera state
  const [showCamera, setShowCamera] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [lastOcrResult, setLastOcrResult] = useState<OcrResult | null>(null);

  // ── Checkout state
  const [showCheckout, setShowCheckout] = useState(false);

  // ── Search engine
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
    return hits
      .map((h) => items.find((i) => i.id === h.item.id)!)
      .filter(Boolean);
  }, [searchEngine, query, items]);

  // ── Select item → pick first batch by nearest expiry (FEFO)
  const handleSelectItem = useCallback((item: InventoryDisplayItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedItem(item);
    setQuery(item.item_name);
    const sorted = [...item.batches]
      .filter((b) => b.current_stock > 0)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    setSelectedBatch(sorted[0] ?? item.batches[0] ?? null);
    setQty(1);
  }, []);

  // ── Computed price
  const computedPrice = useMemo(() => {
    if (!selectedBatch || !selectedItem) return '0.00';
    return computePrice(
      selectedBatch.mrp,
      selectedItem.base_unit_size,
      qty,
      qtyType === 'FULL STRIP' ? 'FULL_STRIP' : 'LOOSE',
    );
  }, [selectedBatch, selectedItem, qty, qtyType]);

  // ── Add to active tab's cart
  const handleAdd = useCallback(() => {
    if (!selectedBatch || !selectedItem || !activeTab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const quantityType: QuantityType = qtyType === 'FULL STRIP' ? 'FULL_STRIP' : 'LOOSE';
    const priceCharged = computePrice(
      selectedBatch.mrp,
      selectedItem.base_unit_size,
      qty,
      quantityType,
    );

    const cartItem: CartItem = {
      batch: selectedBatch,
      itemName: selectedItem.item_name,
      baseUnitSize: selectedItem.base_unit_size,
      quantity: qty,
      quantityType,
      priceCharged,
    };

    addItemToTab(activeTab.id, cartItem);
    setSelectedItem(null);
    setSelectedBatch(null);
    setQuery('');
    setQty(1);
  }, [selectedBatch, selectedItem, qty, qtyType, activeTab, addItemToTab]);

  // ── Complete sale (called from CheckoutSheet)
  const handleCompleteSale = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!activeTab || activeTab.cart.length === 0) {
      return { success: false, error: 'Cart is empty' };
    }

    try {
      const result = await recordSale(activeTab.cart);
      if (result.success) {
        clearTabCart(activeTab.id);
        refreshInv();
      }
      return result;
    } catch (err) {
      return { success: false, error: 'Failed to save sale' };
    }
  }, [activeTab, clearTabCart, refreshInv]);

  // ── Camera capture handler → sends to Gemini OCR
  const handleCameraCapture = useCallback(async (uris: string[], base64s: string[]) => {
    setShowCamera(false);
    setOcrProcessing(true);
    setLastOcrResult(null);

    try {
      const result = await extractMedicineDetails(base64s);
      setLastOcrResult(result);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('OCR Error', 'Failed to process the image. Please try again.');
    } finally {
      setOcrProcessing(false);
    }
  }, []);

  // ── Handle acceptance of OCR data from the review modal
  const handleOcrAccept = useCallback((data: FinalOcrData, inventoryId: string, batchId: string) => {
    if (!activeTab) return;

    const cleanMrp = String(data.mrp).replace(/[^\d.]/g, '');
    const mrpNum = parseFloat(cleanMrp) || 0;

    const batchRow: BatchRecordRow = {
      id: batchId,
      item_id: inventoryId,
      batch_number: data.batchNumber,
      expiry_date: data.expiryDate,
      mrp: cleanMrp || '0',
      purchase_rate: String(mrpNum * 0.7),
      current_stock: 0,
    };

    const cartItem: CartItem = {
      batch: batchRow,
      itemName: data.medicineName,
      baseUnitSize: 10,
      quantity: data.qty,
      quantityType: 'FULL_STRIP',
      priceCharged: computePrice(cleanMrp, 10, data.qty, 'FULL_STRIP'),
    };

    addItemToTab(activeTab.id, cartItem);
    setLastOcrResult(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    refreshInv();
  }, [activeTab, addItemToTab, refreshInv]);

  // ── Current tab's total
  const currentTotal = activeTab ? getTabTotal(activeTab.id) : '0.00';

  // ── Camera modal
  if (showCamera) {
    return (
      <CameraScanner
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
        modal={isPhone}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Tab Bar */}
      <BillTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={switchTab}
        onCloseTab={closeTab}
        onCreateTab={createTab}
        getTabTotal={getTabTotal}
      />

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
            {/* Receipt */}
            {activeTab && (
              <BillReceipt
                billNumber={activeTab.billNumber}
                createdAt={activeTab.createdAt}
                cart={activeTab.cart}
                total={currentTotal}
                onRemoveItem={(index) => removeItemFromTab(activeTab.id, index)}
              />
            )}

            {/* OCR Processing overlay */}
            {ocrProcessing && (
              <View style={styles.ocrProcessingBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.ocrProcessingText}>
                  Analyzing medicine strip with AI...
                </Text>
              </View>
            )}

            {/* Search & Add Section */}
            <View style={styles.addSection}>
              <SearchInput value={query} onChangeText={setQuery} placeholder="Search medicine..." />

              {query.length >= 2 && !selectedItem && (
                <View style={styles.dropdown}>
                  {invLoading ? (
                    <Text style={styles.hint}>Loading inventory...</Text>
                  ) : searchResults.length === 0 ? (
                    <Text style={styles.hint}>No matches found</Text>
                  ) : (
                    searchResults.map((item) => (
                      <ListRow
                        key={item.id}
                        title={item.item_name}
                        subtitle={item.composition ?? undefined}
                        rightLabel={`${item.total_stock} strips`}
                        rightSublabel={`₹${item.batches[0]?.mrp ?? '—'}`}
                        dimmed={item.total_stock === 0}
                        onPress={() => handleSelectItem(item)}
                      />
                    ))
                  )}
                </View>
              )}

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

                  <View style={styles.qtyRow}>
                    <NumericInput
                      value={qty}
                      onChange={setQty}
                      min={1}
                      max={
                        qtyType === 'FULL STRIP'
                          ? selectedBatch.current_stock
                          : selectedBatch.current_stock * selectedItem.base_unit_size
                      }
                      label="Quantity"
                    />
                    <View style={styles.toggleWrap}>
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
                    label="Add to Bill"
                    onPress={handleAdd}
                    disabled={!selectedBatch || qty < 1}
                    style={styles.addBtn}
                  />
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          /* Tablet: side-by-side layout */
          <View style={styles.tabletContainer}>
            {/* Left: Receipt */}
            <View style={styles.leftCol}>
              {activeTab && (
                <BillReceipt
                  billNumber={activeTab.billNumber}
                  createdAt={activeTab.createdAt}
                  cart={activeTab.cart}
                  total={currentTotal}
                  onRemoveItem={(index) => removeItemFromTab(activeTab.id, index)}
                />
              )}
            </View>

            {/* Right: Search & Add */}
            <View style={styles.rightCol}>
              {ocrProcessing && (
                <View style={styles.ocrProcessingBox}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.ocrProcessingText}>
                    Analyzing medicine strip with AI...
                  </Text>
                </View>
              )}

              <SearchInput value={query} onChangeText={setQuery} placeholder="Search medicine..." />

              {query.length >= 2 && !selectedItem && (
                <View style={styles.dropdown}>
                  {invLoading ? (
                    <Text style={styles.hint}>Loading inventory...</Text>
                  ) : searchResults.length === 0 ? (
                    <Text style={styles.hint}>No matches found</Text>
                  ) : (
                    <ScrollView style={{ maxHeight: 320 }}>
                      {searchResults.map((item) => (
                        <ListRow
                          key={item.id}
                          title={item.item_name}
                          subtitle={item.composition ?? undefined}
                          rightLabel={`${item.total_stock} strips`}
                          rightSublabel={`₹${item.batches[0]?.mrp ?? '—'}`}
                          dimmed={item.total_stock === 0}
                          onPress={() => handleSelectItem(item)}
                        />
                      ))}
                    </ScrollView>
                  )}
                </View>
              )}

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

                  <View style={styles.qtyRow}>
                    <NumericInput
                      value={qty}
                      onChange={setQty}
                      min={1}
                      max={
                        qtyType === 'FULL STRIP'
                          ? selectedBatch.current_stock
                          : selectedBatch.current_stock * selectedItem.base_unit_size
                      }
                      label="Quantity"
                    />
                    <View style={styles.toggleWrap}>
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
                    label="Add to Bill"
                    onPress={handleAdd}
                    disabled={!selectedBatch || qty < 1}
                    style={styles.addBtn}
                  />
                </View>
              )}
            </View>
          </View>
        )}

        {/* Sticky Bottom Action Bar */}
        <View style={styles.actionBar}>
          <PrimaryButton
            label={ocrProcessing ? '🔍 Analyzing...' : '📷 Scan Medicine'}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowCamera(true);
            }}
            variant="ghost"
            style={styles.actionBtn}
            disabled={ocrProcessing}
          />
          <PrimaryButton
            label="💰 Checkout"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowCheckout(true);
            }}
            style={styles.actionBtn}
            disabled={!activeTab || activeTab.cart.length === 0}
          />
        </View>
      </KeyboardAvoidingView>

      {/* OCR Review Modal */}
      <OcrReviewModal
        visible={!!lastOcrResult}
        ocrResult={lastOcrResult}
        onAccept={handleOcrAccept}
        onCancel={() => setLastOcrResult(null)}
      />

      {/* Checkout Sheet */}
      {activeTab && (
        <CheckoutSheet
          visible={showCheckout}
          billNumber={activeTab.billNumber}
          date={activeTab.createdAt}
          cart={activeTab.cart}
          total={currentTotal}
          customerName={activeTab.customerName}
          customerPhone={activeTab.customerPhone}
          onUpdateCustomerInfo={(name, phone) =>
            updateCustomerInfo(activeTab.id, name, phone)
          }
          onCompleteSale={handleCompleteSale}
          onClose={() => setShowCheckout(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.bg },

  // Tablet layout
  tabletContainer: { flex: 1, flexDirection: 'row', padding: SPACING.lg },
  leftCol: { flex: 1, marginRight: SPACING.lg },
  rightCol: { width: 380, paddingLeft: SPACING.lg },

  // Phone layout
  phoneContainer: { padding: SPACING.lg, paddingBottom: 120 },

  // Search & add
  addSection: { marginTop: SPACING.lg },

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

  dropdown: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 320,
    marginTop: SPACING.sm,
  },
  hint: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    padding: SPACING.lg,
    textAlign: 'center',
  },
  selectionBlock: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectedName: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
  },
  batchInfo: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    marginTop: SPACING.xs,
  },
  batchPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  batchBtn: { paddingHorizontal: SPACING.md, minHeight: 44 },

  qtyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: SPACING.lg,
    gap: SPACING.xl,
  },
  toggleWrap: { flex: 1 },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  priceLabel: {
    fontSize: FONT.large,
    color: COLORS.textDim,
    marginRight: SPACING.md,
  },
  priceValue: {
    fontSize: FONT.header,
    fontWeight: '800',
    color: COLORS.primary,
  },
  addBtn: { marginTop: SPACING.lg },

  // Sticky bottom action bar
  actionBar: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    paddingBottom: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionBtn: { flex: 1 },
});
