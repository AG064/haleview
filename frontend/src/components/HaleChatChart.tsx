import type { ChatChart } from "../assistant-api";

const colours = ["var(--accent)", "var(--chart-carbs)", "var(--chart-fat)", "var(--color-clay)"];

function safeItems(chart: ChatChart) {
  return (Array.isArray(chart.items) ? chart.items : []).filter((item) => typeof item.label === "string" && item.label.length > 0 && item.label.length <= 80
    && Number.isFinite(item.value) && item.value >= 0).slice(0, 31);
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, useGrouping: false }).format(value);
}

function ChartValues({ chart, items }: { chart: ChatChart; items: ReturnType<typeof safeItems> }) {
  return <details className="hale-chart-data"><summary>View chart values</summary><ul>{items.map((item, index) =>
    <li key={`${item.label}-${index}`}><i style={{ backgroundColor: colours[index % colours.length] }} aria-hidden="true" /><span>{item.label}</span><strong>{item.detail ?? `${formatValue(item.value)} ${chart.unit}`}</strong></li>)}</ul></details>;
}

function LineChart({ chart, items }: { chart: ChatChart; items: ReturnType<typeof safeItems> }) {
  const width = 520;
  const height = 220;
  const left = 48;
  const right = 16;
  const top = 18;
  const bottom = 38;
  const values = items.map((item) => item.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.15, Math.abs(maximum) * 0.02, 1);
  const low = Math.max(0, minimum - padding);
  const high = maximum + padding;
  const x = (index: number) => items.length === 1 ? (width + left - right) / 2 : left + index / (items.length - 1) * (width - left - right);
  const y = (value: number) => top + (high - value) / Math.max(1, high - low) * (height - top - bottom);
  const points = items.map((item, index) => `${x(index).toFixed(1)},${y(item.value).toFixed(1)}`).join(" ");
  return <>
    <svg className="hale-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.title}. ${chart.description}`}>
      <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} className="hale-chart-axis" />
      <line x1={left} y1={top} x2={left} y2={height - bottom} className="hale-chart-axis" />
      <text x={left - 8} y={top + 5} textAnchor="end">{formatValue(high)}</text>
      <text x={left - 8} y={height - bottom + 5} textAnchor="end">{formatValue(low)}</text>
      <polyline points={points} className="hale-chart-line" />
      {items.map((item, index) => <circle key={`${item.label}-${index}`} cx={x(index)} cy={y(item.value)} r="4" className="hale-chart-point" />)}
      <text x={left} y={height - 12}>{items[0].label}</text>
      {items.length > 1 && <text x={width - right} y={height - 12} textAnchor="end">{items.at(-1)!.label}</text>}
    </svg>
    <ChartValues chart={chart} items={items} />
  </>;
}

function BarChart({ chart, items }: { chart: ChatChart; items: ReturnType<typeof safeItems> }) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return <>
    <div className="hale-bar-chart" role="img" aria-label={`${chart.title}. ${chart.description}`}>
      {items.map((item, index) => <div className="hale-bar-row" key={`${item.label}-${index}`}>
        <span>{item.label}</span><i><b style={{ width: `${item.value === 0 ? 0 : Math.max(1, item.value / maximum * 100)}%`, backgroundColor: colours[index % colours.length] }} /></i><strong>{item.detail ?? `${formatValue(item.value)} ${chart.unit}`}</strong>
      </div>)}
    </div>
    <ChartValues chart={chart} items={items} />
  </>;
}

function PieChart({ chart, items }: { chart: ChatChart; items: ReturnType<typeof safeItems> }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let position = 0;
  const stops = items.map((item, index) => {
    const start = position;
    position += total > 0 ? item.value / total * 100 : 0;
    return `${colours[index % colours.length]} ${start}% ${position}%`;
  });
  return <>
    <div className="hale-pie-layout">
      <div className="hale-pie-chart" role="img" aria-label={`${chart.title}. ${chart.description}`} style={{ background: total > 0 ? `conic-gradient(${stops.join(", ")})` : "var(--line)" }}><i><strong>{formatValue(total)}</strong><span>{chart.unit}</span></i></div>
      <ul className="hale-pie-key">{items.map((item, index) => <li key={`${item.label}-${index}`}><i style={{ backgroundColor: colours[index % colours.length] }} aria-hidden="true" /><span>{item.label}</span><strong>{total > 0 ? Math.round(item.value / total * 100) : 0}%</strong></li>)}</ul>
    </div>
    <ChartValues chart={chart} items={items} />
  </>;
}

export function HaleChatChart({ chart }: { chart: ChatChart }) {
  const items = safeItems(chart);
  if (!items.length || !["line", "bar", "pie"].includes(chart.type) || typeof chart.title !== "string" || typeof chart.description !== "string" || typeof chart.unit !== "string") return null;
  return <figure className="hale-chat-chart"><figcaption><strong>{chart.title}</strong><span>{chart.description}</span></figcaption>
    {chart.type === "line" ? <LineChart chart={chart} items={items} /> : chart.type === "bar" ? <BarChart chart={chart} items={items} /> : <PieChart chart={chart} items={items} />}
  </figure>;
}
