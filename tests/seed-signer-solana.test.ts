import { describe } from "noba";
import SeedSignerSolana from "../src/signers/seed-signer-solana";
import { createSolanaRpc } from "@solana/rpc";
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/transaction-messages";
import { address } from "@solana/addresses";
import {
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/transactions";
import { pipe } from "@solana/functional";
import { getAddMemoInstruction } from "@solana-program/memo";

const TEST_SEED_PHRASE =
  "test walk nut penalty hip pave soap entry language right filter choice";

describe("SeedSignerSolana", ({ test }) => {
  test("should initiate", async ({ expect }) => {
    const signer = new SeedSignerSolana(TEST_SEED_PHRASE).derive("0'/0");

    while (!signer.isActive) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(signer.address).to.be.truthy();
  });

  describe("sign & verify", async ({ test }) => {
    const signer = new SeedSignerSolana(TEST_SEED_PHRASE).derive("0'/0");

    while (!signer.isActive) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const MESSAGE = "Test message";

    test("should sign", async ({ expect }) => {
      const sig = await signer.sign(MESSAGE);

      expect(sig).to.be(
        "90d1d5dc7430f3efa9fa037ba2179458fad9a8bfdf42ba74fff4581ce9e0ac2fba1562483b072e9eee709ef8d59448b379d9a61e634b37a3c13858bab7754f08"
      );
    });

    test("should verify", async ({ expect }) => {
      const sig = await signer.sign(MESSAGE);
      const ok = await signer.verify(MESSAGE, sig);

      expect(ok).to.be(true);
    });
  });

  describe("signTransaction", async ({ test }) => {
    const signer = new SeedSignerSolana(TEST_SEED_PHRASE).derive("0'/0/0");

    while (!signer.isActive) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    test("should sign a transaction", async ({ expect }) => {
      const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({
          commitment: "confirmed",
        })
        .send();

      const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(address(signer.address), m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) =>
          appendTransactionMessageInstruction(
            getAddMemoInstruction({
              memo: "This is a simple memo",
            }),
            m
          )
      );

      const unsignedTx = Buffer.from(
        getBase64EncodedWireTransaction(compileTransaction(transactionMessage)),
        "base64"
      );

      const signedTx = await signer.signTransaction(unsignedTx);

      expect(signedTx).to.be.truthy();
    });
  });
});
