import type { Metadata } from "next";
import SimplePlanner from "@/components/simple/SimplePlanner";

export const metadata: Metadata = { title: "RoutePulse · Simple mode" };

export default function SimplePage() {
  return <SimplePlanner />;
}
