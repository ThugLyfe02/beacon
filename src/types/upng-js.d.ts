declare module 'upng-js' {
  interface DecodedPng {
    width: number;
    height: number;
    depth?: number;
    ctype?: number;
    data?: ArrayBuffer;
    [key: string]: unknown;
  }

  interface UPNGStatic {
    decode(buffer: ArrayBuffer): DecodedPng;
    toRGBA8(decoded: DecodedPng): ArrayBuffer[];
    encode(buffers: ArrayBuffer[], width: number, height: number, colors?: number): ArrayBuffer;
  }

  const UPNG: UPNGStatic;
  export default UPNG;
}
