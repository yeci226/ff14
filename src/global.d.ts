declare module 'opencc-js' {
    export interface ConverterOptions {
        from?: string;
        to?: string;
    }
    export type ConvertFunc = (text: string) => string;
    export function Converter(options: ConverterOptions): ConvertFunc;
}
