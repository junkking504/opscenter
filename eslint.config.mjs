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
    "tmp/**",
    "node_modules/**",
    "workerd-dist/**",
    "next-env.d.ts",
  ]),
]);
