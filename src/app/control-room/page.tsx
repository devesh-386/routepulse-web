import type { Metadata } from "next";
import ModeRail from "@/components/shell/ModeRail";
import OpsConsole from "@/components/ops/OpsConsole";

export const metadata: Metadata = { title: "RoutePulse · Control room" };

export default function ControlRoomPage() {
  return (
    <div className="rp-shell">
      <ModeRail mode="control" />
      <div className="rp-main"><OpsConsole /></div>
    </div>
  );
}
