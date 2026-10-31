import { z } from "zod";
import { Email, Id, IsoDateTime, PersonName } from "./common";
import { RoleSchema } from "./rbac";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const NewPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

const Token = z.string().min(16).max(256);

export const RegisterInput = z.object({
  email: Email,
  password: NewPassword,
  firstName: PersonName,
  lastName: PersonName,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

/** Login does not re-check password rules: old accounts may predate them. */
export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const PublicUser = z.object({
  id: Id,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: RoleSchema,
  emailVerified: z.boolean(),
});
export type PublicUser = z.infer<typeof PublicUser>;

/** The refresh token is never in the body; it travels as an httpOnly cookie. */
export const AuthSession = z.object({ accessToken: z.string().min(1), user: PublicUser });
export type AuthSession = z.infer<typeof AuthSession>;

export const VerifyEmailInput = z.object({ token: Token });
export const ForgotPasswordInput = z.object({ email: Email });
export const ResendVerificationInput = z.object({ email: Email });
export const ResetPasswordInput = z.object({ token: Token, password: NewPassword });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

// ---------- Admin two-step login ----------

export const AdminLoginInput = LoginInput;
export type AdminLoginInput = LoginInput;

export const AdminChallenge = z.object({
  challengeToken: z.string().min(1),
  /** True on first login: the client shows the QR code from otpauthUrl. */
  enrollmentRequired: z.boolean(),
  otpauthUrl: z.string().startsWith("otpauth://").optional(),
});
export type AdminChallenge = z.infer<typeof AdminChallenge>;

/** A 6-digit TOTP code; also the step-up proof for sensitive admin changes. */
export const TotpCode = z
  .string()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

export const Admin2faInput = z.object({
  challengeToken: z.string().min(1),
  code: TotpCode,
});
export type Admin2faInput = z.infer<typeof Admin2faInput>;

// ---------- Staff invites (Phase 2) ----------
// Admin 2FA enrollment only happens through an emailed invite, so a leaked
// password alone can never enroll an attacker's authenticator.

export const STAFF_ROLES = ["STAFF", "ADMIN", "SUPER_ADMIN"] as const;

export const AdminInviteInput = z.object({
  email: Email,
  firstName: PersonName,
  lastName: PersonName,
  role: z.enum(STAFF_ROLES),
});
export type AdminInviteInput = z.infer<typeof AdminInviteInput>;

/** POST /admin/auth/accept-invite → AdminChallenge with the enrollment otpauthUrl. */
export const AcceptInviteInput = z.object({ token: Token, password: NewPassword });
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

// ---------- Admin-initiated password resets (Phase 3b) ----------
// Admins send a reset link; they never see or set another user's password.

/** POST /admin/users/:userId/password-reset. `resetTwoFactor` is for staff targets, SUPER_ADMIN only. */
export const AdminPasswordResetInput = z
  .object({ resetTwoFactor: z.boolean().optional() })
  .strict();
export type AdminPasswordResetInput = z.infer<typeof AdminPasswordResetInput>;

/** 202 body of the admin password-reset endpoint. */
export const PasswordResetSent = z.object({ sent: z.literal(true) });
export type PasswordResetSent = z.infer<typeof PasswordResetSent>;

/** POST /admin/auth/reset-password: staff tokens only (customer tokens are rejected there). */
export const AdminResetPasswordInput = ResetPasswordInput;
export type AdminResetPasswordInput = ResetPasswordInput;

// ---------- Admin profile (Phase 3b) ----------

/** GET/PATCH /admin/me. PATCH takes ProfileUpdate (name only). */
export const AdminProfile = PublicUser.extend({ totpEnabledAt: IsoDateTime.nullable() });
export type AdminProfile = z.infer<typeof AdminProfile>;

/** POST /admin/me/password: revokes every other session on success. */
export const ChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
    newPassword: NewPassword,
    totpCode: TotpCode,
  })
  .refine((p) => p.newPassword !== p.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

// ---------- Customer security and privacy ----------

/** POST /me/password: a customer changes their own password; their other devices are signed out. */
export const CustomerChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
    newPassword: NewPassword,
  })
  .refine((p) => p.newPassword !== p.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });
export type CustomerChangePasswordInput = z.infer<typeof CustomerChangePasswordInput>;

/** One signed-in device. `id` is the sign-in's session id; `current` marks the one asking. */
export const AccountSession = z.object({
  id: Id,
  device: z.string(),
  signedInAt: IsoDateTime,
  expiresAt: IsoDateTime,
  current: z.boolean(),
});
export type AccountSession = z.infer<typeof AccountSession>;

/** POST /me/delete: permanent, so it needs the password and the word DELETE. */
export const DeleteAccountInput = z.object({
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
  confirm: z.literal("DELETE", { errorMap: () => ({ message: "Type DELETE to confirm." }) }),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;
