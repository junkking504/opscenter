import assert from "node:assert/strict";
import { runInThisContext } from "node:vm";
import { readLinxupPortalCameraInventory as inventoryReader } from "../lib/linxup-camera-inventory";

// Match page.evaluate's serialization boundary: no module/transpiler closures.
const readLinxupPortalCameraInventory: typeof inventoryReader = runInThisContext(`(${inventoryReader.toString()})`);

const root = globalThis as typeof globalThis & { Ext?: unknown };
const previousExt = root.Ext;
const record = (hardwareId: string) => ({ data: { vehicleName: "Truck #9", dashCamVendorDeviceId: hardwareId } });
type LoadOptions = { callback: (records: unknown, operation: unknown, success: boolean) => void };
const install = (store: unknown) => { root.Ext = { StoreManager: { lookup: () => store } }; };

async function main() {
  try {
    let records = [record("")];
    let loads = 0;
    install({
      isLoaded: () => true,
      load: ({ callback }: LoadOptions) => {
        loads++;
        records = [record(loads === 1 ? "camera-current" : "camera-reassigned")];
        callback(records, {}, true);
      },
      getData: () => ({ items: records, getSource: () => null }),
    });
    assert.equal((await readLinxupPortalCameraInventory())[0].hardwareId, "camera-current", "Refresh an already-loaded list that predates assignment");
    assert.equal((await readLinxupPortalCameraInventory())[0].hardwareId, "camera-reassigned", "Refresh every explicit request, including replacements");
    assert.equal(loads, 2);

    install({
      load: ({ callback }: LoadOptions) => callback([], {}, true),
      getData: () => ({ items: [], getSource: () => ({ items: [record("unfiltered-camera")] }) }),
    });
    assert.equal((await readLinxupPortalCameraInventory())[0].hardwareId, "unfiltered-camera", "Saved map filters must not hide cameras");

    install({
      load: ({ callback }: LoadOptions) => callback([], {}, true),
      getDataSource: () => ({ items: [record("")] }),
    });
    assert.deepEqual(await readLinxupPortalCameraInventory(), [{ vehicleName: "Truck #9", hardwareId: "" }], "Preserve verified trucks without cameras");

    install({
      load: ({ callback }: LoadOptions) => callback([], {}, false),
      getData: () => ({ items: [record("")] }),
    });
    await assert.rejects(readLinxupPortalCameraInventory(), /could not be refreshed/, "A failed load must not report an unassigned camera");
    install(undefined);
    await assert.rejects(readLinxupPortalCameraInventory(), /unavailable/);

    const originalSetTimeout = globalThis.setTimeout;
    try {
      globalThis.setTimeout = ((callback: () => void) => originalSetTimeout(callback, 1)) as typeof setTimeout;
      install({ load: () => {} });
      await assert.rejects(readLinxupPortalCameraInventory(), /timed out/, "Bound a hung portal request");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    console.log("LinxUp camera inventory refresh tests passed.");
  } finally {
    root.Ext = previousExt;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
