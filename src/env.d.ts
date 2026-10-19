// Build-time constants injected by esbuild (see scripts/build.mjs).
declare const __MIKI_VERSION__: string;
declare const __MIKI_SINGLE__: boolean;
declare const __MIKI_DEV__: boolean;

declare module "*.css";
declare module "*.woff" {
  const url: string;
  export default url;
}
