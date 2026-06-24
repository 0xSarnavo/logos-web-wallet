// Phase 2 verification: key-vault crypto. Run: npm run test:vault
import { randomBytes } from "node:crypto";
import { deriveKek, seal, open, sealForPassword, openForPassword } from "../src/lib/crypto-vault";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}
async function throws(name: string, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
    fail++;
    console.log(`  ✗ ${name} (expected throw, got success)`);
  } catch {
    pass++;
    console.log(`  ✓ ${name} (threw as expected)`);
  }
}

async function main() {
  const salt = randomBytes(16);
  const password = "hunter2pass";
  const secret = Buffer.from("super-secret-cli-password-32bytes!!", "utf8");

  // 1. round-trip
  const sealed = await sealForPassword(password, salt, secret);
  const back = await openForPassword(password, salt, sealed);
  check("round-trip returns original", back.equals(secret));

  // 2. wrong password fails
  await throws("wrong password fails to open", () =>
    openForPassword("WRONGpass", salt, sealed),
  );

  // 3. wrong salt fails
  await throws("wrong salt fails to open", () =>
    openForPassword(password, randomBytes(16), sealed),
  );

  // 4. tampered ciphertext fails
  const kek = await deriveKek(password, salt);
  const s2 = seal(kek, secret);
  s2.ciphertext[0] ^= 0xff; // flip a byte
  await throws("tampered ciphertext fails (GCM tag)", () => open(kek, s2));

  // 5. determinism: same inputs → same KEK
  const k1 = await deriveKek(password, salt);
  const k2 = await deriveKek(password, salt);
  check("KEK derivation is deterministic", k1.equals(k2));

  // 6. nonce uniqueness
  const a = seal(kek, secret);
  const b = seal(kek, secret);
  check("nonce differs per seal", !a.nonce.equals(b.nonce));
  check("ciphertext differs per seal (random nonce)", !a.ciphertext.equals(b.ciphertext));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
