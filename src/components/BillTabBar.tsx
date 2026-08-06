/**
 * BillTabBar — Horizontal scrollable tab bar for multi-customer billing.
 *
 * Shows active bill tabs with a close button, an active indicator,
 * and a "+" button to create new tabs.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS } from '../constants/theme';
import type { BillTab } from '../hooks/useBillTabs';

interface BillTabBarProps {
  tabs: BillTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCreateTab: () => void;
  getTabTotal: (id: string) => string;
}

export function BillTabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onCreateTab,
  getTabTotal,
}: BillTabBarProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const total = getTabTotal(tab.id);
          const hasItems = tab.cart.length > 0;

          return (
            <Pressable
              key={tab.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSwitchTab(tab.id);
              }}
              style={[styles.tab, isActive && styles.tabActive]}
            >
              <View style={styles.tabContent}>
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                {hasItems && (
                  <Text style={[styles.tabTotal, isActive && styles.tabTotalActive]}>
                    ₹{total}
                  </Text>
                )}
              </View>

              {/* Close button */}
              {tabs.length > 1 && (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onCloseTab(tab.id);
                  }}
                  style={styles.closeBtn}
                  hitSlop={8}
                >
                  <Text style={styles.closeBtnText}>×</Text>
                </Pressable>
              )}

              {/* Active indicator line */}
              {isActive && <View style={styles.activeIndicator} />}
            </Pressable>
          );
        })}

        {/* Add new tab button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onCreateTab();
          }}
          style={styles.addBtn}
        >
          <Text style={styles.addBtnText}>＋</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    position: 'relative',
    minWidth: 140,
  },
  tabActive: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.primary,
  },
  tabContent: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  tabLabel: {
    fontSize: FONT.base,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  tabLabelActive: {
    color: COLORS.text,
    fontWeight: '700',
  },
  tabTotal: {
    fontSize: 14,
    color: COLORS.textDim,
    marginTop: 2,
  },
  tabTotalActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: COLORS.textDim,
    fontWeight: '700',
    lineHeight: 18,
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -1,
    left: SPACING.lg,
    right: SPACING.lg,
    height: 3,
    backgroundColor: COLORS.primary,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: 22,
    color: COLORS.primary,
    fontWeight: '700',
  },
});
