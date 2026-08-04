#!/usr/bin/env node
/**
 * parseMargExcel.ts — Marg ERP .xlsx → Supabase Ingestion Pipeline
 *
 * Reads the standard Marg export columns:
 *   Item Name | Batch Number | Expiry Date | MRP | Purchase Rate | Current Stock
 *
 * Produces two insertion-ready arrays:
 *   1. inventoryItems  → `inventory_items` table  (deduplicated by item_name)
 *   2. batchRecords    → `batch_records`  table  (one row per spreadsheet row)
 *
 * Usage:
 *   npx tsx scripts/parseMargExcel.ts ./path/to/marg-export.xlsx
 *   npx tsx scripts/parseMargExcel.ts ./path/to/marg-export.xlsx --out ./parsed.json
 *   npx tsx scripts/parseMargExcel.ts ./path/to/marg-export.xlsx --upload
 *
 * The --upload flag requires a .env file in ./scripts/ (or project root) with:
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Requirements:  exceljs (install: npm i exceljs)
 *                tsx      (install: npm i -D tsx)  — or ts-node
 */

import { Workbook, type CellValue, type Row } from 'exceljs';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  InventoryItemInsert,
  BatchRecordInsert,
} from '../src/types/database';

// Load .env from scripts/ directory first, then project root fallback
loadEnv({ path: path.resolve(__dirname, '.env') });
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

// ─── CLI argument parsing ───────────────────────────────────────────

function resolveArgs(): { inputPath: string; outputPath: string | null; upload: boolean } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  Marg Excel Parser — Pharmacy Vision Ledger

  USAGE
    npx tsx scripts/parseMargExcel.ts <input.xlsx> [--out <output.json>] [--upload]

  ARGUMENTS
    <input.xlsx>        Path to the Marg ERP export spreadsheet.
    --out <output.json> Optional. Write parsed data to a JSON file
                        instead of stdout.
    --upload            Upload parsed data directly to Supabase.
                        Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
                        in scripts/.env or project root .env

  EXAMPLES
    npx tsx scripts/parseMargExcel.ts ./data/marg-june.xlsx
    npx tsx scripts/parseMargExcel.ts ./data/marg-june.xlsx --out ./parsed.json
    npx tsx scripts/parseMargExcel.ts ./data/marg-june.xlsx --upload
`);
    process.exit(0);
  }

  const inputPath = path.resolve(args[0]);
  const outIdx = args.indexOf('--out');
  const outputPath =
    outIdx !== -1 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1])
      : null;
  const upload = args.includes('--upload');

  return { inputPath, outputPath, upload };
}

// ─── Cell value helpers ─────────────────────────────────────────────

/** Collapse any ExcelJS CellValue to a trimmed string (or empty). */
function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) {
    // RichText cell
    return String((value as { text: string }).text).trim();
  }
  return String(value).trim();
}

/** Parse a cell to a finite number, returning `fallback` on failure. */
function cellToNumber(value: CellValue, fallback: number): number {
  const raw = cellToString(value);
  if (raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a cell to an ISO date string (YYYY-MM-DD).
 *
 * Marg exports expiry dates in various formats:
 *   - Native Excel date serial  → ExcelJS resolves to JS Date
 *   - String "MM/YYYY", "MM-YYYY", or "DD/MM/YYYY"
 *
 * Returns `null` if the value is unparseable so callers can skip
 * the row rather than silently insert garbage.
 */
function cellToISODate(value: CellValue): string | null {
  if (value instanceof Date) {
    return toISODate(value);
  }
  const raw = cellToString(value);
  if (raw === '') return null;

  // ── Indian formats FIRST (before native Date parse which assumes US MM/DD) ──

  // Handle "DD/MM/YYYY" or "DD-MM-YYYY" (standard Indian format)
  const longMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (longMatch) {
    const day = parseInt(longMatch[1], 10);
    const month = parseInt(longMatch[2], 10);
    const year = parseInt(longMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return toISODate(d);
      }
    }
  }

  // Handle "MM/YYYY" or "MM-YYYY" (common Marg shorthand → last day of month)
  const shortMatch = raw.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (shortMatch) {
    const month = parseInt(shortMatch[1], 10);
    const year = parseInt(shortMatch[2], 10);
    if (month >= 1 && month <= 12) {
      // Last day of the expiry month
      const lastDay = new Date(year, month, 0);
      return toISODate(lastDay);
    }
  }

  // Fallback: native Date parse (handles ISO-8601 "2025-02-01" style strings)
  const directParse = new Date(raw);
  if (!isNaN(directParse.getTime())) {
    return toISODate(directParse);
  }

  return null;
}

function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Column header detection ────────────────────────────────────────

/**
 * Expected Marg export columns → normalised keys.
 * Matching is case-insensitive and trims whitespace.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  item_name: ['item name', 'item_name', 'itemname', 'product name', 'medicine', 'drug name'],
  batch_number: ['batch number', 'batch_number', 'batchno', 'batch no', 'batch', 'batch no.'],
  expiry_date: ['expiry date', 'expiry_date', 'exp date', 'exp', 'expiry', 'exp.date', 'exp. date'],
  mrp: ['mrp', 'maximum retail price', 'retail price', 'm.r.p', 'm.r.p.'],
  purchase_rate: ['purchase rate', 'purchase_rate', 'cost', 'cost price', 'purchase price', 'pur rate', 'pur. rate'],
  current_stock: ['current stock', 'current_stock', 'stock', 'qty', 'quantity', 'closing stock', 'closing qty'],
};

type ColumnKey = keyof typeof COLUMN_ALIASES;

function detectColumnMap(headerRow: Row): Map<ColumnKey, number> {
  const map = new Map<ColumnKey, number>();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = cellToString(cell.value).toLowerCase();

    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(header)) {
        map.set(key as ColumnKey, colNumber);
        break;
      }
    }
  });

  return map;
}

// ─── Core parsing logic ─────────────────────────────────────────────

interface ParseResult {
  inventoryItems: InventoryItemInsert[];
  batchRecords: (Omit<BatchRecordInsert, 'item_id'> & {
    /** Temporary reference resolved at insert time via
     *  `item_name` → returned `id` lookup.  */
    _item_name_ref: string;
  })[];
  skippedRows: { rowNumber: number; reason: string }[];
  stats: {
    totalRows: number;
    parsedRows: number;
    skippedRows: number;
    uniqueItems: number;
  };
}

async function parseWorkbook(filePath: string): Promise<ParseResult> {
  const workbook = new Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Workbook contains no worksheets.');
  }

  // Detect header row (first row)
  const headerRow = sheet.getRow(1);
  const colMap = detectColumnMap(headerRow);

  // Validate mandatory columns are present
  const required: ColumnKey[] = ['item_name', 'batch_number', 'mrp', 'purchase_rate'];
  const missing = required.filter((k) => !colMap.has(k));
  if (missing.length > 0) {
    throw new Error(
      `Missing required columns: ${missing.join(', ')}.\n` +
      `Detected columns: ${[...colMap.entries()].map(([k, v]) => `${k}→col${v}`).join(', ')}`
    );
  }

  // Deduplicated inventory map (item_name → insert object)
  const itemMap = new Map<string, InventoryItemInsert>();
  const batchRecords: ParseResult['batchRecords'] = [];
  const skippedRows: ParseResult['skippedRows'] = [];
  let totalDataRows = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header
    if (rowNumber === 1) return;
    totalDataRows++;

    const getValue = (key: ColumnKey): CellValue => {
      const col = colMap.get(key);
      return col ? row.getCell(col).value : null;
    };

    // ── item_name (required, skip row if blank)
    const itemName = cellToString(getValue('item_name'));
    if (!itemName) {
      skippedRows.push({ rowNumber, reason: 'Empty item_name' });
      return;
    }

    // ── batch_number (required)
    const batchNumber = cellToString(getValue('batch_number'));
    if (!batchNumber) {
      skippedRows.push({ rowNumber, reason: `Missing batch_number for "${itemName}"` });
      return;
    }

    // ── mrp & purchase_rate — default to 0.00 when absent
    const mrp = cellToNumber(getValue('mrp'), 0).toFixed(2);
    const purchaseRate = cellToNumber(getValue('purchase_rate'), 0).toFixed(2);

    // ── expiry_date — default to far-future sentinel if missing
    const expiryRaw = cellToISODate(getValue('expiry_date'));
    const expiryDate = expiryRaw ?? '2099-12-31';

    if (!expiryRaw) {
      console.warn(
        `⚠  Row ${rowNumber}: Could not parse expiry date for "${itemName}" batch "${batchNumber}". Defaulting to 2099-12-31.`
      );
    }

    // ── current_stock — default to 0
    const currentStock = Math.max(0, Math.round(cellToNumber(getValue('current_stock'), 0)));

    // ── Dedup inventory item
    const normalisedName = itemName.toUpperCase();
    if (!itemMap.has(normalisedName)) {
      itemMap.set(normalisedName, {
        item_name: itemName,
        composition: null,         // Marg export does not include composition
        base_unit_size: 10,        // Spec default
      });
    }

    // ── Accumulate batch record
    batchRecords.push({
      _item_name_ref: itemName,
      batch_number: batchNumber,
      mrp,
      purchase_rate: purchaseRate,
      expiry_date: expiryDate,
      current_stock: currentStock,
    });
  });

  const inventoryItems = [...itemMap.values()];

  return {
    inventoryItems,
    batchRecords,
    skippedRows,
    stats: {
      totalRows: totalDataRows,
      parsedRows: batchRecords.length,
      skippedRows: skippedRows.length,
      uniqueItems: inventoryItems.length,
    },
  };
}

// ─── Supabase Upload ────────────────────────────────────────────────

async function uploadToSupabase(result: ParseResult): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '✗ Missing Supabase credentials for --upload.\n' +
      '  Create scripts/.env with:\n' +
      '    SUPABASE_URL=https://xxx.supabase.co\n' +
      '    SUPABASE_SERVICE_ROLE_KEY=eyJ...\n'
    );
    process.exit(1);
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  // ── Step 1: Upsert inventory_items ────────────────────────────────
  console.log('\n⬆  Uploading inventory items...');

  const BATCH_SIZE = 100;
  let itemsUpserted = 0;

  for (let i = 0; i < result.inventoryItems.length; i += BATCH_SIZE) {
    const batch = result.inventoryItems.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('inventory_items')
      .upsert(
        batch.map((item) => ({
          item_name: item.item_name,
          composition: item.composition,
          base_unit_size: item.base_unit_size,
        })),
        { onConflict: 'item_name' }
      );

    if (error) {
      console.error(`✗ Failed to upsert inventory items (batch ${i}):`, error.message);
      process.exit(1);
    }

    itemsUpserted += batch.length;
    process.stdout.write(`\r   ${itemsUpserted}/${result.inventoryItems.length} items`);
  }
  console.log(' ✓');

  // ── Step 2: Fetch item IDs for FK resolution ──────────────────────
  console.log('   Fetching item IDs for FK resolution...');

  const { data: allItems, error: fetchErr } = await supabase
    .from('inventory_items')
    .select('id, item_name');

  if (fetchErr || !allItems) {
    console.error('✗ Failed to fetch inventory items:', fetchErr?.message);
    process.exit(1);
  }

  // Build name → id lookup (case-insensitive)
  const nameToId = new Map<string, string>();
  for (const item of allItems as { id: string; item_name: string }[]) {
    nameToId.set(item.item_name.toUpperCase(), item.id);
  }

  // ── Step 3: Upsert batch_records ──────────────────────────────────
  console.log('⬆  Uploading batch records...');

  let batchesUpserted = 0;
  let batchesSkipped = 0;

  for (let i = 0; i < result.batchRecords.length; i += BATCH_SIZE) {
    const chunk = result.batchRecords.slice(i, i + BATCH_SIZE);

    // Resolve item_id from _item_name_ref
    const resolved = chunk
      .map((br) => {
        const itemId = nameToId.get(br._item_name_ref.toUpperCase());
        if (!itemId) {
          batchesSkipped++;
          return null;
        }
        return {
          item_id: itemId,
          batch_number: br.batch_number,
          mrp: br.mrp,
          purchase_rate: br.purchase_rate,
          expiry_date: br.expiry_date,
          current_stock: br.current_stock,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (resolved.length === 0) continue;

    const { error } = await supabase
      .from('batch_records')
      .upsert(resolved, {
        onConflict: 'item_id,batch_number',
      });

    if (error) {
      console.error(`✗ Failed to upsert batch records (chunk ${i}):`, error.message);
      process.exit(1);
    }

    batchesUpserted += resolved.length;
    process.stdout.write(`\r   ${batchesUpserted}/${result.batchRecords.length} batches`);
  }
  console.log(' ✓');

  if (batchesSkipped > 0) {
    console.warn(`⚠  ${batchesSkipped} batch records skipped (no matching item ID)`);
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ✓ Upload complete!`);
  console.log(`    ${itemsUpserted} items + ${batchesUpserted} batches → Supabase`);
  console.log('════════════════════════════════════════\n');
}

// ─── Entrypoint ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { inputPath, outputPath, upload } = resolveArgs();

  if (!fs.existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`\n📂  Reading: ${inputPath}\n`);

  const result = await parseWorkbook(inputPath);

  // ── Report
  console.log('┌──────────────────────────────────────┐');
  console.log('│     Marg Excel Parse — Summary       │');
  console.log('├──────────────────────────────────────┤');
  console.log(`│  Total data rows:   ${String(result.stats.totalRows).padStart(8)}       │`);
  console.log(`│  Parsed rows:       ${String(result.stats.parsedRows).padStart(8)}       │`);
  console.log(`│  Skipped rows:      ${String(result.stats.skippedRows).padStart(8)}       │`);
  console.log(`│  Unique items:      ${String(result.stats.uniqueItems).padStart(8)}       │`);
  console.log('└──────────────────────────────────────┘');

  if (result.skippedRows.length > 0) {
    console.log('\n⚠  Skipped rows:');
    for (const skip of result.skippedRows) {
      console.log(`   Row ${skip.rowNumber}: ${skip.reason}`);
    }
  }

  // ── Upload to Supabase if --upload flag is present
  if (upload) {
    await uploadToSupabase(result);
    return;
  }

  // ── Otherwise output JSON
  const output = JSON.stringify(
    {
      inventoryItems: result.inventoryItems,
      batchRecords: result.batchRecords,
      stats: result.stats,
    },
    null,
    2
  );

  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf-8');
    console.log(`\n✓  Output written to: ${outputPath}`);
  } else {
    console.log('\n─── Parsed Output (JSON) ───\n');
    console.log(output);
  }
}

main().catch((err: unknown) => {
  console.error('✗ Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
