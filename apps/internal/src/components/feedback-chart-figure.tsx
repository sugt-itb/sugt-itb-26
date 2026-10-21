import {
  CHART_TRACK_STROKE,
  CHART_WIDTH,
  chartLayout,
  type ChartFigure,
  type ChartParts,
} from "-/components/feedback-chart";
import { type Ref, useId } from "react";

/**
 * **One Lihat Grafik figure, hand-written SVG** (#510, #514, #516, #518) — not shadcn's `chart`.
 * Recharts draws the legend and title as HTML outside its `<svg>`, so exporting one would need a
 * DOM-to-image library; here the title block with its Tipe Peserta pill, the donuts, their names
 * and scores all live inside **one `<svg>`**, which is what lets the PNG export (#511) serialise it
 * whole. Its view box is 1200 wide and as tall as `chartLayout` says its content is (#522).
 *
 * It only draws `chartLayout`'s positions. Colours are the theme's tokens through `var(…)`, so on
 * screen it follows Mode Gelap. Each part the checkboxes hide carries a `data-part` naming it —
 * `title`, `values` — as do the Aspects' names, `labels`, which always show; each donut, its arc,
 * the pill and the empty notice carry `donut`, `arc`, `pill` and `empty`. `ref` reaches the `<svg>`
 * itself, which Unduh PNG (#511) serialises as it stands.
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
  // The whole ring, always: the track an arc fills. The outline on both edges is what shows it in
  // light mode, where --muted is nearly white.
  const track = { fill: "var(--muted)", stroke: "var(--border)", strokeWidth: CHART_TRACK_STROKE };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${CHART_WIDTH} ${layout.height}`}
      role="img"
      aria-labelledby={titleId}
      className="h-auto w-full"
    >
      {/* The accessible name, whatever the checkboxes hide. Never drawn. */}
      <title id={titleId}>{figure.title.name}</title>

      {layout.title && (
        <g data-part="title">
          <text
            x={layout.title.heading.x}
            y={layout.title.heading.y}
            textAnchor="end"
            fontSize={layout.title.fontSize}
            fontWeight={600}
            style={text}
          >
            {layout.title.heading.text}
          </text>
          {/* The Tipe Peserta stands out at a glance: the brand colour, never an Aspect's. */}
          <g data-part="pill">
            <rect
              x={layout.title.pill.x}
              y={layout.title.pill.y}
              width={layout.title.pill.width}
              height={layout.title.pill.height}
              rx={layout.title.pill.height / 2}
              style={{ fill: "var(--primary)" }}
            />
            <text
              x={layout.title.pill.textX}
              y={layout.title.pill.textY}
              textAnchor="middle"
              fontSize={layout.title.fontSize}
              fontWeight={600}
              style={{ fill: "var(--primary-foreground)" }}
            >
              {layout.title.pill.text}
            </text>
          </g>
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
        </g>
      )}

      {layout.slots.map((slot) => (
        <g
          key={slot.aspect}
          data-part="donut"
          data-aspect={slot.aspect}
        >
          <path
            d={slot.track}
            fillRule="evenodd"
            style={track}
          />
          {slot.arc && (
            <path
              data-part="arc"
              d={slot.arc.d}
              fillRule="evenodd"
              style={{ fill: `var(${slot.colour})` }}
            />
          )}
        </g>
      ))}

      {layout.slots.length > 0 && (
        <g data-part="labels">
          {layout.slots.map((slot) => (
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
          ))}
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
          fontSize={layout.emptyNotice.fontSize}
          style={muted}
        >
          {layout.emptyNotice.text}
        </text>
      )}
    </svg>
  );
}

export { ParticipantChartFigure };
