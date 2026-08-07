// Ambient declarations for esbuild-loaded assets.
declare module "*.png" {
  const data: Uint8Array;
  export default data;
}
declare module "*.css";
