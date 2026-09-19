import { UserRole } from "@generated/prisma";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../decorators/roles.decorator";
import {
  AnnouncementDto,
  InboxQueryDto,
  MarkNotificationsReadDto,
  UpdateNotificationPreferencesDto,
} from "./dto/notification-preferences.dto";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "./notification-categories";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { PushService } from "./push.service";

interface AuthedRequest {
  user: { id: string; walletAddress?: string | null };
}

/**
 * The user-facing notification centre: the inbox (every push we sent this
 * user, whether or not the OS showed it) and the per-category switches.
 * JWT-scoped — a user only ever sees their own rows.
 */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("users/me")
export class NotificationsController {
  constructor(
    private readonly pushService: PushService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get("notifications")
  @ApiOperation({
    summary:
      "Notification inbox, newest first. Cursor = id of the last item of the previous page.",
  })
  async list(@Request() req: AuthedRequest, @Query() query: InboxQueryDto) {
    return this.pushService.listInbox({
      userId: req.user.id,
      walletAddress: req.user.walletAddress ?? null,
      cursor: query.cursor,
      take: query.take ?? 20,
      unreadOnly: query.unreadOnly === true,
    });
  }

  @Get("notifications/unread-count")
  @ApiOperation({ summary: "Number of unread inbox items (for the badge)." })
  async unreadCount(@Request() req: AuthedRequest) {
    const count = await this.pushService.unreadCount(
      req.user.id,
      req.user.walletAddress ?? null,
    );
    return { count };
  }

  @Post("notifications/read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Mark inbox items read — the given ids, or everything when omitted.",
  })
  async markRead(
    @Request() req: AuthedRequest,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    const updated = await this.pushService.markRead(
      req.user.id,
      req.user.walletAddress ?? null,
      dto.ids,
    );
    return { updated };
  }

  @Get("notification-preferences")
  @ApiOperation({
    summary:
      "Per-category switches (effective values + code defaults) and the digest hour.",
  })
  async getPreferences(@Request() req: AuthedRequest) {
    const view = await this.preferences.getForUser(req.user.id);
    return { ...view, knownCategories: NOTIFICATION_CATEGORIES };
  }

  @Patch("notification-preferences")
  @ApiOperation({
    summary:
      "Flip categories on/off and/or move the digest hour. Only the keys sent change.",
  })
  async updatePreferences(
    @Request() req: AuthedRequest,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    const view = await this.preferences.update(req.user.id, {
      categories: dto.categories as Partial<
        Record<NotificationCategory, boolean>
      >,
      digestHourUtc: dto.digestHourUtc,
    });
    return { ...view, knownCategories: NOTIFICATION_CATEGORIES };
  }
}

/**
 * Ops-only: product announcements to every registered device. The `key`
 * makes a retry (or an accidental double-post) idempotent per user.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/notifications")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminNotificationsController {
  constructor(private readonly pushService: PushService) {}

  @Post("announcements")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      "Broadcast an announcement push to every signed-in device (honours each user's `announcements` switch).",
  })
  async announce(@Body() dto: AnnouncementDto) {
    return this.pushService.broadcastAnnouncement({
      title: dto.title,
      body: dto.body,
      data: dto.data,
      imageUrl: dto.imageUrl,
      dedupeKey: `announcement:${dto.key}`,
    });
  }
}
