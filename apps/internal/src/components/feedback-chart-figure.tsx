import {
  CHART_HEIGHT,
  CHART_WIDTH,
  chartLayout,
  type ChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import { useId } from "react";

/**
 * **One Lihat Grafik figure, hand-written SVG** (#510) — not shadcn's `chart`. Recharts draws the
 * legend and title as HTML outside its `<svg>`, so exporting one would need a DOM-to-image library;
 * here the title, n line, legend, axes, bars and value labels all live inside **one `<svg>`** with a
 * fixed view box, which is what lets the PNG export (#511) serialise it whole.
 *
 * It only draws `chartLayout`'s positions. Colours are the theme's tokens through `var(…)`, so on
 * screen it follows Mode Gelap. Each part the checkboxes hide carries a `data-part` naming it —
 * `title`, `legend`, `axes`, `values` — and the bars and the empty notice carry `bar` and `empty`.
 */
function ParticipantChartFigure({ figure, parts }: { figure: ChartFigure; parts: ChartParts }) {
  const layout = chartLayout(figure, parts);
  const titleId = useId();
  const muted = { fill: "var(--muted-foreground)" };
  const text = { fill: "var(--foreground)" };
  const axisLine = { stroke: "var(--muted-foreground)", strokeWidth: 2 };

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-labelledby={titleId}
      className="h-auto w-full"
    >
      {/* The accessible name, whatever the checkboxes hide. Never drawn. */}
      <title id={titleId}>{`${figure.title} (${figure.countLine})`}</title>

      {layout.title && (
        <g data-part="title">
          <text
            x={layout.title.x}
            textAnchor="middle"
            fontSize={layout.title.fontSize}
            fontWeight={600}
            style={text}
          >
            {layout.title.lines.map((line, index) => (
              <tspan
                key={index}
                x={layout.title!.x}
                y={layout.title!.baselines[index]}
              >
                {line}
              </tspan>
            ))}
          </text>
          <text
            x={layout.title.count.x}
            y={layout.title.count.y}
            textAnchor="middle"
            fontSize={layout.title.count.fontSize}
            style={muted}
          >
            {layout.title.count.text}
          </text>
        </g>
      )}

      {layout.legend && (
        <g data-part="legend">
          {layout.legend.items.map((item) => (
            <g key={item.label}>
              <rect
                x={item.swatch.x}
                y={item.swatch.y}
                width={layout.legend!.swatch}
                height={layout.legend!.swatch}
                rx={4}
                style={{ fill: `var(${item.colour})` }}
              />
              <text
                x={item.text.x}
                y={item.text.y}
                fontSize={layout.legend!.fontSize}
                style={text}
              >
                {item.label}
              </text>
            </g>
          ))}
        </g>
      )}

      {layout.axes && (
        <g data-part="axes">
          <line
            x1={layout.plot.left}
            y1={layout.plot.top}
            x2={layout.plot.left}
            y2={layout.plot.bottom}
            style={axisLine}
          />
          <line
            x1={layout.plot.left}
            y1={layout.plot.bottom}
            x2={layout.plot.right}
            y2={layout.plot.bottom}
            style={axisLine}
          />
          {layout.axes.yTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={layout.plot.left - layout.axes!.tickLength}
                y1={tick.y}
                x2={layout.plot.left}
                y2={tick.y}
                style={axisLine}
              />
              <text
                x={layout.plot.left - layout.axes!.tickLength - 12}
                y={tick.y + layout.axes!.fontSize * 0.35}
                textAnchor="end"
                fontSize={layout.axes!.fontSize}
                style={muted}
              >
                {tick.label}
              </text>
            </g>
          ))}
          {layout.axes.xTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={tick.x}
                y1={layout.plot.bottom}
                x2={tick.x}
                y2={layout.plot.bottom + layout.axes!.tickLength}
                style={axisLine}
              />
              <text
                x={tick.x}
                y={layout.axes!.xTickBaseline}
                textAnchor="middle"
                fontSize={layout.axes!.fontSize}
                style={text}
              >
                {tick.label}
              </text>
            </g>
          ))}
          <text
            x={layout.axes.xTitle.x}
            y={layout.axes.xTitle.y}
            textAnchor="middle"
            fontSize={layout.axes.fontSize}
            fontWeight={600}
            style={muted}
          >
            {layout.axes.xTitle.text}
          </text>
          <text
            x={layout.axes.yTitle.x}
            y={layout.axes.yTitle.y}
            transform={`rotate(-90 ${layout.axes.yTitle.x} ${layout.axes.yTitle.y})`}
            textAnchor="middle"
            fontSize={layout.axes.fontSize}
            fontWeight={600}
            style={muted}
          >
            {layout.axes.yTitle.text}
          </text>
        </g>
      )}

      {layout.slots.map(
        (slot) =>
          slot.bar && (
            <rect
              key={slot.aspect}
              data-part="bar"
              data-aspect={slot.aspect}
              x={slot.bar.x}
              y={slot.bar.y}
              width={slot.bar.width}
              height={slot.bar.height}
              style={{ fill: `var(${slot.colour})` }}
            />
          ),
      )}

      {layout.slots.some((slot) => slot.valueLabel) && (
        <g data-part="values">
          {layout.slots.map(
            (slot) =>
              slot.valueLabel && (
                <text
                  key={slot.aspect}
                  x={slot.valueLabel.x}
                  y={slot.valueLabel.y}
                  textAnchor="middle"
                  fontSize={slot.valueLabel.fontSize}
                  fontWeight={600}
                  style={text}
                >
                  {slot.valueLabel.text}
                </text>
              ),
          )}
        </g>
      )}

      {layout.emptyNotice && (
        <text
          data-part="empty"
          x={layout.emptyNotice.x}
          y={layout.emptyNotice.y}
          textAnchor="middle"
          fontSize={36}
          style={muted}
        >
          {layout.emptyNotice.text}
        </text>
      )}
    </svg>
  );
}

export { ParticipantChartFigure };
