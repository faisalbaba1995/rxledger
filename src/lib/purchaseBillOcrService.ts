/**
 * purchaseBillOcrService — Gemini Vision OCR for distributor purchase bills.
 *
 * Sends a base64-encoded photo of a printed purchase bill (like "UPDATE PHARMA")
 * to Gemini Flash and extracts structured line items for stock intake.
 *
 * Tuned for Indian pharmaceutical distributor bills with columns like:
 * Sn, Product, HSN, Qty, Free, Batch No, Exp Date, MRP, Rate, Dis%, SGST%, CGST%, Amount
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface PurchaseBillItem {
  /** Medicine/product name */
  productName: string;
  /** Batch number */
  batchNumber: string;
  /** Quantity ordered */
  quantity: number;
  /** Free quantity (bonus) */
  freeQuantity: number;
  /** Total stock to add (quantity + free) */
  totalStock: number;
  /** Expiry date as string (e.g., "11/24", "2024-11-01") */
  expiryDate: string;
  /** MRP per strip/unit */
  mrp: string;
  /** Purchase rate (cost price) */
  purchaseRate: string;
}

export interface PurchaseBillResult {
  /** Supplier/distributor name */
  supplierName: string | null;
  /** Bill/invoice number */
  billNumber: string | null;
  /** Bill date */
  billDate: string | null;
  /** Extracted line items */
  items: PurchaseBillItem[];
  /** Raw text response for debugging */
  rawText: string;
  /** Whether extraction was confident */
  confident: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

const PURCHASE_BILL_PROMPT = `You are an expert OCR system for Indian pharmaceutical distributor purchase bills/invoices.

Analyze this photo of a printed purchase bill. Extract:

1. SUPPLIER INFO:
   - Supplier/Company Name (top-left header)
   - Bill/Invoice Number (often labeled "CNB", "Inv No", or similar)
   - Bill Date

2. LINE ITEMS (each row in the table):
   - Product Name (medicine name)
   - Batch Number (Batch No)
   - Quantity (Qty)
   - Free quantity (Free column, bonus items - default 0 if not present)
   - Expiry Date (Exp Date - format as MM/YY or MM/YYYY)
   - MRP (Maximum Retail Price)
   - Purchase Rate (Rate column - the cost price)

IMPORTANT RULES:
- "Qty" and "Free" should be extracted as numbers.
- If there is a "Free" column, set freeQuantity to that value. totalStock = quantity + freeQuantity.
- Expiry dates like "11/24" mean November 2024. Convert short years: "24" → "2024", "25" → "2025", etc.
- MRP and Rate should be extracted as decimal strings (e.g., "268.50", "193.69").
- Extract ALL line items, not just the first one.

RESPOND WITH ONLY VALID JSON in this exact format:
{
  "supplierName": "string or null",
  "billNumber": "string or null",
  "billDate": "string or null",
  "items": [
    {
      "productName": "string",
      "batchNumber": "string",
      "quantity": number,
      "freeQuantity": number,
      "totalStock": number,
      "expiryDate": "string (MM/YYYY format)",
      "mrp": "string",
      "purchaseRate": "string"
    }
  ]
}

If you cannot read the bill or it's not a purchase bill, return: { "supplierName": null, "billNumber": null, "billDate": null, "items": [] }`;

// ─── Helpers ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;

// ─── Service ────────────────────────────────────────────────────────

/**
 * Sends base64 images of a purchase bill to Gemini Vision and extracts line items.
 */
export async function extractPurchaseBillItems(
  base64Images: string[],
  mimeType: string = 'image/jpeg',
): Promise<PurchaseBillResult> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    return {
      supplierName: null,
      billNumber: null,
      billDate: null,
      items: [],
      rawText: 'ERROR: EXPO_PUBLIC_GEMINI_API_KEY is not set in .env',
      confident: false,
    };
  }

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: PURCHASE_BILL_PROMPT },
          ...base64Images.map((data) => ({
            inlineData: { mimeType, data },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  });

  try {
    let response: Response | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const delay = 3000 * Math.pow(2, attempt);
        console.warn(`Rate limited. Retrying in ${delay / 1000}s...`);
        await sleep(delay);
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'No response';
      return {
        supplierName: null,
        billNumber: null,
        billDate: null,
        items: [],
        rawText: `API Error ${response?.status ?? 'unknown'}: ${errorText.slice(0, 200)}`,
        confident: false,
      };
    }

    const data = await response.json();
    const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!rawText) {
      return {
        supplierName: null,
        billNumber: null,
        billDate: null,
        items: [],
        rawText: 'Empty response from Gemini',
        confident: false,
      };
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const items: PurchaseBillItem[] = (parsed.items ?? []).map((item: any) => ({
          productName: item.productName ?? '',
          batchNumber: item.batchNumber ?? '',
          quantity: Number(item.quantity) || 0,
          freeQuantity: Number(item.freeQuantity) || 0,
          totalStock: Number(item.totalStock) || (Number(item.quantity) || 0) + (Number(item.freeQuantity) || 0),
          expiryDate: item.expiryDate ?? '',
          mrp: String(item.mrp ?? '0'),
          purchaseRate: String(item.purchaseRate ?? '0'),
        }));

        return {
          supplierName: parsed.supplierName ?? null,
          billNumber: parsed.billNumber ?? null,
          billDate: parsed.billDate ?? null,
          items,
          rawText,
          confident: items.length > 0,
        };
      } catch {
        // JSON parse failed
      }
    }

    return {
      supplierName: null,
      billNumber: null,
      billDate: null,
      items: [],
      rawText,
      confident: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      supplierName: null,
      billNumber: null,
      billDate: null,
      items: [],
      rawText: `Network error: ${message}`,
      confident: false,
    };
  }
}
