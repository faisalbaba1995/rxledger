/**
 * ocrService — Gemini Vision OCR for medicine strip text extraction.
 *
 * Sends a base64-encoded photo of a medicine strip to Gemini 1.5 Flash
 * and extracts structured data: medicine name, batch number, expiry date,
 * MRP, and composition.
 *
 * This is a TEST-ONLY service: it does NOT insert anything into the DB.
 * It simply returns whatever the AI could read from the image.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface OcrResult {
  /** The medicine or product name extracted from the strip */
  medicineName: string | null;
  /** Batch number (e.g., "B12345") */
  batchNumber: string | null;
  /** Expiry date as extracted (e.g., "12/2025", "2025-12-01") */
  expiryDate: string | null;
  /** MRP if visible on the strip */
  mrp: string | null;
  /** Composition / strength (e.g., "Paracetamol 650mg") */
  composition: string | null;
  /** The raw text block returned by the AI (for debugging) */
  rawText: string;
  /** Whether the extraction was confident (AI returned valid JSON) */
  confident: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

const PHARMACY_PROMPT = `You are an expert pharmacy OCR system. Analyze this photo of a medicine strip or medicine packaging.

Extract the following information ONLY if clearly visible in the image:
1. Medicine Name (the brand name or generic name)
2. Batch Number (often labeled as "B.No", "Batch No", "Lot")
3. Expiry Date (often labeled as "Exp", "Expiry", "Use Before")
4. MRP (Maximum Retail Price, often preceded by "MRP" or "₹")
5. Composition (active ingredients and strengths, e.g., "Paracetamol 650mg")

RESPOND WITH ONLY VALID JSON in this exact format, nothing else:
{
  "medicineName": "string or null",
  "batchNumber": "string or null",
  "expiryDate": "string or null",
  "mrp": "string or null",
  "composition": "string or null"
}

If you cannot read a field, set it to null. Do NOT guess or hallucinate values.
If the image is not a medicine strip, return all fields as null.`;

// ─── Helpers ────────────────────────────────────────────────────────

/** Sleep for the given number of milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Maximum number of retries on 429 rate-limit errors. */
const MAX_RETRIES = 3;

// ─── Service ────────────────────────────────────────────────────────

/**
 * Sends a base64 image to Gemini Vision and extracts medicine details.
 *
 * @param base64Image  Raw base64 string (NO data URI prefix).
 * @param mimeType     MIME type, defaults to "image/jpeg".
 * @returns            Parsed OCR result.
 */
export async function extractMedicineDetails(
  base64Image: string,
  mimeType: string = 'image/jpeg',
): Promise<OcrResult> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    return {
      medicineName: null,
      batchNumber: null,
      expiryDate: null,
      mrp: null,
      composition: null,
      rawText: 'ERROR: EXPO_PUBLIC_GEMINI_API_KEY is not set in .env',
      confident: false,
    };
  }

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: PHARMACY_PROMPT },
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 512,
    },
  });

  try {
    let response: Response | null = null;

    // Retry loop for 429 rate-limit errors
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.status === 429 && attempt < MAX_RETRIES) {
        // Exponential backoff: 3s, 6s, 12s
        const delay = 3000 * Math.pow(2, attempt);
        console.warn(`Rate limited (429). Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      break; // Success or non-retryable error
    }

    if (!response || !response.ok) {
      const errorText = response ? await response.text() : 'No response';
      console.error('Gemini API error:', response?.status, errorText);
      return {
        medicineName: null,
        batchNumber: null,
        expiryDate: null,
        mrp: null,
        composition: null,
        rawText: `API Error ${response?.status ?? 'unknown'}: ${errorText.slice(0, 200)}`,
        confident: false,
      };
    }

    const data = await response.json();

    // Extract the text content from the Gemini response
    const rawText: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!rawText) {
      return {
        medicineName: null,
        batchNumber: null,
        expiryDate: null,
        mrp: null,
        composition: null,
        rawText: 'Empty response from Gemini',
        confident: false,
      };
    }

    // Try to parse the JSON from the response
    // The AI sometimes wraps JSON in markdown code fences
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          medicineName: parsed.medicineName ?? null,
          batchNumber: parsed.batchNumber ?? null,
          expiryDate: parsed.expiryDate ?? null,
          mrp: parsed.mrp ?? null,
          composition: parsed.composition ?? null,
          rawText,
          confident: true,
        };
      } catch {
        // JSON parse failed — return raw text
      }
    }

    // Fallback: couldn't parse JSON
    return {
      medicineName: null,
      batchNumber: null,
      expiryDate: null,
      mrp: null,
      composition: null,
      rawText,
      confident: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('OCR service error:', message);
    return {
      medicineName: null,
      batchNumber: null,
      expiryDate: null,
      mrp: null,
      composition: null,
      rawText: `Network error: ${message}`,
      confident: false,
    };
  }
}
