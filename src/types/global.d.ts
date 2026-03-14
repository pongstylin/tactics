type Exact<T, U extends T> = U & Record<Exclude<keyof U, keyof T>, never>;
type PickOptional<T, R extends keyof T, O extends keyof T> = Pick<T, R> & Partial<Pick<T, O>>;
type PickRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
type PickPartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type SetElementType<T> = T extends Set<infer U> ? U : never;
type IsObject<T> = T extends object
  ? T extends Array<any>
    ? false
    : T extends null
      ? false
      : true
  : false;
type DeepMerge<T> = T extends [infer Head, ...infer Tail]
  ? Head extends object
    ? Tail extends []
      ? Head
      : MergeTwo<Head, DeepMerge<Tail>>
    : DeepMerge<Tail>
  : {};
type MergeTwo<T1, T2> = {
  [K in keyof T1 | keyof T2]: K extends keyof T2
    ? K extends keyof T1
      ? IsObject<T1[K]> extends true
        ? IsObject<T2[K]> extends true
          ? MergeTwo<T1[K], T2[K]>
          : T2[K]
        : T2[K]
      : T2[K]
    : K extends keyof T1
      ? T1[K]
      : never;
};
interface Array<T> {
  sortIn(cmp?:(T,T) => number, ...items:T[]): Array<T>;
  findSortIndex(cmp?:(T,T) => number);
  last: T | undefined;
  someSorted(cmp?:(T) => number): boolean;
  random(): T;
  clone(): T[];
};

interface Object {
  clone<T>(this:T): T;
  merge<T>(this:T, ...args:T[]): T;
  pick<T, K extends keyof T>(this:T, ...keys: K[]): Pick<T, K>
};

interface PromiseConstructor {
  isThenable(value:unknown): value is PromiseLike<unknown>;
};

type UnwrapFunction<T> = T extends (...args: any[]) => infer U ? U : T;
type Constructor<T> = new (...args: any[]) => T;
type ValueType<T> = 
  T extends Array<infer U> ? U :
  T extends Set<infer U> ? U :
  T extends Map<any, infer U> ? U :
  T extends Promise<infer U> ? U :
  T extends (...args: any[]) => infer U ? U :
  T;
type Override<T, U> = Omit<T, keyof U> & U;