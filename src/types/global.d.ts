type PickOptional<T, R extends keyof T, O extends keyof T> = Pick<T, R> & Partial<Pick<T, O>>;

interface Array<T> {
  sortIn(cmp?:(T,T) => number, ...items:T[]): Array<T>;
  findSortIndex(cmp?:(T,T) => number);
  last: T | undefined;
  someSorted(cmp?:(T) => number): boolean;
  random(): T;
  clone(): T[];
};
