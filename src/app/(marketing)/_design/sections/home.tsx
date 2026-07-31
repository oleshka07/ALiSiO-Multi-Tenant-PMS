/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionHome() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "96px 28px 0", position: "relative" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)", display: "inline-flex", alignItems: "center", gap: "10px", border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "7px 14px", fontSize: "13px", color: "#B6BCC3", flexWrap: "wrap", rowGap: "2px" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "var(--acc,#3DDCC0)" }} />
          <span style={{ whiteSpace: "nowrap" }}>PMS + AI Crew</span>
          <span style={{ color: "#5F676E", whiteSpace: "nowrap" }}>· hotels, glampings &amp; apartments</span>
          <span style={{ color: "#5F676E", whiteSpace: "nowrap" }}>· 8–60 units</span>
        </div>
        <h1 data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "opacity .8s cubic-bezier(.2,.7,.2,1) .08s,transform .8s cubic-bezier(.2,.7,.2,1) .08s", marginTop: "30px", fontSize: "clamp(44px,6.4vw,86px)", lineHeight: ".98", letterSpacing: "-.038em", fontWeight: "600", maxWidth: "17ch", textWrap: "balance" }} data-i18n="hero_h1">See what your property lost last month.</h1>
        <p data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "opacity .8s cubic-bezier(.2,.7,.2,1) .16s,transform .8s cubic-bezier(.2,.7,.2,1) .16s", marginTop: "26px", fontSize: "19.5px", lineHeight: "1.55", color: "#9BA3AB", maxWidth: "58ch", textWrap: "pretty" }} data-i18n="hero_sub">
          Alisio is a full property management system with a digital crew on top: pricing, guest replies, housekeeping, payments and compliance. Connect it read-only for 14 days: it makes every decision, executes none, and hands you an itemised receipt of what it would have earned.
        </p>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "opacity .8s cubic-bezier(.2,.7,.2,1) .24s,transform .8s cubic-bezier(.2,.7,.2,1) .24s", marginTop: "36px", display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "15.5px", padding: "15px 26px", borderRadius: "12px" }} data-i18n="cta_shadow" className="dcx-h1">Start Shadow Mode, 14 days, free</Link>
          <Link href="/agents" data-route="agents" style={{ border: "1px solid rgba(255,255,255,.16)", color: "#ECEAE5", fontWeight: "500", fontSize: "15.5px", padding: "15px 24px", borderRadius: "12px" }} data-i18n="cta_watch" className="dcx-h2">Watch the 90-second story</Link>
        </div>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .8s ease .32s", marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "18px", fontSize: "13.5px", color: "#6F787F" }}>
          <span>Read-only</span>
          <span>·</span>
          <span>Nothing changes</span>
          <span>·</span>
          <span>No card</span>
          <span>·</span>
          <span>Runs alongside your current PMS</span>
        </div>
      </div>
      <div style={{ maxWidth: "1400px", margin: "64px auto 0", padding: "0 28px", position: "relative" }}>
        <div data-reveal={true} data-parallax="-0.05" style={{ opacity: "0", transform: "translateY(40px)", transition: "opacity 1s cubic-bezier(.2,.7,.2,1),transform 1s cubic-bezier(.2,.7,.2,1)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", overflow: "hidden", background: "linear-gradient(180deg,#101418,#0B0E11)", boxShadow: "0 60px 160px rgba(0,0,0,.7)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.02)" }}>
            <div style={{ display: "flex", gap: "7px" }}>
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3B4148" }} />
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3B4148" }} />
              <span style={{ width: "11px", height: "11px", borderRadius: "50%", background: "#3B4148" }} />
            </div>
            <div style={{ flex: "1", textAlign: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#5F676E" }}>deck.alisio.app / Aurora Valley Camp · 18 units</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--acc,#3DDCC0)" }} />
              Live
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 372px", minHeight: "520px" }}>
            <div style={{ padding: "20px 22px", borderRight: "1px solid rgba(255,255,255,.07)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                  <h3 style={{ fontSize: "17px", fontWeight: "600" }}>August 2026</h3>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#6F787F" }}>occupancy 84% · ADR €142 · RevPAR €119</span>
                </div>
                <div style={{ display: "flex", gap: "6px", fontSize: "12px", color: "#8B939C" }}>
                  <span style={{ padding: "5px 10px", borderRadius: "7px", background: "rgba(255,255,255,.06)", color: "#ECEAE5" }}>Tape</span>
                  <span style={{ padding: "5px 10px", borderRadius: "7px" }}>Resources</span>
                  <span style={{ padding: "5px 10px", borderRadius: "7px" }}>Housekeeping</span>
                </div>
              </div>
              <div data-grid={true} style={{ fontSize: "12.5px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", marginBottom: "6px", fontFamily: "'JetBrains Mono',monospace", color: "#5F676E", fontSize: "11px" }}>
                  <span />
                  <span style={{ textAlign: "center" }}>10</span>
                  <span style={{ textAlign: "center" }}>11</span>
                  <span style={{ textAlign: "center" }}>12</span>
                  <span style={{ textAlign: "center" }}>13</span>
                  <span style={{ textAlign: "center", color: "#8B939C" }}>14</span>
                  <span style={{ textAlign: "center", color: "#8B939C" }}>15</span>
                  <span style={{ textAlign: "center" }}>16</span>
                  <span style={{ textAlign: "center" }}>17</span>
                  <span style={{ textAlign: "center" }}>18</span>
                  <span style={{ textAlign: "center" }}>19</span>
                  <span style={{ textAlign: "center", color: "#8B939C" }}>20</span>
                  <span style={{ textAlign: "center", color: "#8B939C" }}>21</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#B6BCC3" }}>Dome 01</span>
                  <span data-cell={true} style={{ gridColumn: "2/span 4", background: "linear-gradient(90deg,rgba(61,220,192,.24),rgba(61,220,192,.14))", border: "1px solid rgba(61,220,192,.4)", borderRadius: "7px", padding: "7px 10px", color: "#CFF6EE", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="K. Weber · 4 nights · Direct · €568 · paid">K. Weber · direct</span>
                  <span data-cell={true} style={{ gridColumn: "7/span 3", background: "rgba(255,255,255,.05)", border: "1px dashed rgba(255,255,255,.16)", borderRadius: "7px", padding: "7px 10px", color: "#7F888F", cursor: "pointer" }} data-bk="Open · 3 nights · Rate agent suggests €168/night for Fri–Sat">open</span>
                  <span data-cell={true} style={{ gridColumn: "10/span 4", background: "linear-gradient(90deg,rgba(96,140,255,.24),rgba(96,140,255,.14))", border: "1px solid rgba(96,140,255,.4)", borderRadius: "7px", padding: "7px 10px", color: "#D3DDFF", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Guest #7719 · Booking.com · 4 nights · €604 · commission 18%">Guest #7719 · BCOM</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#B6BCC3" }}>Dome 02</span>
                  <span data-cell={true} style={{ gridColumn: "2/span 2", background: "rgba(255,255,255,.05)", border: "1px dashed rgba(255,255,255,.16)", borderRadius: "7px", padding: "7px 10px", color: "#7F888F", cursor: "pointer" }} data-bk="Open · orphan night flagged by Tetris agent">open</span>
                  <span data-cell={true} style={{ gridColumn: "4/span 6", background: "linear-gradient(90deg,rgba(242,180,90,.24),rgba(242,180,90,.14))", border: "1px solid rgba(242,180,90,.42)", borderRadius: "7px", padding: "7px 10px", color: "#FFE3B4", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Group · 12 pax · deposit pending · €3 120 · contract sent">Group · 12 pax · deposit due</span>
                  <span data-cell={true} style={{ gridColumn: "10/span 4", background: "linear-gradient(90deg,rgba(61,220,192,.24),rgba(61,220,192,.14))", border: "1px solid rgba(61,220,192,.4)", borderRadius: "7px", padding: "7px 10px", color: "#CFF6EE", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="L. Moreau · 4 nights · Airbnb · checked in">L. Moreau · Airbnb</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#B6BCC3" }}>Cabin 03</span>
                  <span data-cell={true} style={{ gridColumn: "2/span 3", background: "linear-gradient(90deg,rgba(61,220,192,.24),rgba(61,220,192,.14))", border: "1px solid rgba(61,220,192,.4)", borderRadius: "7px", padding: "7px 10px", color: "#CFF6EE", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Guest #4412 · 3 nights · card retried successfully · €412">Guest #4412</span>
                  <span data-cell={true} style={{ gridColumn: "5/span 2", background: "rgba(255,107,90,.14)", border: "1px solid rgba(255,107,90,.38)", borderRadius: "7px", padding: "7px 10px", color: "#FFC4BB", cursor: "pointer" }} data-bk="Blocked · shower tray repair · contractor booked 15.08 09:00">maintenance</span>
                  <span data-cell={true} style={{ gridColumn: "8/span 6", background: "linear-gradient(90deg,rgba(61,220,192,.24),rgba(61,220,192,.14))", border: "1px solid rgba(61,220,192,.4)", borderRadius: "7px", padding: "7px 10px", color: "#CFF6EE", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Repeat guest · 6 nights · upgraded by Tetris · €1 014">Repeat guest · upgraded</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#B6BCC3" }}>Loft A2</span>
                  <span data-cell={true} style={{ gridColumn: "3/span 5", background: "linear-gradient(90deg,rgba(96,140,255,.24),rgba(96,140,255,.14))", border: "1px solid rgba(96,140,255,.4)", borderRadius: "7px", padding: "7px 10px", color: "#D3DDFF", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Guest #2205 · Expedia · 5 nights · €710">Guest #2205 · Expedia</span>
                  <span data-cell={true} style={{ gridColumn: "9/span 2", background: "rgba(255,255,255,.05)", border: "1px dashed rgba(255,255,255,.16)", borderRadius: "7px", padding: "7px 10px", color: "#7F888F", cursor: "pointer" }} data-bk="Open · min-LOS raised to 2 by Rate agent">open</span>
                  <span data-cell={true} style={{ gridColumn: "11/span 3", background: "linear-gradient(90deg,rgba(61,220,192,.24),rgba(61,220,192,.14))", border: "1px solid rgba(61,220,192,.4)", borderRadius: "7px", padding: "7px 10px", color: "#CFF6EE", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden" }} data-bk="Walk-in · 3 nights · paid at reception via Teya">Walk-in</span>
                </div>
                <div style={{ height: "1px", background: "rgba(255,255,255,.07)", margin: "12px 0 10px" }} />
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10.5px", letterSpacing: ".12em", color: "#5F676E", marginBottom: "8px" }}>NON-ROOM RESOURCES · SAME CALENDAR</div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#B6BCC3" }}>Hot tub · 90′</span>
                  <span data-cell={true} style={{ gridColumn: "3/span 1", background: "rgba(242,180,90,.16)", border: "1px solid rgba(242,180,90,.36)", borderRadius: "7px", padding: "7px 6px", color: "#FFE3B4", textAlign: "center", cursor: "pointer" }} data-bk="Hot tub session 18:00–19:30 · €45 · sold in Guest Portal">18:00</span>
                  <span data-cell={true} style={{ gridColumn: "5/span 1", background: "rgba(242,180,90,.16)", border: "1px solid rgba(242,180,90,.36)", borderRadius: "7px", padding: "7px 6px", color: "#FFE3B4", textAlign: "center", cursor: "pointer" }} data-bk="Hot tub session 20:00–21:30 · €45 · upsold by agent">20:00</span>
                  <span data-cell={true} style={{ gridColumn: "8/span 1", background: "rgba(242,180,90,.16)", border: "1px solid rgba(242,180,90,.36)", borderRadius: "7px", padding: "7px 6px", color: "#FFE3B4", textAlign: "center", cursor: "pointer" }} data-bk="Hot tub session 19:00–20:30 · €45">19:00</span>
                  <span data-cell={true} style={{ gridColumn: "11/span 1", background: "rgba(242,180,90,.16)", border: "1px solid rgba(242,180,90,.36)", borderRadius: "7px", padding: "7px 6px", color: "#FFE3B4", textAlign: "center", cursor: "pointer" }} data-bk="Hot tub session 17:30–19:00 · €45">17:30</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "126px repeat(12,1fr)", gap: "4px", alignItems: "center" }}>
                  <span style={{ color: "#B6BCC3" }}>EV parking</span>
                  <span data-cell={true} style={{ gridColumn: "2/span 4", background: "rgba(120,200,255,.14)", border: "1px solid rgba(120,200,255,.34)", borderRadius: "7px", padding: "7px 10px", color: "#CDE9FF", cursor: "pointer" }} data-bk="EV bay · 4 nights · €12/night · added at check-in">EV bay · €12/night</span>
                  <span data-cell={true} style={{ gridColumn: "10/span 4", background: "rgba(120,200,255,.14)", border: "1px solid rgba(120,200,255,.34)", borderRadius: "7px", padding: "7px 10px", color: "#CDE9FF", cursor: "pointer" }} data-bk="EV bay · 4 nights · €12/night">EV bay · €12/night</span>
                </div>
              </div>
              <div data-booking-detail={true} style={{ marginTop: "16px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px", padding: "12px 14px", fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#8B939C", background: "rgba(255,255,255,.025)" }}>Click any bar on the tape → booking details appear here.</div>
            </div>
            <aside style={{ padding: "20px 20px", display: "flex", flexDirection: "column", minHeight: "0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <h4 style={{ fontSize: "14.5px", fontWeight: "600" }}>Decision Ledger</h4>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "var(--acc,#3DDCC0)" }}>41 today</span>
              </div>
              <p style={{ fontSize: "12.5px", color: "#6F787F", marginBottom: "14px" }}>Every autonomous action, its reason and its measured effect.</p>
              <div data-ledger={true} style={{ display: "flex", flexDirection: "column", gap: "8px" }} />
              <div style={{ marginTop: "16px", border: "1px solid rgba(61,220,192,.35)", borderRadius: "13px", padding: "14px 16px", background: "rgba(61,220,192,.07)" }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10.5px", letterSpacing: ".14em", color: "var(--acc,#3DDCC0)" }}>SHADOW RECEIPT · DEMO DATA</div>
                <div style={{ marginTop: "9px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12.5px", color: "#8B939C" }}>14 days · 341 decisions</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "26px", letterSpacing: "-.02em", color: "var(--acc,#3DDCC0)" }}>+€3 940</strong>
                </div>
              </div>
              <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12.5px", color: "#6F787F" }}>Reversible for 2h</span>
                <Link href="/agents" data-route="agents" style={{ fontSize: "13px", fontWeight: "600" }}>Open the crew →</Link>
              </div>
            </aside>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "56px auto 0", padding: "0 28px" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .7s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", background: "#0B0E11", padding: "22px 26px", display: "flex", flexWrap: "wrap", gap: "26px", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "14px", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "17px", fontWeight: "600" }}>Aurora Valley Camp</strong>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "13px", color: "#8B939C" }}>18 units · +€3 940 in 14 days</span>
            <span style={{ border: "1px solid rgba(255,255,255,.14)", borderRadius: "99px", padding: "4px 10px", fontSize: "11.5px", color: "#6F787F" }}>demo data</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "12.5px" }}>
            <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>99.9% uptime</span>
            <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>GDPR · EU hosting</span>
            <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>PCI-DSS acquiring</span>
            <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>Open API</span>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "56px auto 0", padding: "0 28px" }}>
        <p style={{ textAlign: "center", fontSize: "12px", letterSpacing: ".16em", textTransform: "uppercase", color: "#5F676E", marginBottom: "24px" }}>Running the day at independent properties across Central Europe</p>
        <div style={{ overflow: "hidden", maskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)" }}>
          <div style={{ display: "flex", gap: "60px", width: "max-content", animation: "marq 38s linear infinite", fontSize: "17px", fontWeight: "600", letterSpacing: "-.01em", color: "#4C545B" }}>
            <span>Aurora Valley Camp</span>
            <span>Hoffmann Boutique</span>
            <span>Ostrava Lofts</span>
            <span>Bergwald Resort</span>
            <span>Sedmý Dům</span>
            <span>Lakeside Domes</span>
            <span>Vltava Retreat</span>
            <span>Kamenný Mlýn</span>
            <span>Aurora Valley Camp</span>
            <span>Hoffmann Boutique</span>
            <span>Ostrava Lofts</span>
            <span>Bergwald Resort</span>
            <span>Sedmý Dům</span>
            <span>Lakeside Domes</span>
            <span>Vltava Retreat</span>
            <span>Kamenný Mlýn</span>
          </div>
        </div>
        <p style={{ textAlign: "center", fontSize: "11.5px", color: "#3E454B", marginTop: "14px" }}>Illustrative property names, used for demonstration of the product surface.</p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "110px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .75s cubic-bezier(.2,.7,.2,1)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", padding: "40px", background: "#0C1013", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>SEGMENT 01</div>
            <h2 style={{ marginTop: "14px", fontSize: "30px", fontWeight: "600", letterSpacing: "-.028em", lineHeight: "1.12" }}>Still on spreadsheets and extranets?</h2>
            <p style={{ marginTop: "16px", fontSize: "17px", lineHeight: "1.62", color: "#9BA3AB" }}>
              You are the system. Every message, every rate change, every police report goes through you, and the night shift never ends because there is nobody else on it. Alisio replaces the stack and the night shift at once.
            </p>
            <div style={{ marginTop: "22px", display: "grid", gap: "9px", fontSize: "15px", color: "#B6BCC3" }}>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                One calendar for rooms and everything else you sell
              </div>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                Channels connected, so the double booking stops being possible
              </div>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                Guest replies and filings handled while you sleep
              </div>
            </div>
            <Link href="/demo" data-route="demo" style={{ marginTop: "auto", paddingTop: "28px", fontWeight: "600", fontSize: "15.5px" }}>Set it up in 40 minutes →</Link>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .75s cubic-bezier(.2,.7,.2,1) .1s", border: "1px solid rgba(61,220,192,.26)", borderRadius: "20px", padding: "40px", background: "radial-gradient(120% 170% at 15% 0%,rgba(61,220,192,.09),transparent 60%),#0C1013", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "var(--acc,#3DDCC0)" }}>SEGMENT 02</div>
            <h2 style={{ marginTop: "14px", fontSize: "30px", fontWeight: "600", letterSpacing: "-.028em", lineHeight: "1.12" }}>Already running a PMS?</h2>
            <p style={{ marginTop: "16px", fontSize: "17px", lineHeight: "1.62", color: "#9BA3AB" }}>
              Yesterday your PMS made zero decisions. It stored them. Alisio makes them, and shows you what that is worth before you switch anything at all.
            </p>
            <div style={{ marginTop: "22px", display: "grid", gap: "9px", fontSize: "15px", color: "#B6BCC3" }}>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                Read-only for fourteen days, beside what you use today
              </div>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                Every decision logged with its reason and its value
              </div>
              <div style={{ display: "flex", gap: "11px" }}>
                <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                An itemised receipt on day fourteen, then your call
              </div>
            </div>
            <Link href="/cases" data-route="cases" style={{ marginTop: "auto", paddingTop: "28px", fontWeight: "600", fontSize: "15.5px" }}>Run it alongside yours for 14 days →</Link>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "110px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1px", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "18px", overflow: "hidden" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .7s cubic-bezier(.2,.7,.2,1)", background: "#0B0E11", padding: "34px 30px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>HOURS RETURNED</div>
            <div style={{ fontSize: "56px", fontWeight: "600", letterSpacing: "-.04em", marginTop: "14px", color: "#ECEAE5" }}>
              <span data-count-to="15">0</span>
              <span style={{ color: "var(--acc,#3DDCC0)" }}>h</span>
              <span style={{ fontSize: "22px", color: "#6F787F", fontWeight: "400" }}>/ week</span>
            </div>
            <p style={{ marginTop: "12px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Measured from the log of autonomous actions × the standard time of each operation. Not a brochure number.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .7s cubic-bezier(.2,.7,.2,1) .1s", background: "#0B0E11", padding: "34px 30px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>GOPPAR UPLIFT</div>
            <div style={{ fontSize: "56px", fontWeight: "600", letterSpacing: "-.04em", marginTop: "14px", color: "#ECEAE5" }}>
              +
              <span data-count-to="11">0</span>
              <span style={{ color: "var(--acc,#3DDCC0)" }}>%</span>
              <span style={{ fontSize: "22px", color: "#6F787F", fontWeight: "400" }}>per unit</span>
            </div>
            <p style={{ marginTop: "12px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Proven against a randomised holdout baseline, 12% of dates stay on your own rules, so the difference is real.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .7s cubic-bezier(.2,.7,.2,1) .2s", background: "#0B0E11", padding: "34px 30px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>COMPLIANCE STREAK</div>
            <div style={{ fontSize: "56px", fontWeight: "600", letterSpacing: "-.04em", marginTop: "14px", color: "#ECEAE5" }}>
              <span data-count-to="0">0</span>
              <span style={{ fontSize: "22px", color: "#6F787F", fontWeight: "400" }}>fines · 0 missed filings</span>
            </div>
            <p style={{ marginTop: "12px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Foreign-guest registration, city tax, DAC7, e-invoicing. We don't ask whether you filed. We show the confirmation.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "130px auto 0", padding: "0 28px" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", maxWidth: "56ch" }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>01 · THE FOUNDATION</div>
          <h2 style={{ marginTop: "18px", fontSize: "clamp(32px,4.2vw,54px)", lineHeight: "1.04", letterSpacing: "-.032em", fontWeight: "600" }}>A PMS your receptionist learns in 25 minutes.</h2>
          <p style={{ marginTop: "20px", fontSize: "18px", lineHeight: "1.6", color: "#9BA3AB" }}>
            Before any of the clever parts: the boring parts have to be excellent. Fourteen modules on one database, with a single calendar for every sellable thing you own.
          </p>
        </div>
        <div data-tabs="found" style={{ marginTop: "40px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", borderBottom: "1px solid rgba(255,255,255,.08)", paddingBottom: "14px" }}>
            <button data-tab-btn="grid" style={{ all: "unset", cursor: "pointer", padding: "9px 16px", borderRadius: "99px", fontSize: "14.5px", color: "#07100E", background: "var(--acc,#3DDCC0)", fontWeight: "600" }} type="button">Booking tape</button>
            <button data-tab-btn="chan" style={{ all: "unset", cursor: "pointer", padding: "9px 16px", borderRadius: "99px", fontSize: "14.5px", color: "#B6BCC3" }} type="button">Channels</button>
            <button data-tab-btn="fin" style={{ all: "unset", cursor: "pointer", padding: "9px 16px", borderRadius: "99px", fontSize: "14.5px", color: "#B6BCC3" }} type="button">Finance &amp; P&amp;L</button>
            <button data-tab-btn="guest" style={{ all: "unset", cursor: "pointer", padding: "9px 16px", borderRadius: "99px", fontSize: "14.5px", color: "#B6BCC3" }} type="button">Guest Portal</button>
            <button data-tab-btn="ops" style={{ all: "unset", cursor: "pointer", padding: "9px 16px", borderRadius: "99px", fontSize: "14.5px", color: "#B6BCC3" }} type="button">Housekeeping</button>
          </div>
          <div data-tab-panel="grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "44px", alignItems: "center", paddingTop: "38px" }}>
            <div>
              <h3 style={{ fontSize: "28px", fontWeight: "600", letterSpacing: "-.02em" }}>Drag a booking. Everything else catches up.</h3>
              <p style={{ marginTop: "16px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
                Move a stay to another unit and the price recalculates, the channels resync, housekeeping reschedules and the folio updates, in the same gesture. Groups get one balance and a room-allocation board. Blocks for repairs are one click and instantly close the OTA calendars.
              </p>
              <ul style={{ marginTop: "22px", display: "grid", gap: "11px", fontSize: "15.5px", color: "#B6BCC3" }}>
                <li style={{ display: "flex", gap: "11px" }}>
                  <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                  Colour-coded statuses: confirmed, in-house, departed, awaiting payment, blocked
                </li>
                <li style={{ display: "flex", gap: "11px" }}>
                  <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                  Quick-create in 4 fields, guest matched by phone or e-mail
                </li>
                <li style={{ display: "flex", gap: "11px" }}>
                  <span style={{ color: "var(--acc,#3DDCC0)" }}>•</span>
                  Audit log on every booking: who changed what, when, and why
                </li>
              </ul>
              <Link href="/modules/calendar" data-route="m-calendar" style={{ display: "inline-block", marginTop: "24px", fontWeight: "600" }}>Explore the calendar module →</Link>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", background: "#0D1114", padding: "18px", boxShadow: "0 30px 80px rgba(0,0,0,.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", marginBottom: "12px" }}>
                <span>QUICK CREATE</span>
                <span>⌘K</span>
              </div>
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "10px", padding: "11px 13px" }}>
                    <div style={{ fontSize: "11px", color: "#5F676E" }}>CHECK-IN</div>
                    <div style={{ fontSize: "15px", marginTop: "3px" }}>Fri 14 Aug</div>
                  </div>
                  <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "10px", padding: "11px 13px" }}>
                    <div style={{ fontSize: "11px", color: "#5F676E" }}>CHECK-OUT</div>
                    <div style={{ fontSize: "15px", marginTop: "3px" }}>Mon 17 Aug</div>
                  </div>
                </div>
                <div style={{ border: "1px solid rgba(61,220,192,.4)", borderRadius: "10px", padding: "11px 13px", background: "rgba(61,220,192,.06)" }}>
                  <div style={{ fontSize: "11px", color: "var(--acc,#3DDCC0)" }}>UNIT</div>
                  <div style={{ fontSize: "15px", marginTop: "3px" }}>Dome 01 · panoramic, sleeps 4</div>
                </div>
                <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "10px", padding: "11px 13px" }}>
                  <div style={{ fontSize: "11px", color: "#5F676E" }}>RATE PLAN</div>
                  <div style={{ fontSize: "15px", marginTop: "3px" }}>Standard flexible · €142/night</div>
                </div>
                <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "10px", padding: "11px 13px" }}>
                  <div style={{ fontSize: "11px", color: "#5F676E" }}>EXTRAS</div>
                  <div style={{ fontSize: "15px", marginTop: "3px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ background: "rgba(242,180,90,.14)", color: "#FFE3B4", borderRadius: "7px", padding: "3px 9px", fontSize: "13px" }}>Hot tub 90′ €45</span>
                    <span style={{ background: "rgba(255,255,255,.06)", borderRadius: "7px", padding: "3px 9px", fontSize: "13px" }}>Breakfast ×3 €54</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "6px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#5F676E" }}>TOTAL</div>
                    <div style={{ fontSize: "24px", fontWeight: "600", letterSpacing: "-.02em" }}>
                      €525
                      <span style={{ fontSize: "13px", color: "#6F787F", fontWeight: "400" }}>≈ 12 900 Kč</span>
                    </div>
                  </div>
                  <span style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "14px", padding: "11px 18px", borderRadius: "10px" }}>Create &amp; send payment link</span>
                </div>
              </div>
            </div>
          </div>
          <div data-tab-panel="chan" style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: "44px", alignItems: "center", paddingTop: "38px" }}>
            <div>
              <h3 style={{ fontSize: "28px", fontWeight: "600", letterSpacing: "-.02em" }}>Two-way ARI. Overbooking becomes structurally impossible.</h3>
              <p style={{ marginTop: "16px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
                Availability, rates and inventory push to Booking.com, Airbnb, Expedia, Hostex and any iCal endpoint. New reservations land in the tape in 2–5 seconds. The resource invariant lives in the database, not in an agent, nothing in the system can create a conflict.
              </p>
              <Link href="/modules/channels" data-route="m-channels" style={{ display: "inline-block", marginTop: "24px", fontWeight: "600" }}>Explore the channel manager →</Link>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", background: "#0D1114", padding: "18px" }}>
              <div style={{ display: "grid", gap: "9px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid rgba(61,220,192,.28)", background: "rgba(61,220,192,.05)", borderRadius: "11px" }}>
                  <span style={{ fontWeight: "500" }}>Booking.com</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>synced 2s ago · 18/18 mapped</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                  <span style={{ fontWeight: "500" }}>Airbnb</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>synced 9s ago</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                  <span style={{ fontWeight: "500" }}>Expedia</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>synced 31s ago</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid rgba(242,180,90,.34)", background: "rgba(242,180,90,.05)", borderRadius: "11px" }}>
                  <span style={{ fontWeight: "500" }}>Hostex</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#F2B45A" }}>retry 1/3 · auto</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "11px" }}>
                  <span style={{ fontWeight: "500" }}>iCal · 6 endpoints</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#8B939C" }}>parsed 4m ago</span>
                </div>
                <div style={{ marginTop: "6px", padding: "13px 14px", borderRadius: "11px", background: "rgba(255,255,255,.03)", fontSize: "13.5px", color: "#8B939C" }}>
                  Parity check:
                  <span style={{ color: "var(--acc,#3DDCC0)" }}>no gaps</span>
                  across 5 channels · 0 overbookings in 214 days
                </div>
              </div>
            </div>
          </div>
          <div data-tab-panel="fin" style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: "44px", alignItems: "center", paddingTop: "38px" }}>
            <div>
              <h3 style={{ fontSize: "28px", fontWeight: "600", letterSpacing: "-.02em" }}>Profit per unit-night, the moment the night happens.</h3>
              <p style={{ marginTop: "16px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
                Hoteliers see revenue, and profit shows up in accounting forty days later. Alisio subtracts real channel commission, real acquiring fee, cleaning minutes × shift rate, energy profile, amenities and amortisation, per night, per unit. Then it shows you which bookings lose money.
              </p>
              <Link href="/modules/finance" data-route="m-finance" style={{ display: "inline-block", marginTop: "24px", fontWeight: "600" }}>Explore the finance engine →</Link>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", background: "#0D1114", padding: "20px", fontFamily: "'JetBrains Mono',monospace", fontSize: "13.5px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#8B939C", marginBottom: "12px" }}>
                <span>DOME 01 · NIGHT 14.08</span>
                <span style={{ color: "#5F676E" }}>unit-night P&amp;L</span>
              </div>
              <div style={{ display: "grid", gap: "9px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#B6BCC3" }}>Room revenue</span>
                  <span>€168.00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#B6BCC3" }}>Hot tub session</span>
                  <span>€45.00</span>
                </div>
                <div style={{ height: "1px", background: "rgba(255,255,255,.08)", margin: "2px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
                  <span>Channel commission 18%</span>
                  <span>−€30.24</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
                  <span>Acquiring (Teya, real)</span>
                  <span>−€2.61</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
                  <span>Cleaning 52 min × rate</span>
                  <span>−€22.00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
                  <span>Energy + amenities</span>
                  <span>−€9.40</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#FF8E80" }}>
                  <span>Amortisation</span>
                  <span>−€6.80</span>
                </div>
                <div style={{ height: "1px", background: "rgba(255,255,255,.14)", margin: "4px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "19px", color: "var(--acc,#3DDCC0)" }}>
                  <span>GOP unit-night</span>
                  <span>€141.95</span>
                </div>
                <div style={{ marginTop: "10px", padding: "11px 13px", borderRadius: "10px", background: "rgba(255,107,90,.08)", border: "1px solid rgba(255,107,90,.24)", color: "#FFC4BB", fontFamily: "'Instrument Sans',sans-serif", fontSize: "13.5px", lineHeight: "1.5" }}>
                  Flagged: single Monday nights from this channel run at −€4 after cleaning. Rate agent raised min-LOS to 2.
                </div>
              </div>
            </div>
          </div>
          <div data-tab-panel="guest" style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: "44px", alignItems: "center", paddingTop: "38px" }}>
            <div>
              <h3 style={{ fontSize: "28px", fontWeight: "600", letterSpacing: "-.02em" }}>The guest never downloads anything.</h3>
              <p style={{ marginTop: "16px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
                One secure link. Passport scan, digital signature on the house rules, balance paid with Apple Pay, hot tub booked for 8pm, Wi-Fi password and the trail map, all before arrival. Reception saves several minutes on every arrival.
              </p>
              <Link href="/modules/guest-portal" data-route="m-guest" style={{ display: "inline-block", marginTop: "24px", fontWeight: "600" }}>Explore the guest portal →</Link>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: "300px", border: "10px solid #1A1F24", borderRadius: "42px", background: "#0D1114", padding: "16px 14px 22px", boxShadow: "0 40px 90px rgba(0,0,0,.6)", animation: "floaty 7s ease-in-out infinite" }}>
                <div style={{ width: "78px", height: "5px", borderRadius: "99px", background: "#2A3036", margin: "0 auto 16px" }} />
                <div style={{ fontSize: "12px", color: "#6F787F" }}>Aurora Valley Camp</div>
                <div style={{ fontSize: "20px", fontWeight: "600", marginTop: "4px", letterSpacing: "-.02em" }}>Welcome, you're in Dome 01</div>
                <div style={{ marginTop: "16px", display: "grid", gap: "9px", fontSize: "13.5px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "11px", background: "rgba(61,220,192,.08)", border: "1px solid rgba(61,220,192,.28)" }}>
                    <span style={{ color: "var(--acc,#3DDCC0)" }}>✓</span>
                    <span>Documents uploaded</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", borderRadius: "11px", background: "rgba(61,220,192,.08)", border: "1px solid rgba(61,220,192,.28)" }}>
                    <span style={{ color: "var(--acc,#3DDCC0)" }}>✓</span>
                    <span>House rules signed</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: "11px", border: "1px solid rgba(255,255,255,.12)" }}>
                    <span>Balance €212</span>
                    <span style={{ background: "#ECEAE5", color: "#0B0E11", fontWeight: "600", borderRadius: "8px", padding: "5px 11px", fontSize: "12.5px" }}>Pay</span>
                  </div>
                  <div style={{ padding: "12px", borderRadius: "11px", border: "1px solid rgba(242,180,90,.3)", background: "rgba(242,180,90,.06)" }}>
                    <div style={{ fontWeight: "600" }}>Heat the hot tub?</div>
                    <div style={{ color: "#8B939C", fontSize: "12.5px", marginTop: "2px" }}>Tonight 20:00 · €45 · 2 slots left</div>
                  </div>
                  <div style={{ padding: "12px", borderRadius: "11px", border: "1px solid rgba(255,255,255,.12)" }}>
                    <div style={{ fontSize: "12px", color: "#6F787F" }}>WI-FI</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", marginTop: "2px" }}>aurora-guest / 8842</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div data-tab-panel="ops" style={{ display: "none", gridTemplateColumns: "1fr 1fr", gap: "44px", alignItems: "center", paddingTop: "38px" }}>
            <div>
              <h3 style={{ fontSize: "28px", fontWeight: "600", letterSpacing: "-.02em" }}>One card. Swipe done. Photo is the proof.</h3>
              <p style={{ marginTop: "16px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
                Housekeeping and maintenance work from a phone, in their own language, with gloves on. Routes are ordered by arrival time, not by unit number. Every completion carries a timestamp and a photo, which is also how cleaning minutes reach the unit-night P&amp;L.
              </p>
              <Link href="/modules/housekeeping" data-route="m-ops" style={{ display: "inline-block", marginTop: "24px", fontWeight: "600" }}>Explore tasks &amp; housekeeping →</Link>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "16px" }}>
              <div style={{ width: "250px", border: "9px solid #1A1F24", borderRadius: "36px", background: "#0D1114", padding: "14px 12px 18px", boxShadow: "0 40px 90px rgba(0,0,0,.6)" }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#6F787F" }}>TASK 3 OF 7 · 09:12</div>
                <div style={{ marginTop: "12px", padding: "14px", borderRadius: "14px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)" }}>
                  <div style={{ fontSize: "19px", fontWeight: "600" }}>Dome 02</div>
                  <div style={{ color: "#8B939C", fontSize: "13.5px", marginTop: "4px" }}>Departure clean · arrival 15:00</div>
                  <div style={{ display: "flex", gap: "7px", marginTop: "12px", flexWrap: "wrap", fontSize: "12px" }}>
                    <span style={{ background: "rgba(255,107,90,.14)", color: "#FFC4BB", padding: "4px 9px", borderRadius: "7px" }}>Priority</span>
                    <span style={{ background: "rgba(255,255,255,.06)", padding: "4px 9px", borderRadius: "7px" }}>Linen ×2</span>
                    <span style={{ background: "rgba(255,255,255,.06)", padding: "4px 9px", borderRadius: "7px" }}>Tub drain</span>
                  </div>
                  <div style={{ marginTop: "14px", border: "1px dashed rgba(255,255,255,.18)", borderRadius: "11px", padding: "20px", textAlign: "center", fontSize: "13px", color: "#6F787F" }}>📷 Add proof photo</div>
                  <div style={{ marginTop: "12px", background: "var(--acc,#3DDCC0)", color: "#07100E", textAlign: "center", fontWeight: "600", borderRadius: "11px", padding: "14px" }}>Swipe → done</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "140px", borderTop: "1px solid rgba(255,255,255,.08)", background: "linear-gradient(180deg,rgba(61,220,192,.05),transparent 40%)" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "96px 28px 0" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", maxWidth: "58ch" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>02 · THE CREW</div>
            <h2 style={{ marginTop: "18px", fontSize: "clamp(32px,4.2vw,54px)", lineHeight: "1.04", letterSpacing: "-.032em", fontWeight: "600" }}>Then you hire the crew, and decide how far it may go.</h2>
            <p style={{ marginTop: "20px", fontSize: "18px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Thirteen narrow specialists. Each has its own tools, budget, guardrails and KPI. Each one sits at an autonomy level you set. Turn the dial down to zero and Alisio is simply a very good cloud PMS.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", marginTop: "48px", display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: "28px", alignItems: "stretch" }}>
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", background: "#0C1013", padding: "32px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Autonomy dial · Rate agent</h3>
                <span data-dial-level={true} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "34px", fontWeight: "500", color: "var(--acc,#3DDCC0)", letterSpacing: "-.02em" }}>L3</span>
              </div>
              <input data-dial={true} type="range" min="0" max="5" step="1" style={{ width: "100%", margin: "26px 0 8px", height: "22px", cursor: "pointer" }} defaultValue="3" />
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>
                <span>L0</span>
                <span>L1</span>
                <span>L2</span>
                <span>L3</span>
                <span>L4</span>
                <span>L5</span>
              </div>
              <div style={{ marginTop: "22px" }}>
                <div data-dial-name={true} style={{ fontSize: "22px", fontWeight: "600", letterSpacing: "-.02em" }}>Act with undo</div>
                <p data-dial-desc={true} style={{ marginTop: "10px", fontSize: "16px", lineHeight: "1.6", color: "#9BA3AB", minHeight: "78px" }}>
                  Acts on its own, tells you immediately, and leaves a two-hour cancellation window on every move. Like an experienced manager you trust with the day.
                </p>
              </div>
              <div data-dial-meta={true} style={{ marginTop: "18px", display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "13px" }}>
                <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>Price floor: cost × 1.35</span>
                <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>Max move / 24h: 18%</span>
                <span style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "99px", padding: "6px 12px", color: "#B6BCC3" }}>&gt;25% change → you approve</span>
              </div>
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ background: "rgba(255,107,90,.12)", border: "1px solid rgba(255,107,90,.3)", color: "#FFC4BB", fontWeight: "600", fontSize: "13.5px", padding: "10px 16px", borderRadius: "10px" }}>Manual mode, all agents to L0</span>
                <span style={{ fontSize: "13px", color: "#6F787F" }}>One switch. The hotel keeps running.</span>
              </div>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", background: "#0C1013", padding: "32px", display: "flex", flexDirection: "column" }}>
              <h3 style={{ fontSize: "20px", fontWeight: "600" }}>Tuesday, 08:00 · Pulse briefing</h3>
              <p style={{ fontSize: "14px", color: "#6F787F", marginTop: "6px" }}>Three facts, two decisions and one anomaly. Nothing else.</p>
              <div style={{ marginTop: "22px", display: "grid", gap: "14px", fontSize: "15px", lineHeight: "1.6" }}>
                <div style={{ borderLeft: "2px solid var(--acc,#3DDCC0)", paddingLeft: "16px" }}>
                  <span style={{ color: "#6F787F", fontSize: "13px", display: "block" }}>MONEY</span>
                  Yesterday €4 180 (+12% vs last Tuesday). GOP €2 640, margin 63%.
                </div>
                <div style={{ borderLeft: "2px solid rgba(255,255,255,.2)", paddingLeft: "16px" }}>
                  <span style={{ color: "#6F787F", fontSize: "13px", display: "block" }}>OVERNIGHT</span>
                  41 decisions. Night audit closed. Six foreign guests filed and confirmed. Two cards re-charged successfully.
                </div>
                <div style={{ borderLeft: "2px solid #F2B45A", paddingLeft: "16px" }}>
                  <span style={{ color: "#6F787F", fontSize: "13px", display: "block" }}>NEEDS YOU</span>
                  Group contract changes payment to 100% post-pay. Exposure €14 200.
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    <span style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "13px", padding: "7px 14px", borderRadius: "8px" }}>Read</span>
                    <span style={{ border: "1px solid rgba(255,255,255,.16)", fontSize: "13px", padding: "7px 14px", borderRadius: "8px", color: "#B6BCC3" }}>Later</span>
                  </div>
                </div>
                <div style={{ borderLeft: "2px solid #FF6B5A", paddingLeft: "16px" }}>
                  <span style={{ color: "#6F787F", fontSize: "13px", display: "block" }}>ANOMALY</span>
                  Unit 14: cleaning time up for the third week. Maintenance suspects the shower tray. Contractor €400–600, your call.
                </div>
              </div>
              <div style={{ marginTop: "auto", paddingTop: "22px", fontSize: "13.5px", color: "#6F787F" }}>Four minutes. Then you go and drink coffee with your housekeepers.</div>
            </div>
          </div>
          <div style={{ marginTop: "28px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" }}>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "18px", background: "#0C1013" }} className="dcx-h3">
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>01</div>
              <div style={{ fontWeight: "600", marginTop: "6px" }}>Rate</div>
              <div style={{ fontSize: "13.5px", color: "#8B939C", marginTop: "4px" }}>RevPAR vs holdout</div>
            </div>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .04s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "18px", background: "#0C1013" }} className="dcx-h3">
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>02</div>
              <div style={{ fontWeight: "600", marginTop: "6px" }}>Tetris</div>
              <div style={{ fontSize: "13.5px", color: "#8B939C", marginTop: "4px" }}>Lost capacity %</div>
            </div>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .08s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "18px", background: "#0C1013" }} className="dcx-h3">
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>03</div>
              <div style={{ fontWeight: "600", marginTop: "6px" }}>Channel</div>
              <div style={{ fontSize: "13.5px", color: "#8B939C", marginTop: "4px" }}>Parity gaps</div>
            </div>
            <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .12s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "18px", background: "#0C1013" }} className="dcx-h3">
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>04</div>
              <div style={{ fontWeight: "600", marginTop: "6px" }}>Inbox</div>
              <div style={{ fontSize: "13.5px", color: "#8B939C", marginTop: "4px" }}>First-response time</div>
            </div>
          </div>
          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <Link href="/agents" data-route="agents" style={{ fontWeight: "600", fontSize: "15.5px" }}>See all thirteen agents and their job descriptions →</Link>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "120px", background: "#F3F0EA", color: "#14171A" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "100px 28px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "60px", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "#8A7A55" }}>03 · THE PROOF</div>
              <h2 style={{ marginTop: "18px", fontSize: "clamp(32px,4.2vw,52px)", lineHeight: "1.05", letterSpacing: "-.032em", fontWeight: "600" }}>Fourteen days in the shadows. Then you decide.</h2>
              <p style={{ marginTop: "20px", fontSize: "18px", lineHeight: "1.6", color: "#4A5158" }}>
                For most owners the obstacle is not the price of a new system, it is the risk of moving mid-season. So do not move yet. Connect Alisio read-only to whatever you run today, it works in parallel, decides everything, executes nothing, and writes what it
                <em style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.08em" }}>would</em>
                have done into the Ledger.
              </p>
              <p style={{ marginTop: "16px", fontSize: "18px", lineHeight: "1.6", color: "#4A5158" }}>On day fourteen you get an invoice for what not having it cost you.</p>
              <div style={{ marginTop: "30px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <Link href="/demo" data-route="demo" style={{ background: "#14171A", color: "#F3F0EA", fontWeight: "600", fontSize: "15.5px", padding: "15px 24px", borderRadius: "12px" }} className="dcx-h1">Start 14 days in shadow</Link>
                <Link href="/cases" data-route="cases" style={{ border: "1px solid rgba(20,23,26,.2)", color: "#14171A", fontWeight: "500", fontSize: "15.5px", padding: "15px 24px", borderRadius: "12px" }} className="dcx-h4">Read the shadow check case</Link>
              </div>
            </div>
            <div style={{ background: "#FFF", border: "1px solid rgba(20,23,26,.1)", borderRadius: "18px", padding: "30px", boxShadow: "0 40px 90px rgba(20,23,26,.12)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", color: "#8A9099", letterSpacing: ".1em" }}>
                SHADOW CHECK
                <span>DAYS 1–14</span>
              </div>
              <div style={{ marginTop: "22px", fontSize: "15px", display: "grid", gap: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid rgba(20,23,26,.08)" }}>
                  <span>Decisions Alisio would have made</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>341</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid rgba(20,23,26,.08)" }}>
                  <span>Rate moves not taken</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>€1 820</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid rgba(20,23,26,.08)" }}>
                  <span>Orphan nights left unsold</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>€960</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid rgba(20,23,26,.08)" }}>
                  <span>Upsells never offered</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>€740</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "12px", borderBottom: "1px solid rgba(20,23,26,.08)" }}>
                  <span>Failed cards never retried</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace" }}>€420</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: "6px" }}>
                  <span style={{ fontSize: "17px", fontWeight: "600" }}>Estimated gap</span>
                  <strong style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "32px", letterSpacing: "-.02em" }}>€3 940</strong>
                </div>
                <div style={{ fontSize: "13px", color: "#8A9099" }}>
                  ≈ 96 000 Kč · illustrative figures from an 18-unit property model, not a customer record.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "110px 28px 0" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px" }}>
          <figure style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <div style={{ fontSize: "22px", color: "var(--acc,#3DDCC0)", fontFamily: "'Instrument Serif',serif" }}>“</div>
            <blockquote style={{ margin: "6px 0 0", fontSize: "17.5px", lineHeight: "1.55", letterSpacing: "-.01em" }}>
              We stopped arguing about which calendar was right. There is one calendar now, and the hot tub is on it.
            </blockquote>
            <figcaption style={{ marginTop: "20px", fontSize: "13.5px", color: "#8B939C" }}>
              Owner · 22-unit glamping resort, South Bohemia
              <div style={{ color: "#4C545B", marginTop: "2px" }}>Composite quote from pilot conversations</div>
            </figcaption>
          </figure>
          <figure style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <div style={{ fontSize: "22px", color: "var(--acc,#3DDCC0)", fontFamily: "'Instrument Serif',serif" }}>“</div>
            <blockquote style={{ margin: "6px 0 0", fontSize: "17.5px", lineHeight: "1.55", letterSpacing: "-.01em" }}>
              The first month I cancelled four of its decisions. Every cancellation lost me money. That's when I turned the dial up.
            </blockquote>
            <figcaption style={{ marginTop: "20px", fontSize: "13.5px", color: "#8B939C" }}>
              General manager · boutique hotel group, 3 properties
              <div style={{ color: "#4C545B", marginTop: "2px" }}>Composite quote from pilot conversations</div>
            </figcaption>
          </figure>
          <figure style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "30px", background: "#0C1013" }}>
            <div style={{ fontSize: "22px", color: "var(--acc,#3DDCC0)", fontFamily: "'Instrument Serif',serif" }}>“</div>
            <blockquote style={{ margin: "6px 0 0", fontSize: "17.5px", lineHeight: "1.55", letterSpacing: "-.01em" }}>
              Foreign-guest filings used to be my Sunday evening. I haven't opened that form since March.
            </blockquote>
            <figcaption style={{ marginTop: "20px", fontSize: "13.5px", color: "#8B939C" }}>
              Operations lead · apart-complex, 34 units
              <div style={{ color: "#4C545B", marginTop: "2px" }}>Composite quote from pilot conversations</div>
            </figcaption>
          </figure>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "110px auto 0", padding: "0 28px" }}>
        <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "20px", marginBottom: "28px" }}>
          <h2 style={{ fontSize: "34px", fontWeight: "600", letterSpacing: "-.03em" }}>From the Alisio journal</h2>
          <Link href="/blog" data-route="blog" style={{ fontWeight: "600" }}>All articles →</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "20px" }}>
          <Link href="/blog/goppar-uplift" data-route="post-goppar" data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .7s ease", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h5">
            <div style={{ height: "170px", background: "radial-gradient(120% 140% at 20% 10%,rgba(61,220,192,.5),transparent 55%),radial-gradient(100% 120% at 85% 80%,rgba(96,120,255,.45),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>REVENUE · 9 MIN</div>
              <div style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>The booking that costs you money: unit-night GOP explained</div>
            </div>
          </Link>
          <Link href="/blog/autonomy-levels" data-route="post-autonomy" data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .7s ease .08s", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h5">
            <div style={{ height: "170px", background: "radial-gradient(120% 140% at 80% 15%,rgba(242,180,90,.45),transparent 55%),radial-gradient(110% 130% at 10% 85%,rgba(61,220,192,.4),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>AI OPERATIONS · 12 MIN</div>
              <div style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>Six levels of trust: how to let software price your rooms</div>
            </div>
          </Link>
          <Link href="/blog" data-route="blog" data-reveal={true} style={{ opacity: "0", transform: "translateY(20px)", transition: "all .7s ease .16s", display: "block", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", overflow: "hidden", background: "#0C1013", color: "#ECEAE5" }} className="dcx-h5">
            <div style={{ height: "170px", background: "radial-gradient(130% 150% at 50% 0%,rgba(120,200,255,.42),transparent 58%),radial-gradient(90% 110% at 90% 90%,rgba(255,107,90,.3),transparent 60%),#0F1418" }} />
            <div style={{ padding: "24px" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".1em" }}>COMPLIANCE · 7 MIN</div>
              <div style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px", lineHeight: "1.3", letterSpacing: "-.02em" }}>Foreign guest registration in CZ, SK and PL without Sunday evenings</div>
            </div>
          </Link>
        </div>
      </div>
      <div data-cta-band={true} style={{ maxWidth: "1280px", margin: "120px auto 0", padding: "0 28px 130px" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(22px)", transition: "all .8s cubic-bezier(.2,.7,.2,1)", border: "1px solid rgba(61,220,192,.25)", borderRadius: "24px", padding: "70px 60px", textAlign: "center", background: "radial-gradient(120% 180% at 50% 0%,rgba(61,220,192,.14),transparent 60%),#0B0E11" }}>
          <h2 style={{ fontSize: "clamp(30px,4vw,48px)", lineHeight: "1.06", letterSpacing: "-.034em", fontWeight: "600", maxWidth: "20ch", margin: "0 auto" }}>Let it run one night. Read the log in the morning.</h2>
          <p style={{ margin: "20px auto 0", maxWidth: "58ch", fontSize: "17.5px", lineHeight: "1.6", color: "#9BA3AB" }}>
            A 40-minute setup, read-only, on top of the system you already use. Nothing changes until you say so.
          </p>
          <div style={{ marginTop: "32px", display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "16px 30px", borderRadius: "12px" }} className="dcx-h1">Book a demo</Link>
            <Link href="/product" data-route="product" style={{ border: "1px solid rgba(255,255,255,.18)", color: "#ECEAE5", fontWeight: "500", fontSize: "16px", padding: "16px 26px", borderRadius: "12px" }} className="dcx-h2">See all modules</Link>
          </div>
        </div>
      </div>
    </>
  );
}
