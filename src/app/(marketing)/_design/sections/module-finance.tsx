/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleFinance() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "22ch" }}>Finance, P&amp;L and profit per unit-night</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Most systems tell you what came in. Alisio tells you what stayed. Every night of every unit carries its own commission, acquiring fee, cleaning minutes, energy profile, amenities and amortisation, so GOPPAR stops being an annual guess.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Accrual P&amp;L</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Revenue recognised per night, not per payment. CapEx and OpEx separated, period locks, comparison against plan and last year.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Cash-flow matrix</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Multi-account ledger with expected inflows from confirmed bookings, deposits and payout schedules, thirteen weeks ahead.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Reconciliation</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Bank statements and terminal settlements matched to folios automatically; only genuine mismatches reach a human.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Investor module</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Unit owners see their own unit's performance and payouts on a read-only role, with the reporting pack generated monthly.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Documents</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Proforma, invoice, credit note, cash receipt, in EUR or CZK, with structured e-invoicing where the law requires it.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(61,220,192,.3)", borderRadius: "16px", padding: "26px", background: "linear-gradient(160deg,rgba(61,220,192,.08),transparent 65%),#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>The loss-making booking report</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              A ranked list of stays that cost more than they brought, with the reason attached. Usually single nights, from one channel, on cleaning-heavy units.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "80px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "20px", padding: "44px", display: "flex", gap: "28px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "26px", fontWeight: "600", letterSpacing: "-.02em" }}>See your own GOPPAR by unit</h2>
            <p style={{ marginTop: "8px", fontSize: "16px", color: "#9BA3AB" }}>
              Fourteen days read-only is enough to build the first honest unit-night P&amp;L of your property.
            </p>
          </div>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "15px 26px", borderRadius: "12px" }}>Request a quote</Link>
        </div>
      </div>
    </>
  );
}
