import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint config for the admin panel.
 *
 * Created 2026-07-26 (audit). Before this, the repo had NO eslint config at
 * all — `npm run lint` failed outright, and next.config.ts carried
 * `eslint: { ignoreDuringBuilds: true }`, so nothing was ever linted.
 *
 * Baseline is deliberately set at parity with the main app (bahikhata-pro)
 * so CI can go green today. Targeted guard rules are added by the phase that
 * fixes the corresponding class of bug — a rule added before its violations
 * are fixed just gets switched off again:
 *
 *   Phase 3 → ban `.catch(() => <literal>)`   (317 silent-failure sites)
 *   Phase 5 → ban `findMany` without `take`   (27 unbounded reads)
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "react-hooks/exhaustive-deps": "off",
      // Off at main-app parity. The 3 violations are the standard
      // "hydrate state from localStorage in an effect" pattern — a
      // cascading-render perf note, not a correctness defect.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "prefer-const": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-empty": "off",
      "no-case-declarations": "off",
      "no-undef": "off",

      // Kept ON — these catch real defects and the codebase is already clean of them.
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-dupe-else-if": "error",
      "no-constant-condition": "error",
      "no-self-compare": "error",
      "require-atomic-updates": "off", // too noisy on async route handlers
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "prisma/generated/**",
    ],
  },
];

export default eslintConfig;
