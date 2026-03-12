declare module "ms" {
  type Options = {
    long?: boolean;
  };

  export default function ms(value: string, options?: Options): number;
  export default function ms(value: number, options?: Options): string;
}
