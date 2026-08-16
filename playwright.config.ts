import { defineConfig } from "playwright/test";
import {
  DEVICE_SCALE_FACTOR,
  resolveBaseURL,
  SCREENSHOT_VIEWPORT,
} from "./scripts/release/dev-stack.ts";

export default defineConfig({
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: resolveBaseURL(),
    viewport: SCREENSHOT_VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  },
});
