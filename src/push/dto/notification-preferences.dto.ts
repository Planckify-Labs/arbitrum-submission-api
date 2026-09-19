import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { NOTIFICATION_CATEGORIES } from "../notification-categories";

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: `Per-category on/off. Only the keys present change. Known categories: ${NOTIFICATION_CATEGORIES.join(", ")}. Unknown keys are ignored.`,
    example: { wallet_activity: true, portfolio_digest: true },
  })
  @IsOptional()
  @IsObject()
  categories?: Record<string, boolean>;

  @ApiPropertyOptional({
    description:
      "Hour of day (UTC, 0-23) the daily portfolio digest is sent, when that category is on. Default 2 (09:00 WIB).",
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  digestHourUtc?: number;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({
    description: "Notification ids to mark read. Omit to mark everything read.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];
}

export class InboxQueryDto {
  @ApiPropertyOptional({ description: "Page size (1-100).", example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number = 20;

  @ApiPropertyOptional({
    description: "Id of the last item of the previous page.",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: "Only unread items.", example: false })
  @IsOptional()
  @Type(() => Boolean)
  unreadOnly?: boolean;
}

export class AnnouncementDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @ApiPropertyOptional({
    description:
      "Stable id for this announcement. Re-posting with the same key is a no-op for users already notified — safe to retry.",
    example: "2026-09-release-notes",
  })
  @IsString()
  key: string;

  @ApiPropertyOptional({
    description: "Extra payload for the app's tap handler.",
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "PNG image URL (Android big picture)." })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
