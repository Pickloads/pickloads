/*
 * Sample-lane ticker (V4). company_settings.load_ticker_mode switches this to
 * live booked-lane data in Phase 3 (audit S-07). Rows duplicated once for the
 * seamless -50% translateX loop, exactly like the prototype.
 */
const LANES = [
  ["NEWARK, NJ", "ATLANTA, GA", "DRY VAN", "$2.85/mi"],
  ["MIAMI, FL", "CHARLOTTE, NC", "REEFER", "$3.10/mi"],
  ["HOUSTON, TX", "MEMPHIS, TN", "FLATBED", "$3.02/mi"],
  ["CHICAGO, IL", "DALLAS, TX", "POWER ONLY", "$2.64/mi"],
  ["ELIZABETH, NJ", "COLUMBUS, OH", "BOX TRUCK", "$2.40/mi"],
  ["SAVANNAH, GA", "NASHVILLE, TN", "DRY VAN", "$2.92/mi"],
] as const;

export function LoadTicker() {
  const rows = [...LANES, ...LANES];
  return (
    <div className="board" aria-label="Sample lanes">
      <div className="board-label">
        <i /> Load Board
      </div>
      <div className="board-track">
        {rows.map(([from, to, eq, rate], i) => (
          <div className="board-row" key={i} aria-hidden={i >= LANES.length}>
            {from} <span className="arrow">→</span> {to}{" "}
            <span className="eq">{eq}</span> <span className="rate">{rate}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
