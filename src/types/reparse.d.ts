declare module 'reparse' {
  export type Production<T = unknown> =
    | RegExp
    | ((this: ReParse) => T);

  export class ReParse {
    constructor(input:string, ignorews?:boolean);

    eof(): boolean;
    fail(input?:string): never;
    produce<T>(method:Production<T>): T;
    start<T>(method:Production<T>): T;
    maybe<T>(method:Production<T>): T;
    option<T, O>(method:Production<T>, otherwise:O): T | O;
    between<T>(left:Production, right:Production, body:Production<T>): T;
    match(pattern:RegExp): string;
    choice<T>(...methods:Production<T>[]): T;
    seq<T extends unknown[]>(...methods:{ [K in keyof T]: Production<T[K]> }): [ string, ...T ];
    skip(method:Production, min?:number): this;
    skip1(method:Production): this;
    skipWS(): this;
    many<T>(method:Production<T>, min?:number): T[];
    many1<T>(method:Production<T>): T[];
    sepBy<T>(method:Production<T>, sep:Production, min?:number): T[];
    sepBy1<T>(method:Production<T>, sep:Production): T[];
    endBy<T>(method:Production<T>, end:Production, min?:number): T[];
    endBy1<T>(method:Production<T>, end:Production): T[];
    sepEndBy<T>(method:Production<T>, sep:Production, min?:number): T[];
    sepEndBy1<T>(method:Production<T>, sep:Production): T[];
  }
}
