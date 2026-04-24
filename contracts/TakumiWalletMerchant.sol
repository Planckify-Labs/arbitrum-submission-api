// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TakumiWalletMerchant is Ownable, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // === Structs ===
    struct QuoteCommitment {
        string  refId;
        string  merchantId;
        address tokenAddress;
        uint256 amount;
        uint256 platformFeeAmount;
        uint256 fiatAmountMinor;
        bytes3  fiatCurrency;
        uint256 exchangeRateId;
        uint256 expiresAt;
    }

    struct MerchantPayment {
        address payer;
        address tokenAddress;
        string  merchantId;
        string  refId;
        uint256 amount;
        uint256 platformFeeAmount;
        uint256 fiatAmountMinor;
        bytes3  fiatCurrency;
        uint256 exchangeRateId;
        uint256 timestamp;
    }

    // === State ===
    address public backendSigner;
    mapping(bytes32 => bool) private _consumedRefs;
    mapping(bytes32 => MerchantPayment) private _payments;
    mapping(address => uint256) public platformFeeAccrued;

    // === Events ===
    event MerchantPaymentProcessed(
        string  indexed refId,
        string  indexed merchantId,
        address indexed payer,
        address tokenAddress,
        uint256 amount,
        uint256 platformFeeAmount,
        uint256 fiatAmountMinor,
        uint256 exchangeRateId
    );
    event PlatformFeesSwept(address indexed token, address indexed recipient, uint256 amount);
    event MerchantBackingSwept(address indexed token, address indexed recipient, uint256 amount);
    event BackendSignerRotated(address indexed previous, address indexed next);

    // === EIP-712 Typehash ===
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "QuoteCommitment(string refId,string merchantId,address tokenAddress,"
        "uint256 amount,uint256 platformFeeAmount,uint256 fiatAmountMinor,"
        "bytes3 fiatCurrency,uint256 exchangeRateId,uint256 expiresAt)"
    );

    // === Constructor ===
    constructor(address initialSigner)
        Ownable(msg.sender)
        EIP712("TakumiPay", "1")
    {
        require(initialSigner != address(0), "ZERO_SIGNER");
        backendSigner = initialSigner;
    }

    // === Core: processMerchantPayment ===
    function processMerchantPayment(
        QuoteCommitment calldata quote,
        bytes calldata backendSignature
    ) external payable {
        // 1. Quote not expired
        require(block.timestamp <= quote.expiresAt, "QUOTE_EXPIRED");

        // 2. Anti-replay
        bytes32 refKey = keccak256(bytes(quote.refId));
        require(!_consumedRefs[refKey], "REF_CONSUMED");

        // 3. Backend signature verification (EIP-712)
        bytes32 structHash = keccak256(abi.encode(
            QUOTE_TYPEHASH,
            keccak256(bytes(quote.refId)),
            keccak256(bytes(quote.merchantId)),
            quote.tokenAddress,
            quote.amount,
            quote.platformFeeAmount,
            quote.fiatAmountMinor,
            quote.fiatCurrency,
            quote.exchangeRateId,
            quote.expiresAt
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        require(ECDSA.recover(digest, backendSignature) == backendSigner, "BAD_QUOTE");

        // 4. Fee sanity
        require(quote.platformFeeAmount <= quote.amount, "FEE_EXCEEDS_AMOUNT");

        // 5. Custody
        if (quote.tokenAddress == address(0)) {
            require(msg.value == quote.amount, "NATIVE_AMOUNT_MISMATCH");
        } else {
            require(msg.value == 0, "UNEXPECTED_NATIVE");
            IERC20(quote.tokenAddress).safeTransferFrom(msg.sender, address(this), quote.amount);
        }

        // 6. Persist + commit + accrue fee
        _consumedRefs[refKey] = true;
        _payments[refKey] = MerchantPayment({
            payer:             msg.sender,
            tokenAddress:      quote.tokenAddress,
            merchantId:        quote.merchantId,
            refId:             quote.refId,
            amount:            quote.amount,
            platformFeeAmount: quote.platformFeeAmount,
            fiatAmountMinor:   quote.fiatAmountMinor,
            fiatCurrency:      quote.fiatCurrency,
            exchangeRateId:    quote.exchangeRateId,
            timestamp:         block.timestamp
        });
        platformFeeAccrued[quote.tokenAddress] += quote.platformFeeAmount;

        emit MerchantPaymentProcessed(
            quote.refId,
            quote.merchantId,
            msg.sender,
            quote.tokenAddress,
            quote.amount,
            quote.platformFeeAmount,
            quote.fiatAmountMinor,
            quote.exchangeRateId
        );
    }

    // === Read ===
    function getMerchantPaymentByRef(string calldata refId)
        external view returns (MerchantPayment memory)
    {
        return _payments[keccak256(bytes(refId))];
    }

    // === Treasury ===
    function sweepPlatformFees(address token, address recipient, uint256 amount)
        external onlyOwner
    {
        require(amount > 0 && amount <= platformFeeAccrued[token], "FEE_AMOUNT_INVALID");
        platformFeeAccrued[token] -= amount;
        _transferOut(token, recipient, amount);
        emit PlatformFeesSwept(token, recipient, amount);
    }

    function sweepMerchantBacking(address token, address recipient, uint256 amount)
        external onlyOwner
    {
        _transferOut(token, recipient, amount);
        emit MerchantBackingSwept(token, recipient, amount);
    }

    // === Signer rotation ===
    function rotateBackendSigner(address next) external onlyOwner {
        require(next != address(0), "ZERO_SIGNER");
        emit BackendSignerRotated(backendSigner, next);
        backendSigner = next;
    }

    // === Internal ===
    function _transferOut(address token, address recipient, uint256 amount) private {
        require(recipient != address(0), "ZERO_RECIPIENT");
        if (token == address(0)) {
            (bool ok,) = recipient.call{value: amount}("");
            require(ok, "NATIVE_TRANSFER_FAILED");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // Allow contract to receive native tokens
    receive() external payable {}
}
