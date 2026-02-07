/**
 * Type declarations stub for 'xlsx' module.
 * Install the real package via `npm install xlsx` for full functionality.
 */
declare module 'xlsx' {
    export interface WorkBook {
        SheetNames: string[];
        Sheets: { [sheet: string]: WorkSheet };
    }
    export interface WorkSheet {
        [cell: string]: any;
    }
    export interface ParsingOptions {
        type?: 'base64' | 'binary' | 'buffer' | 'file' | 'array' | 'string';
        cellDates?: boolean;
        cellFormula?: boolean;
        cellStyles?: boolean;
        cellNF?: boolean;
        cellHTML?: boolean;
        raw?: boolean;
        dense?: boolean;
        sheetRows?: number;
        [key: string]: any;
    }
    export interface WritingOptions {
        type?: 'base64' | 'binary' | 'buffer' | 'file' | 'array' | 'string';
        bookType?: string;
        bookSST?: boolean;
        [key: string]: any;
    }
    export interface Sheet2JSONOpts {
        header?: number | string | string[];
        range?: any;
        raw?: boolean;
        dateNF?: string;
        defval?: any;
        blankrows?: boolean;
        [key: string]: any;
    }
    export const utils: {
        sheet_to_json<T = any>(sheet: WorkSheet, opts?: Sheet2JSONOpts): T[];
        json_to_sheet(data: any[], opts?: any): WorkSheet;
        aoa_to_sheet(data: any[][], opts?: any): WorkSheet;
        book_new(): WorkBook;
        book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void;
        sheet_to_csv(sheet: WorkSheet, opts?: any): string;
        sheet_to_html(sheet: WorkSheet, opts?: any): string;
        decode_range(range: string): any;
        decode_cell(cell: string): any;
        encode_cell(cell: { c: number; r: number }): string;
        encode_range(range: any): string;
        [key: string]: any;
    };
    export function read(data: any, opts?: ParsingOptions): WorkBook;
    export function readFile(filename: string, opts?: ParsingOptions): WorkBook;
    export function write(wb: WorkBook, opts?: WritingOptions): any;
    export function writeFile(wb: WorkBook, filename: string, opts?: WritingOptions): void;
}
