import {
  CHART_EXPORT_HEIGHT,
  CHART_EXPORT_WIDTH,
  exportChartSvg,
} from "-/components/feedback-chart-export";

/**
 * **Unduh PNG's browser half** (#511): serialise a figure's `<svg>`, make it self-contained with
 * `exportChartSvg`, draw it through an `<img>` onto a 2400×1600 canvas — the 1200×800 layout at 2×,
 * whatever the screen — and hand back the PNG. No dependency: an SVG with no `foreignObject` draws
 * without tainting the canvas.
 */
export async function chartPng(svg: SVGSVGElement): Promise<Blob> {
  const markup = exportChartSvg(new XMLSerializer().serializeToString(svg));
  const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = CHART_EXPORT_WIDTH;
    canvas.height = CHART_EXPORT_HEIGHT;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No 2D canvas context");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (png === null) throw new Error("The canvas produced no PNG");
    return png;
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Draws the figure with `chartPng` and downloads it under `fileName`. */
export async function downloadChartPng(svg: SVGSVGElement, fileName: string): Promise<void> {
  const href = URL.createObjectURL(await chartPng(svg));
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  // Revoked a tick later: some browsers cancel a download whose URL is revoked as it starts.
  setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 0);
}
