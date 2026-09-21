/* SUGT Public site — recreation of the launch homepage described in
   docs/product.md ("leads with scope, not delivery"). The app in the repo is a
   placeholder (<Button>Tes</Button>), so this is built to the product spec using
   the real design system: Montserrat, brick-red primary, rounded corners.
   Copy is Indonesian, as the spec requires. Exports PublicSite to window. */

const { Button, Badge, Card } = window.SUGTDesignSystem_4f31cd;

const MAX = 1120;
const wrap = { maxWidth: MAX, margin: "0 auto", padding: "0 32px" };

function Icon({ name, size = 18, color }) {
  return <i data-lucide={name} style={{ width: size, height: size, color }}></i>;
}

function Header() {
  const link = { fontSize: 14, fontWeight: 500, color: "var(--foreground)", textDecoration: "none", cursor: "pointer" };
  return (
    <header style={{ borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--background)", zIndex: 10 }}>
      <div style={{ ...wrap, height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="../../assets/logo-sekolah-garuda.png" alt="Sekolah Garuda" style={{ height: 30, width: "auto" }} />
        </div>
        <nav style={{ display: "flex", gap: 28, alignItems: "center" }}>
          <a style={link}>Program</a>
          <a style={link}>Cluster</a>
          <a style={link}>Cerita</a>
          <a style={link}>Tentang</a>
          <Button size="sm" variant="outline">Portal Internal</Button>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...wrap, padding: "88px 32px 72px", maxWidth: 900 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 22 }}>
          <Badge variant="primary">STEM &amp; Research Track</Badge>
          <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Program Kementerian Pendidikan Tinggi</span>
        </div>
        <h1 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.025em", margin: "0 0 22px", maxWidth: 780 }}>
          Membangun kapasitas riset di sekolah-sekolah unggul Indonesia.
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--muted-foreground)", maxWidth: 620, margin: "0 0 32px" }}>
          Sekolah Unggul Garuda Transformasi, dijalankan oleh DITSAMA ITB. Pengajaran STEM dan Riset yang dibawa langsung ke sekolah — luring dan daring — kepada guru, manajemen, dan siswa.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Button size="lg">Lihat Program</Button>
          <Button size="lg" variant="outline">Cerita Lapangan</Button>
        </div>
      </div>
    </section>
  );
}

function Stat({ figure, label, sub }) {
  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>{figure}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10 }}>{label}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Scope() {
  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...wrap, padding: "56px 32px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 28 }}>Cakupan Program</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0 }}>
          <Stat figure="47" label="Sekolah peserta" sub="tersebar di 16 provinsi" />
          <Stat figure="2" label="Stream" sub="STEM &amp; Research" />
          <Stat figure="3" label="Kelas / sekolah" sub="GTK · MS · Siswa" />
          <Stat figure="10" label="Sesi / sekolah" sub="4 luring · 6 daring" />
        </div>
      </div>
    </section>
  );
}

function Delivery() {
  return (
    <section style={{ background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...wrap, padding: "40px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 24 }}>
        <div style={{ display: "flex", gap: 56 }}>
          <Stat figure="128" label="Sesi terlaksana" />
          <Stat figure="19" label="Sekolah terjangkau" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 300 }}>
          <Icon name="refresh-cw" size={14} />
          Angka penyampaian diperbarui seiring berjalannya Program.
        </div>
      </div>
    </section>
  );
}

function Streams() {
  const streams = [
    { t: "STEM", d: "Sains, teknologi, dan rekayasa — dibawa ke setiap Kelas untuk memperkuat penalaran dan praktik.", i: "flask-conical" },
    { t: "Research", d: "Metode riset dan penyelidikan — mengangkat satu Problem nyata yang dikerjakan setiap Cluster.", i: "microscope" },
  ];
  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...wrap, padding: "64px 32px" }}>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Dua Stream, satu Problem</h2>
        <p style={{ fontSize: 15, color: "var(--muted-foreground)", margin: "0 0 32px", maxWidth: 560 }}>Setiap Cluster memegang satu Topik dan satu Problem; kedua Stream mengerjakannya dari sudut masing-masing.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {streams.map((s) => (
            <Card key={s.t}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 44, height: 44, background: "var(--primary)", color: "var(--primary-foreground)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: "var(--radius-md)" }}>
                  <Icon name={s.i} size={22} color="var(--primary-foreground)" />
                </div>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>{s.t}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted-foreground)" }}>{s.d}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stories() {
  const items = [
    { s: "SMA Negeri 3 Bandung", c: "Cluster Priangan Timur", tag: "STEM" },
    { s: "SMA Negeri 1 Garut", c: "Cluster Priangan Timur", tag: "Research" },
    { s: "SMA Negeri 2 Tasikmalaya", c: "Cluster Priangan Timur", tag: "STEM" },
  ];
  return (
    <section style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...wrap, padding: "64px 32px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px" }}>Cerita dari lapangan</h2>
            <p style={{ fontSize: 15, color: "var(--muted-foreground)", margin: 0 }}>Ditulis dan dipilih oleh tim, bukan dipanen dari catatan.</p>
          </div>
          <Button variant="ghost">Semua cerita <Icon name="arrow-right" size={16} /></Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {items.map((it, i) => (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
              <div style={{ aspectRatio: "4/3", background: "repeating-linear-gradient(45deg,var(--muted),var(--muted) 12px,var(--secondary) 12px,var(--secondary) 24px)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", fontSize: 12, gap: 6 }}>
                <Icon name="image" size={16} /> Foto lapangan
              </div>
              <div style={{ padding: 16 }}>
                <Badge variant="outline">{it.tag}</Badge>
                <div style={{ fontSize: 16, fontWeight: 600, margin: "10px 0 4px" }}>{it.s}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{it.c}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const col = { display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--muted-foreground)" };
  return (
    <footer>
      <div style={{ ...wrap, padding: "48px 32px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 40 }}>
        <div style={{ maxWidth: 300 }}>
          <img src="../../assets/logo-sekolah-garuda.png" alt="Sekolah Garuda" style={{ height: 34, width: "auto" }} />
          <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55, marginTop: 12 }}>Sekolah Unggul Garuda Transformasi — STEM &amp; Research Track, dijalankan oleh DITSAMA ITB.</p>
        </div>
        <div style={col}><b style={{ color: "var(--foreground)", fontWeight: 600 }}>Program</b><a>Cakupan</a><a>Stream</a><a>Cluster</a></div>
        <div style={col}><b style={{ color: "var(--foreground)", fontWeight: 600 }}>Cerita</b><a>Lapangan</a><a>Sekolah</a><a>Final Project</a></div>
        <div style={col}><b style={{ color: "var(--foreground)", fontWeight: 600 }}>Penyelenggara</b><img src="../../assets/logo-dpb-full.jpeg" alt="Direktorat Persiapan Bersama ITB" style={{ height: 34, width: "auto", marginTop: 4, marginBottom: 6 }} /><a>DITSAMA ITB</a><a>Kementerian Pendidikan Tinggi</a></div>
      </div>
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ ...wrap, padding: "18px 32px", fontSize: 12, color: "var(--muted-foreground)", display: "flex", justifyContent: "space-between" }}>
          <span>© 2026 DITSAMA ITB</span>
          <span>Direktorat Persiapan Bersama ITB</span>
        </div>
      </div>
    </footer>
  );
}

function PublicSite() {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return (
    <div>
      <Header /><Hero /><Scope /><Delivery /><Streams /><Stories /><Footer />
    </div>
  );
}

window.PublicSite = PublicSite;
