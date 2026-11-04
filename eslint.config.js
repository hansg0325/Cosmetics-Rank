import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".wrangler/**",
      ".local-browser/**",
    ],
  },
  ...ts.configs.recommended,
);
