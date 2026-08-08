import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * Next 16 / ESLint 9 flat config (eslint-config-next recommended).
 * The app is not compiled with React Compiler. Its advisory-only rules flag
 * intentional effect-driven UI synchronization and ref bridges used by the
 * media players, so keep correctness rules (notably exhaustive-deps) enabled
 * while disabling compiler migration diagnostics.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-export/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
  ]),
]);

export default eslintConfig;
