import { buildTrainingData } from "./data";
import { train, classifyText } from "./model";

const CLASSES = ["Enquiry", "Positive", "Complaint", "Negative", "Spam"];
let model: any = null;

function getModel() {
  if (!model) model = train(buildTrainingData(), CLASSES, { epochs: 40, lr: 1, l2: 1e-4 });
  return model;
}

export type LocalResult = {
  category: "Enquiry" | "Positive" | "Negative";
  negative_type: "complaint" | "criticism" | "spam" | null;
  needs_review: boolean;
  reason: string;
};

const REVIEW_BELOW = 0.5;

export function classifyLocal(text: string): LocalResult {
  const r = classifyText(getModel(), text) as { label: string; p: number; rule?: boolean };
  const category = r.label === "Enquiry" || r.label === "Positive" ? r.label : "Negative";
  const negative_type = r.label === "Complaint" ? "complaint" : r.label === "Spam" ? "spam" : r.label === "Negative" ? "criticism" : null;
  return {
    category,
    negative_type,
    needs_review: r.p < REVIEW_BELOW,
    reason: r.rule ? "Common short comment" : `Built-in model, ${Math.round(r.p * 100)}% sure`,
  };
}
