import { tool } from "@opencode-ai/plugin";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const oklchToHex = tool({
  description: "Convert a oklch color to hex format",
  args: {
    l: tool.schema.number().describe("The l axis of a oklch color"),
    c: tool.schema.number().describe("The c axis of a oklch color"),
    h: tool.schema.number().describe("The h axis of a oklch color"),
  },
  async execute(args) {
    const { l, c, h } = args;
    // 1. OKLCH → OKLab
    const hRad = (h * Math.PI) / 180;
    const a = c * Math.cos(hRad);
    const b = c * Math.sin(hRad);

    // 2. OKLab → LMS' (inverse M2)
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;

    // 3. Cube (inverse cube root)
    const lms_l = l_ * l_ * l_;
    const lms_m = m_ * m_ * m_;
    const lms_s = s_ * s_ * s_;

    // 4. LMS → Linear RGB (inverse M1)
    const r =
      +4.0767416621 * lms_l - 3.3077115913 * lms_m + 0.2309699292 * lms_s;
    const g =
      -1.2684380046 * lms_l + 2.6097574011 * lms_m - 0.3413193965 * lms_s;
    const bLin =
      -0.0041960863 * lms_l - 0.7034186147 * lms_m + 1.707614701 * lms_s;

    // 5. Linear RGB → sRGB → Hex
    const toHex = (c: number) =>
      Math.round(clamp(linearToSrgb(c)) * 255)
        .toString(16)
        .padStart(2, "0");

    return `#${toHex(r)}${toHex(g)}${toHex(bLin)}`;
  },
});

export const hexToOklch = tool({
  description: "Convert a hex color to oklch format",
  args: {
    hex: tool.schema
      .string()
      .describe("The hex color string (e.g. #ff0000 or ff0000)"),
  },
  async execute(args) {
    const hex = args.hex.replace(/^#/, "");
    const r = srgbToLinear(parseInt(hex.slice(0, 2), 16) / 255);
    const g = srgbToLinear(parseInt(hex.slice(2, 4), 16) / 255);
    const b = srgbToLinear(parseInt(hex.slice(4, 6), 16) / 255);

    // 1. Linear RGB → LMS
    const lms_l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const lms_m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const lms_s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    // 2. LMS → LMS' (cube root)
    const l_ = Math.cbrt(lms_l);
    const m_ = Math.cbrt(lms_m);
    const s_ = Math.cbrt(lms_s);

    // 3. LMS' → OKLab (M2)
    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

    // 4. OKLab → OKLCH
    const C = Math.sqrt(a * a + bLab * bLab);
    const H = (Math.atan2(bLab, a) * 180) / Math.PI;
    const hNormalized = H < 0 ? H + 360 : H;

    return {
      l: Math.round(L * 10000) / 10000,
      c: Math.round(C * 10000) / 10000,
      h: Math.round(hNormalized * 100) / 100,
      css: `oklch(${(Math.round(L * 10000) / 10000)} ${(Math.round(C * 10000) / 10000)} ${Math.round(hNormalized * 100) / 100})`,
    };
  },
});
