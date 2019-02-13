type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;
type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };
