import {
  closeLinxupCameraBrowser,
  startLinxupCameraStream,
  stopLinxupCameraStream,
} from "../lib/linxup-live-camera";

const configuredTruck = Number(process.env.LINXUP_CAMERA_TEST_TRUCK || "9");
if (!Number.isInteger(configuredTruck) || configuredTruck < 1 || configuredTruck > 99) {
  throw new Error("LINXUP_CAMERA_TEST_TRUCK must be a valid truck number.");
}

async function main(): Promise<void> {
  try {
    const stream = await startLinxupCameraStream(configuredTruck);
    const channels = Object.keys(stream.channels);
    console.log(`LinxUp live camera verified for Truck ${configuredTruck}: ${channels.join(", ")}.`);
    await stopLinxupCameraStream(configuredTruck, channels.includes("outside") ? "outside" : "inside");
  } finally {
    await closeLinxupCameraBrowser();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LinxUp live camera verification failed.");
  process.exitCode = 1;
});
