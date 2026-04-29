import type { Response } from "express";

export function setTotalCountHeader(res: Response, total: number): void {
  res.setHeader("X-Total-Count", String(total));
}

export type ListPaginationDto = {
  cursor?: string;
  take?: number;
  skip?: number;
};

export function buildPrismaPagination(p: ListPaginationDto): {
  take: number;
  skip: number;
  cursor?: { id: string };
} {
  const take = Math.max(1, Math.min(200, p.take ?? 10));
  if (typeof p.skip === "number" && p.skip > 0) {
    return { take, skip: p.skip };
  }
  return {
    take,
    skip: p.cursor ? 1 : 0,
    cursor: p.cursor ? { id: p.cursor } : undefined,
  };
}
