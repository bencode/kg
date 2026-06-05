// Minimal declaration so tsc (NodeNext, no bun-types) can compile the runtime
// adapter in db.ts; the adapter casts to the shared Db interface anyway.
declare module 'bun:sqlite' {
  export const Database: unknown
}
