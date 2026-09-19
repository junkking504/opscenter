import WaypointApp from "@/components/WaypointApp";
import { inspectionFont } from "@/lib/inspection-font";

export default function Page() {
  return <div className={inspectionFont.variable}><WaypointApp initialView="jobs" /></div>;
}
