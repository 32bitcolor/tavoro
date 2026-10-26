import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters.
const options = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, options);
}

let dummy: Promise<string> | undefined;
/** A real hash of a random secret, for checking a password when there's no account. */
export function dummyHash(): Promise<string> {
  dummy ??= hash(crypto.randomUUID(), options);
  return dummy;
}
