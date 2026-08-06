/**
 * billShareService — Handles bill distribution via Print, WhatsApp, and Email.
 *
 * Formats the completed bill into appropriate output formats and
 * delegates to native APIs for each sharing channel.
 */

import * as Print from 'expo-print';
import * as Linking from 'expo-linking';
import * as MailComposer from 'expo-mail-composer';
import type { CartItem } from '../hooks/useSaleCart';

// ─── Types ──────────────────────────────────────────────────────────

interface BillData {
  billNumber: string;
  date: Date;
  cart: CartItem[];
  total: string;
  customerName?: string;
  customerPhone?: string;
}

// ─── Formatters ─────────────────────────────────────────────────────

/** Format bill as plain text (for WhatsApp) */
function formatBillText(bill: BillData): string {
  const dateStr = bill.date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = bill.date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  let text = `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `  💊 *RX LEDGER*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Bill: ${bill.billNumber}\n`;
  text += `Date: ${dateStr} ${timeStr}\n`;
  if (bill.customerName) {
    text += `Customer: ${bill.customerName}\n`;
  }
  text += `────────────────────\n`;

  bill.cart.forEach((item, i) => {
    const qtyLabel =
      item.quantityType === 'FULL_STRIP'
        ? `${item.quantity} strip${item.quantity > 1 ? 's' : ''}`
        : `${item.quantity} tab${item.quantity > 1 ? 's' : ''}`;
    text += `${i + 1}. ${item.itemName}\n`;
    text += `   ${qtyLabel} → ₹${item.priceCharged}\n`;
  });

  text += `────────────────────\n`;
  text += `*TOTAL: ₹${bill.total}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Thank you for your purchase!`;

  return text;
}

/** Format bill as HTML (for Print and Email) */
function formatBillHtml(bill: BillData): string {
  const dateStr = bill.date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = bill.date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const rows = bill.cart
    .map(
      (item, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <strong>${item.itemName}</strong><br/>
          <span style="color:#888;font-size:12px;">Batch: ${item.batch.batch_number}</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">
          ${item.quantity} ${item.quantityType === 'FULL_STRIP' ? 'strip' : 'tab'}${item.quantity > 1 ? 's' : ''}
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;">
          ₹${item.priceCharged}
        </td>
      </tr>`
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <style>
        body { font-family: -apple-system, Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .receipt { max-width: 380px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #34D399; padding-bottom: 12px; margin-bottom: 12px; }
        .logo { font-size: 24px; font-weight: 800; letter-spacing: 3px; color: #1a1a1a; }
        .logo-icon { font-size: 20px; }
        .bill-info { display: flex; justify-content: space-between; font-size: 13px; color: #666; margin-top: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        th { padding: 8px; text-align: left; border-bottom: 2px solid #ddd; font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 1px; }
        .total-row { border-top: 2px solid #333; }
        .total-row td { padding: 12px 8px; font-size: 18px; font-weight: 800; }
        .total-amount { color: #34D399; }
        .footer { text-align: center; margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ccc; font-size: 12px; color: #999; }
      </style>
    </head>
    <body>
      <div class="receipt">
        <div class="header">
          <div class="logo"><span class="logo-icon">💊</span> RX LEDGER</div>
          <div class="bill-info">
            <span>${bill.billNumber}</span>
            <span>${dateStr} · ${timeStr}</span>
          </div>
          ${bill.customerName ? `<div style="font-size:14px;margin-top:6px;">Customer: <strong>${bill.customerName}</strong></div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td colspan="3" style="text-align:right;">TOTAL</td>
              <td style="text-align:right;" class="total-amount">₹${bill.total}</td>
            </tr>
          </tbody>
        </table>
        <div class="footer">Thank you for your purchase! 🙏</div>
      </div>
    </body>
    </html>
  `;
}

// ─── Public API ─────────────────────────────────────────────────────

/** Print the bill using the native print dialog */
export async function printBill(bill: BillData): Promise<void> {
  const html = formatBillHtml(bill);
  await Print.printAsync({ html });
}

/** Send bill to customer via WhatsApp */
export async function sendWhatsApp(bill: BillData): Promise<boolean> {
  const text = formatBillText(bill);
  const encoded = encodeURIComponent(text);
  const phone = bill.customerPhone?.replace(/[^0-9]/g, '') ?? '';

  // If phone is provided, use wa.me deep link
  const url = phone
    ? `https://wa.me/${phone.startsWith('91') ? phone : `91${phone}`}?text=${encoded}`
    : `whatsapp://send?text=${encoded}`;

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return true;
  }
  return false;
}

/** Send bill to customer via Email */
export async function sendEmail(bill: BillData): Promise<boolean> {
  const isAvailable = await MailComposer.isAvailableAsync();
  if (!isAvailable) return false;

  const text = formatBillText(bill);

  await MailComposer.composeAsync({
    subject: `RxLedger Bill ${bill.billNumber}`,
    body: text,
    isHtml: false,
  });

  return true;
}
