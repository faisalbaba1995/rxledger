/**
 * CheckoutSheet — Bottom sheet modal for completing a sale.
 *
 * Shows bill summary, customer info fields, and action buttons
 * for Print, WhatsApp, Email, and Complete Sale.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../constants/theme';
import { PrimaryButton } from './PrimaryButton';
import { printBill, sendWhatsApp, sendEmail } from '../lib/billShareService';
import type { CartItem } from '../hooks/useSaleCart';

interface CheckoutSheetProps {
  visible: boolean;
  billNumber: string;
  date: Date;
  cart: CartItem[];
  total: string;
  customerName: string;
  customerPhone: string;
  onUpdateCustomerInfo: (name: string, phone: string) => void;
  onCompleteSale: () => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

export function CheckoutSheet({
  visible,
  billNumber,
  date,
  cart,
  total,
  customerName,
  customerPhone,
  onUpdateCustomerInfo,
  onCompleteSale,
  onClose,
}: CheckoutSheetProps) {
  const [completing, setCompleting] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);

  const billData = {
    billNumber,
    date,
    cart,
    total,
    customerName,
    customerPhone,
  };

  const handlePrint = useCallback(async () => {
    setSharing('print');
    try {
      await printBill(billData);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Print Error', 'Could not open print dialog.');
    } finally {
      setSharing(null);
    }
  }, [billData]);

  const handleWhatsApp = useCallback(async () => {
    setSharing('whatsapp');
    try {
      const sent = await sendWhatsApp(billData);
      if (!sent) {
        Alert.alert('WhatsApp', 'WhatsApp is not installed on this device.');
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open WhatsApp.');
    } finally {
      setSharing(null);
    }
  }, [billData]);

  const handleEmail = useCallback(async () => {
    setSharing('email');
    try {
      const sent = await sendEmail(billData);
      if (!sent) {
        Alert.alert('Email', 'Email is not available on this device.');
      }
    } catch (err) {
      Alert.alert('Error', 'Could not open email composer.');
    } finally {
      setSharing(null);
    }
  }, [billData]);

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    try {
      const result = await onCompleteSale();
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onClose();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Error', result.error ?? 'Failed to save sale.');
      }
    } finally {
      setCompleting(false);
    }
  }, [onCompleteSale, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Handle bar */}
            <View style={styles.handleBar}>
              <View style={styles.handle} />
            </View>

            {/* Bill Summary */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View>
                  <Text style={styles.summaryBillNo}>{billNumber}</Text>
                  <Text style={styles.summaryTotal}>₹{total}</Text>
                </View>
                <View style={styles.summaryRight}>
                  <View style={styles.itemCountBadge}>
                    <Text style={styles.itemCountText}>
                      {cart.length} item{cart.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Customer Info */}
            <Text style={styles.sectionTitle}>Customer Info (Optional)</Text>
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Customer Name"
                placeholderTextColor={COLORS.textPlaceholder}
                value={customerName}
                onChangeText={(text) => onUpdateCustomerInfo(text, customerPhone)}
              />
              <TextInput
                style={styles.input}
                placeholder="Phone Number (for WhatsApp)"
                placeholderTextColor={COLORS.textPlaceholder}
                value={customerPhone}
                onChangeText={(text) => onUpdateCustomerInfo(customerName, text)}
                keyboardType="phone-pad"
              />
            </View>

            {/* Action Buttons Grid */}
            <Text style={styles.sectionTitle}>Share Bill</Text>
            <View style={styles.actionGrid}>
              <Pressable
                style={styles.actionBtn}
                onPress={handlePrint}
                disabled={!!sharing}
              >
                {sharing === 'print' ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.actionIcon}>🖨️</Text>
                )}
                <Text style={styles.actionLabel}>Print Bill</Text>
              </Pressable>

              <Pressable
                style={styles.actionBtn}
                onPress={handleWhatsApp}
                disabled={!!sharing}
              >
                {sharing === 'whatsapp' ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.actionIcon}>💬</Text>
                )}
                <Text style={styles.actionLabel}>WhatsApp</Text>
              </Pressable>

              <Pressable
                style={styles.actionBtn}
                onPress={handleEmail}
                disabled={!!sharing}
              >
                {sharing === 'email' ? (
                  <ActivityIndicator color={COLORS.text} />
                ) : (
                  <Text style={styles.actionIcon}>📧</Text>
                )}
                <Text style={styles.actionLabel}>Email</Text>
              </Pressable>
            </View>

            {/* Complete Sale Button */}
            <PrimaryButton
              label="✅ Complete & Save Bill"
              onPress={handleComplete}
              loading={completing}
              disabled={cart.length === 0}
              style={styles.completeBtn}
            />

            <Text style={styles.autoSaveHint}>
              All bills are automatically saved to your business records.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill as any,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg * 2,
    borderTopRightRadius: RADIUS.lg * 2,
    maxHeight: '85%',
  },
  scrollContent: {
    padding: SPACING.xl,
    paddingBottom: SPACING.xxl * 2,
  },
  handleBar: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },

  // Summary card
  summaryCard: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginBottom: SPACING.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryBillNo: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textDim,
    fontFamily: 'monospace',
    marginBottom: SPACING.xs,
  },
  summaryTotal: {
    fontSize: FONT.hero,
    fontWeight: '800',
    color: COLORS.primary,
  },
  summaryRight: {
    alignItems: 'flex-end',
  },
  itemCountBadge: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  itemCountText: {
    fontSize: FONT.base,
    fontWeight: '600',
    color: COLORS.textDim,
  },

  // Section title
  sectionTitle: {
    fontSize: FONT.base,
    fontWeight: '700',
    color: COLORS.textDim,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Input group
  inputGroup: {
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    fontSize: FONT.base,
    color: COLORS.text,
    minHeight: TOUCH_TARGET_MIN,
  },

  // Action grid
  actionGrid: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 90,
    gap: SPACING.sm,
  },
  actionIcon: {
    fontSize: 28,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },

  // Complete button
  completeBtn: {
    marginBottom: SPACING.md,
  },

  // Auto-save hint
  autoSaveHint: {
    fontSize: 13,
    color: COLORS.textPlaceholder,
    textAlign: 'center',
  },
});
