// Turns Meta's error messages into a short reason a person can act on.
// The raw message is kept separately for the activity log.
export type Reason = "permission" | "deleted" | "rate-limit" | "expired" | "other";

export function classify(msg: string = ""): { reason: Reason; text: string } {
  const m = msg.toLowerCase();
  if (/expired|session has been invalidated|#190\b|code 190/.test(m)) return { reason: "expired", text: "the Facebook login expired" };
  if (/limit|#4\b|#17\b|#32\b|#613\b|too many calls/.test(m)) return { reason: "rate-limit", text: "Meta is limiting requests right now" };
  // Meta's "Unsupported get request … does not exist, cannot be loaded due to missing permissions" is almost always
  // a permission problem (the post exists, this login just can't open it).
  if (/permission|unsupported get request|#10\b|#200\b|not authorized|access/.test(m)) return { reason: "permission", text: "missing permissions" };
  if (/does not exist|deleted|nonexisting/.test(m)) return { reason: "deleted", text: "the post no longer exists" };
  return { reason: "other", text: "an error from Meta" };
}
