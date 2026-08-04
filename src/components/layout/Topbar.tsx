import { ComingSoonLink } from "@/components/ui/ComingSoonLink";
import { LangSelect } from "./LangSelect";

export function Topbar() {
  return (
    <div className="topbar">
      <div className="wrap">
        <a className="phone" href="tel:+19084045373">
          ☎ (908) 404-5373 · 24/7 Dispatch
        </a>
        <div className="right">
          <a href="mailto:support@pickloads.com">support@pickloads.com</a>
          <ComingSoonLink kind="Carrier">Carrier Login</ComingSoonLink>
          <ComingSoonLink kind="Shipper">Shipper Login</ComingSoonLink>
          <LangSelect />
        </div>
      </div>
    </div>
  );
}
