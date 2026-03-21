/**
 * Lattice — Perceptual Color System
 *
 * OKLCH/OKLAB color space engine for perceptually uniform gradients,
 * color harmony rules, palette extraction, and evolution-aware mutation.
 */

// ═══ OKLCH / OKLAB Color Space Conversions ═══

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2024326293 * g + 0.6892650189 * b;
  const l = Math.cbrt(l_), m = Math.cbrt(m_), s = Math.cbrt(s_);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  return [
    +4.0767416621 * l_ * l_ * l_ - 3.3077115913 * m_ * m_ * m_ + 0.2309699292 * s_ * s_ * s_,
    -1.2684380046 * l_ * l_ * l_ + 2.6097574011 * m_ * m_ * m_ - 0.3413193965 * s_ * s_ * s_,
    -0.0041960863 * l_ * l_ * l_ - 0.7034186147 * m_ * m_ * m_ + 1.7076147010 * s_ * s_ * s_,
  ];
}

export function oklchToOklab(L: number, C: number, H: number): [number, number, number] {
  const hRad = H * Math.PI / 180;
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)];
}

export function oklabToOklch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let H = Math.atan2(b, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export function hexToOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
}

export function hexToOklch(hex: string): [number, number, number] {
  const [L, a, b] = hexToOklab(hex);
  return oklabToOklch(L, a, b);
}

/** Convert OKLCH to hex, gamut-mapping by reducing chroma until in sRGB */
export function oklchToHex(L: number, C: number, H: number): string {
  let c = C;
  for (let i = 0; i < 25; i++) {
    const [lL, la, lb] = oklchToOklab(L, c, H);
    const [r, g, b] = oklabToLinearRgb(lL, la, lb);
    if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && b >= -0.001 && b <= 1.001) {
      const toHex = (v: number) => {
        const s = Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255).toString(16);
        return s.length === 1 ? "0" + s : s;
      };
      return "#" + toHex(r) + toHex(g) + toHex(b);
    }
    c *= 0.95;
  }
  const grey = Math.round(Math.max(0, Math.min(1, L)) * 255);
  const h = grey.toString(16).padStart(2, "0");
  return "#" + h + h + h;
}

// ═══ Delta E (Perceptual Distance) ═══

/** OKLAB Euclidean distance — correlates well with perceived color difference */
export function deltaE(hex1: string, hex2: string): number {
  const a = hexToOklab(hex1), b = hexToOklab(hex2);
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// ═══ Color Harmony Rules ═══

export type HarmonyMode = "mono" | "complementary" | "analogous" | "triadic" | "split" | "tetradic";

export interface HarmonyRule {
  label: string;
  offsets: number[];
  desc: string;
}

export const HARMONY_RULES: Record<HarmonyMode, HarmonyRule> = {
  mono:          { label: "Monochromatic",    offsets: [0],              desc: "Single hue, varied lightness" },
  complementary: { label: "Complementary",    offsets: [0, 180],         desc: "Opposite hues, maximum contrast" },
  analogous:     { label: "Analogous",        offsets: [-30, 0, 30],     desc: "Adjacent hues, gentle temperature shift" },
  triadic:       { label: "Triadic",          offsets: [0, 120, 240],    desc: "Three equidistant hues, vibrant balance" },
  split:         { label: "Split-Complementary", offsets: [0, 150, 210], desc: "Base + two near-complements" },
  tetradic:      { label: "Tetradic",         offsets: [0, 90, 180, 270], desc: "Four equidistant hues, complex palette" },
};

export const ALL_HARMONY_MODES: HarmonyMode[] = ["mono", "complementary", "analogous", "triadic", "split", "tetradic"];

export function getHarmonyHues(baseHue: number, mode: HarmonyMode): number[] {
  return HARMONY_RULES[mode].offsets.map(o => (baseHue + o + 360) % 360);
}

// ═══ Perceptually Uniform Gradient Generation ═══

export interface ColorTheme {
  hue: number;        // 0-360 base hue in OKLCH
  chroma: number;     // 0-0.4 saturation intensity
  harmony: HarmonyMode;
  lMin: number;       // 0-1 lightness floor
  lMax: number;       // 0-1 lightness ceiling
}

/** Generate a perceptually uniform color ramp in OKLCH space */
export function generateGradient(theme: ColorTheme, steps: number): string[] {
  const hues = getHarmonyHues(theme.hue, theme.harmony);
  const colors: string[] = [];

  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0.5 : i / (steps - 1);
    const L = theme.lMin + t * (theme.lMax - theme.lMin);
    // Chroma peaks at mid-lightness (parabolic envelope avoids washed-out extremes)
    const cScale = 1 - Math.pow(2 * t - 1, 2) * 0.4;
    // Distribute hues across the ramp via shortest-arc interpolation
    const hueIdx = t * (hues.length - 1);
    const hLow = hues[Math.floor(hueIdx)];
    const hHigh = hues[Math.min(Math.ceil(hueIdx), hues.length - 1)];
    const hFrac = hueIdx - Math.floor(hueIdx);
    let dh = hHigh - hLow;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    const h = (hLow + dh * hFrac + 360) % 360;

    colors.push(oklchToHex(L, theme.chroma * cScale, h));
  }
  return colors;
}

/** Generate default 8-step gradient from a ColorTheme */
export function themeToColors(theme: ColorTheme): string[] {
  return generateGradient(theme, 8);
}

// ═══ Species Color Theme Definitions (OKLCH-native) ═══

/** OKLCH-native theme definitions per species type */
export const SPECIES_THEMES: Record<string, ColorTheme> = {
  "1d":                  { hue: 270, chroma: 0.18, harmony: "mono",    lMin: 0.05, lMax: 1.0 },
  "2d":                  { hue: 145, chroma: 0.18, harmony: "mono",    lMin: 0.05, lMax: 0.95 },
  "lsystem":             { hue: 35,  chroma: 0.16, harmony: "mono",    lMin: 0.05, lMax: 0.95 },
  "reaction-diffusion":  { hue: 300, chroma: 0.19, harmony: "mono",    lMin: 0.05, lMax: 0.95 },
  "voronoi":             { hue: 200, chroma: 0.16, harmony: "mono",    lMin: 0.05, lMax: 0.92 },
  "wfc":                 { hue: 340, chroma: 0.18, harmony: "mono",    lMin: 0.05, lMax: 0.93 },
  "spirograph":          { hue: 90,  chroma: 0.17, harmony: "mono",    lMin: 0.05, lMax: 0.95 },
  "attractor":           { hue: 20,  chroma: 0.14, harmony: "mono",    lMin: 0.05, lMax: 0.92 },
  "julia":               { hue: 170, chroma: 0.16, harmony: "mono",    lMin: 0.05, lMax: 0.92 },
  "noise":               { hue: 65,  chroma: 0.15, harmony: "mono",    lMin: 0.05, lMax: 0.95 },
  "flowfield":           { hue: 185, chroma: 0.14, harmony: "mono",    lMin: 0.05, lMax: 0.92 },
  "magnetic-pendulum":   { hue: 310, chroma: 0.16, harmony: "mono",    lMin: 0.05, lMax: 0.92 },
  "particle-life":       { hue: 145, chroma: 0.18, harmony: "triadic",  lMin: 0.05, lMax: 0.93 },
  "flame":               { hue: 10,  chroma: 0.20, harmony: "analogous", lMin: 0.05, lMax: 0.95 },
};

/** Get the 8-step color array for a species type (drop-in replacement for hardcoded TYPE_COLORS) */
export function getSpeciesColors(type: string): string[] {
  const theme = SPECIES_THEMES[type] || SPECIES_THEMES["2d"];
  return themeToColors(theme);
}

// ═══ Palette Uniformity Scoring ═══

export interface PaletteAnalysis {
  deltaEs: number[];       // perceptual distance between adjacent steps
  avgDeltaE: number;
  variance: number;
  uniformityScore: number; // 0-100, higher = more perceptually uniform
  contrastRatio: number;   // lightness range ratio (WCAG-related)
}

/** Analyze the perceptual uniformity of a color ramp */
export function analyzePalette(colors: string[]): PaletteAnalysis {
  if (colors.length < 2) {
    return { deltaEs: [], avgDeltaE: 0, variance: 0, uniformityScore: 100, contrastRatio: 1 };
  }

  const deltaEs: number[] = [];
  for (let i = 0; i < colors.length - 1; i++) {
    deltaEs.push(deltaE(colors[i], colors[i + 1]));
  }

  const avgDeltaE = deltaEs.reduce((a, b) => a + b, 0) / deltaEs.length;
  const variance = deltaEs.reduce((a, d) => a + (d - avgDeltaE) ** 2, 0) / deltaEs.length;
  const uniformityScore = avgDeltaE > 0 ? Math.max(0, 100 - Math.sqrt(variance) / avgDeltaE * 100) : 0;

  // Contrast: ratio between darkest and lightest luminance
  const lums = colors.map(c => hexToOklab(c)[0]);
  const minL = Math.min(...lums);
  const maxL = Math.max(...lums);
  const contrastRatio = maxL > 0 ? (maxL + 0.05) / (minL + 0.05) : 1;

  return { deltaEs, avgDeltaE, variance, uniformityScore, contrastRatio };
}

// ═══ K-Means Palette Extraction (OKLAB space) ═══

/** Extract dominant colors from a rendered piece using k-means clustering in OKLAB */
export function extractPaletteFromRendered(
  rendered: string,
  typeColors: string[],
  k: number = 6,
): string[] {
  // Map characters to colors via intensity, then cluster those colors
  const pixels: [number, number, number][] = [];
  const lines = rendered.split("\n");

  for (const line of lines) {
    for (const ch of line) {
      const intensity = charIntensity(ch);
      if (intensity === 0) continue;
      const colorIdx = Math.min(intensity, typeColors.length - 1);
      pixels.push(hexToOklab(typeColors[colorIdx]));
    }
  }

  if (pixels.length < k) return typeColors.slice(0, k);
  return kMeansOklab(pixels, k);
}

function charIntensity(ch: string): number {
  if (ch === " ") return 0;
  const light = "\u00B7.:~\u2801";
  const med1 = "\u2591\u2022\u2248\u2803\u25B3\u25BD\u2726";
  const med2 = "\u2592\u25CB\u223F\u2807\u25C7\u2727\u2766";
  const med3 = "\u2593\u25CF\u224B\u280F\u25C8\u2605\u273F";
  const heavy = "\u2588\u25C6\u2307\u281F\u2B21\u2736\u2740\u2741";
  const max = "\u2573\u25D0\u25D1\u25D2\u25D3\u2301\u283F\u28FF\u2B22\u2739\u273A";
  if (light.includes(ch)) return 1;
  if (med1.includes(ch)) return 2;
  if (med2.includes(ch)) return 3;
  if (med3.includes(ch)) return 4;
  if (heavy.includes(ch)) return 5;
  if (max.includes(ch)) return 6;
  return 3;
}

/** K-means clustering in OKLAB space with k-means++ initialization */
function kMeansOklab(pixels: [number, number, number][], k: number): string[] {
  // k-means++ initialization
  const centroids: [number, number, number][] = [pixels[Math.floor(Math.random() * pixels.length)]];
  for (let c = 1; c < k; c++) {
    const dists = pixels.map(p => {
      let minD = Infinity;
      for (const ct of centroids) {
        const d = (p[0] - ct[0]) ** 2 + (p[1] - ct[1]) ** 2 + (p[2] - ct[2]) ** 2;
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total, acc = 0;
    for (let i = 0; i < dists.length; i++) {
      acc += dists[i];
      if (acc >= r) { centroids.push([...pixels[i]]); break; }
    }
  }

  // 15 iterations of Lloyd's algorithm
  for (let iter = 0; iter < 15; iter++) {
    const clusters: [number, number, number][][] = Array.from({ length: k }, () => []);
    for (const p of pixels) {
      let minD = Infinity, minC = 0;
      for (let c = 0; c < k; c++) {
        const d = (p[0] - centroids[c][0]) ** 2 + (p[1] - centroids[c][1]) ** 2 + (p[2] - centroids[c][2]) ** 2;
        if (d < minD) { minD = d; minC = c; }
      }
      clusters[minC].push(p);
    }
    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) continue;
      const n = clusters[c].length;
      centroids[c] = [
        clusters[c].reduce((a, p) => a + p[0], 0) / n,
        clusters[c].reduce((a, p) => a + p[1], 0) / n,
        clusters[c].reduce((a, p) => a + p[2], 0) / n,
      ];
    }
  }

  // Sort by lightness (dark to light) and convert to hex
  return centroids
    .map(ct => {
      const [L, C, H] = oklabToOklch(ct[0], ct[1], ct[2]);
      return oklchToHex(L, C, H);
    })
    .sort((a, b) => hexToOklab(a)[0] - hexToOklab(b)[0]);
}

// ═══ Evolution-Aware Palette Mutation ═══

/** Mutate a ColorTheme in OKLCH space (small perceptual shifts) */
export function mutateColorTheme(theme: ColorTheme, rng: () => number, intensity: number = 1.0): ColorTheme {
  const mutated = { ...theme };

  // Hue shift (70% chance): ±5-30 degrees
  if (rng() < 0.7) {
    const shift = (rng() - 0.5) * 60 * intensity;
    mutated.hue = (mutated.hue + shift + 360) % 360;
  }

  // Chroma shift (40% chance): ±0.02-0.06
  if (rng() < 0.4) {
    const shift = (rng() - 0.5) * 0.12 * intensity;
    mutated.chroma = Math.max(0.04, Math.min(0.3, mutated.chroma + shift));
  }

  // Harmony mode swap (15% chance)
  if (rng() < 0.15) {
    mutated.harmony = ALL_HARMONY_MODES[Math.floor(rng() * ALL_HARMONY_MODES.length)];
  }

  // Lightness range shift (25% chance)
  if (rng() < 0.25) {
    const shift = (rng() - 0.5) * 0.15 * intensity;
    mutated.lMin = Math.max(0.02, Math.min(0.3, mutated.lMin + shift));
    mutated.lMax = Math.max(0.6, Math.min(1.0, mutated.lMax + shift * 0.5));
  }

  return mutated;
}

/** Crossover two ColorThemes */
export function crossoverColorThemes(a: ColorTheme, b: ColorTheme, rng: () => number): ColorTheme {
  // Interpolate hues via shortest arc
  let dh = b.hue - a.hue;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const t = rng();

  return {
    hue: (a.hue + dh * t + 360) % 360,
    chroma: a.chroma + (b.chroma - a.chroma) * t,
    harmony: rng() > 0.5 ? a.harmony : b.harmony,
    lMin: a.lMin + (b.lMin - a.lMin) * t,
    lMax: a.lMax + (b.lMax - a.lMax) * t,
  };
}

/** Generate a random ColorTheme */
export function randomColorTheme(rng: () => number): ColorTheme {
  return {
    hue: rng() * 360,
    chroma: 0.08 + rng() * 0.15,
    harmony: ALL_HARMONY_MODES[Math.floor(rng() * ALL_HARMONY_MODES.length)],
    lMin: 0.05 + rng() * 0.1,
    lMax: 0.8 + rng() * 0.2,
  };
}

// ═══ Color Blindness Simulation ═══

export type ColorBlindnessType = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

/** Simulate color blindness on a hex color (Brettel/Viénot matrices) */
export function simulateColorBlindness(hex: string, type: ColorBlindnessType): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);

  let sr: number, sg: number, sb: number;

  switch (type) {
    case "protanopia":
      sr = 0.152286 * lr + 1.052583 * lg - 0.204868 * lb;
      sg = 0.114503 * lr + 0.786281 * lg + 0.099216 * lb;
      sb = -0.003882 * lr - 0.048116 * lg + 1.051998 * lb;
      break;
    case "deuteranopia":
      sr = 0.367322 * lr + 0.860646 * lg - 0.227968 * lb;
      sg = 0.280085 * lr + 0.672501 * lg + 0.047413 * lb;
      sb = -0.011820 * lr + 0.042940 * lg + 0.968881 * lb;
      break;
    case "tritanopia":
      sr = 1.255528 * lr - 0.076749 * lg - 0.178779 * lb;
      sg = -0.078411 * lr + 0.930809 * lg + 0.147602 * lb;
      sb = 0.004733 * lr + 0.691367 * lg + 0.303900 * lb;
      break;
    case "achromatopsia":
      const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      sr = sg = sb = lum;
      break;
  }

  const toHex = (v: number) => {
    const s = Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255).toString(16);
    return s.length === 1 ? "0" + s : s;
  };
  return "#" + toHex(sr!) + toHex(sg!) + toHex(sb!);
}

// ═══ Gamut Boundary ═══

/** Find the maximum in-gamut chroma at a given lightness and hue (binary search) */
export function gamutMaxChroma(L: number, h: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const [lL, la, lb] = oklchToOklab(L, mid, h);
    const [r, g, b] = oklabToLinearRgb(lL, la, lb);
    if (r >= -0.001 && r <= 1.001 && g >= -0.001 && g <= 1.001 && b >= -0.001 && b <= 1.001) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Generate a cusp-following gradient that maximizes chroma at each lightness level */
export function cuspGradient(hue: number, steps: number = 8, chromaScale: number = 0.85): string[] {
  return Array.from({ length: steps }, (_, i) => {
    const L = 0.08 + (i / (steps - 1)) * 0.87;
    const maxC = gamutMaxChroma(L, hue);
    const [lL, la, lb] = oklchToOklab(L, maxC * chromaScale, hue);
    return oklchToHex(lL, la, lb);
  });
}

// ═══ WCAG Contrast Ratio ═══

/** Calculate WCAG 2.1 contrast ratio between two colors */
export function contrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  };
  const l1 = lum(hex1), l2 = lum(hex2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ═══ Palette Blending ═══

/** Blend two color ramps in OKLAB space */
export function blendPalettes(a: string[], b: string[], t: number): string[] {
  const len = Math.max(a.length, b.length);
  const result: string[] = [];

  for (let i = 0; i < len; i++) {
    const aIdx = Math.floor(i / len * a.length);
    const bIdx = Math.floor(i / len * b.length);
    const aLab = hexToOklab(a[Math.min(aIdx, a.length - 1)]);
    const bLab = hexToOklab(b[Math.min(bIdx, b.length - 1)]);

    const L = aLab[0] + (bLab[0] - aLab[0]) * t;
    const la = aLab[1] + (bLab[1] - aLab[1]) * t;
    const lb = aLab[2] + (bLab[2] - aLab[2]) * t;
    const [lL, lC, lH] = oklabToOklch(L, la, lb);
    result.push(oklchToHex(lL, lC, lH));
  }
  return result;
}

// ═══ Color Temperature ═══

/** Estimate perceptual color temperature: -1 (cool) to +1 (warm) */
export function colorTemperature(hex: string): number {
  const [, , h] = hexToOklch(hex);
  // Warm hues: ~0-90 (red/orange/yellow) and ~300-360 (magenta/red)
  // Cool hues: ~150-270 (green/cyan/blue)
  const warmZones = [
    { center: 30, width: 60, weight: 1.0 },   // orange/red
    { center: 60, width: 40, weight: 0.7 },   // yellow
    { center: 330, width: 50, weight: 0.6 },  // magenta
  ];
  const coolZones = [
    { center: 210, width: 60, weight: 1.0 },  // blue
    { center: 170, width: 40, weight: 0.8 },  // cyan
    { center: 270, width: 40, weight: 0.5 },  // violet
  ];

  let temp = 0;
  for (const z of warmZones) {
    let dh = Math.abs(h - z.center);
    if (dh > 180) dh = 360 - dh;
    temp += Math.max(0, 1 - dh / z.width) * z.weight;
  }
  for (const z of coolZones) {
    let dh = Math.abs(h - z.center);
    if (dh > 180) dh = 360 - dh;
    temp -= Math.max(0, 1 - dh / z.width) * z.weight;
  }
  return Math.max(-1, Math.min(1, temp));
}

/** Average temperature of a palette */
export function paletteTemperature(colors: string[]): number {
  if (colors.length === 0) return 0;
  const chromatic = colors.filter(c => {
    const [, C] = hexToOklch(c);
    return C > 0.02; // skip near-neutral colors
  });
  if (chromatic.length === 0) return 0;
  return chromatic.reduce((s, c) => s + colorTemperature(c), 0) / chromatic.length;
}

// ═══ Aesthetic Palette Scoring ═══

export interface AestheticScore {
  uniformity: number;     // 0-1 perceptual step evenness
  contrast: number;       // 0-1 lightness range coverage
  chromaRichness: number; // 0-1 saturation variety
  hueSpread: number;      // 0-1 hue diversity
  overall: number;        // 0-1 weighted composite
}

/** Rate the aesthetic quality of a color palette */
export function scorePaletteAesthetics(colors: string[]): AestheticScore {
  if (colors.length < 2) return { uniformity: 0, contrast: 0, chromaRichness: 0, hueSpread: 0, overall: 0 };

  const analysis = analyzePalette(colors);
  const uniformity = analysis.uniformityScore / 100;

  // Contrast: how much of the 0-1 lightness range is used
  const lums = colors.map(c => hexToOklab(c)[0]);
  const contrast = Math.min(1, (Math.max(...lums) - Math.min(...lums)) / 0.8);

  // Chroma richness: variance in saturation levels
  const chromas = colors.map(c => hexToOklch(c)[1]);
  const avgC = chromas.reduce((a, b) => a + b, 0) / chromas.length;
  const chromaVar = chromas.reduce((a, c) => a + Math.abs(c - avgC), 0) / chromas.length;
  const chromaRichness = Math.min(1, avgC / 0.15 * 0.6 + chromaVar / 0.05 * 0.4);

  // Hue spread: angular coverage of the hue wheel
  const hues = colors.filter(c => hexToOklch(c)[1] > 0.02).map(c => hexToOklch(c)[2]);
  let hueSpread = 0;
  if (hues.length >= 2) {
    const sorted = [...hues].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    maxGap = Math.max(maxGap, 360 - sorted[sorted.length - 1] + sorted[0]);
    hueSpread = Math.min(1, (360 - maxGap) / 180);
  }

  const overall = uniformity * 0.3 + contrast * 0.3 + chromaRichness * 0.25 + hueSpread * 0.15;
  return { uniformity, contrast, chromaRichness, hueSpread, overall };
}

// ═══ Grid-Based Palette Extraction ═══

/** Extract dominant colors from a numeric grid using intensity distribution + species theme */
export function extractPaletteFromGrid(
  grid: number[][],
  speciesType: string,
  k: number = 6,
): string[] {
  if (!grid.length || !grid[0]?.length) {
    return getSpeciesColors(speciesType).slice(0, k);
  }

  const colors = getSpeciesColors(speciesType);
  const maxVal = Math.max(1, ...grid.flat());

  // Sample grid cells as OKLAB pixels based on their intensity
  const pixels: [number, number, number][] = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell === 0) continue;
      const intensity = cell / maxVal;
      const idx = Math.round(intensity * (colors.length - 1));
      pixels.push(hexToOklab(colors[Math.min(idx, colors.length - 1)]));
    }
  }

  if (pixels.length < k) return colors.slice(0, k);
  return kMeansOklab(pixels, k);
}

/** Infer a ColorTheme from a rendered piece's character distribution */
export function inferThemeFromRendered(rendered: string, speciesType: string): ColorTheme {
  const base = SPECIES_THEMES[speciesType] || SPECIES_THEMES["2d"];
  const colors = getSpeciesColors(speciesType);
  const extracted = extractPaletteFromRendered(rendered, colors, 4);

  // Analyze extracted colors to refine the theme
  const oklchValues = extracted.map(c => hexToOklch(c));
  const avgHue = oklchValues.reduce((s, v) => s + v[2], 0) / oklchValues.length;
  const avgChroma = oklchValues.reduce((s, v) => s + v[1], 0) / oklchValues.length;
  const lValues = oklchValues.map(v => v[0]);

  return {
    hue: avgHue || base.hue,
    chroma: avgChroma || base.chroma,
    harmony: base.harmony,
    lMin: Math.min(...lValues, base.lMin),
    lMax: Math.max(...lValues, base.lMax),
  };
}

// ═══ Naive RGB Gradient (for comparison) ═══

/** Generate a naive linear RGB gradient (to contrast with OKLCH) */
export function naiveRgbGradient(hex1: string, hex2: string, steps: number): string[] {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 0.5 : i / (steps - 1);
    const r = Math.round((r1 + (r2 - r1) * t) * 255);
    const g = Math.round((g1 + (g2 - g1) * t) * 255);
    const b = Math.round((b1 + (b2 - b1) * t) * 255);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  });
}

/** OKLCH interpolation gradient between two hex colors */
export function oklchGradient(hex1: string, hex2: string, steps: number): string[] {
  const [L1, C1, h1] = hexToOklch(hex1);
  const [L2, C2, h2] = hexToOklch(hex2);
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return Array.from({ length: steps }, (_, i) => {
    const t = steps === 1 ? 0.5 : i / (steps - 1);
    return oklchToHex(
      L1 + (L2 - L1) * t,
      C1 + (C2 - C1) * t,
      (h1 + dh * t + 360) % 360,
    );
  });
}

// ═══ Palette Fingerprinting & Similarity ═══

/** Compact fingerprint of a palette for fast similarity comparison */
export interface PaletteFingerprint {
  avgL: number;
  avgC: number;
  avgH: number;       // circular mean hue
  lRange: number;     // lightness range
  cRange: number;     // chroma range
  hSpread: number;    // hue angular spread
  temperature: number; // -1 cool to +1 warm
  stepCount: number;
}

/** Compute a compact fingerprint from a palette */
export function fingerprintPalette(colors: string[]): PaletteFingerprint {
  if (colors.length === 0) {
    return { avgL: 0, avgC: 0, avgH: 0, lRange: 0, cRange: 0, hSpread: 0, temperature: 0, stepCount: 0 };
  }

  const oklch = colors.map(c => hexToOklch(c));
  const ls = oklch.map(v => v[0]);
  const cs = oklch.map(v => v[1]);

  // Circular mean for hue
  const sinSum = oklch.reduce((s, v) => s + Math.sin(v[2] * Math.PI / 180), 0);
  const cosSum = oklch.reduce((s, v) => s + Math.cos(v[2] * Math.PI / 180), 0);
  const avgH = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;

  // Hue spread (max gap method)
  const chromatic = oklch.filter(v => v[1] > 0.02);
  let hSpread = 0;
  if (chromatic.length >= 2) {
    const sorted = chromatic.map(v => v[2]).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
    maxGap = Math.max(maxGap, 360 - sorted[sorted.length - 1] + sorted[0]);
    hSpread = (360 - maxGap) / 360;
  }

  return {
    avgL: ls.reduce((a, b) => a + b, 0) / ls.length,
    avgC: cs.reduce((a, b) => a + b, 0) / cs.length,
    avgH,
    lRange: Math.max(...ls) - Math.min(...ls),
    cRange: Math.max(...cs) - Math.min(...cs),
    hSpread,
    temperature: paletteTemperature(colors),
    stepCount: colors.length,
  };
}

/** Measure similarity between two palettes (0 = identical, higher = more different) */
export function paletteSimilarity(a: string[], b: string[]): number {
  const fa = fingerprintPalette(a);
  const fb = fingerprintPalette(b);

  // Hue distance on circle
  let dh = Math.abs(fa.avgH - fb.avgH);
  if (dh > 180) dh = 360 - dh;

  return Math.sqrt(
    (fa.avgL - fb.avgL) ** 2 * 4 +       // lightness matters most
    (fa.avgC - fb.avgC) ** 2 * 9 +        // chroma differences are perceptually strong
    (dh / 180) ** 2 * 2 +                  // hue normalized to 0-1 range
    (fa.lRange - fb.lRange) ** 2 +
    (fa.temperature - fb.temperature) ** 2
  );
}

/** Cluster palettes by similarity using simple agglomerative clustering */
export function clusterPalettes(
  palettes: { id: string; colors: string[] }[],
  maxClusters: number = 6,
): { centroid: string[]; members: { id: string; colors: string[] }[] }[] {
  if (palettes.length <= maxClusters) {
    return palettes.map(p => ({ centroid: p.colors, members: [p] }));
  }

  // Start with each palette as its own cluster
  let clusters: { members: { id: string; colors: string[] }[] }[] =
    palettes.map(p => ({ members: [p] }));

  // Merge closest clusters until we reach target count
  while (clusters.length > maxClusters) {
    let minDist = Infinity;
    let mergeI = 0, mergeJ = 1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = paletteSimilarity(
          clusters[i].members[0].colors,
          clusters[j].members[0].colors
        );
        if (d < minDist) { minDist = d; mergeI = i; mergeJ = j; }
      }
    }

    clusters[mergeI].members.push(...clusters[mergeJ].members);
    clusters.splice(mergeJ, 1);
  }

  return clusters.map(c => ({
    centroid: c.members[0].colors,
    members: c.members,
  }));
}

// ═══ Palette-Fitness Correlation ═══

/** Compute how well a palette's aesthetic properties predict fitness */
export function paletteContribution(aestheticScore: AestheticScore, pieceScore: number): number {
  // Correlation between palette aesthetics and overall piece fitness
  // Returns -1 to 1: positive means good palette = good piece
  return (aestheticScore.overall - 0.5) * (pieceScore - 0.5) * 4;
}
