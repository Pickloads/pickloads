import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { LangSelect } from "./LangSelect";

export function Topbar() {
  const tv = useV4();
  return (
    <div className="topbar">
      <div className="wrap">
        <a className="phone" href="tel:+19084045373">
          {tv("☎ (908) 404-5373 · 24/7 Dispatch")}
        </a>
        <div className="right">
          <a href="mailto:support@pickloads.com">support@pickloads.com</a>
          {/* M-51: both portals are live — real auth links, no Coming-Soon toasts. */}
          <Link href="/login">{tv("Carrier Login")}</Link>
          <Link href="/login">{tv("Shipper Login")}</Link>
          <LangSelect />
        </div>
      </div>
    </div>
  );
}
