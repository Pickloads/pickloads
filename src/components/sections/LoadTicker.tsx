/*
 * Sample-lane ticker (V4). company_settings.load_ticker_mode switches this to
 * live booked-lane data in Phase 3 (audit S-07). Rows duplicated once for the
 * seamless -50% translateX loop, exactly like the prototype.
 */
import { useV4 } from "@/i18n/v4";

const LANES = [
  ["NEWARK, NJ", "ATLANTA, GA", "DRY VAN", "$2.85/mi"],
  ["MIAMI, FL", "CHARLOTTE, NC", "REEFER", "$3.10/mi"],
  ["HOUSTON, TX", "MEMPHIS, TN", "FLATBED", "$3.02/mi"],
  ["CHICAGO, IL", "DALLAS, TX", "POWER ONLY", "$2.64/mi"],
  ["ELIZABETH, NJ", "COLUMBUS, OH", "BOX TRUCK", "$2.40/mi"],
  ["SAVANNAH, GA", "NASHVILLE, TN", "DRY VAN", "$2.92/mi"],
] as const;

export function LoadTicker() {
  const tv = useV4();
  const rows = [...LANES, ...LANES];
  return (
    // M-90: the board's accessible name and its visible label both translate.
    // The lane rows themselves do not — city names and $/mi are the same in
    // every locale, and "NEWARK, NJ" is a place, not copy.
    <div className="board" aria-label={tv("Sample lanes")}>
      <div className="board-label">
        <i /> {tv("Load Board")}
      </div>
      <div className="board-track">
        {rows.map(([from, to, eq, rate], i) => (
          <div className="board-row" key={i} aria-hidden={i >= LANES.length}>
            {from} <span className="arrow">→</span> {to}{" "}
            <span className="eq">{eq}</span>{" "}
            <span className="rate">{rate}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
