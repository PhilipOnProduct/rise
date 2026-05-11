import type { SkylineRegion } from "@/lib/region-from-accept-language";

type PrimitiveProps = { x: number; y: number };

function Colosseum({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="0" y="20" width="70" height="50" rx="2" fill="#c8a882" />
      <path
        d="M8,20 A27,25 0 0,1 62,20"
        fill="#c8a882"
        stroke="#b89872"
        strokeWidth="1"
      />
      <rect x="12" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
      <rect x="30" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
      <rect x="48" y="35" width="10" height="18" rx="5" fill="#e8d4b8" />
    </g>
  );
}

function EiffelTower({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <polygon points="25,0 19,40 31,40" fill="#b0c4d4" />
      <polygon points="19,40 9,130 41,130 31,40" fill="#9ab4c8" />
      <rect x="20" y="37" width="10" height="3" rx="1" fill="#8aa4b8" />
      <rect x="15" y="78" width="20" height="3" rx="1" fill="#8aa4b8" />
    </g>
  );
}

function Skyscrapers({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="0" y="15" width="18" height="90" rx="1" fill="#9ab4c8" />
      <rect x="22" y="0" width="16" height="105" rx="1" fill="#b0c4d4" />
      <rect x="42" y="28" width="17" height="77" rx="1" fill="#a0b8cc" />
    </g>
  );
}

function BigBen({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="8" y="15" width="18" height="110" rx="1" fill="#c8a882" />
      <polygon points="17,0 8,15 26,15" fill="#b89872" />
      <rect x="11" y="40" width="12" height="7" rx="1" fill="#e8d4b8" />
    </g>
  );
}

function MosqueDome({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="5" y="32" width="52" height="48" rx="2" fill="#e8d4b8" />
      <ellipse cx="31" cy="32" rx="26" ry="20" fill="#c8a882" />
      <line
        x1="31"
        y1="12"
        x2="31"
        y2="6"
        stroke="#b89872"
        strokeWidth="2"
      />
      <ellipse cx="31" cy="5" rx="2.5" ry="2.5" fill="#b89872" />
      <rect x="-1" y="25" width="5" height="55" rx="1" fill="#d8c8a8" />
      <rect x="58" y="25" width="5" height="55" rx="1" fill="#d8c8a8" />
    </g>
  );
}

function TajMahal({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="8" y="40" width="52" height="38" rx="2" fill="#e8d4b8" />
      <ellipse cx="34" cy="40" rx="22" ry="17" fill="#d8ccb8" />
      <line
        x1="34"
        y1="21"
        x2="34"
        y2="16"
        stroke="#c8a882"
        strokeWidth="1.5"
      />
      <ellipse cx="34" cy="15" rx="2" ry="2" fill="#c8a882" />
      <ellipse cx="15" cy="44" rx="7" ry="6" fill="#d0c4a8" />
      <ellipse cx="53" cy="44" rx="7" ry="6" fill="#d0c4a8" />
    </g>
  );
}

function BurjKhalifa({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <polygon points="13,0 7,140 19,140" fill="#9ab4c8" />
      <rect x="5" y="85" width="16" height="2.5" rx="1" fill="#8aa4b8" />
      <rect x="7" y="50" width="12" height="2" rx="1" fill="#8aa4b8" />
    </g>
  );
}

function Pagoda({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="15" y="15" width="20" height="92" rx="1" fill="#c8a882" />
      <polygon points="25,6 6,22 44,22" fill="#b89872" />
      <polygon points="25,22 9,34 41,34" fill="#c8a882" />
      <polygon points="25,38 11,48 39,48" fill="#b89872" />
      <polygon points="25,54 13,62 37,62" fill="#c8a882" />
      <line
        x1="25"
        y1="0"
        x2="25"
        y2="6"
        stroke="#a08060"
        strokeWidth="1.5"
      />
    </g>
  );
}

function SydneyOperaHouse({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M0,60 Q12,8 24,60" fill="#e8d4b8" />
      <path d="M16,60 Q28,4 40,60" fill="#d8ccb8" />
      <path d="M32,60 Q42,12 53,60" fill="#e8d4b8" />
      <rect x="-4" y="56" width="64" height="8" rx="1" fill="#c8a882" />
    </g>
  );
}

function TowerCluster({ x, y }: PrimitiveProps) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="0" y="8" width="22" height="107" rx="2" fill="#b0c4d4" />
      <rect x="26" y="24" width="17" height="91" rx="2" fill="#9ab4c8" />
      <rect x="47" y="0" width="19" height="115" rx="2" fill="#a0b8cc" />
      <rect x="70" y="40" width="15" height="75" rx="2" fill="#b0c4d4" />
    </g>
  );
}

function SkylineFrame({
  children,
  ariaLabel,
}: {
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <svg
      viewBox="0 0 1200 160"
      preserveAspectRatio="xMidYMax slice"
      className="w-full block h-full"
      role="img"
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="1200" height="160" fill="#e8e2d8" />
      <defs>
        <linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f6f1" />
          <stop offset="40%" stopColor="#f8f6f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1200" height="160" fill="url(#skyFade)" />
      <rect y="145" width="1200" height="15" fill="#d8ccb8" />
      {children}
    </svg>
  );
}

function DefaultSkyline() {
  return (
    <SkylineFrame ariaLabel="Illustrated skyline of world landmarks — Colosseum, Eiffel Tower, Big Ben, a mosque, the Taj Mahal, Burj Khalifa, a pagoda, and the Sydney Opera House">
      <Colosseum x={30} y={75} />
      <EiffelTower x={160} y={15} />
      <Skyscrapers x={260} y={40} />
      <BigBen x={380} y={20} />
      <MosqueDome x={460} y={55} />
      <TajMahal x={580} y={50} />
      <BurjKhalifa x={720} y={5} />
      <Pagoda x={800} y={38} />
      <SydneyOperaHouse x={920} y={85} />
      <TowerCluster x={1060} y={30} />
    </SkylineFrame>
  );
}

function EuropeSkyline() {
  return (
    <SkylineFrame ariaLabel="Illustrated European skyline — Colosseum, Eiffel Tower, modern skyscrapers, Big Ben, and a domed Mediterranean landmark">
      <Colosseum x={50} y={75} />
      <EiffelTower x={200} y={15} />
      <Skyscrapers x={310} y={40} />
      <BigBen x={460} y={20} />
      <MosqueDome x={560} y={55} />
      <Skyscrapers x={720} y={45} />
      <TowerCluster x={870} y={30} />
      <Skyscrapers x={1020} y={50} />
    </SkylineFrame>
  );
}

function AsiaSkyline() {
  return (
    <SkylineFrame ariaLabel="Illustrated Asian skyline — domed landmark, Burj Khalifa, Taj Mahal, pagoda, Sydney Opera House, and modern skyscrapers">
      <MosqueDome x={30} y={55} />
      <Skyscrapers x={150} y={40} />
      <BurjKhalifa x={290} y={5} />
      <TajMahal x={390} y={50} />
      <Pagoda x={530} y={38} />
      <Skyscrapers x={620} y={45} />
      <SydneyOperaHouse x={770} y={85} />
      <TowerCluster x={920} y={30} />
      <BurjKhalifa x={1050} y={10} />
      <Skyscrapers x={1100} y={50} />
    </SkylineFrame>
  );
}

function AmericasSkyline() {
  return (
    <SkylineFrame ariaLabel="Illustrated Americas skyline — modern skyscrapers and tower clusters spanning a downtown horizon">
      <Skyscrapers x={50} y={35} />
      <TowerCluster x={150} y={25} />
      <Skyscrapers x={310} y={45} />
      <BurjKhalifa x={420} y={5} />
      <TowerCluster x={490} y={30} />
      <Skyscrapers x={640} y={40} />
      <TowerCluster x={760} y={28} />
      <Skyscrapers x={920} y={35} />
      <TowerCluster x={1030} y={32} />
      <Skyscrapers x={1140} y={50} />
    </SkylineFrame>
  );
}

export default function LandmarkSkyline({
  region,
}: {
  region?: SkylineRegion | null;
}) {
  switch (region) {
    case "americas":
      return <AmericasSkyline />;
    case "asia":
      return <AsiaSkyline />;
    case "europe":
      return <EuropeSkyline />;
    default:
      return <DefaultSkyline />;
  }
}
