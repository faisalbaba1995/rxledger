import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS } from '../constants/theme';
import { PrimaryButton } from './PrimaryButton';
import type { OcrResult } from '../lib/ocrService';
import { supabase } from '../lib/supabase';

export interface FinalOcrData {
  medicineName: string;
  batchNumber: string;
  expiryDate: string;
  mrp: string;
  composition: string;
  qty: number;
}

interface OcrReviewModalProps {
  visible: boolean;
  ocrResult: OcrResult | null;
  onAccept: (data: FinalOcrData, inventoryId: string, batchId: string) => void;
  onCancel: () => void;
}

export function OcrReviewModal({ visible, ocrResult, onAccept, onCancel }: OcrReviewModalProps) {
  // State for editable fields
  const [name, setName] = useState('');
  const [batch, setBatch] = useState('');
  const [expiry, setExpiry] = useState('');
  const [mrp, setMrp] = useState('');
  const [composition, setComposition] = useState('');
  const [qty, setQty] = useState('1');
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when ocrResult changes
  useEffect(() => {
    if (visible && ocrResult) {
      setName(ocrResult.medicineName ?? '');
      setBatch(ocrResult.batchNumber ?? '');
      setExpiry(ocrResult.expiryDate ?? '');
      setMrp(ocrResult.mrp ?? '');
      setComposition(ocrResult.composition ?? '');
      setQty('1');
      setError(null);
    }
  }, [visible, ocrResult]);

  const handleAccept = async () => {
    if (!name.trim() || !batch.trim() || !mrp.trim()) {
      setError('Name, Batch, and MRP are required.');
      return;
    }

    setSaving(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // 1. Check if inventory item exists
      let inventoryId: string;
      const { data: existingItems } = await supabase
        .from('inventory_items')
        .select('id')
        .ilike('item_name', name.trim())
        .limit(1);

      if (existingItems && existingItems.length > 0) {
        inventoryId = existingItems[0].id;
      } else {
        // Create new inventory item
        const { data: newItem, error: invError } = await supabase
          .from('inventory_items')
          .insert({
            item_name: name.trim(),
            composition: composition.trim() || null,
            base_unit_size: 10, // Default to 10 for new items
          })
          .select('id')
          .single();

        if (invError) throw new Error('Failed to create inventory item: ' + invError.message);
        inventoryId = newItem.id;
      }

      // 2. Check if batch exists
      let batchId: string;
      const { data: existingBatches } = await supabase
        .from('batch_records')
        .select('id')
        .eq('item_id', inventoryId)
        .eq('batch_number', batch.trim())
        .limit(1);

      if (existingBatches && existingBatches.length > 0) {
        batchId = existingBatches[0].id;
      } else {
        // Create new batch record
        const { data: newBatch, error: batchError } = await supabase
          .from('batch_records')
          .insert({
            item_id: inventoryId,
            batch_number: batch.trim(),
            expiry_date: expiry.trim() || '2099-12-31', // Fallback
            mrp: parseFloat(mrp) || 0,
            purchase_rate: (parseFloat(mrp) || 0) * 0.7, // Estimate PTR
            current_stock: 0, // Will be sold immediately
          })
          .select('id')
          .single();

        if (batchError) throw new Error('Failed to create batch: ' + batchError.message);
        batchId = newBatch.id;
      }

      const finalData: FinalOcrData = {
        medicineName: name.trim(),
        batchNumber: batch.trim(),
        expiryDate: expiry.trim(),
        mrp: mrp.trim(),
        composition: composition.trim(),
        qty: parseInt(qty, 10) || 1,
      };

      onAccept(finalData, inventoryId, batchId);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  if (!ocrResult) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Review OCR Data</Text>
            {ocrResult.confident ? (
              <Text style={styles.confidenceHigh}>✅ High Confidence</Text>
            ) : (
              <Text style={styles.confidenceLow}>⚠️ Low Confidence - Please verify</Text>
            )}
          </View>

          <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Medicine Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Aderol-D3" placeholderTextColor={COLORS.textPlaceholder} />

            <Text style={styles.label}>Batch Number</Text>
            <TextInput style={styles.input} value={batch} onChangeText={setBatch} placeholder="e.g. US-24334F" placeholderTextColor={COLORS.textPlaceholder} />

            <View style={styles.row}>
              <View style={styles.halfCol}>
                <Text style={styles.label}>Expiry Date</Text>
                <TextInput style={styles.input} value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={COLORS.textPlaceholder} />
              </View>
              <View style={styles.halfCol}>
                <Text style={styles.label}>MRP (₹)</Text>
                <TextInput style={styles.input} value={mrp} onChangeText={setMrp} keyboardType="numeric" placeholder="0.00" placeholderTextColor={COLORS.textPlaceholder} />
              </View>
            </View>

            <Text style={styles.label}>Composition</Text>
            <TextInput 
              style={[styles.input, styles.multiline]} 
              value={composition} 
              onChangeText={setComposition} 
              multiline 
              placeholder="Active ingredients"
              placeholderTextColor={COLORS.textPlaceholder}
            />

            <Text style={styles.label}>Quantity to Add to Bill (Strips)</Text>
            <TextInput 
              style={styles.input} 
              value={qty} 
              onChangeText={setQty} 
              keyboardType="number-pad" 
            />

            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton 
              label="Cancel" 
              onPress={onCancel} 
              variant="ghost" 
              style={styles.cancelBtn} 
              disabled={saving}
            />
            <PrimaryButton 
              label={saving ? "Saving..." : "Accept & Add to Bill"} 
              onPress={handleAccept} 
              style={styles.acceptBtn} 
              disabled={saving}
            />
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONT.large,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  confidenceHigh: {
    color: COLORS.primary,
    marginTop: 4,
  },
  confidenceLow: {
    color: COLORS.warning,
    marginTop: 4,
  },
  form: {
    flex: 1,
    padding: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  halfCol: {
    flex: 1,
  },
  label: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    marginBottom: 4,
    marginTop: SPACING.md,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    padding: SPACING.md,
    color: COLORS.text,
    fontSize: FONT.medium,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  errorText: {
    color: COLORS.danger,
    marginTop: SPACING.md,
  },
  footer: {
    flexDirection: 'row',
    padding: SPACING.md,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    gap: SPACING.sm,
  },
  cancelBtn: {
    flex: 1,
  },
  acceptBtn: {
    flex: 2,
  },
});
