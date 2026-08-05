import { Packet } from "@/components/sections/Packet";
import { getBooleanSetting } from "@/lib/company-settings";

/**
 * M-69 / P-6 — server wrapper that reads `packet_downloads_live` and hands
 * it to the (client) Packet section.
 *
 * The section itself must stay a client component (the pending-state toast
 * is an onClick), so the switchboard read lives here: the flag is read
 * server-side through the shared accessor, exactly like every other gate.
 */
export async function PacketSection() {
  const downloadsLive = await getBooleanSetting("packet_downloads_live");
  return <Packet downloadsLive={downloadsLive} />;
}
