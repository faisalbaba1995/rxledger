-- 1. Wipe all existing tables in public schema to remove untitled/old tables
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;

-- 2. Create tables
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name VARCHAR NOT NULL UNIQUE,
  composition TEXT,
  base_unit_size INT NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS batch_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  batch_number VARCHAR NOT NULL,
  mrp NUMERIC(10, 2) NOT NULL,
  purchase_rate NUMERIC(10, 2) NOT NULL,
  expiry_date DATE NOT NULL,
  current_stock INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_amount NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_items_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales_ledger(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES batch_records(id),
  quantity_type VARCHAR NOT NULL CHECK (quantity_type IN ('FULL_STRIP', 'LOOSE')),
  units_sold INT NOT NULL,
  price_charged NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_outlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category VARCHAR NOT NULL CHECK (category IN ('EXPENSE', 'RUNNER', 'SALARY', 'NEIGHBOR')),
  recipient VARCHAR,
  amount NUMERIC(10, 2) NOT NULL,
  notes TEXT
);

-- 3. Setup RLS
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_items_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_outlays ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'inventory_items', 'batch_records', 'sales_ledger',
    'sales_items_manifest', 'cash_outlays'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for anon" ON %I', tbl);
    EXECUTE format('CREATE POLICY "Allow all for anon" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- 4. Create Unique Index
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_item_batch
  ON batch_records (item_id, batch_number);
