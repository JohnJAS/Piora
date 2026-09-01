declare module "json-bigint" {
  interface JsonBigOptions {
    alwaysParseAsBig?: boolean;
    constructorAction?: "error" | "ignore" | "preserve";
    protoAction?: "error" | "ignore" | "preserve";
    storeAsString?: boolean;
    strict?: boolean;
    useNativeBigInt?: boolean;
  }

  interface JsonBigApi {
    parse(text: string): unknown;
    stringify(value: unknown, replacer?: unknown, space?: string | number): string;
  }

  function JSONBig(options?: JsonBigOptions): JsonBigApi;
  export default JSONBig;
}
