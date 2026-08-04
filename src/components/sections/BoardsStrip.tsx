import { useV4Rich } from "@/i18n/v4";
export function BoardsStrip() {
  const t = useV4Rich();
  return (
    <div className="boards-strip">
      <div className="wrap">
<p>{t.rich("rich_boards_p", { b: (c) => <b>{c}</b> })}</p>
        <div className="board-names">
          <span className="board-name">DAT ONE</span>
          <span className="board-name">TRUCKSTOP</span>
          <span className="board-name">123LOADBOARD</span>
          <span className="board-name">DIRECT BROKER NETWORK</span>
        </div>
        <small>
          {"// Platform names are the property of their respective owners. PickLoads is an independent dispatch service and is not affiliated with or endorsed by these platforms."}
        </small>
      </div>
    </div>
  );
}
