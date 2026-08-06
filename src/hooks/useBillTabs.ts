/**
 * useBillTabs — Multi-tab billing state management for concurrent customer sales.
 *
 * Each tab represents an independent customer bill with its own cart,
 * customer info, and bill metadata. Tabs are stored in volatile memory
 * for maximum speed (cleared on app restart).
 */

import { useState, useCallback, useRef } from 'react';
import type { CartItem } from './useSaleCart';

// ─── Types ──────────────────────────────────────────────────────────

export interface BillTab {
  /** Unique tab identifier */
  id: string;
  /** Sequential bill number for display (e.g., "BILL-2026-0001") */
  billNumber: string;
  /** Display label for the tab (e.g., "Customer #1") */
  label: string;
  /** Cart items for this bill */
  cart: CartItem[];
  /** Optional customer name */
  customerName: string;
  /** Optional customer phone (for WhatsApp/Email) */
  customerPhone: string;
  /** Timestamp when the tab was created */
  createdAt: Date;
}

export interface UseBillTabsReturn {
  /** All open bill tabs */
  tabs: BillTab[];
  /** The currently active tab ID */
  activeTabId: string;
  /** The currently active tab object (convenience) */
  activeTab: BillTab | null;
  /** Create a new empty bill tab and switch to it */
  createTab: () => void;
  /** Close a tab by ID. If it's the active tab, switches to the next available. */
  closeTab: (id: string) => void;
  /** Switch the active tab */
  switchTab: (id: string) => void;
  /** Update the cart for a specific tab */
  updateCart: (tabId: string, cart: CartItem[]) => void;
  /** Add a single item to a tab's cart */
  addItemToTab: (tabId: string, item: CartItem) => void;
  /** Remove an item from a tab's cart by index */
  removeItemFromTab: (tabId: string, index: number) => void;
  /** Update customer info for a tab */
  updateCustomerInfo: (tabId: string, name: string, phone: string) => void;
  /** Compute total for a tab */
  getTabTotal: (tabId: string) => string;
  /** Clear a tab's cart (after successful sale) */
  clearTabCart: (tabId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

let billCounter = 0;

function generateBillNumber(): string {
  billCounter += 1;
  const now = new Date();
  const year = now.getFullYear();
  const padded = String(billCounter).padStart(4, '0');
  return `BILL-${year}-${padded}`;
}

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function computeTotal(cart: CartItem[]): string {
  return cart
    .reduce((sum, item) => sum + (parseFloat(item.priceCharged) || 0), 0)
    .toFixed(2);
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useBillTabs(): UseBillTabsReturn {
  const tabCountRef = useRef(0);

  const createNewTab = useCallback((): BillTab => {
    tabCountRef.current += 1;
    return {
      id: generateTabId(),
      billNumber: generateBillNumber(),
      label: `Customer #${tabCountRef.current}`,
      cart: [],
      customerName: '',
      customerPhone: '',
      createdAt: new Date(),
    };
  }, []);

  // Initialize with one tab
  const [tabs, setTabs] = useState<BillTab[]>(() => {
    const first = createNewTab();
    return [first];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? '');

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const createTab = useCallback(() => {
    const newTab = createNewTab();
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [createNewTab]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) {
        // Don't close the last tab — just clear it instead
        return prev.map((t) =>
          t.id === id ? { ...t, cart: [], customerName: '', customerPhone: '' } : t
        );
      }
      const filtered = prev.filter((t) => t.id !== id);
      // If closing the active tab, switch to the last remaining
      setActiveTabId((currentActive) => {
        if (currentActive === id) {
          return filtered[filtered.length - 1]?.id ?? '';
        }
        return currentActive;
      });
      return filtered;
    });
  }, []);

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const updateCart = useCallback((tabId: string, cart: CartItem[]) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, cart } : t))
    );
  }, []);

  const addItemToTab = useCallback((tabId: string, item: CartItem) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, cart: [...t.cart, item] } : t
      )
    );
  }, []);

  const removeItemFromTab = useCallback((tabId: string, index: number) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, cart: t.cart.filter((_, i) => i !== index) }
          : t
      )
    );
  }, []);

  const updateCustomerInfo = useCallback(
    (tabId: string, name: string, phone: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, customerName: name, customerPhone: phone } : t
        )
      );
    },
    []
  );

  const getTabTotal = useCallback(
    (tabId: string): string => {
      const tab = tabs.find((t) => t.id === tabId);
      return tab ? computeTotal(tab.cart) : '0.00';
    },
    [tabs]
  );

  const clearTabCart = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, cart: [] } : t))
    );
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    updateCart,
    addItemToTab,
    removeItemFromTab,
    updateCustomerInfo,
    getTabTotal,
    clearTabCart,
  };
}
