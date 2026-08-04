import { notFound } from "next/navigation";

/** Catch-all: any unknown path inside a valid locale renders the 404. */
export default function CatchAllPage() {
  notFound();
}
