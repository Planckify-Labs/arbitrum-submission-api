import * as crypto from "crypto";

export const createSignatureVCGamer = (params) => {
  const secret = `8aa3a704a9c2af43c636df2e59828777`;
  const hmac = crypto.createHmac("sha512", secret).update(params).digest("hex");
  return Buffer.from(hmac).toString("base64");
};

export const getVariantLandingBrandKey = async (brand_key: string) => {
  try {
    if (!brand_key)
      return {
        message: "Brand key tidak ditemukan",
        statusCode: 400,
      };

    const paramsSignature =
      `${process.env.VCGAMERS_SECRET}` + "variation" + brand_key;
    const signature = createSignatureVCGamer(paramsSignature);
    const URL_VARIATION = `https://mitra-api.vcgamers.com/v2/public/variations?sign=${signature}&brand_key=${brand_key}`;
    const fetchResponse = await fetch(URL_VARIATION, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization:
          "Bearer 4d5855d626b5558e155ce6eddb7f370e7749f2e6fee891556e879d46cadb276e8c7a25a4b841efb5972e6d3d9aa2f201bb4d",
      },
    });
    const response = await fetchResponse.json();

    if (response.code !== 200)
      return {
        message: "Gagal mengambil detail produk",
        statusCode: 400,
      };

    return {
      message: "Berhasil mengambil semua data",
      statusCode: 200,
      data: response?.data,
    };
  } catch (err) {
    console.log(err);
    return {
      message: "Terjadi kesalahan di server",
      statusCode: 500,
    };
  }
};

export const getProductList = async () => {
  try {
    const paramsSignature = `${process.env.VCGAMERS_SECRET}` + "brand";
    const signature = createSignatureVCGamer(paramsSignature);
    const URL_BRAND = `https://mitra-api.vcgamers.com/v2/public/brands?sign=${signature}`;
    const fetchResponse = await fetch(URL_BRAND, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization:
          "Bearer 4d5855d626b5558e155ce6eddb7f370e7749f2e6fee891556e879d46cadb276e8c7a25a4b841efb5972e6d3d9aa2f201bb4d",
      },
    });
    const response = await fetchResponse.json();
    console.log("response source:", response);

    if (response.code !== 200)
      return {
        message: "Gagal mengambil produk",
        statusCode: 400,
      };

    return {
      message: "Berhasil mengambil semua data",
      statusCode: 200,
      data: response?.data,
    };
  } catch (err) {
    console.log(err);
    return {
      message: "Terjadi kesalahan di server",
      statusCode: 500,
    };
  }
};
