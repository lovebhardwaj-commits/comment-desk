export const fmtShort = (s: string) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
