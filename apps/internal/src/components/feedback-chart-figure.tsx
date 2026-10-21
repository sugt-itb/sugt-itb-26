import {
  CHART_HEIGHT,
  CHART_WIDTH,
  chartLayout,
  type ChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import { type Ref, useId } from "react";

/**
 * **One Lihat Grafik figure, hand-written SVG** (#510, #514) — not shadcn's `chart`. Recharts draws
 * the legend and title as HTML outside its `<svg>`, so exporting one would need a DOM-to-image
 * library; here the title, n line, legend, pies, their labels and scores all live inside **one
 * `<svg>`** with a fixed view box, which is what lets the PNG export (#511) serialise it whole.
 *
 * It only draws `chartLayout`'s positions. Colours are the theme's tokens through `var(…)`, so on
 * screen it follows Mode Gelap. Each part the checkboxes hide carries a `data-part` naming it —
 * `title`, `legend`, `labels`, `values` — and each pie, its wedge and the empty notice carry `pie`,
 * `wedge` and `empty`. `ref` reaches the `<svg>` itself, which Unduh PNG (#511) serialises as it
 * stands.
 */
function ParticipantChartFigure({
  figure,
  parts,
  ref,
}: {
  figure: ChartFigure;
  parts: ChartParts;
  ref?: Ref<SVGSVGElement>;
}) {
  const layout = chartLayout(figure, parts);
  const titleId = useId();
  const muted = { fill: "var(--muted-foreground)" };
  const text = { fill: "var(--foreground)" };
  // The whole circle, always: the track a wedge fills. The outline is what shows it in light mode,
  // where --muted is nearly white.
  const track = { fill: "var(--muted)", stroke: "var(--border)", strokeWidth: 2 };
  // The score sits on the wedge's edge as often as not, so it is drawn over a thick halo of the
  // background colour: legible on every wedge colour and on the track, without cutting the pie.
  const score = {
    fill: "var(--foreground)",
    stroke: "var(--background)",
    strokeWidth: 10,
    paintOrder: "stroke",
    strokeLinejoin: "round",
  } as const;

  return (
    <svg
      ref={ref}
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

      {layout.slots.map((slot) => (
        <g
          key={slot.aspect}
          data-part="pie"
          data-aspect={slot.aspect}
        >
          <circle
            cx={slot.centre.x}
            cy={slot.centre.y}
            r={slot.radius}
            style={track}
          />
          {slot.wedge?.kind === "full" && (
            <circle
              data-part="wedge"
              cx={slot.centre.x}
              cy={slot.centre.y}
              r={slot.radius}
              style={{ fill: `var(${slot.colour})` }}
            />
          )}
          {slot.wedge?.kind === "sector" && (
            <path
              data-part="wedge"
              d={slot.wedge.d}
              style={{ fill: `var(${slot.colour})` }}
            />
          )}
        </g>
      ))}

      {layout.slots.some((slot) => slot.nameLabel) && (
        <g data-part="labels">
          {layout.slots.map(
            (slot) =>
              slot.nameLabel && (
                <text
                  key={slot.aspect}
                  x={slot.nameLabel.x}
                  y={slot.nameLabel.y}
                  textAnchor="middle"
                  fontSize={slot.nameLabel.fontSize}
                  style={text}
                >
                  {slot.nameLabel.text}
                </text>
              ),
          )}
        </g>
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
                  fontWeight={700}
                  style={score}
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
