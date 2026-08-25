import { ApiError } from "@doughpie/api-client";
import { COPY } from "@doughpie/shared";

/**
 * ApiError → 中文文案：契约错误码优先走 shared COPY 常量（保持一致），
 * 其余透传服务端 message（服务端文案同样取自 COPY）；非 ApiError 兜底通用错误。
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_CREDENTIALS":
        return COPY.auth.loginFailed;
      case "USERNAME_TAKEN":
        return COPY.auth.usernameTaken;
      case "USER_DISABLED":
        return COPY.auth.userDisabled;
      case "VERSION_CONFLICT":
        return COPY.common.versionConflict;
      case "UNAUTHORIZED":
        return COPY.common.unauthorized;
      case "FORBIDDEN":
        return COPY.common.forbidden;
      case "NOT_FOUND":
        return COPY.common.notFound;
      case "INVITE_INVALID":
        return COPY.workspace.inviteInvalid;
      case "INVITE_EXPIRED":
        return COPY.workspace.inviteExpired;
      case "ALREADY_MEMBER":
        return COPY.workspace.alreadyMember;
      case "LAST_OWNER":
        return COPY.workspace.lastOwner;
      case "LAST_ADMIN":
        return COPY.admin.lastAdmin;
      case "PENDING_SSO_EXPIRED":
        return COPY.auth.pendingSsoExpired;
      case "IDENTITY_BOUND":
        return COPY.auth.identityBound;
      case "UNBIND_FORBIDDEN":
        return COPY.auth.unbindForbidden;
      case "SUBTASK_LIMIT":
        return COPY.task.subtaskLimit;
      case "RECURRENCE_INVALID":
        return COPY.task.recurrenceInvalid;
      case "REMIND_THROTTLED":
        return COPY.mention.remindThrottled;
      case "VALIDATION_FAILED":
        return COPY.common.validationFailed;
      default:
        return err.message || COPY.common.internal;
    }
  }
  return COPY.common.internal;
}
