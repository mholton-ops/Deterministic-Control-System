import type { ReactNode } from "react";

interface EvidencePreviewProps {
  readonly artifactId: string;
  readonly evidenceType: string;
  readonly uri: string;
  readonly capturedAt?: string | null;
  readonly gpsLat?: string | null;
  readonly gpsLon?: string | null;
  readonly gpsAccuracyM?: string | null;
  readonly capturedBy?: string | null;
  readonly size?: "sm" | "md";
}

const SIZE_CLASS = {
  sm: {
    shell: "min-w-[92px]",
    frame: "h-14",
    meta: "text-[9px]",
  },
  md: {
    shell: "min-w-[132px]",
    frame: "h-20",
    meta: "text-[10px]",
  },
} as const;

const EVIDENCE_DISPLAY_ORDER: Record<string, number> = {
  gps: 0,
  image: 1,
  video: 2,
  document: 3,
  note: 4,
};

function evidenceDisplayOrder(type: string): number {
  return EVIDENCE_DISPLAY_ORDER[type] ?? 99;
}

export function orderedEvidenceTypes(types: readonly string[]): string[] {
  return [...types].sort((left, right) => {
    const orderDelta = evidenceDisplayOrder(left) - evidenceDisplayOrder(right);
    return orderDelta === 0 ? left.localeCompare(right) : orderDelta;
  });
}

export function orderedEvidenceArtifacts<T extends { readonly evidenceType: string }>(artifacts: readonly T[]): T[] {
  return [...artifacts].sort((left, right) => {
    const orderDelta = evidenceDisplayOrder(left.evidenceType) - evidenceDisplayOrder(right.evidenceType);
    return orderDelta === 0 ? left.evidenceType.localeCompare(right.evidenceType) : orderDelta;
  });
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

function proofRoleLabel(type: string): string {
  if (type === "image") return "ORIGIN";
  if (type === "gps") return "GPS";
  if (type === "video") return "VIDEO";
  if (type === "document") return "DOC";
  if (type === "note") return "NOTE";
  return type.toUpperCase();
}

function compactEvidenceRef(uri: string, artifactId: string): string {
  const shortId = artifactId.slice(0, 8);
  if (uri.startsWith("placeholder://")) {
    const type = uri.slice("placeholder://".length).split("/")[0] || "artifact";
    return `generated://${type}/${shortId}`;
  }
  if (uri.length <= 28) return uri;
  return `${uri.slice(0, 15)}...${uri.slice(-8)}`;
}

function formatCoordinate(value: string | null | undefined): string {
  if (!value) return "--";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return numeric.toFixed(4);
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toISOString().slice(11, 16);
}

function FrameChrome(props: {
  readonly label: string;
  readonly time: string;
  readonly children: ReactNode;
}) {
  return (
    <svg className="block h-full w-full" viewBox="0 0 160 96" role="img" aria-label={`${props.label} evidence preview`}>
      {props.children}
      <rect x="4" y="4" width="152" height="88" rx="5" fill="none" stroke="rgba(233, 237, 242, 0.24)" />
      <rect x="8" y="8" width="42" height="12" rx="2" fill="rgba(3, 7, 11, 0.62)" />
      <text x="12" y="17" fill="#e9edf2" fontFamily="Consolas, monospace" fontSize="7">
        {props.label}
      </text>
      <rect x="116" y="76" width="34" height="11" rx="2" fill="rgba(3, 7, 11, 0.58)" />
      <text x="122" y="84" fill="#e9edf2" fontFamily="Consolas, monospace" fontSize="7">
        {props.time}
      </text>
    </svg>
  );
}

function OriginPhotoPreview(props: {
  readonly seed: number;
  readonly label: string;
  readonly time: string;
}) {
  const random = createRandom(props.seed);
  const sky = pick(["#43515c", "#394a43", "#51483f"], random);
  const ground = pick(["#3b3f3b", "#4a443b", "#333b42"], random);
  const converter = pick(["#a79474", "#988b80", "#b09a79"], random);
  const stainX = 20 + random() * 80;
  const canisterX = 44 + random() * 20;
  const canisterY = 47 + random() * 12;
  const rotation = -8 + random() * 16;

  return (
    <FrameChrome label={props.label} time={props.time}>
      <defs>
        <linearGradient id={`origin-bg-${props.seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={sky} />
          <stop offset="46%" stopColor="#232c2e" />
          <stop offset="100%" stopColor={ground} />
        </linearGradient>
        <radialGradient id={`origin-light-${props.seed}`} cx="0.22" cy="0.2" r="0.8">
          <stop offset="0%" stopColor="rgba(244, 229, 188, 0.35)" />
          <stop offset="100%" stopColor="rgba(244, 229, 188, 0)" />
        </radialGradient>
        <filter id={`origin-noise-${props.seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={props.seed % 997} />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.09" />
          </feComponentTransfer>
        </filter>
      </defs>
      <rect width="160" height="96" fill={`url(#origin-bg-${props.seed})`} />
      <rect width="160" height="96" fill={`url(#origin-light-${props.seed})`} />
      <path d={`M${stainX} 77 C${stainX + 18} 69 ${stainX + 44} 72 ${stainX + 62} 84`} fill="none" stroke="#1f2525" strokeWidth="7" opacity="0.45" />
      <g transform={`rotate(${rotation} 80 58)`}>
        <ellipse cx={canisterX + 34} cy={canisterY + 21} rx="50" ry="9" fill="#06090d" opacity="0.4" />
        <path d={`M${canisterX - 22} ${canisterY + 7} L${canisterX + 16} ${canisterY + 7}`} stroke="#7b7b75" strokeWidth="7" strokeLinecap="round" />
        <rect x={canisterX + 12} y={canisterY} width="58" height="24" rx="11" fill={converter} stroke="#d8c69f" strokeOpacity="0.34" />
        <path d={`M${canisterX + 67} ${canisterY + 9} L${canisterX + 118} ${canisterY + 7}`} stroke="#7d7c74" strokeWidth="6" strokeLinecap="round" />
        <path d={`M${canisterX + 20} ${canisterY + 5} C${canisterX + 34} ${canisterY + 1} ${canisterX + 48} ${canisterY + 3} ${canisterX + 61} ${canisterY + 8}`} fill="none" stroke="#f1dfb2" strokeWidth="2" opacity="0.38" />
        <path d={`M${canisterX + 23} ${canisterY + 19} C${canisterX + 41} ${canisterY + 24} ${canisterX + 54} ${canisterY + 21} ${canisterX + 64} ${canisterY + 16}`} fill="none" stroke="#322a20" strokeWidth="2" opacity="0.35" />
      </g>
      <path d="M7 66 C19 59 27 60 35 66 L31 91 L8 91 Z" fill="#1d2f3d" opacity="0.8" />
      <path d="M27 59 C37 55 48 57 55 64" fill="none" stroke="#2e4d5e" strokeWidth="7" strokeLinecap="round" opacity="0.9" />
      <path d="M106 24 L143 29 L139 51 L103 46 Z" fill="rgba(13, 18, 22, 0.55)" stroke="rgba(231, 230, 209, 0.18)" />
      <rect width="160" height="96" filter={`url(#origin-noise-${props.seed})`} opacity="0.55" />
      <path d="M0 78 L160 55 L160 96 L0 96 Z" fill="rgba(4, 6, 8, 0.16)" />
    </FrameChrome>
  );
}

function GpsPreview(props: {
  readonly seed: number;
  readonly label: string;
  readonly time: string;
  readonly gpsLat?: string | null;
  readonly gpsLon?: string | null;
  readonly gpsAccuracyM?: string | null;
}) {
  const random = createRandom(props.seed);
  const roadOffset = Math.round(random() * 18);
  const pinX = 72 + Math.round(random() * 22);
  const pinY = 39 + Math.round(random() * 14);
  const radius = 12 + Math.round(random() * 10);

  return (
    <FrameChrome label={props.label} time={props.time}>
      <defs>
        <linearGradient id={`gps-bg-${props.seed}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#18282c" />
          <stop offset="50%" stopColor="#253739" />
          <stop offset="100%" stopColor="#3b3f34" />
        </linearGradient>
        <pattern id={`gps-grid-${props.seed}`} width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(216, 224, 218, 0.12)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="160" height="96" fill={`url(#gps-bg-${props.seed})`} />
      <rect width="160" height="96" fill={`url(#gps-grid-${props.seed})`} />
      <path d={`M-10 ${68 - roadOffset} C32 ${52 - roadOffset} 48 ${76 - roadOffset} 87 ${57 - roadOffset} S134 ${37 - roadOffset} 173 ${46 - roadOffset}`} fill="none" stroke="#a8b59d" strokeWidth="10" opacity="0.28" />
      <path d={`M-10 ${68 - roadOffset} C32 ${52 - roadOffset} 48 ${76 - roadOffset} 87 ${57 - roadOffset} S134 ${37 - roadOffset} 173 ${46 - roadOffset}`} fill="none" stroke="#d8d4b6" strokeWidth="2" opacity="0.55" strokeDasharray="7 7" />
      <path d={`M${20 + roadOffset} -8 L${53 + roadOffset} 104`} stroke="#8da098" strokeWidth="7" opacity="0.22" />
      <path d={`M${119 - roadOffset} -8 L${84 - roadOffset} 104`} stroke="#8da098" strokeWidth="5" opacity="0.2" />
      <circle cx={pinX} cy={pinY} r={radius} fill="rgba(107, 143, 182, 0.16)" stroke="#6b8fb6" strokeWidth="1.5" />
      <path d={`M${pinX} ${pinY - 14} C${pinX - 8} ${pinY - 14} ${pinX - 12} ${pinY - 7} ${pinX - 12} ${pinY - 1} C${pinX - 12} ${pinY + 9} ${pinX} ${pinY + 19} ${pinX} ${pinY + 19} C${pinX} ${pinY + 19} ${pinX + 12} ${pinY + 9} ${pinX + 12} ${pinY - 1} C${pinX + 12} ${pinY - 7} ${pinX + 8} ${pinY - 14} ${pinX} ${pinY - 14} Z`} fill="#d9ad50" stroke="#f2d594" strokeWidth="1" />
      <circle cx={pinX} cy={pinY - 2} r="4" fill="#12181f" />
      <rect x="11" y="63" width="81" height="20" rx="3" fill="rgba(3, 7, 11, 0.62)" />
      <text x="15" y="72" fill="#e9edf2" fontFamily="Consolas, monospace" fontSize="7">
        {formatCoordinate(props.gpsLat)}, {formatCoordinate(props.gpsLon)}
      </text>
      <text x="15" y="81" fill="#cfd8e2" fontFamily="Consolas, monospace" fontSize="6">
        ACC {props.gpsAccuracyM ?? "--"}M
      </text>
    </FrameChrome>
  );
}

function DocumentPreview(props: {
  readonly seed: number;
  readonly label: string;
  readonly time: string;
  readonly evidenceType: string;
}) {
  const random = createRandom(props.seed);
  const isNote = props.evidenceType === "note";
  const isVideo = props.evidenceType === "video";
  const lines = Array.from({ length: 5 }, (_, index) => ({
    y: 31 + index * 8,
    width: 43 + Math.round(random() * 58),
  }));

  if (isVideo) {
    return (
      <FrameChrome label={props.label} time={props.time}>
        <defs>
          <linearGradient id={`video-bg-${props.seed}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#262c32" />
            <stop offset="100%" stopColor="#5b5547" />
          </linearGradient>
          <filter id={`video-noise-${props.seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed={props.seed % 997} />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.08" />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect width="160" height="96" fill={`url(#video-bg-${props.seed})`} />
        <rect width="160" height="96" filter={`url(#video-noise-${props.seed})`} />
        <rect x="38" y="24" width="84" height="48" rx="4" fill="rgba(2, 5, 8, 0.34)" stroke="rgba(233, 237, 242, 0.24)" />
        <path d="M71 36 L94 48 L71 60 Z" fill="#e9edf2" opacity="0.86" />
        <rect x="15" y="70" width="48" height="8" rx="4" fill="rgba(233, 237, 242, 0.2)" />
        <rect x="15" y="70" width="24" height="8" rx="4" fill="#d9ad50" />
      </FrameChrome>
    );
  }

  return (
    <FrameChrome label={props.label} time={props.time}>
      <defs>
        <linearGradient id={`doc-bg-${props.seed}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={isNote ? "#473f2f" : "#313946"} />
          <stop offset="100%" stopColor={isNote ? "#2e322b" : "#1b242e"} />
        </linearGradient>
      </defs>
      <rect width="160" height="96" fill={`url(#doc-bg-${props.seed})`} />
      <path d="M36 14 L116 18 L111 84 L31 79 Z" fill={isNote ? "#d7cda9" : "#d7dde4"} opacity="0.94" />
      <path d="M100 18 L116 18 L113 34 Z" fill={isNote ? "#b9a979" : "#aeb8c3"} />
      <rect x="45" y="25" width="30" height="5" fill={isNote ? "#77643d" : "#5d6e7c"} opacity="0.65" />
      {lines.map((line) => (
        <path
          key={`${props.seed}-${line.y}`}
          d={`M44 ${line.y} L${44 + line.width} ${line.y + (isNote ? Math.round(random() * 3) - 1 : 0)}`}
          stroke={isNote ? "#685d40" : "#6d7b87"}
          strokeWidth={isNote ? 1.8 : 1.4}
          opacity="0.55"
        />
      ))}
      <rect x="87" y="58" width="22" height="15" rx="2" fill="none" stroke="#b34f4f" strokeWidth="2" opacity="0.72" />
      <path d="M7 86 L150 72" stroke="rgba(2, 5, 8, 0.22)" strokeWidth="11" />
    </FrameChrome>
  );
}

function EvidenceVisual(props: EvidencePreviewProps & { readonly label: string; readonly time: string }) {
  const seed = hashSeed(`${props.artifactId}:${props.uri}:${props.evidenceType}`);

  if (props.evidenceType === "image") {
    return <OriginPhotoPreview seed={seed} label={props.label} time={props.time} />;
  }
  if (props.evidenceType === "gps") {
    return (
      <GpsPreview
        seed={seed}
        label={props.label}
        time={props.time}
        gpsLat={props.gpsLat}
        gpsLon={props.gpsLon}
        gpsAccuracyM={props.gpsAccuracyM}
      />
    );
  }
  return (
    <DocumentPreview
      seed={seed}
      label={props.label}
      time={props.time}
      evidenceType={props.evidenceType}
    />
  );
}

export function EvidencePreview(props: EvidencePreviewProps) {
  const size = props.size ?? "sm";
  const classes = SIZE_CLASS[size];
  const label = proofRoleLabel(props.evidenceType);
  const time = formatTime(props.capturedAt);
  const displayRef = compactEvidenceRef(props.uri, props.artifactId);

  return (
    <div className={`overflow-hidden rounded border border-surface-700/60 bg-surface-900/80 ${classes.shell}`}>
      <div className={`${classes.frame} relative overflow-hidden bg-surface-950`}>
        <EvidenceVisual {...props} label={label} time={time} />
        <div className="haldn-evidence-render-loader absolute inset-0 overflow-hidden bg-surface-950/95" aria-hidden>
          <div className="haldn-loader-grid absolute inset-0 opacity-65" />
          <div className="haldn-loader-sweep absolute inset-x-0 top-0 h-1" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="haldn-loader-core h-8 w-8">
              <div className="haldn-loader-ring haldn-loader-ring-a" />
              <div className="haldn-loader-ring haldn-loader-ring-b" />
              <div className="haldn-loader-center" />
            </div>
          </div>
        </div>
      </div>
      <div className={`space-y-0.5 px-1.5 py-1 font-mono leading-tight text-surface-200 ${classes.meta}`}>
        <div className="truncate text-surface-100">{displayRef}</div>
        <div className="truncate">
          {props.capturedBy ? props.capturedBy : props.artifactId.slice(0, 8)}
        </div>
      </div>
    </div>
  );
}
