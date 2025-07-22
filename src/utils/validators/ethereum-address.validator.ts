import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

export function IsEthereumAddress(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: "isEthereumAddress",
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: string | unknown) {
          if (typeof value !== "string") {
            return false;
          }
          return /^0x[a-fA-F0-9]{40}$/i.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Ethereum address`;
        },
      },
    });
  };
}
