/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SiteFooterMarkup() {
  return (
    <footer style={{ position: "relative", zIndex: "1", borderTop: "1px solid rgba(255,255,255,.08)", background: "#0A0C0E" }}>
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "64px 28px 40px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", gap: "36px" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
          <span style={{ width: "24px", height: "24px", borderRadius: "7px", background: "linear-gradient(135deg,var(--acc,#3DDCC0),#2B8FE0)", display: "block" }} />
          <span style={{ fontSize: "16px", fontWeight: "600" }}>Alisio PMS</span>
        </div>
        <p style={{ marginTop: "14px", fontSize: "14px", lineHeight: "1.6", color: "#7F888F", maxWidth: "34ch" }}>
          Property management software built by ROZUM for independent hotels, glampings and apartments in Central Europe.
        </p>
        <p style={{ marginTop: "16px", fontSize: "12.5px", color: "#4C545B" }}>Prices in EUR and CZK · GDPR &amp; EU AI Act aligned</p>
      </div>
      <div>
        <div style={{ fontSize: "12px", letterSpacing: ".14em", color: "#5F676E", textTransform: "uppercase" }}>Product</div>
        <ul style={{ marginTop: "14px", display: "grid", gap: "9px", fontSize: "14.5px" }}>
          <li>
            <Link href="/modules/calendar" data-route="m-calendar" style={{ color: "#B6BCC3" }}>Calendar</Link>
          </li>
          <li>
            <Link href="/modules/channels" data-route="m-channels" style={{ color: "#B6BCC3" }}>Channels</Link>
          </li>
          <li>
            <Link href="/modules/finance" data-route="m-finance" style={{ color: "#B6BCC3" }}>Finance</Link>
          </li>
          <li>
            <Link href="/modules/guest-portal" data-route="m-guest" style={{ color: "#B6BCC3" }}>Guest Portal</Link>
          </li>
          <li>
            <Link href="/modules/crm" data-route="m-crm" style={{ color: "#B6BCC3" }}>CRM &amp; AI</Link>
          </li>
          <li>
            <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#B6BCC3" }}>Compliance</Link>
          </li>
        </ul>
      </div>
      <div>
        <div style={{ fontSize: "12px", letterSpacing: ".14em", color: "#5F676E", textTransform: "uppercase" }}>Platform</div>
        <ul style={{ marginTop: "14px", display: "grid", gap: "9px", fontSize: "14.5px" }}>
          <li>
            <Link href="/agents" data-route="agents" style={{ color: "#B6BCC3" }}>AI crew</Link>
          </li>
          <li>
            <Link href="/modules/housekeeping" data-route="m-ops" style={{ color: "#B6BCC3" }}>Housekeeping</Link>
          </li>
          <li>
            <Link href="/integrations" data-route="integrations" style={{ color: "#B6BCC3" }}>Integrations</Link>
          </li>
          <li>
            <Link href="/product" data-route="product" style={{ color: "#B6BCC3" }}>All modules</Link>
          </li>
        </ul>
      </div>
      <div>
        <div style={{ fontSize: "12px", letterSpacing: ".14em", color: "#5F676E", textTransform: "uppercase" }}>Company</div>
        <ul style={{ marginTop: "14px", display: "grid", gap: "9px", fontSize: "14.5px" }}>
          <li>
            <Link href="/about" data-route="about" style={{ color: "#B6BCC3" }}>About ROZUM</Link>
          </li>
          <li>
            <Link href="/cases" data-route="cases" style={{ color: "#B6BCC3" }}>Customers</Link>
          </li>
          <li>
            <Link href="/blog" data-route="blog" style={{ color: "#B6BCC3" }}>Journal</Link>
          </li>
          <li>
            <Link href="/demo" data-route="demo" style={{ color: "#B6BCC3" }}>Contact</Link>
          </li>
        </ul>
      </div>
      <div>
        <div style={{ fontSize: "12px", letterSpacing: ".14em", color: "#5F676E", textTransform: "uppercase" }}>Trust</div>
        <ul style={{ marginTop: "14px", display: "grid", gap: "9px", fontSize: "14.5px" }}>
          <li>
            <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#B6BCC3" }}>Security</Link>
          </li>
          <li>
            <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#B6BCC3" }}>GDPR</Link>
          </li>
          <li>
            <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#B6BCC3" }}>EU AI Act</Link>
          </li>
          <li>
            <Link href="/demo" data-route="demo" style={{ color: "#B6BCC3" }}>Status</Link>
          </li>
        </ul>
      </div>
    </div>
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 28px 44px", display: "flex", justifyContent: "space-between", gap: "20px", fontSize: "13px", color: "#4C545B", borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: "24px" }}>
      <span>© 2026 ROZUM s.r.o. · Alisio PMS</span>
      <span>Figures and property names on this site are illustrative.</span>
    </div>
    </footer>
  );
}
