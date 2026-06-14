import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Optional JWT guard — populates req.user if a valid token is present,
 * but does NOT throw if the token is missing or invalid.
 * Use this on endpoints that should work for both authenticated and anonymous users.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    // Return user if valid token, null otherwise — never throw
    return (user ?? null) as TUser;
  }
}
