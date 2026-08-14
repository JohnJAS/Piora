import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  {
    ignores: [
      "desktop/dist/**",
      "desktop/release/**",
      "Piora-*-win-x64/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/immutability": "error",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
