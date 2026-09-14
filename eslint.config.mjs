import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  {
    // These React Compiler advisory rules are not runtime requirements. The
    // existing state synchronization and map-ref patterns remain covered by
    // browser regression tests while they are migrated component by component.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([
    ".next/**",
    // Vite replaces these compiled bundles during a build. Lint their source
    // under desktop-ui instead of racing generated files or double-reporting it.
    "public/desktop-assets/**",
    "tmp/**",
    "node_modules/**",
    "workerd-dist/**",
    "next-env.d.ts",
  ]),
]);
