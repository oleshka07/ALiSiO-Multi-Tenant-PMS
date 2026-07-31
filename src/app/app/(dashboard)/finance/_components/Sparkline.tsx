'use client';

interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  showZeroLine?: boolean;
}

export default function Sparkline({
  values,
  width = 110,
  height = 28,
  color,
  showZeroLine = true,
}: Props) {
  if (!values || values.length === 0) return null;

  const padding = 2;
  const w = width;
  const h = height;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;

  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;

  const xStep = values.length > 1 ? innerW / (values.length - 1) : innerW;
  const yFor = (v: number) => padding + innerH - ((v - min) / range) * innerH;

  const points = values.map((v, i) => `${padding + i * xStep},${yFor(v)}`);
  const pathD = `M ${points.join(' L ')}`;

  const last = values[values.length - 1];
  const total = values.reduce((s, v) => s + v, 0);
  const trendColor = color || (total >= 0 ? '#22c55e' : '#ef4444');

  const fillD = `${pathD} L ${padding + (values.length - 1) * xStep},${padding + innerH} L ${padding},${padding + innerH} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }} aria-hidden="true">
      {showZeroLine && min < 0 && max > 0 && (
        <line
          x1={padding}
          x2={padding + innerW}
          y1={yFor(0)}
          y2={yFor(0)}
          stroke="var(--text-secondary)"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          opacity={0.4}
        />
      )}
      <path d={fillD} fill={trendColor} opacity={0.12} />
      <path d={pathD} fill="none" stroke={trendColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={padding + i * xStep}
          cy={yFor(v)}
          r={i === values.length - 1 ? 2.2 : 1.2}
          fill={trendColor}
          opacity={i === values.length - 1 ? 1 : 0.6}
        />
      ))}
    </svg>
  );
}
