// A bundled image: Metro turns `import x from './a.png'` into an asset id (a number) that Image takes as `source`.
declare module '*.png' {
  const assetId: number;
  export default assetId;
}
