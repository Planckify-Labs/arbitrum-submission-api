import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@generated/prisma";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { Roles } from "../../decorators/roles.decorator";
import { AdminFulfilmentService } from "./admin-fulfilment.service";
import {
  FulfilmentKindParam,
  ListOrdersQueryDto,
  ListRefundsQueryDto,
  ListShapesQueryDto,
  OptionalRefundNoteDto,
  PreviewTemplateDto,
  RefundNoteDto,
  ResolveOrderDto,
  SetVoucherTemplateDto,
} from "./dto/admin-fulfilment.dto";
import { FULFILMENT_KINDS } from "./dto/admin-fulfilment.dto";
import { BadRequestException } from "@nestjs/common";

type AdminReq = { user: { id: string } };

function kindParam(kind: string): FulfilmentKindParam {
  if (!(FULFILMENT_KINDS as readonly string[]).includes(kind)) {
    throw new BadRequestException(
      `kind must be one of ${FULFILMENT_KINDS.join(", ")}`,
    );
  }
  return kind as FulfilmentKindParam;
}

/**
 * Ops surface for the fulfilment leg: orders the vendor left in limbo,
 * held refunds, and the voucher-shape log that tells ops which brands
 * still need a parser template. Every write lands in `AdminAuditLog`.
 */
@Controller("admin/fulfilment")
@ApiTags("admin-fulfilment")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminFulfilmentController {
  constructor(private readonly svc: AdminFulfilmentService) {}

  @Get("orders")
  @ApiOperation({
    summary:
      "Orders by fulfilment status (default NEEDS_RECONCILE), both kinds.",
  })
  listOrders(@Query() q: ListOrdersQueryDto) {
    return this.svc.listOrders({
      status: q.status,
      kind: q.kind,
      limit: q.limit,
    });
  }

  @Post("orders/:kind/:id/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ask the vendor about this order right now." })
  checkOrder(@Param("kind") kind: string, @Param("id") id: string) {
    return this.svc.checkOrder(kindParam(kind), id);
  }

  @Post("orders/:kind/:id/resolve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Decide an ambiguous order: delivered, or failed (→ points refund).",
  })
  resolveOrder(
    @Request() req: AdminReq,
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() body: ResolveOrderDto,
  ) {
    return this.svc.resolveOrder(kindParam(kind), id, {
      outcome: body.outcome,
      note: body.note,
      raw: body.raw,
      adminId: req.user.id,
    });
  }

  @Get("refunds")
  @ApiOperation({
    summary: "Refund ledger by status (default PENDING_REVIEW).",
  })
  listRefunds(@Query() q: ListRefundsQueryDto) {
    return this.svc.listRefunds({ status: q.status, limit: q.limit });
  }

  @Post("refunds/:id/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Credit a held refund." })
  approveRefund(
    @Request() req: AdminReq,
    @Param("id") id: string,
    @Body() body: OptionalRefundNoteDto,
  ) {
    return this.svc.approveRefund(id, req.user.id, body.note);
  }

  @Post("refunds/:id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Decline a held refund (note required)." })
  rejectRefund(
    @Request() req: AdminReq,
    @Param("id") id: string,
    @Body() body: RefundNoteDto,
  ) {
    return this.svc.rejectRefund(id, req.user.id, body.note);
  }

  @Post("refunds/:id/reverse")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Claw back a completed refund whose order was delivered after all. Refuses if the balance can't cover it.",
  })
  reverseRefund(
    @Request() req: AdminReq,
    @Param("id") id: string,
    @Body() body: RefundNoteDto,
  ) {
    return this.svc.reverseRefund(id, req.user.id, body.note);
  }

  @Get("voucher-shapes")
  @ApiOperation({
    summary:
      "Distinct voucher_code shapes seen per product, with the parser tier that handled them.",
  })
  listShapes(@Query() q: ListShapesQueryDto) {
    return this.svc.listShapes({
      tier: q.tier,
      productCode: q.productCode,
      limit: q.limit,
    });
  }

  @Put("products/:code/voucher-template")
  @ApiOperation({
    summary:
      "Set (or clear with template: null) the positional parser for a product's voucher_code.",
  })
  setTemplate(
    @Request() req: AdminReq,
    @Param("code") code: string,
    @Body() body: SetVoucherTemplateDto,
  ) {
    return this.svc.setVoucherTemplate(
      code,
      body.template ?? null,
      req.user.id,
    );
  }

  @Post("products/:code/voucher-template/preview")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Dry-run a template against a raw voucher_code before saving it.",
  })
  previewTemplate(
    @Param("code") code: string,
    @Body() body: PreviewTemplateDto,
  ) {
    return this.svc.previewTemplate(code, body.template, body.raw);
  }
}
