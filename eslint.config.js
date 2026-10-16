import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.supabase/**",
      "supabase/.temp/**",
      "**/dist-demo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  // 閲覧サイト（ブラウザで動く）
  {
    files: ["apps/viewer/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat["recommended-latest"],
  },
  // テストでは、モックの関数をそのまま expect に渡す
  { files: ["**/test/**/*.ts"], rules: { "@typescript-eslint/unbound-method": "off" } },
);
