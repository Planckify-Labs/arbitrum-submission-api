import { parsePln, isPlnVoucher } from "./parsers/pln.parser";
import { parseWithTemplate } from "./parsers/template.parser";
import { parseHeuristic } from "./parsers/heuristic.parser";
import { maskVoucher, voucherSignature } from "./delivery-signature";
import { isVoucherTemplate, resolveDeliveryType } from "./delivery.types";
import { DeliveryType } from "@generated/prisma";

describe("PLN parser (ported from mobile vcGamerUtils)", () => {
  it("parses the canonical shape", () => {
    const out = parsePln(
      "2174-8986-6628-2450-0152/NURMULIANI-MTMN/R1/450VA/43.9KWH",
    );
    expect(out?.primary).toEqual({
      label: "Token",
      value: "2174-8986-6628-2450-0152",
      copyable: true,
    });
    expect(out?.fields).toEqual([
      { label: "Name", value: "NURMULIANI-MTMN" },
      { label: "Tarif / Power", value: "R1 / 450 VA" },
      { label: "kWh", value: "43.9 kWh" },
    ]);
    expect(out?.parse).toBe("exact");
    expect(out?.parserId).toBe("pln@2");
  });

  it("survives dropped unit suffixes and comma decimals", () => {
    const out = parsePln(
      "0591-0184-8779-9496-4877/NURMULIANIMTMN/R1/450/109,6",
    );
    expect(out?.fields).toEqual([
      { label: "Name", value: "NURMULIANIMTMN" },
      { label: "Tarif / Power", value: "R1 / 450 VA" },
      { label: "kWh", value: "109.6 kWh" },
    ]);
  });

  it("survives casing and spacing drift", () => {
    const out = parsePln(
      "2174-8986-6628-2450-0152/NURMULIANI-MTMN/r1/450 VA/109,6KWH",
    );
    expect(out?.fields[1]).toEqual({
      label: "Tarif / Power",
      value: "R1 / 450 VA",
    });
    expect(out?.fields[2]).toEqual({ label: "kWh", value: "109.6 kWh" });
  });

  it("segment order does not matter", () => {
    const out = parsePln("R1/450VA/2174-8986-6628-2450-0152/43.9KWH/SOMEONE");
    expect(out?.primary?.value).toBe("2174-8986-6628-2450-0152");
    expect(out?.fields.find((f) => f.label === "Name")?.value).toBe("SOMEONE");
  });

  it("is not PLN without a 20-digit token", () => {
    expect(isPlnVoucher("ABCD-EFGH-IJKL")).toBe(false);
    expect(parsePln("STEAM-1234-5678")).toBeNull();
  });
});

describe("template parser", () => {
  const template = {
    separator: "|",
    fields: ["Code", "PIN", "", "Expires"],
    primary: 0,
  };

  it("labels by position and drops empty labels", () => {
    const out = parseWithTemplate(
      "ABCD1234|9876|internal|2027-01-01",
      template,
      "GPLAY",
    );
    expect(out?.primary).toEqual({
      label: "Code",
      value: "ABCD1234",
      copyable: true,
    });
    expect(out?.fields).toEqual([
      { label: "PIN", value: "9876" },
      { label: "Expires", value: "2027-01-01" },
    ]);
    expect(out?.parse).toBe("template");
    expect(out?.parserId).toBe("template:GPLAY");
  });

  it("returns null when the segment count does not match — the template is stale", () => {
    expect(parseWithTemplate("ABCD1234|9876", template, "GPLAY")).toBeNull();
  });

  it("validates templates", () => {
    expect(isVoucherTemplate(template)).toBe(true);
    expect(isVoucherTemplate({ ...template, primary: 4 })).toBe(false);
    expect(isVoucherTemplate({ ...template, separator: "" })).toBe(false);
    expect(isVoucherTemplate(null)).toBe(false);
  });
});

describe("heuristic parser", () => {
  it("promotes the most code-looking segment and keeps key:value pairs", () => {
    const out = parseHeuristic(
      "Serial: 1234567890123 / Code: AB12-CD34-EF56 / Valid until 2027",
    );
    expect(out.primary).toEqual({
      label: "Code",
      value: "AB12-CD34-EF56",
      copyable: true,
    });
    expect(out.fields).toEqual([
      { label: "Serial", value: "1234567890123", copyable: true },
      { label: "", value: "Valid until 2027" },
    ]);
    expect(out.parse).toBe("heuristic");
  });

  it("never loses the raw and copes with a plain single code", () => {
    const out = parseHeuristic("XK7Q-9PLM-22ZA");
    expect(out.primary?.value).toBe("XK7Q-9PLM-22ZA");
    expect(out.raw).toBe("XK7Q-9PLM-22ZA");
  });

  it("a sentence is not a code", () => {
    const out = parseHeuristic(
      "Your voucher will be sent by email within 24 hours",
    );
    expect(out.primary).toBeUndefined();
    expect(out.fields).toHaveLength(1);
  });
});

describe("signature + mask", () => {
  it("two PLN tokens share a signature; a Steam key does not", () => {
    const a = voucherSignature(
      "2174-8986-6628-2450-0152/NURMU/R1/450VA/43.9KWH",
    );
    const b = voucherSignature(
      "0591-0184-8779-9496-4877/ANDI/R2/900VA/12.1KWH",
    );
    expect(a).toBe(b);
    expect(voucherSignature("XK7Q-9PLM-22ZA")).not.toBe(a);
  });

  it("masks the middle of every run so ops never sees a live code", () => {
    expect(maskVoucher("ABCD1234/PIN 9876")).toBe("A••••••4/PIN 9••6");
    expect(
      voucherSignature(
        "2174-8986-6628-2450-0152/NURMULIANI-MTMN/R1/450VA/43.9KWH",
      ),
    ).toBe("9999-9999-9999-9999-9999/a-a/a9/999a/99.9a");
  });
});

describe("resolveDeliveryType", () => {
  it("explicit wins, else isVoucher decides", () => {
    expect(
      resolveDeliveryType({
        deliveryType: DeliveryType.EMAIL,
        isVoucher: true,
      }),
    ).toBe("EMAIL");
    expect(resolveDeliveryType({ deliveryType: null, isVoucher: true })).toBe(
      "VOUCHER_CODE",
    );
    expect(resolveDeliveryType({ deliveryType: null, isVoucher: false })).toBe(
      "DIRECT_TOPUP",
    );
  });
});
