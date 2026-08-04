import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { ComingSoonLink } from "@/components/ui/ComingSoonLink";
import { LangSelect } from "./LangSelect";

export function Topbar() {
  const tv = useV4();
  return (
    <div className="topbar">
      <div className="wrap">
        <a className="phone" href="tel:+19084045373">
          {tv("\u260e (908) 404-5373 \u00b7 24/7 Dispatch")}
        </a>
        <div className="right">
          <a href="mailto:support@pickloads.com">support@pickloads.com</a>
          {/* M-02b: carrier portal is live; shipper portal lands in M-32. */}
          <Link href="/login">{tv("Carrier Login")}</Link>
          <ComingSoonLink kind="Shipper">{tv("Shipper Login")}</ComingSoonLink>
          <LangSelect />
        </div>
      </div>
    </div>
  );
}
