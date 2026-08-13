import { useV4 } from "@/i18n/v4";

export function CallFab() {
  const tv = useV4();
  return (
    // M-90: the mobile call button is the loudest CTA below 700px and was a
    // bare JSX literal — English in every locale, on the one surface a driver
    // is most likely to be using.
    <a className="call-fab" href="tel:+19084045373">
      <span aria-hidden="true">☎</span>{" "}
      {tv("Call Dispatch Now — (908) 404-5373")}
    </a>
  );
}
