import type { SVGProps } from "react";

export type Piece =
  "skillet" | "oven" | "saucepan" | "knife" | "board" | "scale" | "jar" | "generic";
export type PieceTone = "forest" | "ivory" | "copper" | "charcoal";

/** Which drawn piece stands in for a product, judged from its name (never a claim about the product). */
export function pieceFor(text: string): Piece {
  const t = text.toLowerCase();
  if (/dutch|oven|casserole|braiser|stock ?pot|cookware/.test(t)) return "oven";
  if (/sauce ?pan|saucepan|pot\b/.test(t)) return "saucepan";
  if (/skillet|frying|fry pan|griddle|\bpan\b/.test(t)) return "skillet";
  if (/knife|knives|cleaver|santoku|blade|cutlery/.test(t)) return "knife";
  if (/board|block|chopping|utensil|spatula|tools?\b/.test(t)) return "board";
  if (/scale|weigh|appliance/.test(t)) return "scale";
  if (/storage|container|jar|glass/.test(t)) return "jar";
  return "generic";
}

const TONES: Record<PieceTone, { body: string; inner: string; accent: string }> = {
  forest: { body: "#243b30", inner: "#2f4a3c", accent: "#b87953" },
  ivory: { body: "#f7f4ed", inner: "#e3dccb", accent: "#b87953" },
  copper: { body: "#b87953", inner: "#c98e68", accent: "#243b30" },
  charcoal: { body: "#242622", inner: "#343630", accent: "#b87953" },
};

type Props = Omit<SVGProps<SVGSVGElement>, "children"> & { piece: Piece; tone?: PieceTone };

/**
 * Flat drawings of kitchenware in the brand palette. They stand in where a real photograph
 * is missing and are always decorative: the surrounding element carries the accessible name.
 */
export function PieceArt({ piece, tone = "forest", ...props }: Props) {
  const c = TONES[tone];
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" {...props}>
      {piece === "skillet" ? (
        <g>
          <rect x="146" y="95" width="50" height="17" rx="8.5" fill={c.body} />
          <circle cx="187" cy="103.5" r="3.5" fill={c.inner} />
          <circle cx="86" cy="104" r="70" fill={c.body} />
          <circle cx="86" cy="104" r="56" fill={c.inner} />
          <circle
            cx="86"
            cy="104"
            r="56"
            fill="none"
            stroke={c.accent}
            strokeWidth="2"
            strokeDasharray="1 7"
            strokeLinecap="round"
            opacity="0.7"
          />
        </g>
      ) : null}
      {piece === "oven" ? (
        <g>
          <rect x="12" y="98" width="26" height="14" rx="7" fill={c.body} />
          <rect x="162" y="98" width="26" height="14" rx="7" fill={c.body} />
          <rect x="30" y="88" width="140" height="78" rx="26" fill={c.body} />
          <path d="M26 92 Q100 22 174 92Z" fill={c.inner} />
          <circle cx="100" cy="46" r="10" fill={c.accent} />
          <rect x="52" y="118" width="96" height="6" rx="3" fill={c.accent} opacity="0.55" />
        </g>
      ) : null}
      {piece === "saucepan" ? (
        <g>
          <rect x="124" y="82" width="70" height="14" rx="7" fill={c.body} />
          <circle cx="187" cy="89" r="3.5" fill={c.inner} />
          <rect x="22" y="64" width="108" height="86" rx="12" fill={c.body} />
          <rect x="30" y="72" width="92" height="13" rx="6.5" fill={c.inner} />
          <rect x="22" y="112" width="108" height="5" fill={c.accent} opacity="0.7" />
        </g>
      ) : null}
      {piece === "knife" ? (
        <g>
          <path
            d="M16 126 C58 100 118 90 168 90 L168 108 C118 112 64 128 16 130 Z"
            fill={c.inner}
          />
          <path
            d="M16 126 C58 100 118 90 168 90 L168 96 C118 98 64 112 16 126 Z"
            fill={c.body}
            opacity="0.35"
          />
          <rect x="164" y="88" width="34" height="22" rx="8" fill={c.body} />
          <circle cx="174" cy="99" r="2.6" fill={c.accent} />
          <circle cx="186" cy="99" r="2.6" fill={c.accent} />
        </g>
      ) : null}
      {piece === "board" ? (
        <g>
          <rect x="18" y="52" width="164" height="98" rx="16" fill={c.body} />
          <rect x="30" y="64" width="140" height="74" rx="9" fill={c.inner} />
          <circle cx="160" cy="76" r="6" fill={c.body} />
          <path
            d="M44 82h86M44 100h100M44 118h72"
            stroke={c.accent}
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.6"
          />
        </g>
      ) : null}
      {piece === "scale" ? (
        <g>
          <rect x="22" y="112" width="156" height="38" rx="12" fill={c.body} />
          <rect x="44" y="76" width="112" height="34" rx="10" fill={c.inner} />
          <rect x="74" y="124" width="52" height="14" rx="5" fill={c.accent} />
          <circle cx="42" cy="131" r="3" fill={c.inner} />
        </g>
      ) : null}
      {piece === "jar" ? (
        <g>
          <rect x="52" y="34" width="96" height="22" rx="8" fill={c.accent} />
          <rect x="44" y="52" width="112" height="116" rx="22" fill={c.body} />
          <rect x="56" y="76" width="88" height="80" rx="12" fill={c.inner} />
          <rect x="68" y="96" width="64" height="5" rx="2.5" fill={c.accent} opacity="0.6" />
          <rect x="68" y="112" width="44" height="5" rx="2.5" fill={c.accent} opacity="0.6" />
        </g>
      ) : null}
      {piece === "generic" ? (
        <g>
          <circle cx="86" cy="104" r="64" fill={c.body} />
          <circle cx="86" cy="104" r="46" fill={c.inner} />
          <rect x="146" y="97" width="46" height="14" rx="7" fill={c.body} />
        </g>
      ) : null}
    </svg>
  );
}
