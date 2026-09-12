export type PortalCameraTracker = { vehicleName: string; hardwareId: string };

// Runs inside the portal page. Keep this self-contained for page.evaluate.
export async function readLinxupPortalCameraInventory(): Promise<PortalCameraTracker[]> {
  type ExtRecord = { data?: Record<string, unknown> };
  type Collection = { items?: ExtRecord[]; getSource?: () => Collection | null };
  type ExtStore = {
    load?: (options: { callback: (records: unknown, operation: unknown, success: boolean) => void }) => void;
    getDataSource?: () => Collection;
    getData?: () => Collection;
  };
  type ExtApi = { StoreManager?: { lookup?: (name: string) => ExtStore | undefined } };
  const store = (globalThis as unknown as { Ext?: ExtApi }).Ext?.StoreManager?.lookup?.("mapVehicleLocationStore");
  if (!store?.load) throw new Error("LinxUp tracker inventory is unavailable.");

  // isLoaded only describes a past load, including one before a camera was assigned.
  // Refresh on the explicit camera request; never infer absence from a failed load.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LinxUp tracker inventory timed out.")), 20_000);
    try {
      store.load!({ callback(_records, _operation, success) {
        clearTimeout(timer);
        if (success === true) resolve();
        else reject(new Error("LinxUp tracker inventory could not be refreshed."));
      } });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });

  const data = store.getData?.();
  const records = (store.getDataSource?.() || data?.getSource?.() || data)?.items;
  if (!records) throw new Error("LinxUp tracker inventory is unavailable.");
  return records.map((record) => ({
    vehicleName: String(record.data?.vehicleName || ""),
    hardwareId: String(record.data?.dashCamVendorDeviceId || ""),
  })).filter((record) => record.vehicleName);
}
