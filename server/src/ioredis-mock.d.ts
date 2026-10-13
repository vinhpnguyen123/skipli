// ioredis-mock ships no types; it mirrors ioredis's Redis class.
declare module 'ioredis-mock' {
  import { Redis } from 'ioredis';
  export default Redis;
}
