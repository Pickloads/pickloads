import { Topbar } from "@/components/layout/Topbar";

/**
 * (auth) chrome — deliberately minimal (no nav/footer): sign-in is a utility
 * surface, not a marketing page. Net-new page composed from V4 vocabulary
 * per audit U-10.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Topbar />
      {children}
    </>
  );
}
