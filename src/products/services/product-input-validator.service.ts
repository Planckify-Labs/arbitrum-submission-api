import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { InputFieldType } from "@generated/prisma";

export interface TVcGamerForms {
  key: string;
  type: InputFieldType;
  alias: string;
  options?: string[];
}

export interface CustomerInfoKeyValue {
  key: string;
  value: string;
}

export type CustomerInfoObject = Record<
  string,
  string | number | boolean | string[]
>;

export type CustomerInfo = CustomerInfoObject | CustomerInfoKeyValue[];

@Injectable()
export class ProductInputValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validateCustomerInfo(
    productId: string,
    customerInfo?: CustomerInfo,
  ): Promise<CustomerInfo> {
    if (!customerInfo) {
      return {};
    }

    const infoObject: CustomerInfoObject = Array.isArray(customerInfo)
      ? customerInfo.reduce((obj, item) => {
          obj[item.key] = item.value;
          return obj;
        }, {} as CustomerInfoObject)
      : customerInfo;

    const inputField = await this.prisma.productInputField.findFirst({
      where: {
        productId,
      },
    });

    if (!inputField) {
      return customerInfo;
    }

    let formFields: TVcGamerForms[] = [];
    try {
      formFields = inputField.forms as unknown as TVcGamerForms[];

      if (!Array.isArray(formFields)) {
        return customerInfo;
      }
    } catch (error) {
      console.error("Error parsing form fields:", error);
      return customerInfo;
    }

    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    for (const field of formFields) {
      const { key, alias, type } = field;

      if (!infoObject[key]) {
        missingFields.push(alias || key);
        continue;
      }

      const value = infoObject[key];

      switch (type) {
        case InputFieldType.NUMBER:
          if (typeof value !== "number" && isNaN(Number(value))) {
            invalidFields.push(alias || key);
          }
          break;
        case InputFieldType.EMAIL:
          if (
            typeof value !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)
          ) {
            invalidFields.push(alias || key);
          }
          break;
        case InputFieldType.OPTION: {
          const options = field.options;
          if (
            options &&
            Array.isArray(options) &&
            !options.includes(value as string)
          ) {
            invalidFields.push(alias || key);
          }
          break;
        }
      }
    }

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields: ${missingFields.join(", ")}`,
      );
    }

    if (invalidFields.length > 0) {
      throw new BadRequestException(
        `Invalid values for fields: ${invalidFields.join(", ")}`,
      );
    }

    return customerInfo;
  }

  async getProductInputFields(productId: string) {
    const inputField = await this.prisma.productInputField.findFirst({
      where: {
        productId,
      },
    });

    if (!inputField) {
      return [];
    }

    let formFields: TVcGamerForms[] = [];
    try {
      formFields = inputField.forms as unknown as TVcGamerForms[];

      if (!Array.isArray(formFields)) {
        return [];
      }
    } catch (error) {
      console.error("Error parsing form fields:", error);
      return [];
    }

    return formFields;
  }
}
