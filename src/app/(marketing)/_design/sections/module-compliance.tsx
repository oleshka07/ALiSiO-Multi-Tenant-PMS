/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionModuleCompliance() {
  return (
    <>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/product" data-route="product" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← ALL MODULES</Link>
        <h1 style={{ marginTop: "20px", fontSize: "clamp(36px,5vw,62px)", lineHeight: "1.03", letterSpacing: "-.036em", fontWeight: "600", maxWidth: "20ch" }}>Compliance &amp; Trust</h1>
        <p style={{ marginTop: "20px", fontSize: "19px", lineHeight: "1.6", color: "#9BA3AB", maxWidth: "62ch" }}>
          The work nobody thanks you for and everybody fines you for. Alisio does not remind you to file, it files, and shows you the confirmation.
        </p>
      </div>
      <div style={{ maxWidth: "1280px", margin: "48px auto 0", padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px" }}>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>Foreign guest registration</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Domovní kniha and foreign-police obligations handled from the check-in data, within the statutory window, with the submission receipt stored against the stay.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>City &amp; tourist tax</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Per-municipality rates and exemptions, the tax book maintained continuously, and the monthly declaration generated ready to sign.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>DAC7 &amp; platform reporting</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Platform payouts reconciled with your own records so the numbers you report and the numbers they report are the same numbers.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>E-invoicing</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Structured invoices for corporate and public-sector guests, in the formats your market requires, without a separate portal.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .05s", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px", padding: "26px", background: "#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>GDPR by construction</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Purpose-bound storage, retention timers that actually delete, documents encrypted at rest, EU hosting, and a subject-access export that takes minutes.
            </p>
          </div>
          <div data-reveal={true} style={{ opacity: "0", transform: "translateY(16px)", transition: "all .6s ease .1s", border: "1px solid rgba(61,220,192,.3)", borderRadius: "16px", padding: "26px", background: "linear-gradient(160deg,rgba(61,220,192,.08),transparent 65%),#0C1013" }}>
            <h3 style={{ fontSize: "19px", fontWeight: "600" }}>EU AI Act transparency</h3>
            <p style={{ marginTop: "9px", fontSize: "15px", lineHeight: "1.6", color: "#9BA3AB" }}>
              Every automated decision keeps its inputs, its policy, its reason and its author. Guests are informed when they speak to an assistant. The log is exportable for an auditor.
            </p>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: "1280px", margin: "70px auto 0", padding: "0 28px 120px" }}>
        <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "20px", padding: "40px", background: "#0C1013", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "24px" }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".14em" }}>HOSTING</div>
            <div style={{ marginTop: "8px", fontSize: "16px" }}>EU data centres, daily backups, point-in-time restore</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".14em" }}>ACCESS</div>
            <div style={{ marginTop: "8px", fontSize: "16px" }}>RBAC with seven roles, 2FA, full session audit</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".14em" }}>PAYMENTS</div>
            <div style={{ marginTop: "8px", fontSize: "16px" }}>No card data on our servers, tokenised at the acquirer</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", color: "#5F676E", letterSpacing: ".14em" }}>EXIT</div>
            <div style={{ marginTop: "8px", fontSize: "16px" }}>One-click full export in open formats, no exit fee</div>
          </div>
        </div>
      </div>
    </>
  );
}
