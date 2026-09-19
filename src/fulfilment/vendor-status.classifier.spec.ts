import {
  classifyOrderFailure,
  classifyVendorStatus,
} from "./vendor-status.classifier";
import type { TVCGamersOrderStatusData } from "../providers/vendor-api/types/vcgamer-api.types";

function status(
  overrides: Partial<TVCGamersOrderStatusData>,
): TVCGamersOrderStatusData {
  return {
    code: "TRX1",
    status: 1,
    date: "2026-09-19",
    grand_total: 10000,
    delivery_duration: 0,
    ref_id: "ref",
    detail: {
      variation_key: "v",
      variation_name: "V",
      price: 10000,
      customer_data: {},
      voucher_code: "",
      order_param: [],
    },
    history_status: [],
    ...overrides,
  };
}

describe("classifyVendorStatus", () => {
  it("status 2 is delivered, with the raw voucher_code", () => {
    const v = classifyVendorStatus(
      status({
        status: 2,
        detail: { ...status({}).detail, voucher_code: " ABC/DEF " },
      }),
    );
    expect(v).toEqual({ outcome: "delivered", raw: "ABC/DEF" });
  });

  it("a configured failed code is failed", () => {
    const v = classifyVendorStatus(status({ status: 3 }), {
      success: [2],
      failed: [3],
    });
    expect(v.outcome).toBe("failed");
  });

  it("an unknown code with a failure-looking latest history name is failed", () => {
    const v = classifyVendorStatus(
      status({
        status: 9,
        history_status: [
          { status_name: "Pending", timestamp: "2026-09-19T10:00:00Z" },
          { status_name: "Gagal", timestamp: "2026-09-19T10:05:00Z" },
        ],
      }),
    );
    expect(v).toMatchObject({ outcome: "failed", reason: "Gagal" });
  });

  it("history order does not matter — the newest entry decides", () => {
    const v = classifyVendorStatus(
      status({
        status: 9,
        history_status: [
          { status_name: "Failed", timestamp: "2026-09-19T10:05:00Z" },
          { status_name: "Pending", timestamp: "2026-09-19T10:00:00Z" },
        ],
      }),
    );
    expect(v.outcome).toBe("failed");
  });

  it("a success-looking name with an unknown code counts only when a code was handed over", () => {
    const withCode = classifyVendorStatus(
      status({
        status: 7,
        detail: { ...status({}).detail, voucher_code: "X1" },
        history_status: [{ status_name: "Sukses", timestamp: "t" }],
      }),
    );
    const withoutCode = classifyVendorStatus(
      status({
        status: 7,
        history_status: [{ status_name: "Sukses", timestamp: "t" }],
      }),
    );
    expect(withCode.outcome).toBe("delivered");
    expect(withoutCode.outcome).toBe("pending");
  });

  it("anything else is pending", () => {
    expect(classifyVendorStatus(status({ status: 1 })).outcome).toBe("pending");
    expect(classifyVendorStatus(status({ status: 0 })).outcome).toBe("pending");
  });
});

describe("classifyOrderFailure", () => {
  const base = { statusCode: 502, message: "Invalid vendor response" };

  it("a business rejection (4xx the vendor understood) is definitive", () => {
    for (const code of [400, 402, 404, 409, 422]) {
      const c = classifyOrderFailure({
        ...base,
        success: false,
        originalError: { status: code, message: "invalid user id" },
      });
      expect(c.cls).toBe("definitive");
      expect(c.reason).toContain("invalid user id");
    }
  });

  it("timeouts, 5xx, rate limits, auth and lost responses are ambiguous", () => {
    for (const code of [408, 429, 500, 502, 503, 504, 401, 403, undefined]) {
      const c = classifyOrderFailure({
        ...base,
        success: false,
        originalError: { status: code, message: "boom" },
      });
      expect(c.cls).toBe("ambiguous");
    }
    expect(classifyOrderFailure({ ...base, success: false }).cls).toBe(
      "ambiguous",
    );
  });

  it("an accepted HTTP call whose body says FAILED is definitive", () => {
    const c = classifyOrderFailure({
      success: true,
      statusCode: 200,
      message: "Success",
      data: {
        code: 200,
        rc_code: "01",
        status: "FAILED",
        data: { selling_total: 0, transaction_status: "FAILED", trx_code: "" },
      },
    });
    expect(c.cls).toBe("definitive");
  });

  it("an accepted call with a pending body but no trx_code is ambiguous", () => {
    const c = classifyOrderFailure({
      success: true,
      statusCode: 200,
      message: "Success",
      data: {
        code: 200,
        rc_code: "00",
        status: "SUCCESS",
        data: { selling_total: 0, transaction_status: "PENDING", trx_code: "" },
      },
    });
    expect(c.cls).toBe("ambiguous");
  });
});
