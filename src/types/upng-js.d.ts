declare module 'upng-js' {
  interface UPNGStatic {
    decode(buffer: ArrayBuffer): unknown;
    toRGBA8(decoded: unknown): ArrayBuffer[];
    encode(buffers: ArrayBuffer[], width: number, height: number, colors?: number): ArrayBuffer;
  }

  const UPNG: UPNGStatic;
  export default UPNG;
}
