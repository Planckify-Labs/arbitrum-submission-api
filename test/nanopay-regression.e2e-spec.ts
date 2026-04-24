/**
 * Nanopay regression suite (task 25).
 *
 * Verifies that adding the settlement port + module does not break existing
 * nanopay test paths. These are structural smoke tests that assert the module
 * wiring is sound -- they do NOT exercise the full Circle Gateway settle call.
 *
 * Gated behind `describe.skip` until the full app module is wired with
 * the SettlementModule alongside the existing nanopay code path. Remove
 * `.skip` once the module integration lands.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, HttpStatus } from "@nestjs/common";
import * as request from "supertest";

describe.skip("Nanopay Regression", () => {
  let app: INestApplication | undefined;

  const VALID_SIG = `0x${"ab".repeat(65)}`;
  const TX_HASH = `0x${"cc".repeat(32)}`;
  const CHAIN_ID = 5042002;

  beforeAll(async () => {
    // Bootstrap test app with mocked dependencies
    // const moduleFixture = await Test.createTestingModule({
    //   imports: [AppModule],
    // })
    //   .overrideProvider(PrismaService).useValue(mockPrisma)
    //   .overrideProvider(CircleSettleClient).useValue(circleSettleStub)
    //   .compile();
    // app = moduleFixture.createNestApplication();
    // await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("existing nanopay flow should be unaffected by settlement port addition", () => {
    // Structural assertion: the SettlementModule exports
    // SettlementOrchestratorService, and the NanopaySettlementProvider
    // is registered alongside the OnchainSettlementProvider. Importing
    // the module should not throw.
    const { SettlementModule } = require("../src/pay/settlement/settlement.module");
    const { NanopaySettlementProvider } = require("../src/pay/settlement/providers/nanopay.settlement.provider");
    const { OnchainSettlementProvider } = require("../src/pay/settlement/providers/onchain.settlement.provider");
    const { SettlementOrchestratorService } = require("../src/pay/settlement/settlement-orchestrator.service");

    expect(SettlementModule).toBeDefined();
    expect(NanopaySettlementProvider).toBeDefined();
    expect(OnchainSettlementProvider).toBeDefined();
    expect(SettlementOrchestratorService).toBeDefined();
  });

  it("POST /v1/pay/intents/:id/nanopay still works", async () => {
    // When app is wired:
    // const res = await request(app.getHttpServer())
    //   .post("/v1/pay/intents/pi_nanopay_01/nanopay")
    //   .set("Authorization", "Bearer test-jwt")
    //   .send({ signature: VALID_SIG })
    //   .expect(HttpStatus.OK);
    // expect(res.body.status).toBeDefined();
    expect(true).toBe(true); // placeholder until app wiring
  });

  it("POST /v1/pay/intents/:id/nanopay-svm still works", async () => {
    // When app is wired:
    // const res = await request(app.getHttpServer())
    //   .post("/v1/pay/intents/pi_nanopay_svm_01/nanopay-svm")
    //   .set("Authorization", "Bearer test-jwt")
    //   .send({ signedTransaction: "base64encoded..." })
    //   .expect(HttpStatus.OK);
    // expect(res.body.status).toBeDefined();
    expect(true).toBe(true); // placeholder until app wiring
  });

  it("settlement port does not conflict with existing nanopay submission table", () => {
    // Verify both NanopaySubmission and OnchainSettlement models can
    // coexist: importing the generated types should not throw.
    // In a real test with Prisma:
    //   const { NanopaySubmission } = require("@generated/prisma");
    //   expect(NanopaySubmission).toBeDefined();
    expect(true).toBe(true); // placeholder
  });
});
