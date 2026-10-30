/**
 * Generates the character illustrations: one hero at four stages × eight states (32 SVG files).
 *
 *     node frontend/scripts/characters/generate.mjs     # writes frontend/src/assets/characters/*.svg
 *
 * Style: minimalist geometric figures in the spirit of 16Personalities illustrations — flat colours, one facet of
 * shade per surface, simple faces. Every stage reuses the same head, eyes, brows and hair silhouette, so the four
 * stages read as one person growing up; only age cues, clothes and props change.
 *
 * The files are ordinary assets: an illustrator can replace any of them (same name, viewBox 0 0 200 280, transparent
 * background) without touching the application code. The app finds them through src/character/assets.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../src/assets/characters");

export const STAGES = [1, 2, 3, 4];
export const STATES = ["idle", "happy", "thinking", "confident", "learning", "celebrating", "working", "supportive"];

const SKIN = "#F1C7A3", SKIN_SHADE = "#E2AE87", EYE = "#1E2533", MOUTH = "#9A4E3F";
const HAIR = "#2E2A33", HAIR_HI = "#433D49", GREY = "#9CA3AF";

/** Per-stage look. bs/hs: body and head scale (younger = smaller body, relatively larger head). */
const LOOK = {
  1: { bs: 0.9, hs: 1.08, sh: 23, top: "#5C9FFF", topShade: "#4789EC", sleeve: "#5C9FFF", legs: "#3E5A82", legsShade: "#344E73",
       shoe: "#F1F5F9", sole: "#94A3B8", blush: true },
  2: { bs: 0.95, hs: 1.04, sh: 25, top: "#4B5A70", topShade: "#3F4C60", inner: "#CBD5E1", sleeve: "#4B5A70", legs: "#C8B595", legsShade: "#B6A283",
       shoe: "#F1F5F9", sole: "#94A3B8", blush: true },
  3: { bs: 0.99, hs: 1.0, sh: 27, top: "#30558E", topShade: "#284A7E", inner: "#DCEBFF", sleeve: "#30558E", legs: "#334155", legsShade: "#2B3747",
       shoe: "#5B3A29", sole: "#3F281C", blush: false },
  4: { bs: 1.02, hs: 0.98, sh: 29, top: "#232B3A", topShade: "#1A212D", inner: "#F8FAFC", sleeve: "#232B3A", legs: "#232B3A", legsShade: "#1A212D",
       shoe: "#151A23", sole: "#0B0E14", blush: false, tie: "#17865A", grey: true },
};

const GROUND = 262;
const NECK_TOP = 86; // base coordinates of the neck top (where the head sits)
const HEAD = 1.16; // stylised head size: faces stay readable when the avatar is small

const f = (n) => Math.round(n * 10) / 10;

function mapper(stage) {
  const { bs, hs } = LOOK[stage];
  const B = (x, y) => [100 + (x - 100) * bs, GROUND - (GROUND - y) * bs];
  const neckTop = B(100, NECK_TOP)[1];
  const H = (x, y) => [100 + (x - 100) * hs * HEAD, neckTop - (NECK_TOP - y) * hs * HEAD];
  return { B, H, bs, hs: hs * HEAD };
}

const pts = (m, list) => list.map(([x, y]) => m(x, y).map(f).join(",")).join(" ");
const poly = (m, list, fill, extra = "") => `<polygon points="${pts(m, list)}" fill="${fill}"${extra}/>`;
const path = (d, fill, extra = "") => `<path d="${d}" fill="${fill}"${extra}/>`;
/** A path given in base coordinates, mapped point by point: commands are kept, numbers come in x,y pairs. */
function mpath(m, d) {
  return d.replace(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g, (_, x, y) => m(Number(x), Number(y)).map(f).join(","));
}

/* ------------------------------------------------------------------ body ------------------------------------------------------------------ */

function legs(stage, m, state) {
  const L = LOOK[stage];
  const spread = state === "confident" || state === "celebrating" ? 4 : 0;
  const out = [];
  // left leg (viewer's left), right leg slightly shaded
  out.push(poly(m.B, [[84, 164], [99, 164], [97 - spread / 2, 250], [86 - spread, 250]], L.legs));
  out.push(poly(m.B, [[101, 164], [116, 164], [114 + spread, 250], [103 + spread / 2, 250]], L.legsShade));
  // shoes
  const shoe = (x0, x1, dir) => {
    const toe = dir < 0 ? x0 - 5 : x1 + 5;
    return poly(m.B, dir < 0 ? [[x0, 249], [x1, 249], [x1, 259], [toe, 259], [toe, 255]] : [[x0, 249], [x1, 249], [toe, 255], [toe, 259], [x0, 259]], L.shoe)
      + poly(m.B, dir < 0 ? [[x1, 259], [toe, 259], [toe, 262], [x1, 262]] : [[x0, 259], [toe, 259], [toe, 262], [x0, 262]], L.sole);
  };
  out.push(shoe(85 - spread, 98 - spread / 2, -1));
  out.push(shoe(102 + spread / 2, 115 + spread, 1));
  return out.join("");
}

function torso(stage, m) {
  const L = LOOK[stage], s = L.sh, B = m.B;
  const out = [];
  const shape = `M${100 - s + 7} 89 Q${100 - s} 90 ${100 - s - 1} 100 L${100 - s + 6} 168 L${100 + s - 6} 168 L${100 + s + 1} 100 Q${100 + s} 90 ${100 + s - 7} 89 Z`;
  if (stage === 1) {
    // backpack behind the body
    out.push(path(mpath(B, `M${100 - s - 7} 102 Q${100 - s - 8} 96 ${100 - s - 2} 96 L${100 - s + 2} 96 L${100 - s + 2} 150 L${100 - s - 5} 150 Q${100 - s - 8} 150 ${100 - s - 8} 146 Z`), "#25B875"));
    out.push(path(mpath(B, shape), L.top));
    out.push(poly(B, [[106, 90], [100 + s - 7, 89], [100 + s + 1, 100], [100 + s - 6, 168], [112, 168]], L.topShade));
    // hood around the neck
    out.push(path(mpath(B, "M86 92 Q100 102 114 92 Q114 86 108 85 L92 85 Q86 86 86 92 Z"), "#3F7DDB"));
    // drawstrings
    out.push(`<path d="${mpath(B, "M96 96 L95 114 M104 96 L105 114")}" stroke="#F8FAFC" stroke-width="${f(1.6 * m.bs)}" stroke-linecap="round" fill="none"/>`);
    // pocket and hem
    out.push(poly(B, [[86, 142], [114, 142], [118, 158], [82, 158]], "#4789EC"));
    out.push(poly(B, [[100 - s + 6, 162], [100 + s - 6, 162], [100 + s - 6, 168], [100 - s + 6, 168]], "#3F7DDB"));
    // backpack straps over the shoulders
    out.push(`<path d="${mpath(B, `M${100 - s + 6} 90 L${100 - s + 8} 132 M${100 + s - 6} 90 L${100 + s - 8} 132`)}" stroke="#1F7A52" stroke-width="${f(4.5 * m.bs)}" stroke-linecap="round" fill="none"/>`);
  } else {
    // inner layer (hoodie / shirt) visible in the opening
    out.push(path(mpath(B, shape), L.inner));
    if (stage === 2) {
      out.push(path(mpath(B, "M88 91 Q100 101 112 91 Q112 86 107 85 L93 85 Q88 86 88 91 Z"), "#AAB6C6"));
      out.push(poly(B, [[93, 140], [107, 140], [108, 152], [92, 152]], "#B9C4D3"));
    } else {
      // shirt collar
      out.push(poly(B, [[93, 86], [100, 96], [95, 99], [90, 90]], "#FFFFFF"));
      out.push(poly(B, [[107, 86], [100, 96], [105, 99], [110, 90]], "#EEF2F7"));
      if (L.tie) {
        out.push(poly(B, [[98, 96], [102, 96], [103, 100], [100, 102], [97, 100]], L.tie));
        out.push(poly(B, [[98, 101], [102, 101], [104, 138], [100, 143], [96, 138]], L.tie));
      }
    }
    // jacket panels: left and right, open in the middle
    const open = stage === 2 ? 7 : 5;
    out.push(path(mpath(B, `M${100 - s + 7} 89 Q${100 - s} 90 ${100 - s - 1} 100 L${100 - s + 6} 168 L${100 - open + 1} 168 L${100 - open} 120 L93 89 Z`), L.top));
    out.push(path(mpath(B, `M${100 + s - 7} 89 Q${100 + s} 90 ${100 + s + 1} 100 L${100 + s - 6} 168 L${100 + open - 1} 168 L${100 + open} 120 L107 89 Z`), L.topShade));
    // lapels
    out.push(poly(B, [[93, 89], [100 - open, 120], [88, 104], [90, 92]], L.topShade));
    out.push(poly(B, [[107, 89], [100 + open, 120], [112, 104], [110, 92]], shade(L.topShade, -10)));
    if (stage >= 3) out.push(`<circle cx="${f(B(100 - open + 1, 134)[0])}" cy="${f(B(100 - open + 1, 134)[1])}" r="${f(1.3 * m.bs)}" fill="${shade(L.top, -25)}"/>`);
    if (stage === 4) out.push(poly(B, [[110, 110], [118, 110], [117.5, 113], [110.5, 113]], "#F8FAFC")); // pocket square
  }
  return out.join("");
}

/* ------------------------------------------------------------------ head ------------------------------------------------------------------ */

function head(stage, m, state) {
  const L = LOOK[stage], H = m.H;
  const out = [];
  const tilt = state === "supportive" ? -5 : state === "thinking" ? 4 : 0;
  const [cx, cy] = H(100, 60);
  out.push(`<g transform="rotate(${tilt} ${f(cx)} ${f(cy + 18 * m.hs)})">`);
  // neck
  out.push(poly(H, [[94, 74], [106, 74], [106, 90], [94, 90]], SKIN_SHADE));
  // ears
  out.push(`<ellipse cx="${f(H(83, 62)[0])}" cy="${f(H(83, 62)[1])}" rx="${f(3.4 * m.hs)}" ry="${f(4.6 * m.hs)}" fill="${SKIN_SHADE}"/>`);
  out.push(`<ellipse cx="${f(H(117, 62)[0])}" cy="${f(H(117, 62)[1])}" rx="${f(3.4 * m.hs)}" ry="${f(4.6 * m.hs)}" fill="${SKIN_SHADE}"/>`);
  // face: rounder for the younger stages, slightly squarer jaw for the older ones
  const jaw = stage <= 2 ? "M83 56 Q83 40 100 40 Q117 40 117 56 L117 64 Q116 79 100 81 Q84 79 83 64 Z"
    : "M83 56 Q83 40 100 40 Q117 40 117 56 L117 65 Q116 76 108 79 L100 81 L92 79 Q84 76 83 65 Z";
  out.push(path(mpath(H, jaw), SKIN));
  // facet of shade on the right cheek
  out.push(path(mpath(H, stage <= 2 ? "M109 41 Q117 44 117 56 L117 64 Q116 79 100 81 Q110 72 109 41 Z" : "M109 41 Q117 44 117 56 L117 65 Q116 76 108 79 L100 81 Q110 70 109 41 Z"), SKIN_SHADE, ' opacity="0.55"'));
  // hair: same silhouette at every stage (side-swept fringe to the viewer's left)
  const hair = stage === 1
    ? "M81 60 Q78 38 96 33 Q112 30 119 44 Q121 51 118 60 L116 52 Q114 47 108 47 Q100 49 90 47 L86 51 Q84 54 84 61 Z"
    : stage === 4
      ? "M82 58 Q80 39 97 35 Q113 32 118 45 Q120 51 118 58 L116 52 Q113 48 107 48 Q99 49 91 47 L86 51 Q84 54 84 58 Z"
      : "M81.5 59 Q79 38 97 34 Q113 31 119 45 Q120.5 51 118 59 L116 52 Q113 47.5 107 47.5 Q99 49 90.5 47 L86 51 Q84 54 84 59 Z";
  out.push(path(mpath(H, hair), HAIR));
  // fringe sweep and highlight
  out.push(path(mpath(H, stage === 1 ? "M88 47 Q99 36 115 42 Q107 44 100 50 Q94 50 88 47 Z" : "M89 47 Q100 38 114 43 Q106 45 100 49.5 Q94 49.5 89 47 Z"), HAIR_HI));
  if (stage === 1) out.push(path(mpath(H, "M97 34.5 Q99 30 103.5 30.5 Q101 32 101.5 34 Z"), HAIR)); // a few untidy tufts
  if (L.grey) {
    out.push(path(mpath(H, "M82.5 57 Q82 52 84 50 L85 57 Z"), GREY));
    out.push(path(mpath(H, "M117.5 57 Q118 52 116.3 50 L115.5 57 Z"), GREY));
  }
  out.push(face(stage, m, state));
  out.push("</g>");
  return out.join("");
}

function face(stage, m, state) {
  const H = m.H, hs = m.hs;
  const out = [];
  const eye = (x, y, rx = 2.2, ry = 2.8) => `<ellipse cx="${f(H(x, y)[0])}" cy="${f(H(x, y)[1])}" rx="${f(rx * hs)}" ry="${f(ry * hs)}" fill="${EYE}"/>`;
  const stroke = (d, color, w) => `<path d="${mpath(H, d)}" stroke="${color}" stroke-width="${f(w * hs)}" stroke-linecap="round" fill="none"/>`;
  // brows (thicker with age)
  const bw = stage === 4 ? 2.1 : stage === 3 ? 1.9 : 1.7;
  const browL = state === "thinking" ? "M88.5 53.5 L95.5 52" : state === "supportive" ? "M89 55 L95.5 54.5" : "M89 54.5 L95.5 53.5";
  const browR = state === "thinking" ? "M104.5 51 L111.5 52.5" : state === "supportive" ? "M104.5 54.5 L111 55" : "M104.5 53.5 L111 54.5";
  out.push(stroke(browL, HAIR, bw), stroke(browR, HAIR, bw));
  // eyes
  if (state === "happy" || state === "celebrating") {
    out.push(stroke("M90 62 Q92.5 58.8 95 62", EYE, 1.9), stroke("M105 62 Q107.5 58.8 110 62", EYE, 1.9));
  } else if (state === "thinking") {
    out.push(eye(94, 60.5, 2.1, 2.7), eye(108.5, 60.5, 2.1, 2.7));
  } else if (state === "learning" || state === "working") {
    out.push(eye(92.3, 63.2, 2.2, 2.1), eye(107.3, 63.2, 2.2, 2.1));
  } else if (state === "supportive") {
    out.push(stroke("M90.2 61.5 Q92.5 59.6 94.8 61.5", EYE, 1.9), stroke("M105.2 61.5 Q107.5 59.6 109.8 61.5", EYE, 1.9));
  } else {
    out.push(eye(92.5, 61.5), eye(107.5, 61.5));
  }
  // light stubble along the jaw: the mature stage (35–45)
  if (stage === 4) out.push(path(mpath(H, "M86 68 Q88 76 92 78.6 L100 80.6 L108 78.6 Q112 76 114 68 Q110 74 104 75.4 Q100 76.6 96 75.4 Q90 74 86 68 Z"), "#6B5A50", ' opacity="0.16"'));
  // nose
  out.push(stroke("M100.5 64 L99 69 L101 69.5", SKIN_SHADE, 1.3));
  // mouth
  const mouth = {
    idle: () => stroke("M96.5 73.5 Q100 75.2 103.5 73.5", MOUTH, 1.5),
    happy: () => path(mpath(H, "M95 72.5 Q100 73.6 105 72.5 Q104 78 100 78 Q96 78 95 72.5 Z"), MOUTH),
    thinking: () => stroke("M98 74.5 L103 73.8", MOUTH, 1.5),
    confident: () => stroke("M95.5 73 Q100.5 76.5 105 72.6", MOUTH, 1.6),
    learning: () => stroke("M97.5 74 Q100 75 102.5 74", MOUTH, 1.4),
    celebrating: () => path(mpath(H, "M94.5 72 Q100 73.4 105.5 72 Q104.5 79.5 100 79.5 Q95.5 79.5 94.5 72 Z"), MOUTH) + path(mpath(H, "M96.5 73 Q100 73.9 103.5 73 L103 74.6 Q100 75.2 97 74.6 Z"), "#FFFFFF"),
    working: () => stroke("M97.5 74 L102.5 74", MOUTH, 1.4),
    supportive: () => stroke("M95.5 73 Q100 76.8 104.5 73", MOUTH, 1.6),
  }[state];
  out.push(mouth());
  if (LOOK[stage].blush && (state === "happy" || state === "celebrating" || state === "supportive")) {
    out.push(`<ellipse cx="${f(H(88.5, 68)[0])}" cy="${f(H(88.5, 68)[1])}" rx="${f(3 * hs)}" ry="${f(1.8 * hs)}" fill="#F08A7E" opacity="0.35"/>`);
    out.push(`<ellipse cx="${f(H(111.5, 68)[0])}" cy="${f(H(111.5, 68)[1])}" rx="${f(3 * hs)}" ry="${f(1.8 * hs)}" fill="#F08A7E" opacity="0.35"/>`);
  }
  return out.join("");
}

/* ------------------------------------------------------------------ arms and props ------------------------------------------------------------------ */

/** Arm poses in base body coordinates: [elbow, hand] for the viewer's left (L) and right (R) arm. "chin" = to the chin. */
const POSES = {
  idle: { L: [[-3, 128], [-1, 158]], R: [[3, 128], [1, 158]] },
  happy: { L: [[-12, 120], [-20, 104]], R: [[12, 120], [20, 104]] },
  thinking: { L: [[-2, 130], [18, 142]], R: [[2, 132], "chin"] },
  confident: { L: [[-14, 124], [4, 150]], R: [[14, 124], [-4, 150]] },
  learning: { L: [[-4, 130], [14, 128]], R: [[4, 130], [-14, 128]] },
  celebrating: { L: [[-10, 122], [-6, 152]], R: [[10, 76], [6, 50]] },
  working: { L: [[-4, 132], [16, 134]], R: [[4, 132], [-16, 134]] },
  supportive: { L: [[-2, 126], [26, 120]], R: [[6, 128], [-22, 118]] },
};

function arms(stage, m, state) {
  const L = LOOK[stage], s = L.sh, B = m.B;
  const pose = POSES[state];
  const width = f(12.5 * m.bs);
  const chin = m.H(106, 81);
  const out = [];
  const one = (side) => {
    const dir = side === "L" ? -1 : 1;
    const shoulder = B(100 + dir * (s - 4), 97);
    const [el, hd] = pose[side];
    const elbow = B(100 + dir * s + el[0] * 1, el[1]);
    const hand = hd === "chin" ? [chin[0] + 3, chin[1] + 4] : B(100 + dir * s + hd[0], hd[1]);
    const d = `M${f(shoulder[0])},${f(shoulder[1])} L${f(elbow[0])},${f(elbow[1])} L${f(hand[0])},${f(hand[1])}`;
    const sleeve = side === "R" ? shade(L.sleeve, -8) : L.sleeve;
    let g = `<path d="${d}" stroke="${sleeve}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    // cuff
    const vx = hand[0] - elbow[0], vy = hand[1] - elbow[1], len = Math.hypot(vx, vy) || 1;
    const cuff = [hand[0] - (vx / len) * 4.6 * m.bs, hand[1] - (vy / len) * 4.6 * m.bs];
    if (stage >= 3) g += `<circle cx="${f(cuff[0])}" cy="${f(cuff[1])}" r="${f(4.8 * m.bs)}" fill="${L.inner}"/>`;
    if (stage === 4 && side === "L") g += `<circle cx="${f(cuff[0])}" cy="${f(cuff[1])}" r="${f(4.8 * m.bs)}" fill="#3A4252"/>`;
    if (stage <= 2) g += `<circle cx="${f(cuff[0])}" cy="${f(cuff[1])}" r="${f(5.6 * m.bs)}" fill="${shade(sleeve, -12)}"/>`;
    g += `<circle cx="${f(hand[0])}" cy="${f(hand[1])}" r="${f(5.4 * m.bs)}" fill="${SKIN}"/>`;
    return { g, hand };
  };
  const left = one("L"), right = one("R");
  out.push(left.g, right.g);
  return { svg: out.join(""), left: left.hand, right: right.hand };
}

function props(stage, m, state, hands) {
  const B = m.B, bs = m.bs;
  const mid = [(hands.left[0] + hands.right[0]) / 2, (hands.left[1] + hands.right[1]) / 2];
  const rect = (cx, cy, w, h, fill, r = 2, extra = "") => `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="${fill}"${extra}/>`;
  if (state === "learning") {
    if (stage === 1) {
      // open notebook
      const [x, y] = [mid[0], mid[1] - 6 * bs];
      return path(`M${f(x)} ${f(y + 2)} L${f(x - 22 * bs)} ${f(y - 2)} L${f(x - 22 * bs)} ${f(y + 18 * bs)} L${f(x)} ${f(y + 22 * bs)} Z`, "#FFFFFF")
        + path(`M${f(x)} ${f(y + 2)} L${f(x + 22 * bs)} ${f(y - 2)} L${f(x + 22 * bs)} ${f(y + 18 * bs)} L${f(x)} ${f(y + 22 * bs)} Z`, "#EEF2F7")
        + `<path d="M${f(x - 18 * bs)} ${f(y + 4 * bs)} L${f(x - 5 * bs)} ${f(y + 6 * bs)} M${f(x - 18 * bs)} ${f(y + 9 * bs)} L${f(x - 5 * bs)} ${f(y + 11 * bs)} M${f(x + 5 * bs)} ${f(y + 6 * bs)} L${f(x + 18 * bs)} ${f(y + 4 * bs)}" stroke="#93B4E8" stroke-width="1.2" stroke-linecap="round"/>`
        + `<path d="M${f(x)} ${f(y + 2)} L${f(x)} ${f(y + 22 * bs)}" stroke="#CBD5E1" stroke-width="1"/>`;
    }
    // tablet with a chart
    const [x, y] = [mid[0], mid[1] - 6 * bs];
    return rect(x, y, 40 * bs, 28 * bs, "#1E293B", 3) + rect(x, y, 35 * bs, 23 * bs, "#EEF6FF", 2)
      + `<path d="M${f(x - 13 * bs)} ${f(y + 6 * bs)} L${f(x - 4 * bs)} ${f(y)} L${f(x + 3 * bs)} ${f(y + 3 * bs)} L${f(x + 13 * bs)} ${f(y - 7 * bs)}" stroke="#25B875" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }
  if (state === "working") {
    // open laptop held in front, seen from behind (lid towards the viewer)
    const [x, y] = [mid[0], mid[1]];
    return path(`M${f(x - 24 * bs)} ${f(y - 2)} L${f(x + 24 * bs)} ${f(y - 2)} L${f(x + 21 * bs)} ${f(y - 32 * bs)} L${f(x - 21 * bs)} ${f(y - 32 * bs)} Z`, "#CBD5E1")
      + path(`M${f(x - 24 * bs)} ${f(y - 2)} L${f(x + 24 * bs)} ${f(y - 2)} L${f(x + 26 * bs)} ${f(y + 2)} L${f(x - 26 * bs)} ${f(y + 2)} Z`, "#94A3B8")
      + `<circle cx="${f(x)}" cy="${f(y - 17 * bs)}" r="${f(3 * bs)}" fill="#F8FAFC"/>`;
  }
  if (state === "thinking" && stage >= 2) {
    // a folder or tablet held at the waist
    const h = hands.left;
    return rect(h[0] - 2, h[1] - 10 * bs, 9 * bs, 30 * bs, stage === 2 ? "#347FF1" : "#1E293B", 2);
  }
  if (state === "idle" && stage >= 2 && stage <= 3) {
    // laptop / tablet under the arm
    const h = hands.left;
    return rect(h[0] + 1, h[1] - 16 * bs, 7 * bs, 30 * bs, stage === 2 ? "#94A3B8" : "#1E293B", 2);
  }
  if (state === "idle" && stage === 1) {
    const h = hands.right;
    return rect(h[0] + 2, h[1] - 12 * bs, 6 * bs, 24 * bs, "#F59E0B", 1.5); // notebook
  }
  return "";
}

function extras(stage, m, state) {
  const [hx, hy] = m.H(100, 40);
  const star = (x, y, r, fill) => {
    const p = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2, rr = i % 2 === 0 ? r : r * 0.32;
      p.push(`${f(x + Math.cos(a) * rr)},${f(y + Math.sin(a) * rr)}`);
    }
    return `<polygon points="${p.join(" ")}" fill="${fill}"/>`;
  };
  if (state === "celebrating") return star(hx - 46, hy + 4, 7, "#25B875") + star(hx + 48, hy + 22, 5, "#347FF1") + star(hx - 36, hy + 44, 4, "#F59E0B");
  if (state === "happy") return star(hx + 44, hy + 2, 5, "#25B875");
  if (state === "thinking") {
    return `<circle cx="${f(hx + 30)}" cy="${f(hy - 2)}" r="2.2" fill="#94A3B8"/><circle cx="${f(hx + 37)}" cy="${f(hy - 9)}" r="3" fill="#94A3B8"/><circle cx="${f(hx + 46)}" cy="${f(hy - 17)}" r="4" fill="#CBD5E1"/>`;
  }
  if (state === "supportive") {
    return path(`M${f(hx - 44)} ${f(hy + 30)} c-2.4 -3 -7 -1.6 -6.4 2 c0.4 2.6 3.6 4.6 6.4 7 c2.8 -2.4 6 -4.4 6.4 -7 c0.6 -3.6 -4 -5 -6.4 -2 z`, "#F08A7E", ' opacity="0.8"');
  }
  if (state === "confident") return star(hx + 44, hy + 10, 4.5, "#347FF1");
  return "";
}

/* ------------------------------------------------------------------ assembly ------------------------------------------------------------------ */

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amount));
  return `#${[c(n >> 16), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function svg(stage, state) {
  const m = mapper(stage);
  const a = arms(stage, m, state);
  const behind = state === "idle" || state === "thinking" ? props(stage, m, state, a) : "";
  const front = state === "idle" || state === "thinking" ? "" : props(stage, m, state, a);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280" width="200" height="280">`,
    `<ellipse cx="100" cy="264" rx="${f(44 * m.bs)}" ry="5.5" fill="#0F172A" opacity="0.08"/>`,
    legs(stage, m, state),
    torso(stage, m),
    head(stage, m, state),
    behind,
    a.svg,
    front,
    extras(stage, m, state),
    `</svg>`,
  ].join("\n") + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const stage of STAGES) for (const state of STATES) writeFileSync(join(OUT, `stage-${stage}-${state}.svg`), svg(stage, state));
  console.log(`Wrote ${STAGES.length * STATES.length} illustrations to ${OUT}`);
}
