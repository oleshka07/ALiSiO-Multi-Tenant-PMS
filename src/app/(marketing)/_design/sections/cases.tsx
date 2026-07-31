/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionCases() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>CUSTOMER STORIES</div>
        <h1 style={{ marginTop: "18px", fontSize: "clamp(38px,5.4vw,66px)", lineHeight: "1.02", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>What fourteen days in the shadows actually shows.</h1>
        <p style={{ marginTop: "22px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Property names, guest names and amounts on this page are illustrative models of real operating patterns. We do not publish customer data.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "52px auto 0", padding: "0 28px" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .8s ease", border: "1px solid rgba(255,255,255,.12)", borderRadius: "22px", overflow: "hidden", background: "#0C1013" }}>
          <div style={{ padding: "40px 44px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: "40px", alignItems: "end" }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "var(--acc,#3DDCC0)" }}>CASE STUDY · SHADOW CHECK</div>
              <h2 style={{ marginTop: "14px", fontSize: "38px", fontWeight: "600", letterSpacing: "-.03em", lineHeight: "1.1" }}>Aurora Valley Camp: the invoice for not having it</h2>
              <p style={{ marginTop: "14px", fontSize: "17px", lineHeight: "1.6", color: "#9BA3AB" }}>
                18 units · 6 non-room resources · 4 channels · one owner who also drives the tractor. Alisio ran read-only for fourteen days beside their existing tools, decided everything, executed nothing, and logged what it would have done.
              </p>
            </div>
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <span style={{ color: "#8B939C" }}>Setup time</span>
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>41 min</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                <span style={{ color: "#8B939C" }}>Decisions logged</span>
                <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>341</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px" }}>
                <span style={{ color: "#8B939C" }}>Estimated gap</span>
                <strong style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--acc,#3DDCC0)" }}>€3 940</strong>
              </div>
            </div>
          </div>
          <div style={{ padding: "40px 44px", display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "36px" }}>
            <div>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Where the gap came from</h3>
              <div style={{ marginTop: "16px", display: "grid", gap: "12px", fontSize: "15.5px", lineHeight: "1.6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", paddingBottom: "11px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <span style={{ color: "#B6BCC3" }}>Rate moves not taken, festival weekend priced flat</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>€1 820</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", paddingBottom: "11px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <span style={{ color: "#B6BCC3" }}>Orphan nights left unsold between two stays</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>€960</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", paddingBottom: "11px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <span style={{ color: "#B6BCC3" }}>Tub and sauna sessions never offered</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>€740</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "18px" }}>
                  <span style={{ color: "#B6BCC3" }}>Failed cards never retried</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>€420</strong>
                </div>
              </div>
              <p style={{ marginTop: "18px", fontSize: "15px", color: "#8B939C", lineHeight: "1.6" }}>
                None of it was negligence. All of it was one person having fourteen days and one pair of hands.
              </p>
            </div>
            <div>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>What changed after go-live</h3>
              <div style={{ marginTop: "16px", display: "grid", gap: "14px", fontSize: "15.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
                <div>
                  <strong style={{ color: "#ECEAE5", display: "block" }}>Weeks 1–4 · everyone at L2</strong>
                  Agents drafted, the owner tapped. Four decisions were cancelled; three of those cancellations later looked like mistakes.
                </div>
                <div>
                  <strong style={{ color: "#ECEAE5", display: "block" }}>Week 5 · Rate and Inbox to L3</strong>
                  First-response time fell from hours to under three minutes. Weekend ADR moved with demand instead of with the season sheet.
                </div>
                <div>
                  <strong style={{ color: "#ECEAE5", display: "block" }}>Month 3 · Compliance to L4</strong>
                  Foreign-guest filings stopped being a Sunday task. Zero missed windows since.
                </div>
                <div>
                  <strong style={{ color: "#ECEAE5", display: "block" }}>Month 6</strong>
                  Six non-room resources became eleven, because the marginal cost of selling one more was a calendar row.
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: "32px 44px", background: "rgba(61,220,192,.05)", borderTop: "1px solid rgba(61,220,192,.18)" }}>
            <blockquote style={{ margin: "0", fontSize: "20px", lineHeight: "1.5", letterSpacing: "-.015em", maxWidth: "80ch" }}>
              “I did not believe the shadow report. So I checked six of the three hundred decisions by hand. Five of them, it was right and I had been wrong for a year.”
            </blockquote>
            <div style={{ marginTop: "12px", fontSize: "13.5px", color: "#8B939C" }}>
              Owner · glamping resort, South Bohemia, composite quote from pilot conversations
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "70px auto 0", padding: "0 28px" }}>
        <h2 style={{ fontSize: "30px", fontWeight: "600", letterSpacing: "-.028em" }}>Other patterns we keep seeing</h2>
        <div style={{ marginTop: "26px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".12em" }}>BOUTIQUE HOTEL · 26 KEYS</div>
            <h3 style={{ marginTop: "12px", fontSize: "20px", fontWeight: "600", lineHeight: "1.25" }}>The reception that stopped typing</h3>
            <p style={{ marginTop: "10px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Self check-in adoption reached four in five stays within two months. The saved time went into arrival conversations, and the rating followed.
            </p>
            <div style={{ marginTop: "16px", display: "flex", gap: "16px", fontFamily: "'JetBrains Mono',monospace", fontSize: "13px" }}>
              <span style={{ color: "var(--acc,#3DDCC0)" }}>−9 min / arrival</span>
              <span style={{ color: "#8B939C" }}>+0.3 rating</span>
            </div>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .06s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".12em" }}>MANAGEMENT CO · 4 PROPERTIES</div>
            <h3 style={{ marginTop: "12px", fontSize: "20px", fontWeight: "600", lineHeight: "1.25" }}>The reporting week that became an afternoon</h3>
            <p style={{ marginTop: "10px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Owner packs generated from the same events reception created, per unit and per property, instead of rebuilt in spreadsheets each month.
            </p>
            <div style={{ marginTop: "16px", display: "flex", gap: "16px", fontFamily: "'JetBrains Mono',monospace", fontSize: "13px" }}>
              <span style={{ color: "var(--acc,#3DDCC0)" }}>−28 h / month</span>
              <span style={{ color: "#8B939C" }}>0 restatements</span>
            </div>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".12em" }}>WELLNESS RESORT · 40 KEYS</div>
            <h3 style={{ marginTop: "12px", fontSize: "20px", fontWeight: "600", lineHeight: "1.25" }}>The treatment that could not be double-sold</h3>
            <p style={{ marginTop: "10px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Therapists modelled as constraints on the same calendar as rooms. Spa conflicts, previously weekly, went to zero and stayed there.
            </p>
            <div style={{ marginTop: "16px", display: "flex", gap: "16px", fontFamily: "'JetBrains Mono',monospace", fontSize: "13px" }}>
              <span style={{ color: "var(--acc,#3DDCC0)" }}>0 conflicts</span>
              <span style={{ color: "#8B939C" }}>+14% spa revenue</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "90px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(61,220,192,.25)", borderRadius: "22px", padding: "60px", textAlign: "center", background: "radial-gradient(120% 180% at 50% 0%,rgba(61,220,192,.12),transparent 60%),#0B0E11" }}>
          <h2 style={{ fontSize: "clamp(28px,3.6vw,42px)", lineHeight: "1.08", letterSpacing: "-.03em", fontWeight: "600", maxWidth: "26ch", margin: "0 auto" }}>Your own shadow report takes fourteen days and no commitment.</h2>
          <div style={{ marginTop: "28px" }}>
            <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "16px 30px", borderRadius: "12px" }}>Book a demo</Link>
          </div>
        </div>
      </div>
    </>
  );
}
