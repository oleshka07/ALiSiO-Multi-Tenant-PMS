/**
 * Generated from the Alisio PMS design export by scripts/port-design.mjs.
 * Hand edits here are lost on the next run — change the design source instead.
 */
import Link from 'next/link';

export default function SectionPostAutonomyLevels() {
  return (
    <>
      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "80px 28px 0" }}>
        <Link href="/blog" data-route="blog" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".16em" }}>← THE JOURNAL</Link>
        <div style={{ marginTop: "22px", fontFamily: "'JetBrains Mono',monospace", fontSize: "11.5px", letterSpacing: ".14em", color: "var(--acc,#3DDCC0)" }}>AI OPERATIONS · 12 MIN READ</div>
        <h1 style={{ marginTop: "16px", fontSize: "clamp(34px,4.6vw,54px)", lineHeight: "1.06", letterSpacing: "-.034em", fontWeight: "600" }}>Six levels of trust: how to let software price your rooms</h1>
        <p style={{ marginTop: "20px", fontSize: "20px", lineHeight: "1.6", color: "#9BA3AB", fontFamily: "'Instrument Serif',serif", fontStyle: "italic" }}>
          Nobody hands their rates to an algorithm on a Tuesday because a vendor asked nicely. Trust in operations is built the same way it is built with a new employee: in increments, against evidence, with the ability to take it back.
        </p>
        <div style={{ marginTop: "24px", fontSize: "14px", color: "#6F787F" }}>14 July 2026 · Alisio product team</div>
      </div>
      <div style={{ maxWidth: "820px", margin: "44px auto 0", padding: "0 28px", fontSize: "18px", lineHeight: "1.72", color: "#C4C9CE" }}>
        <div style={{ height: "220px", borderRadius: "18px", marginBottom: "40px", background: "radial-gradient(120% 140% at 80% 15%,rgba(242,180,90,.45),transparent 55%),radial-gradient(110% 130% at 10% 85%,rgba(61,220,192,.4),transparent 60%),#0F1418" }} />
        <p>
          The standard argument about AI in hotels is framed as a yes or a no: either the machine decides or you do. That framing is why most properties are stuck. Real operations have never worked in binaries, you do not give a new receptionist the authority to refund a group deposit on day one, and you do not supervise your head housekeeper's every route in year three.
        </p>
        <p style={{ marginTop: "14px" }}>
          What operations have always had is
          <strong style={{ color: "#ECEAE5" }}>levels of delegation</strong>
          . So that is the right shape for software, too.
        </p>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>The ladder</h2>
        <p style={{ marginTop: "14px" }}>
          Six rungs, set per agent and per action type, pricing can sit higher than refunds, housekeeping routing higher than guest messaging.
        </p>
        <div style={{ marginTop: "22px", display: "grid", gap: "12px" }}>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "20px 24px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#5F676E" }}>L0</span>
              <strong style={{ color: "#ECEAE5" }}>Observer.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              It watches and measures. Nothing else. This is week one, and it is also where a kill switch sends everyone at once.
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "20px 24px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#5F676E" }}>L1</span>
              <strong style={{ color: "#ECEAE5" }}>Advisor.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              It writes suggestions with reasoning and expected value. You read them when convenient. The value here is not the advice, it is that you can grade the advice for a month at zero risk.
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "20px 24px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#5F676E" }}>L2</span>
              <strong style={{ color: "#ECEAE5" }}>Drafter.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              The action is fully prepared and waits for one tap. Most properties live here for their first month, and most discover that they approve nine out of ten drafts without editing them.
            </div>
          </div>
          <div style={{ border: "1px solid rgba(61,220,192,.3)", borderRadius: "14px", padding: "20px 24px", background: "linear-gradient(90deg,rgba(61,220,192,.06),transparent)" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--acc,#3DDCC0)" }}>L3</span>
              <strong style={{ color: "#ECEAE5" }}>Act with undo.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              It acts, tells you immediately, and every move carries a two-hour reversal window. This is the rung that changes the economics, because it removes the human from the latency path without removing them from control.
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "20px 24px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#5F676E" }}>L4</span>
              <strong style={{ color: "#ECEAE5" }}>Act quietly.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              It acts and logs, without interrupting you. You meet the decisions in the morning briefing. Compliance filings and channel parity usually get here first, because their correct answer is unambiguous.
            </div>
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: "14px", padding: "20px 24px", background: "#0C1013" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "baseline" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#5F676E" }}>L5</span>
              <strong style={{ color: "#ECEAE5" }}>Owns the KPI.</strong>
            </div>
            <div style={{ marginTop: "6px", fontSize: "16.5px", color: "#9BA3AB" }}>
              It sets sub-goals inside your budget and policy and reports on the target rather than the tasks. This is a director, and you should make it earn the title over quarters, not weeks.
            </div>
          </div>
        </div>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>What makes a rung safe</h2>
        <p style={{ marginTop: "14px" }}>
          Autonomy without written constraints is not delegation. Each rung is only responsible if three things exist underneath it.
        </p>
        <p style={{ marginTop: "14px" }}>
          <strong style={{ color: "#ECEAE5" }}>A written policy the system enforces.</strong>
          Not a prompt: an actual check in the write path. Price floors expressed against real unit cost. A maximum move per twenty-four hours. A monthly discount budget. Quiet hours for guest messages. Escalation when exposure crosses a number you chose.
        </p>
        <p style={{ marginTop: "14px" }}>
          <strong style={{ color: "#ECEAE5" }}>A log that explains, rather than one that only records.</strong>
          Every action should carry its inputs, the policy it satisfied, the reason and the expected effect, and later, the measured effect. A log you cannot argue with is how a manager's suspicion turns into a manager's confidence.
        </p>
        <p style={{ marginTop: "14px" }}>
          <strong style={{ color: "#ECEAE5" }}>Proof against a holdout.</strong>
          This is the part vendors skip. Keep a randomised slice of dates on your own rules, permanently, and compare. Without a control group, "our AI raised your revenue" is a sentence, not a fact.
        </p>
        <blockquote style={{ margin: "34px 0", padding: "26px 30px", borderLeft: "2px solid var(--acc,#3DDCC0)", background: "rgba(61,220,192,.05)", borderRadius: "0 14px 14px 0", fontSize: "20px", lineHeight: "1.55", color: "#ECEAE5" }}>
          An agent that reports its own bad month is easier to trust than one that promises it will never have one.
        </blockquote>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>Promotion should be earned, and demotion automatic</h2>
        <p style={{ marginTop: "14px" }}>
          Grade decisions against what actually happened. When accuracy holds above a threshold long enough, propose a promotion and let a human accept it. When accuracy slips, the agent drops a level on its own and says so before anyone notices. Properties that run this loop end up at higher autonomy than they intended, and with fewer arguments about it, because the evidence arrived before the request.
        </p>
        <h2 style={{ marginTop: "38px", fontSize: "28px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }}>Where to start</h2>
        <p style={{ marginTop: "14px" }}>
          Put everything at L0 for two weeks and read the log. Move messaging and pricing to L2, drafts are psychologically free. After a month of approving nine drafts in ten, move those two to L3 and notice that the day gets quieter. Leave refunds, contracts and anything with a signature at L2 for as long as you like; there is no prize for automating the things that are actually decisions.
        </p>
        <div style={{ marginTop: "48px", border: "1px solid rgba(61,220,192,.25)", borderRadius: "18px", padding: "34px", background: "radial-gradient(120% 200% at 15% 0%,rgba(61,220,192,.1),transparent 60%),#0B0E11" }}>
          <h3 style={{ fontSize: "22px", fontWeight: "600", letterSpacing: "-.02em", color: "#ECEAE5" }}>Turn the dial yourself</h3>
          <p style={{ marginTop: "10px", fontSize: "16px", color: "#9BA3AB", lineHeight: "1.6" }}>
            The crew page has a live autonomy dial and the full guardrail list, including the kill switch that puts thirteen agents back to L0 in one press.
          </p>
          <div style={{ marginTop: "20px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link href="/agents" data-route="agents" style={{ background: "var(--acc,#3DDCC0)", color: "#07100E", fontWeight: "600", fontSize: "15.5px", padding: "14px 24px", borderRadius: "11px" }}>See the AI crew</Link>
            <Link href="/demo" data-route="demo" style={{ border: "1px solid rgba(255,255,255,.18)", color: "#ECEAE5", fontWeight: "500", fontSize: "15.5px", padding: "14px 22px", borderRadius: "11px" }}>Book a demo</Link>
          </div>
        </div>
        <div style={{ margin: "60px 0 120px", paddingTop: "32px", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "11px", letterSpacing: ".14em", color: "#5F676E" }}>READ NEXT</div>
          <Link href="/blog/goppar-uplift" data-route="post-goppar" style={{ display: "block", marginTop: "14px", fontSize: "24px", fontWeight: "600", letterSpacing: "-.024em", color: "#ECEAE5" }} className="dcx-h9">The booking that costs you money: unit-night GOP explained →</Link>
        </div>
      </div>
    </>
  );
}
