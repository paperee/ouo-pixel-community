import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["web/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        alert: "readonly",
        atob: "readonly",
        Blob: "readonly",
        btoa: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        confirm: "readonly",
        console: "readonly",
        document: "readonly",
        Event: "readonly",
        fetch: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Image: "readonly",
        ImageData: "readonly",
        localStorage: "readonly",
        location: "readonly",
        MutationObserver: "readonly",
        navigator: "readonly",
        prompt: "readonly",
        requestAnimationFrame: "readonly",
        ResizeObserver: "readonly",
        sessionStorage: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
  },
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["scripts/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        atob: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
];
