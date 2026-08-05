/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionProduct() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em", color: "var(--acc,#3DDCC0)" }}>PLATFORM</div>
        <h1 style={{ marginTop: "18px", fontSize: "clamp(38px,5.4vw,68px)", lineHeight: "1.02", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "18ch" }}>Fourteen modules. One database. One calendar for everything you sell.</h1>
        <p style={{ marginTop: "22px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          Alisio treats a room, a sauna, an EV parking bay, a lounger and a 90-minute hot tub session the same way: as a resource with a calendar, a cost model and a price. That is why an eighteen-unit property ends up with sixty-plus sellable resources, and no extra capex.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "56px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <Link href="/modules/calendar" data-route="m-calendar" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>01</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Calendar &amp; Bookings</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Drag-and-drop tape, colour-coded statuses, quick create, group bookings with one balance, room allocation, availability blockers, audit log per booking.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/modules/channels" data-route="m-channels" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>02</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Channel Manager</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Two-way ARI with Booking.com, Airbnb, Expedia, Hostex and iCal. Unit mapping, retry queue, parity monitoring, per-channel true cost.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/modules/finance" data-route="m-finance" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>03</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Finance, P&amp;L &amp; CashFlow</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Multi-account ledger, accrual P&amp;L with CapEx/OpEx split, cash-flow matrix, investor module, bank and terminal reconciliation, e-invoices.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/modules/guest-portal" data-route="m-guest" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>04</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Guest Portal</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Token-based personal page: self check-in, document upload, digital signature, balance payment, in-stay services, live chat, post-stay NPS.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/modules/compliance" data-route="m-compliance" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>06</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Compliance &amp; Trust</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Foreign guest registration, city tax book and declaration, DAC7, Peppol e-invoicing, GDPR retention, AI Act transparency log.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/modules/housekeeping" data-route="m-ops" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h6">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>07</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>Housekeeping &amp; Tasks</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Kanban and list boards, tasks bound to units, priorities and deadlines, Telegram assignment, photo proof, cleaning minutes in the P&amp;L.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open module →</div>
          </Link>
          <Link href="/agents" data-route="agents" data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .05s", border: "1px solid rgba(61,220,192,.3)", borderRadius: "18px", padding: "28px", background: "radial-gradient(120% 160% at 20% 0%,rgba(61,220,192,.12),transparent 60%),#0C1013", color: "#ECEAE5", display: "block" }} className="dcx-h7">
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "var(--acc,#3DDCC0)" }}>08</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>The AI crew</h3>
            <p style={{ marginTop: "10px", fontSize: "14.5px", lineHeight: "1.6", color: "#8B939C" }}>
              Thirteen specialists with typed tools, guardrails and KPIs. Autonomy L0–L5 per agent, decision Ledger, auditor, kill switch.
            </p>
            <div style={{ marginTop: "14px", fontSize: "13.5px", color: "var(--acc,#3DDCC0)" }}>Open the crew →</div>
          </Link>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(18px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "18px", padding: "28px", background: "#0C1013" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E" }}>09–14</div>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginTop: "8px", letterSpacing: "-.02em" }}>And the rest of the plumbing</h3>
            <ul style={{ marginTop: "12px", display: "grid", gap: "8px", fontSize: "14.5px", color: "#8B939C" }}>
              <li>
                Properties, buildings, categories, unit types, bulk generator up to 200 units
              </li>
              <li>Dynamic pricing, weekend rates, min-LOS, bulk updates, promo codes</li>
              <li>Payments: links, pre-auth deposits, webhooks, partial refunds</li>
              <li>Reports: occupancy, ADR, RevPAR, ALOS, source mix, per-unit performance</li>
              <li>RBAC: owner, manager, finance, reception, housekeeping, investor, auditor</li>
              <li>
                Admin: system audit log, retention cleaners, Telegram bridge, morning digest
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "90px auto 0", padding: "0 28px" }}>
        <h2 style={{ fontSize: "34px", fontWeight: "600", letterSpacing: "-.03em" }}>Architecture, in four layers</h2>
        <p style={{ marginTop: "14px", fontSize: "17px", color: "#9BA3AB", maxWidth: "64ch" }}>
          The reason the crew can be trusted is not the model. It is what sits underneath it.
        </p>
        <div style={{ marginTop: "32px", display: "grid", gap: "12px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(61,220,192,.28)", borderRadius: "16px", padding: "24px 26px", background: "linear-gradient(90deg,rgba(61,220,192,.07),transparent)" }}>
            <div style={{ display: "flex", gap: "18px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "var(--acc,#3DDCC0)" }}>LAYER 4</span>
              <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Surfaces</h3>
            </div>
            <p style={{ marginTop: "8px", fontSize: "15px", color: "#9BA3AB", lineHeight: "1.6" }}>
              Deck for reception, Pulse for the owner, Pocket for line staff, and Thread for the guest in the messenger they already use. There is also an agent endpoint, so external AI assistants can query and book your property directly.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "24px 26px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "18px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#5F676E" }}>LAYER 3</span>
              <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Agent mesh &amp; trust contract</h3>
            </div>
            <p style={{ marginTop: "8px", fontSize: "15px", color: "#9BA3AB", lineHeight: "1.6" }}>
              Thirteen agents, typed tools only, autonomy levels, the decision Ledger and an auditor that grades the rest. No agent has raw database access, nothing can execute an arbitrary operation.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "24px 26px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "18px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#5F676E" }}>LAYER 2</span>
              <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Semantic layer, the property ontology</h3>
            </div>
            <p style={{ marginTop: "8px", fontSize: "15px", color: "#9BA3AB", lineHeight: "1.6" }}>
              A graph of resources with capabilities, constraints and cost models; a graph of guests resolved to one identity across channels; a graph of money where every euro carries its origin and its destination.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .15s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "24px 26px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "18px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "12px", color: "#5F676E" }}>LAYER 1</span>
              <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Event backbone</h3>
            </div>
            <p style={{ marginTop: "8px", fontSize: "15px", color: "#9BA3AB", lineHeight: "1.6" }}>
              No table holds the truth; the sequence of events does. That gives you free undo, time-travel debugging, "show me the property at 14:03 on Tuesday", and offline-first reception that keeps working when the internet does not.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "96px auto 0", padding: "0 28px 130px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: "22px", padding: "52px", display: "grid", gridTemplateColumns: "1fr auto", gap: "36px", alignItems: "center", background: "#0B0E11" }}>
          <div>
            <h2 style={{ fontSize: "32px", fontWeight: "600", letterSpacing: "-.03em" }}>Pricing is a conversation, not a table</h2>
            <p style={{ marginTop: "12px", fontSize: "16.5px", color: "#9BA3AB", maxWidth: "62ch" }}>
              A base per active unit, plus a share of the uplift we can prove against a holdout baseline. No setup fee, no charge for integrations or extra users, no commission on your direct bookings. Tell us your unit count and channel mix and we model it in EUR and CZK.
            </p>
          </div>
          <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16px", padding: "16px 28px", borderRadius: "12px", whiteSpace: "nowrap" }}>Request a quote</Link>
        </div>
      </div>
    </>
  );
}
