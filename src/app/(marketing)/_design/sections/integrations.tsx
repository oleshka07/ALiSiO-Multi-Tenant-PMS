/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */

export default function SectionIntegrations() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>INTEGRATIONS</div>
        <h1 style={{ marginTop: "18px", fontSize: "clamp(38px,5.4vw,66px)", lineHeight: "1.02", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>Connected to the things you already pay for.</h1>
        <p style={{ marginTop: "22px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Integrations are included. There is no connector fee, no partner tier and no per-endpoint charge, a system that decides is worthless if it cannot reach the world it decides about.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "52px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>DISTRIBUTION</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>OTAs &amp; marketplaces</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Booking.com, Airbnb, Expedia, Hostex, plus any iCal endpoint for the long tail. Two-way ARI, reservations in seconds, mapping health monitored.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>MONEY IN</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>Acquiring &amp; terminals</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Payment links, pre-authorisations, partial refunds and webhook-driven folio updates. Real fees, per transaction, land in the unit-night P&amp;L.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>MONEY OUT</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>Banks &amp; accounting</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Statement import and matching, export packs for your accountant, structured e-invoices where the law requires them.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>REVENUE</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>Pricing tools</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Already run PriceLabs or a similar engine? Keep it. Alisio can consume its recommendations or hand pricing to the Rate agent, your choice, per rate plan.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>PEOPLE</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>Telegram &amp; messaging</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Staff tasks, owner briefing and guest threads in the messenger everyone already has. No licences per seasonal worker.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>ON SITE</div>
            <h3 style={{ fontSize: "19px", fontWeight: "600", marginTop: "10px" }}>Locks, energy, IoT</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Smart locks issued per stay, heating profiles tied to arrival time, tub and sauna sessions triggered from the booking they belong to.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .7s ease", border: "1px solid rgba(61,220,192,.28)", borderRadius: "20px", padding: "44px", background: "radial-gradient(120% 200% at 12% 0%,rgba(61,220,192,.1),transparent 60%),#0B0E11", display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: "44px", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "30px", fontWeight: "600", letterSpacing: "-.026em" }}>And one integration nobody else is building yet</h2>
            <p style={{ marginTop: "14px", fontSize: "16.5px", lineHeight: "1.65", color: "#9BA3AB" }}>
              Guests are starting to plan trips through AI assistants rather than search results. Those assistants need a machine-readable way to ask what a property has and to hold it. Alisio exposes an agent endpoint, availability, capabilities, price, policies and booking, so your property can be found and sold by the next generation of travel agents. When that traffic becomes real, being described in a structured way is the whole difference.
            </p>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", background: "#0D1114", padding: "20px", fontFamily: "'JetBrains Mono',monospace", fontSize: "12.5px", lineHeight: "1.75", color: "#9BA3AB" }}>
            <div style={{ color: "#5F676E" }}>POST /agent/query</div>
            <div>{'{'} "dates": "2026-08-14/17",</div>
            <div>&nbsp;&nbsp;"pax": 2, "needs": ["hot_tub","ev"] {'}'}</div>
            <div style={{ height: "10px" }} />
            <div style={{ color: "#5F676E" }}>→ 200</div>
            <div>{'{'} "unit": "dome_01",</div>
            <div>&nbsp;&nbsp;"total_eur": 525, "total_czk": 12900,</div>
            <div>&nbsp;&nbsp;"hold_token": "hl_9f2…", "ttl": 900 {'}'}</div>
          </div>
        </div>
      </div>
    </>
  );
}
