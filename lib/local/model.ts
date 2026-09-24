// @ts-nocheck
// Built-in comment classifier: character/word n-gram features + multinomial logistic regression,
// trained from lib/local/examples.json + lib/local/templates.ts when the server starts (about 2 seconds, once per server instance).
// No external service, no cost. To improve it, add labelled comments to examples.json and redeploy.
export function normalize(t) {
  let s = (t || "").normalize("NFKC").toLowerCase();
  s = s.replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|in|xyz|ly|net|org)\S*/g, " zurl ");
  s = s.replace(/@[\w.]+/g, " zmention ");
  s = s.replace(/\d+/g, "0");
  s = s.replace(/(.)\1{2,}/gu, "$1$1");
  return s.replace(/\s+/g, " ").trim();
}

const LEX = {
  neg: ["worst","bad","bekar","bakwas","ghatiya","fake","fraud","froud","scam","cheat","cheater","waste","useless","barbad","overpriced","overhyped","expensive","mehenga","mehnga","costly","dull","ugly","poor","gimmick","lie","dont","don't","never","not worth","not good","no way","😒","👎","🤮","🙄","😡","बेकार","महंगा","vilai","नकली","घटिया","धोखा","बर्बादी","nakli","loot","bharosa nahi","mat lena","mat lo","sasta milta"],
  comp: ["not received","nahi mila","nahi aaya","nai mila","abhi tak","refund","return","exchange","wapas","damaged","torn","phati","wrong","galat","missing","leaking","broken","expired","rash","rashes","allergy","irritation","burning","pimples","tracking","courier","delivered","order","parcel","payment","paisa","charged","cancel","customer care","no reply","still","inka","ajun","vandhu","வரவில்லை","नहीं आया","পাইনি","नहीं मिला","टूटा","गलत","रिफंड","खराब","कैंसिल","kharab","tuta","tut gaya","allergy","nahi hua","update nahi","no refund","not working","stopped working","mera order","my order"],
  pos: ["love","loved","best","beautiful","gorgeous","amazing","awesome","superb","suprb","nice","lovely","pretty","stunning","great","perfect","favourite","glowing","thank","thanks","worth","genuine","mast","sundar","sundr","badhiya","khoobsurat","zabardast","wah","wow","super","elegant","classy","royal","obsessed","holy grail","😍","❤️","🔥","👌","👏","🙏","🥰","💯","सुंदर","छान","அழகு","বাগুন্দি","సుందర్","সুন্দর","bagundi","azhaga","chhan","chennagide","अच्छा","पसंद","शानदार","बढ़िया","धन्यवाद","paisa vasool","pyara","tareef","khush","recommend"],
  spam: ["earn","follow","followers","subscribe","f4f","sub4sub","crypto","bitcoin","loan","betting","telegram","whatsapp group","giveaway","collab","promotion","promote","my page","my profile","my channel","my reel","link in bio","click","verify","iphone","astrolog","vashikaran","baba","job","part time","profit","zurl","feature you","check out","visit my","check my"],
  q: ["price","kitne","kitna","rate","cost","how much","pp","available","cod","delivery","ship","link","dm","details","interested","kaise","kya","size","shade","colour","color","stock","where","order kaise","hai?","milega","कितने","कीमत","मिलेगा","चाहिए","कैसे","कहाँ","chahiye","batao","bhejo","kab"],
};
export function features(t) {
  const s = normalize(t);
  const f = new Set();
  const words = s.split(/[^\p{L}\p{M}\p{N}\p{Extended_Pictographic}?₹@]+/u).filter(Boolean);
  if (!words.length) f.add("empty");
  for (let i = 0; i < words.length; i++) {
    f.add("w:" + words[i]);
    if (i + 1 < words.length) f.add("b:" + words[i] + "_" + words[i + 1]);
    const ch = Array.from(" " + words[i] + " ");
    for (let n = 2; n <= 4; n++) for (let j = 0; j + n <= ch.length; j++) f.add("c:" + ch.slice(j, j + n).join(""));
  }
  for (const e of s.match(/\p{Extended_Pictographic}/gu) || []) f.add("e:" + e);
  for (const [k, list] of Object.entries(LEX)) { let c = 0; for (const w of list) if ((" " + s + " ").includes(w.length > 3 || /[^a-z]/.test(w) ? w : " " + w + " ")) c++; if (c) { f.add("lex:" + k); if (c > 1) f.add("lex2:" + k); } }
  if (s.includes("?")) f.add("has_q");
  if (words.length <= 2) f.add("short");
  return [...f];
}
export function train(rows, classes, { epochs = 40, lr = 0.5, l2 = 1e-4 } = {}) {
  const K = classes.length, W = new Map(), b = new Array(K).fill(0);
  const X = rows.map((r) => features(r.text)), Y = rows.map((r) => classes.indexOf(r.label));
  const get = (f) => { let w = W.get(f); if (!w) { w = new Float64Array(K); W.set(f, w); } return w; };
  const order = X.map((_, i) => i);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const eta = lr / (1 + ep * 0.1);
    for (const i of order) {
      const fs = X[i], v = 1 / Math.sqrt(fs.length);
      const z = b.slice();
      for (const f of fs) { const w = get(f); for (let k = 0; k < K; k++) z[k] += w[k] * v; }
      const m = Math.max(...z); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, c) => a + c, 0);
      for (let k = 0; k < K; k++) {
        const g = e[k] / s - (k === Y[i] ? 1 : 0);
        b[k] -= eta * g;
        for (const f of fs) { const w = get(f); w[k] -= eta * (g * v + l2 * w[k]); }
      }
    }
  }
  return { W, b, classes };
}
export function predict(model, text) {
  const fs = features(text), v = 1 / Math.sqrt(fs.length), K = model.classes.length;
  const z = model.b.slice();
  for (const f of fs) { const w = model.W.get(f); if (w) for (let k = 0; k < K; k++) z[k] += w[k] * v; }
  const m = Math.max(...z); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, c) => a + c, 0);
  const p = e.map((x) => x / s); let best = 0; for (let k = 1; k < K; k++) if (p[k] > p[best]) best = k;
  return { label: model.classes[best], p: p[best], probs: p };
}

// High-precision rules checked before the model: very short, unambiguous comments.
const ENQ_SHORT = /^(hi+|hello+|hlo|hey+|namaste|pp+|p\.?p\.?|price+\??|prices?\s*(pls|plz|please)?|rate\??|cost\??|dm+|check dm|dm me|dm pls|details?\s*(pls|plz|please)?|interested|link\??|link pls|info|\?+|kitne ka|kitna|price\?\?|how much\??|available\??|cod\??)[\s!.?🙏]*$/u;
const POS_EMOJI = /^[\s😍❤️♥️💖💕💗🔥👌👏🙏🥰😊💯✨⭐🌟👍❣️🤩😘💓💞]+$/u;
const NEG_EMOJI = /^[\s👎🤮😡🤬😠💩😒🙄]+$/u;
export function classifyText(model, text) {
  const s = normalize(text).replace(/\s+/g, " ").trim();
  if (ENQ_SHORT.test(s)) return { label: "Enquiry", p: 0.95, rule: true };
  if (POS_EMOJI.test(text.trim())) return { label: "Positive", p: 0.95, rule: true };
  if (NEG_EMOJI.test(text.trim())) return { label: "Negative", p: 0.9, rule: true };
  return predict(model, text);
}
