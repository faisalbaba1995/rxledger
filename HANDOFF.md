# RxLedger — Agent Handoff Document

Hello! If you are reading this, you are the new agent picking up the RxLedger project from a previous session. The user had to switch accounts.

## Project Context
- **Project**: RxLedger (Pharmacy Vision Ledger) - A mobile app for pharmacy inventory and sales.
- **Tech Stack**: Expo / React Native (SDK 56), Supabase (PostgreSQL), TypeScript.
- **Goal**: Create a mobile-compatible interface for a pilot test on an actual sale using the user's phone (Pixel 9).

## State of the App (Completed)
1. **Responsive Layouts**: The app fully supports mobile layouts. The main screens (`sales`, `stock`, `cashout`, `dashboard`) automatically switch between tablet and phone layouts using `useResponsiveLayout.ts`.
2. **Supabase Database**: The database is fully set up and clean. We ran `999_wipe_and_recreate.sql` in the Supabase SQL editor to ensure exactly 5 correct tables exist in the `public` schema.
3. **Data Ingestion Script**: `scripts/parseMargExcel.ts` is fully built to parse Marg ERP stock exports and upload them to Supabase (via `--upload`). The user hasn't run this yet because they don't have the Excel file right now.
4. **Camera UI**: `src/components/CameraScanner.tsx` is built. It can toggle front/back cameras, capture a photo, and preview it.

## Immediate Next Step: Gemini Vision OCR
Because the user doesn't have the Marg Excel data yet, they want to test the camera-based sale *immediately* to see if it recognizes medicine names and details.

**Your First Task:** Implement the Gemini OCR Pipeline.
We created an implementation plan for this, but haven't started coding it. Here is the approach you need to take:
1. Update `CameraScanner.tsx` to return `base64: true` when `takePictureAsync` is called.
2. Build `src/lib/ocrService.ts` to call the Gemini 1.5 Flash API directly from the client using `fetch` (the user will provide the API key as `EXPO_PUBLIC_GEMINI_API_KEY` in `.env`).
3. Update `handleScan` in `app/(tabs)/sales.tsx` to use the OCR service.
4. **Crucial:** The user explicitly requested **NOT** to insert any fake medicines into the database. For now, the OCR pipeline should just process the image and display the extracted results (Medicine Name, Batch, Expiry) in a temporary Alert or Bottom Sheet on the screen. The goal right now is purely to test the OCR performance on the camera images before wiring it up to the database.

*Start by reading `app/(tabs)/sales.tsx` and `src/components/CameraScanner.tsx`, then proceed with the OCR implementation!*
