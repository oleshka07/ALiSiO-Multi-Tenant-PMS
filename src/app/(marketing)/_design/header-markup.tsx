/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SiteHeaderMarkup() {
  return (
    <header data-nav="true" style={{ position: "fixed", top: "0", left: "0", right: "0", zIndex: "90", backdropFilter: "blur(18px)", background: "rgba(8,9,11,.72)", borderBottom: "1px solid rgba(255,255,255,.07)", transition: "background .3s ease" }}>
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 28px", height: "70px", display: "flex", alignItems: "center", gap: "34px" }}>
      <Link href="/" data-route="home" style={{ display: "flex", alignItems: "center", gap: "11px", color: "#ECEAE5", flex: "0 0 auto" }}>
        <span style={{ width: "26px", height: "26px", borderRadius: "8px", background: "linear-gradient(135deg,var(--acc,#3DDCC0),#2B8FE0)", display: "block" }} />
        <span style={{ fontSize: "17px", fontWeight: "600", letterSpacing: "-.02em" }}>
          Alisio
          <span style={{ color: "#7B848D", fontWeight: "500" }}>PMS</span>
        </span>
      </Link>
      <nav style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "14.5px", color: "#B6BCC3", flex: "1 1 auto" }}>
        <span data-drop="product" style={{ position: "relative" }}>
          <button data-drop-btn={true} style={{ all: "unset", cursor: "pointer", padding: "9px 13px", borderRadius: "9px", display: "flex", alignItems: "center", gap: "6px" }} data-i18n="nav_product" type="button">
            Product
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" focusable="false">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </span>
        <Link href="/agents" data-route="agents" style={{ color: "#B6BCC3", padding: "9px 13px", borderRadius: "9px" }} data-i18n="nav_agents">AI Crew</Link>
        <span data-drop="solutions" style={{ position: "relative" }}>
          <button data-drop-btn={true} style={{ all: "unset", cursor: "pointer", padding: "9px 13px", borderRadius: "9px", display: "flex", alignItems: "center", gap: "6px" }} data-i18n="nav_solutions" type="button">
            Solutions
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" focusable="false">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </span>
        <Link href="/integrations" data-route="integrations" style={{ color: "#B6BCC3", padding: "9px 13px", borderRadius: "9px" }} data-i18n="nav_integrations">Integrations</Link>
        <Link href="/cases" data-route="cases" style={{ color: "#B6BCC3", padding: "9px 13px", borderRadius: "9px" }} data-i18n="nav_cases">Customers</Link>
        <Link href="/blog" data-route="blog" style={{ color: "#B6BCC3", padding: "9px 13px", borderRadius: "9px" }} data-i18n="nav_blog">Blog</Link>
        <Link href="/about" data-route="about" style={{ color: "#B6BCC3", padding: "9px 13px", borderRadius: "9px" }} data-i18n="nav_about">Company</Link>
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "0 0 auto" }}>
        <div data-lang={true} style={{ position: "relative" }}>
          <button data-lang-btn={true} style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: "7px", fontSize: "13.5px", color: "#B6BCC3", padding: "8px 11px", border: "1px solid rgba(255,255,255,.1)", borderRadius: "9px" }} type="button">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.6 8h12.8M8 1.6c1.7 1.8 2.6 4 2.6 6.4S9.7 12.6 8 14.4C6.3 12.6 5.4 10.4 5.4 8S6.3 3.4 8 1.6z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span data-lang-current={true}>EN</span>
          </button>
          <div data-lang-menu={true} style={{ display: "none", position: "absolute", top: "44px", right: "0", background: "#12161A", border: "1px solid rgba(255,255,255,.1)", borderRadius: "12px", padding: "6px", minWidth: "150px", boxShadow: "0 24px 60px rgba(0,0,0,.6)" }}>
            <button data-lang-opt="en" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "9px 12px", borderRadius: "8px", fontSize: "14px", color: "#ECEAE5", boxSizing: "border-box" }} type="button">English</button>
            <button data-lang-opt="cs" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "9px 12px", borderRadius: "8px", fontSize: "14px", color: "#ECEAE5", boxSizing: "border-box" }} type="button">Čeština</button>
            <button data-lang-opt="de" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "9px 12px", borderRadius: "8px", fontSize: "14px", color: "#ECEAE5", boxSizing: "border-box" }} type="button">Deutsch</button>
            <button data-lang-opt="uk" style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", padding: "9px 12px", borderRadius: "8px", fontSize: "14px", color: "#ECEAE5", boxSizing: "border-box" }} type="button">Українська</button>
          </div>
        </div>
        <Link href="/login" style={{ color: "#B6BCC3", fontSize: "14px", padding: "9px 13px", borderRadius: "9px" }} className="dcx-login">Log in</Link>
        <Link data-nav-cta={true} href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "14px", padding: "11px 18px", borderRadius: "10px" }} data-i18n="nav_demo" className="dcx-h10">Book a demo</Link>
        <button data-burger={true} style={{ all: "unset", display: "none", cursor: "pointer", width: "44px", height: "44px", border: "1px solid rgba(255,255,255,.14)", borderRadius: "11px", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }} type="button">
          <span data-burger-icon={true} style={{ display: "block", width: "18px", height: "12px", position: "relative" }}>
            <span style={{ position: "absolute", left: "0", top: "0", width: "18px", height: "1.6px", background: "#ECEAE5", borderRadius: "2px" }} />
            <span style={{ position: "absolute", left: "0", top: "5.2px", width: "18px", height: "1.6px", background: "#ECEAE5", borderRadius: "2px" }} />
            <span style={{ position: "absolute", left: "0", top: "10.4px", width: "18px", height: "1.6px", background: "#ECEAE5", borderRadius: "2px" }} />
          </span>
        </button>
      </div>
    </div>
    <div data-mobile-menu={true} style={{ display: "none", borderTop: "1px solid rgba(255,255,255,.08)", background: "#0A0C0E", maxHeight: "calc(100vh - 70px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ padding: "18px 20px 28px", display: "grid", gap: "22px" }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10.5px", letterSpacing: ".16em", color: "#5F676E" }}>PLATFORM</div>
          <div style={{ marginTop: "10px", display: "grid", gap: "2px" }}>
            <Link href="/product" data-route="product" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>All modules</Link>
            <Link href="/agents" data-route="agents" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>AI crew</Link>
            <Link href="/modules/calendar" data-route="m-calendar" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Calendar &amp; bookings</Link>
            <Link href="/modules/channels" data-route="m-channels" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Channel manager</Link>
            <Link href="/modules/finance" data-route="m-finance" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Finance &amp; P&amp;L</Link>
            <Link href="/modules/guest-portal" data-route="m-guest" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Guest Portal</Link>
            <Link href="/modules/crm" data-route="m-crm" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>CRM &amp; AI inbox</Link>
            <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Compliance</Link>
            <Link href="/modules/housekeeping" data-route="m-ops" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Housekeeping &amp; tasks</Link>
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: "18px" }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "10.5px", letterSpacing: ".16em", color: "#5F676E" }}>COMPANY</div>
          <div style={{ marginTop: "10px", display: "grid", gap: "2px" }}>
            <Link href="/solutions" data-route="solutions" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Solutions by property type</Link>
            <Link href="/integrations" data-route="integrations" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Integrations</Link>
            <Link href="/cases" data-route="cases" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Customer stories</Link>
            <Link href="/blog" data-route="blog" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>Journal</Link>
            <Link href="/about" data-route="about" style={{ color: "#ECEAE5", fontSize: "17px", padding: "13px 12px", borderRadius: "10px", display: "block" }}>About ROZUM</Link>
          </div>
        </div>
        <Link href="/demo" data-route="demo" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "16.5px", padding: "17px", borderRadius: "12px", textAlign: "center", display: "block" }}>Start Shadow Mode, free</Link>
      </div>
    </div>
    <div data-drop-panel="product" style={{ display: "none", borderTop: "1px solid rgba(255,255,255,.07)", background: "rgba(11,13,16,.97)", backdropFilter: "blur(18px)" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "26px 28px 30px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px 26px" }}>
        <Link href="/product" data-route="product" style={{ gridColumn: "1/-1", fontSize: "12px", letterSpacing: ".14em", textTransform: "uppercase", color: "#6F787F", paddingBottom: "6px" }}>All modules →</Link>
        <Link href="/modules/calendar" data-route="m-calendar" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Calendar &amp; Bookings</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Drag-and-drop tape, groups, blocks</span>
        </Link>
        <Link href="/modules/channels" data-route="m-channels" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Channel Manager</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Two-way ARI, zero overbooking</span>
        </Link>
        <Link href="/modules/finance" data-route="m-finance" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Finance, P&amp;L &amp; GOPPAR</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Profit per unit-night, live</span>
        </Link>
        <Link href="/modules/guest-portal" data-route="m-guest" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Guest Portal</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Online check-in, upsells, signature</span>
        </Link>
        <Link href="/modules/crm" data-route="m-crm" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>CRM &amp; AI Inbox</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>One thread, 12 languages</span>
        </Link>
        <Link href="/modules/compliance" data-route="m-compliance" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Compliance &amp; Trust</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Foreign police, city tax, DAC7</span>
        </Link>
        <Link href="/modules/housekeeping" data-route="m-ops" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Housekeeping &amp; Tasks</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Pocket cards, photo proof</span>
        </Link>
        <Link href="/agents" data-route="agents" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>The AI crew</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>13 agents, autonomy L0–L5</span>
        </Link>
      </div>
    </div>
    <div data-drop-panel="solutions" style={{ display: "none", borderTop: "1px solid rgba(255,255,255,.07)", background: "rgba(11,13,16,.97)", backdropFilter: "blur(18px)" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "26px 28px 30px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "26px" }}>
        <Link href="/solutions" data-route="solutions" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Glamping &amp; camps</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Domes, tubs, sauna sessions</span>
        </Link>
        <Link href="/solutions" data-route="solutions" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Boutique hotels</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>8–40 keys, one manager</span>
        </Link>
        <Link href="/solutions" data-route="solutions" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Resorts &amp; wellness</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Spa slots, day-use, F&amp;B</span>
        </Link>
        <Link href="/solutions" data-route="solutions" style={{ color: "#ECEAE5", padding: "12px 14px", borderRadius: "11px", display: "block" }} className="dcx-h11">
          <span style={{ display: "block", fontWeight: "600", fontSize: "15px" }}>Groups &amp; management cos.</span>
          <span style={{ display: "block", fontSize: "13px", color: "#7F888F", marginTop: "3px" }}>Multi-property, investor reporting</span>
        </Link>
      </div>
    </div>
    </header>
  );
}
