import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { LangSelect } from "./LangSelect";

export function Topbar() {
  const tv = useV4();
  return (
    <div className="topbar">
      <div className="wrap">
        <a className="phone" href="tel:+19084045373">
          {tv("☎ (908) 404-5373 · Dispatch 7 days a week")}
        </a>
        <div className="right">
          {/* M-59: ≤700px the mail/login links hide (tb-hide) — all three are
              reachable from the mobile menu / footer; the bar then fits 320px
              without horizontal overflow (WCAG 1.4.10 reflow). */}
          <a className="tb-hide" href="mailto:support@pickloads.com">
            support@pickloads.com
          </a>
          {/* M-51: both portals are live — real auth links, no Coming-Soon toasts. */}
          <Link className="tb-hide" href="/login">
            {tv("Carrier Login")}
          </Link>
          <Link className="tb-hide" href="/login">
            {tv("Shipper Login")}
          </Link>
          <LangSelect />
        </div>
      </div>
    </div>
  );
}
