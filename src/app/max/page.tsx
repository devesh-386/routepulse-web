import type { Metadata } from "next";
import ModeRail from "@/components/shell/ModeRail";
import StreetDashboard from "@/components/street/StreetDashboard";

export const metadata: Metadata = { title: "RoutePulse · Max mode" };

export default function MaxPage() {
  return (
    <div className="rp-shell">
      <ModeRail mode="max" />
      <div className="rp-main"><StreetDashboard /></div>
    </div>
  );
}
