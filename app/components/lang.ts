// Detects, on the device, comments written in a script the built-in model doesn't read. The model handles
// English, Hindi (Devanagari) and Hinglish (Hindi in Latin letters); anything in another script is offered
// for translation. Limits: Marathi/Nepali share Devanagari with Hindi, and other languages typed in Latin
// letters can't be told apart reliably, so neither is flagged.
const SCRIPTS: [string, RegExp][] = [
  ["Malayalam", /[\u0D00-\u0D7F]/g],
  ["Tamil", /[\u0B80-\u0BFF]/g],
  ["Telugu", /[\u0C00-\u0C7F]/g],
  ["Kannada", /[\u0C80-\u0CFF]/g],
  ["Bengali", /[\u0980-\u09FF]/g],
  ["Gujarati", /[\u0A80-\u0AFF]/g],
  ["Punjabi", /[\u0A00-\u0A7F]/g],
  ["Odia", /[\u0B00-\u0B7F]/g],
  ["Urdu / Arabic", /[\u0600-\u06FF\u0750-\u077F]/g],
  ["Sinhala", /[\u0D80-\u0DFF]/g],
  ["Thai", /[\u0E00-\u0E7F]/g],
  ["Chinese / Japanese", /[\u3040-\u30FF\u4E00-\u9FFF]/g],
  ["Korean", /[\uAC00-\uD7AF]/g],
  ["Russian", /[\u0400-\u04FF]/g],
];
const READABLE = /[A-Za-z\u0900-\u097F]/g; // English / Hinglish (Latin) and Hindi (Devanagari)

/** The language to offer translation for, or null if the built-in model can read the comment. */
export function foreignLanguage(text: string): string | null {
  const readable = (text.match(READABLE) || []).length;
  let best: string | null = null, bestN = 0;
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    if (n > bestN) { best = name; bestN = n; }
  }
  // At least 3 letters in that script, and more of them than English/Hindi letters.
  return best && bestN >= 3 && bestN > readable ? best : null;
}
