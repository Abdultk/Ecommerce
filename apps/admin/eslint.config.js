import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import rootConfig from "../../eslint.config.js";

export default [
  ...rootConfig,
  {
    ignores: [".next/**", "coverage/**", "next-env.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
];
