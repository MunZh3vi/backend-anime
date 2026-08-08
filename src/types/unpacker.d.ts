declare module "unpacker" {
  export function detect(packedSource: string): boolean;
  export function unpack(packedSource: string): string;
}
