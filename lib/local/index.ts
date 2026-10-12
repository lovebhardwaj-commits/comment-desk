import { buildTrainingData } from "./data";
import { train, classifyText } from "./model";
import { correctionsVersion, loadCorrections, keyFor, type Label } from "./corrections";

const CLASSES = ["Enquiry", "Positive", "Complaint", "Negative", "Spam"];
const CORRECTION_WEIGHT = 3; // each corrected comment counts as 3 training examples

let model: any = null;
let modelVersion = -1;
let exact = new Map<string, { text: string; label: Label }>();
let training: Promise<void> | null = null;
let lastCheck = 0;

/** Trains on the built-in data plus the team's corrections, and retrains when corrections change. */
async function ensureModel() {
  const now = Date.now();
  if (model && now - lastCheck < 15_000) return; // check for new corrections at most every 15 seconds
  lastCheck = now;
  const v = await correctionsVersion();
  if (model && v === modelVersion) return;
  if (!training) {
    training = (async () => {
      const corr = await loadCorrections();
      const rows = buildTrainingData();
      for (const c of corr.values()) for (let i = 0; i < CORRECTION_WEIGHT; i++) rows.push({ text: c.text, label: c.label });
      model = train(rows, CLASSES, { epochs: 40, lr: 1, l2: 1e-4 });
      exact = corr;
      modelVersion = v;
    })().finally(() => { training = null; });
  }
  await training;
}

/** Call after saving a correction so this server instance retrains on the next request. */
export function invalidateModel() {
  lastCheck = 0;
  modelVersion = -1;
}

export type LocalResult = {
  category: "Enquiry" | "Positive" | "Negative";
  negative_type: "complaint" | "criticism" | "spam" | null;
  needs_review: boolean;
  reason: string;
  label: Label;
  /** How sure the model is about this category, 0–1 (1 for a team correction). Shown as a % on each comment. */
  score: number;
};

const REVIEW_BELOW = 0.5;

export function toResult(label: string, p: number, reason: string): LocalResult {
  const category = label === "Enquiry" || label === "Positive" ? label : "Negative";
  const negative_type = label === "Complaint" ? "complaint" : label === "Spam" ? "spam" : label === "Negative" ? "criticism" : null;
  return { category, negative_type, needs_review: p < REVIEW_BELOW, reason, label: label as Label, score: Math.round(p * 100) / 100 };
}

export async function classifyLocal(texts: string[]): Promise<LocalResult[]> {
  await ensureModel();
  return texts.map((text) => {
    const hit = exact.get(keyFor(text));
    if (hit) return toResult(hit.label, 1, "Corrected by your team");
    const r = classifyText(model, text) as { label: string; p: number; rule?: boolean };
    return toResult(r.label, r.p, r.rule ? "Common short comment" : `Built-in model, ${Math.round(r.p * 100)}% sure`);
  });
}
