"use client";

import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import {
  deleteDriver,
  deleteTruck,
  saveDriver,
  saveTruck,
} from "@/app/actions/fleet";
import { initialFormState } from "@/lib/form-state";
import { FLEET_EQUIPMENT } from "@/lib/validation/fleet";

/**
 * M-55 — trucks & drivers CRUD UI (carrier portal). One add/edit card above
 * an RLS-scoped table; every mutation goes through the fleet server actions
 * (membership-resolved carrier_id, "member manage" policies re-check).
 */

export interface TruckRowUi {
  id: string;
  unit_number: string | null;
  equipment: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  plate_state: string | null;
  active: boolean;
}

export interface DriverRowUi {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_expiry: string | null;
  medical_card_expiry: string | null;
  active: boolean;
}

function RemoveButton({
  id,
  onDelete,
}: {
  id: string;
  onDelete: (formData: FormData) => Promise<{ status: string; message?: string }>;
}) {
  const tv = useV4();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-busy={pending}
      disabled={pending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        start(async () => {
          const fd = new FormData();
          fd.set("id", id);
          await onDelete(fd);
          router.refresh();
        });
      }}
    >
      {pending ? "…" : armed ? tv("Confirm remove") : tv("Remove")}
    </button>
  );
}

const deleteTruckDirect = async (fd: FormData) => deleteTruck(initialFormState, fd);
const deleteDriverDirect = async (fd: FormData) => deleteDriver(initialFormState, fd);

export function TrucksManager({ trucks }: { trucks: TruckRowUi[] }) {
  const tv = useV4();
  const router = useRouter();
  const [editing, setEditing] = useState<TruckRowUi | null>(null);
  const [state, formAction, pending] = useActionState(saveTruck, initialFormState);

  useEffect(() => {
    if (state.status === "success") {
      setEditing(null);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <div className="pcard" key={editing?.id ?? "new"}>
        <h2>{editing ? tv("Edit truck") : tv("Add a truck")}</h2>
        <form action={formAction}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="pform-row">
            <div className="field">
              <label htmlFor="tr-unit">{tv("Unit #")}</label>
              <input id="tr-unit" name="unit_number" type="text" defaultValue={editing?.unit_number ?? ""} placeholder="101" />
            </div>
            <div className="field">
              <label htmlFor="tr-equipment">{tv("Equipment")}</label>
              <select id="tr-equipment" name="equipment" required defaultValue={editing?.equipment ?? ""}>
                <option value="" disabled>
                  {tv("Select…")}
                </option>
                {FLEET_EQUIPMENT.map((e) => (
                  <option key={e} value={e}>
                    {tv(e)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="tr-year">{tv("Year")}</label>
              <input id="tr-year" name="year" type="text" inputMode="numeric" defaultValue={editing?.year ?? ""} placeholder="2019" />
            </div>
            <div className="field">
              <label htmlFor="tr-make">{tv("Make")}</label>
              <input id="tr-make" name="make" type="text" defaultValue={editing?.make ?? ""} placeholder="Freightliner" />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="tr-model">{tv("Model")}</label>
              <input id="tr-model" name="model" type="text" defaultValue={editing?.model ?? ""} placeholder="Cascadia" />
            </div>
            <div className="field">
              <label htmlFor="tr-vin">{tv("VIN")}</label>
              <input id="tr-vin" name="vin" type="text" defaultValue={editing?.vin ?? ""} placeholder="1FUJG…" />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="tr-plate">{tv("Plate")}</label>
              <input id="tr-plate" name="plate" type="text" defaultValue={editing?.plate ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="tr-plate-state">{tv("Plate state")}</label>
              <input id="tr-plate-state" name="plate_state" type="text" defaultValue={editing?.plate_state ?? ""} placeholder="NJ" />
            </div>
          </div>
          <div className="pform-row" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="tr-active">{tv("Status")}</label>
              <select id="tr-active" name="active" defaultValue={editing === null || editing.active ? "true" : "false"}>
                <option value="true">{tv("In service")}</option>
                <option value="false">{tv("Out of service")}</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
                {pending ? tv("Saving…") : editing ? tv("Save changes") : tv("Add truck")}
              </button>
              {editing ? (
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>
                  {tv("Cancel")}
                </button>
              ) : null}
            </div>
          </div>
        </form>
        <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
          {state.status === "error" && state.message ? tv(state.message) : null}
        </div>
      </div>

      <div className="ptable-wrap">
        {trucks.length === 0 ? (
          <p className="pempty">
            {tv("No trucks on file yet — add your first unit above so dispatch knows what you run.")}
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>{tv("Unit #")}</th>
                <th>{tv("Equipment")}</th>
                <th>{tv("Truck")}</th>
                <th>{tv("Plate")}</th>
                <th>{tv("Status")}</th>
                <th>{tv("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {trucks.map((t) => (
                <tr key={t.id}>
                  <td>{t.unit_number ?? "—"}</td>
                  <td>{tv(t.equipment)}</td>
                  <td>
                    {[t.year, t.make, t.model].filter(Boolean).join(" ") || "—"}
                    {t.vin ? (
                      <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "#5c666d" }}>
                        VIN {t.vin}
                      </span>
                    ) : null}
                  </td>
                  <td>{[t.plate, t.plate_state].filter(Boolean).join(" · ") || "—"}</td>
                  <td>
                    <span className={`pbadge ${t.active ? "green" : ""}`}>
                      {t.active ? tv("In service") : tv("Out of service")}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>
                      {tv("Edit")}
                    </button>{" "}
                    <RemoveButton id={t.id} onDelete={deleteTruckDirect} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function DriversManager({ drivers }: { drivers: DriverRowUi[] }) {
  const tv = useV4();
  const router = useRouter();
  const [editing, setEditing] = useState<DriverRowUi | null>(null);
  const [state, formAction, pending] = useActionState(saveDriver, initialFormState);

  useEffect(() => {
    if (state.status === "success") {
      setEditing(null);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <div className="pcard" key={editing?.id ?? "new"}>
        <h2>{editing ? tv("Edit driver") : tv("Add a driver")}</h2>
        <form action={formAction}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="pform-row">
            <div className="field">
              <label htmlFor="dr-name">{tv("Full name")}</label>
              <input id="dr-name" name="full_name" type="text" required defaultValue={editing?.full_name ?? ""} placeholder="Marcus Rivera" />
            </div>
            <div className="field">
              <label htmlFor="dr-phone">{tv("Phone")}</label>
              <input id="dr-phone" name="phone" type="tel" inputMode="tel" defaultValue={editing?.phone ?? ""} placeholder="(___) ___-____" />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="dr-email">{tv("Email")}</label>
              <input id="dr-email" name="email" type="email" defaultValue={editing?.email ?? ""} placeholder="driver@company.com" />
            </div>
            <div className="field">
              <label htmlFor="dr-cdl">{tv("CDL #")}</label>
              <input id="dr-cdl" name="cdl_number" type="text" defaultValue={editing?.cdl_number ?? ""} />
            </div>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="dr-cdl-state">{tv("CDL state")}</label>
              <input id="dr-cdl-state" name="cdl_state" type="text" defaultValue={editing?.cdl_state ?? ""} placeholder="NJ" />
            </div>
            <div className="field">
              <label htmlFor="dr-cdl-expiry">{tv("CDL expiry")}</label>
              <input id="dr-cdl-expiry" name="cdl_expiry" type="date" defaultValue={editing?.cdl_expiry ?? ""} />
            </div>
          </div>
          <div className="pform-row" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="dr-med">{tv("Medical card expiry")}</label>
              <input id="dr-med" name="medical_card_expiry" type="date" defaultValue={editing?.medical_card_expiry ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="dr-active">{tv("Status")}</label>
              <select id="dr-active" name="active" defaultValue={editing === null || editing.active ? "true" : "false"}>
                <option value="true">{tv("Active")}</option>
                <option value="false">{tv("Inactive")}</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
              {pending ? tv("Saving…") : editing ? tv("Save changes") : tv("Add driver")}
            </button>
            {editing ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>
                {tv("Cancel")}
              </button>
            ) : null}
          </div>
        </form>
        <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
          {state.status === "error" && state.message ? tv(state.message) : null}
        </div>
      </div>

      <div className="ptable-wrap">
        {drivers.length === 0 ? (
          <p className="pempty">
            {tv("No drivers on file yet — add your drivers so dispatch can plan hours and home time.")}
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>{tv("Driver")}</th>
                <th>{tv("Contact")}</th>
                <th>{tv("CDL #")}</th>
                <th>{tv("Medical card")}</th>
                <th>{tv("Status")}</th>
                <th>{tv("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td>{d.full_name}</td>
                  <td>
                    {d.phone ?? "—"}
                    {d.email ? (
                      <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "#5c666d" }}>
                        {d.email}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {[d.cdl_number, d.cdl_state].filter(Boolean).join(" · ") || "—"}
                    {d.cdl_expiry ? (
                      <span className="mono" style={{ display: "block", fontSize: ".62rem", color: "#5c666d" }}>
                        {tv("exp.")} {d.cdl_expiry}
                      </span>
                    ) : null}
                  </td>
                  <td>{d.medical_card_expiry ?? "—"}</td>
                  <td>
                    <span className={`pbadge ${d.active ? "green" : ""}`}>
                      {d.active ? tv("Active") : tv("Inactive")}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(d)}>
                      {tv("Edit")}
                    </button>{" "}
                    <RemoveButton id={d.id} onDelete={deleteDriverDirect} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
