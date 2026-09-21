/* SUGT Internal tool — interactive recreation of the surfaces in docs/product.md:
   Coverage view (landing), Concerns list, and the acquittal (Perjadin Report).
   Ratings and the four evaluation forms follow docs/data-model.md; the reference
   data is the real allocation from packages/db/seed/reference-data.sql.
   The repo app is a placeholder, so this is built to spec with the real design
   system. Staff-facing, English domain terms, Indonesian UI copy where natural.
   Exports InternalTool to window. */

const { Button, Badge, Rating, Card, Input } = window.SUGTDesignSystem_4f31cd;
const { useState, useEffect } = React;

function Icon({ name, size = 18, color, style }) {
  return <i data-lucide={name} style={{ width: size, height: size, color, ...style }}></i>;
}
const rupiah = (n) => "Rp " + n.toLocaleString("id-ID");

/* The real allocation — packages/db/seed/reference-data.sql. Four Clusters, 42
   Schools, sizes 7 / 18 / 12 / 10. Abridged here to a few Schools each; the point
   is that the names and Topics are real, and that Clusters are not comparable
   in size. Cluster Problems in the seed are placeholders, so none are shown. */
const CLUSTERS = [
  { name: "Klaster 1", topic: "Mitigasi Bencana", total: 6, schools: [
    { id: 1, name: "SMAN 10 Fajar Harapan Banda Aceh", done: 6 },
    { id: 2, name: "SMAS Unggul Del", done: 3 },
    { id: 3, name: "MAN Insan Cendekia OKI", done: 1 },
  ] },
  { name: "Klaster 2", topic: "Smart City", total: 17, schools: [
    { id: 4, name: "SMAN 8 Jakarta", done: 4 },
    { id: 5, name: "SMAS Kharisma Bangsa", done: 2 },
    { id: 6, name: "SMA Cahaya Rancamaya", done: 0 },
  ] },
  { name: "Klaster 3", topic: "Ketahanan Pangan", total: 11, schools: [
    { id: 7, name: "SMA Pradita Dirgantara", done: 8 },
    { id: 8, name: "SMA Negeri 3 Semarang", done: 4 },
  ] },
  { name: "Klaster 4", topic: "Waste Management", total: 8, schools: [
    { id: 9, name: "SMAN 10 Samarinda", done: 2 },
    { id: 10, name: "SMAN Siwalima Ambon", done: 1 },
  ] },
];

/* A concerns row is now (source, subject, aspect, rating, who, said) — see the
   four-source query in docs/data-model.md. Aspects are labelled in Indonesian;
   the columns behind them are English. Only Ratings at or below 7 appear.
   Participant rows have no explanation: the elaboration rule binds signed-in
   filers only. */
const CONCERNS = [
  { source: "Class Record", subject: "SMAN 8 Jakarta", klass: "Student Class",
    aspect: "Pemahaman", rating: 4, who: "Citra Dewi · Research",
    said: "Belum paham dasar sensor; perlu pengulangan sebelum sesi berikutnya.", when: "2 hari lalu" },
  { source: "Participant", subject: "SMAN 8 Jakarta", klass: "Student Class",
    aspect: "Pengajar", rating: 3, who: "Rina (peserta)",
    said: null, when: "2 hari lalu" },
  { source: "Session Record", subject: "SMAN 10 Samarinda", klass: null,
    aspect: "Kehadiran", rating: 5, who: "Ani Rahmawati · PIC",
    said: "Hanya 12 dari 30 guru hadir; bentrok dengan agenda sekolah.", when: "5 hari lalu" },
  { source: "Perjadin Evaluation", subject: "Perjadin Ambon", klass: null,
    aspect: "Penginapan", rating: 4, who: "Budi Santoso · Teaching Team",
    said: "Penginapan tidak ada air panas dan jauh dari sekolah.", when: "1 minggu lalu" },
];

const TX = [
  { id: 1, cat: "Transportasi", desc: "Sewa kendaraan Bandung–Garut", amt: 1250000, ev: true },
  { id: 2, cat: "Penginapan", desc: "2 malam, 4 orang", amt: 2400000, ev: true },
  { id: 3, cat: "Konsumsi", desc: "Makan selama perjalanan dinas", amt: 860000, ev: true },
  { id: 4, cat: "Bahan", desc: "Perlengkapan sesi luring", amt: 430000, ev: false },
];

function Sidebar({ view, setView }) {
  const nav = [
    { id: "coverage", label: "Coverage", icon: "layout-grid" },
    { id: "concerns", label: "Concerns", icon: "triangle-alert" },
    { id: "acquittal", label: "Perjadin Report", icon: "receipt-text" },
  ];
  return (
    <aside style={{ width: 240, borderRight: "1px solid var(--sidebar-border)", background: "var(--sidebar)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: "1px solid var(--sidebar-border)" }}>
        <img src="../../assets/logo-sekolah-garuda.png" alt="Sekolah Garuda" style={{ height: 24, width: "auto" }} />
        <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 500 }}>Internal</span>
      </div>
      <nav style={{ padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
        {nav.map((n) => {
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", fontSize: 14, fontWeight: 500,
              fontFamily: "var(--font-sans)", cursor: "pointer", border: "none", textAlign: "left", borderRadius: "var(--radius-md)",
              background: active ? "var(--primary)" : "transparent",
              color: active ? "var(--primary-foreground)" : "var(--sidebar-foreground)" }}>
              <Icon name={n.icon} size={16} color={active ? "var(--primary-foreground)" : "var(--muted-foreground)"} />
              {n.label}
            </button>
          );
        })}
      </nav>
      <div style={{ marginTop: "auto", padding: 16, borderTop: "1px solid var(--sidebar-border)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, borderRadius: "var(--radius-sm)" }}>RN</div>
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Rani N.</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Staff · DITSAMA</div>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, sub, actions }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>{title}</h1>
        {sub && <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

function SchoolRow({ s, selected, onToggle }) {
  return (
    <button onClick={() => onToggle(s.id)} style={{
      display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
      padding: "12px 16px", border: "1px solid var(--border)", borderTop: "none", cursor: "pointer",
      fontFamily: "var(--font-sans)", background: selected ? "color-mix(in oklch,var(--primary),transparent 92%)" : "var(--card)" }}>
      <span style={{ width: 16, height: 16, border: "1px solid " + (selected ? "var(--primary)" : "var(--border)"), background: selected ? "var(--primary)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "var(--radius-sm)" }}>
        {selected && <Icon name="check" size={12} color="var(--primary-foreground)" />}
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{s.name}</span>
      <span style={{ fontSize: 13, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{s.done} / 10</span>
      <span style={{ width: 84, height: 6, background: "var(--muted)", position: "relative", flexShrink: 0, borderRadius: 999, overflow: "hidden" }}>
        <span style={{ position: "absolute", inset: 0, width: (s.done / 10 * 100) + "%", background: "var(--primary)", borderRadius: 999 }}></span>
      </span>
    </button>
  );
}

function Coverage() {
  const [sel, setSel] = useState([]);
  const toggle = (id) => setSel((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const [planning, setPlanning] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Coverage" sub="Setiap Sekolah dengan jumlah Sesi terlaksana, dikelompokkan per Cluster." />
      <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
        {CLUSTERS.map((c) => (
          <div key={c.name} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{c.name}</h2>
              <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Topik: {c.topic}</span>
            </div>
            <div style={{ borderTop: "1px solid var(--border)" }}>
              {c.schools.map((s) => <SchoolRow key={s.id} s={s} selected={sel.includes(s.id)} onToggle={toggle} />)}
            </div>
          </div>
        ))}
      </div>
      {sel.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "var(--shadow-lg)" }}>
          <span style={{ fontSize: 14 }}><b>{sel.length}</b> Sekolah dipilih</span>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => setSel([])}>Batal</Button>
            <Button onClick={() => setPlanning(true)}><Icon name="plus" size={16} color="var(--primary-foreground)" /> Buat Perjadin</Button>
          </div>
        </div>
      )}
      {planning && <PerjadinForm count={sel.length} onClose={() => { setPlanning(false); setSel([]); }} />}
    </div>
  );
}

function PerjadinForm({ count, onClose }) {
  const fld = { display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 };
  const lbl = { fontSize: 13, fontWeight: 500 };
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "color-mix(in oklch,var(--foreground),transparent 55%)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontSize: 16, fontWeight: 600 }}>Buat Perjadin</div><div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{count} Sekolah · membuat {count} Sesi</div></div>
          <Button size="icon-sm" variant="ghost" onClick={onClose}><Icon name="x" size={16} /></Button>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ ...fld, flex: 1 }}><label style={lbl}>Tanggal berangkat</label><Input type="date" defaultValue="2026-08-18" /></div>
            <div style={{ ...fld, flex: 1 }}><label style={lbl}>Tanggal kembali</label><Input type="date" defaultValue="2026-08-20" /></div>
          </div>
          <div style={fld}><label style={lbl}>PIC (Staff)</label><Input defaultValue="Rani N." /></div>
          <div style={fld}><label style={lbl}>Teaching Team — STEM</label><Input placeholder="Pilih anggota…" /></div>
          <div style={fld}><label style={lbl}>Teaching Team — Research</label><Input placeholder="Pilih anggota…" /></div>
          <div style={fld}><label style={lbl}>Advance</label><Input defaultValue="Rp 4.940.000" /></div>
        </div>
        <div style={{ padding: "16px 22px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={onClose}>Simpan Perjadin</Button>
        </div>
      </div>
    </div>
  );
}

function Concerns() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Concerns" sub="Aspek yang dinilai 7 ke bawah, dari keempat sumber, terbaru dahulu." />
      <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
        <div style={{ border: "1px solid var(--border)", borderBottom: "none", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          {CONCERNS.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 16, padding: "16px 18px", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
              <div style={{ width: 132, flexShrink: 0 }}>
                <Rating value={c.rating} label={c.aspect} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {c.subject}{c.klass ? <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}> · {c.klass}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "3px 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge variant="outline">{c.source}</Badge>
                  <span>{c.who}</span>
                </div>
                {c.said
                  ? <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{c.said}</div>
                  : <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--muted-foreground)", fontStyle: "italic" }}>
                      Tanpa penjelasan — peserta tidak diwajibkan menuliskannya.
                    </div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{c.when}</span>
                <Button size="xs" variant="ghost">Buka <Icon name="arrow-right" size={12} /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Acquittal() {
  const [tx, setTx] = useState(TX);
  const total = tx.reduce((s, t) => s + t.amt, 0);
  const advance = 4940000;
  const remaining = advance - total;
  const allEvidenced = tx.every((t) => t.ev);
  const cell = { padding: "12px 16px", fontSize: 13.5, borderBottom: "1px solid var(--border)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar title="Perjadin Report — Bandung–Garut" sub="PIC: Rani N. · 18–20 Agu 2026 · tenggat dalam 6 hari"
        actions={<Button disabled={!allEvidenced}><Icon name="file-down" size={16} color="var(--primary-foreground)" /> Export acquittal</Button>} />
      <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
          <Card title="Advance"><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{rupiah(advance)}</div></Card>
          <Card title="Terpakai"><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{rupiah(total)}</div></Card>
          <Card title="Dikembalikan ke Treasurer"><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: remaining < 0 ? "var(--destructive)" : "var(--foreground)" }}>{rupiah(remaining)}</div></Card>
        </div>
        {!allEvidenced && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", border: "1px solid color-mix(in oklch,var(--destructive),transparent 65%)", background: "color-mix(in oklch,var(--destructive),transparent 92%)", color: "var(--destructive)", fontSize: 13, marginBottom: 20 }}>
            <Icon name="info" size={16} /> Ada transaksi tanpa bukti. Laporan tidak bisa di-export sampai semuanya berbukti — tenggat boleh lewat, dokumen tidak dibuat dari data yang belum lengkap.
          </div>
        )}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 140px 120px", background: "var(--muted)", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>
            <div style={{ padding: "10px 16px" }}>Kategori</div><div style={{ padding: "10px 16px" }}>Keterangan</div>
            <div style={{ padding: "10px 16px", textAlign: "right" }}>Jumlah</div><div style={{ padding: "10px 16px" }}>Bukti</div>
          </div>
          {tx.map((t) => (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 140px 120px", alignItems: "center" }}>
              <div style={cell}>{t.cat}</div>
              <div style={cell}>{t.desc}</div>
              <div style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{rupiah(t.amt)}</div>
              <div style={cell}>
                {t.ev ? <Badge variant="muted"><Icon name="paperclip" size={12} /> Ada</Badge>
                  : <Button size="xs" variant="destructive" onClick={() => setTx((p) => p.map((x) => x.id === t.id ? { ...x, ev: true } : x))}>Lampirkan</Button>}
              </div>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 120px", background: "var(--secondary)" }}>
            <div style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600, textAlign: "right" }}>Total</div>
            <div style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{rupiah(total)}</div>
            <div></div>
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <Button variant="outline"><Icon name="plus" size={16} /> Tambah transaksi</Button>
        </div>
      </div>
    </div>
  );
}

function InternalTool() {
  const [view, setView] = useState("coverage");
  useEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative" }}>
      <Sidebar view={view} setView={setView} />
      <main style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--background)" }}>
        {view === "coverage" && <Coverage />}
        {view === "concerns" && <Concerns />}
        {view === "acquittal" && <Acquittal />}
      </main>
    </div>
  );
}

window.InternalTool = InternalTool;
