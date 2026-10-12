import { formatRupiah } from "@sugt/domain";

/**
 * **One money figure on the Pengeluaran strip** — `/perjadin/[id]` and its Laporan both render Uang
 * Perjalanan Terpakai (ADR-0051), and the Laporan its two cohort totals, so they share this.
 *
 * Money in whole rupiah, which is what it is stored as — `numeric(_, 2)` would imply a subunit nobody
 * uses, so there is no cent to render and none is invented here.
 */
function MoneyFigure({ label, amountIdr }: { label: string; amountIdr: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{formatRupiah(amountIdr)}</dd>
    </div>
  );
}

export { MoneyFigure };
