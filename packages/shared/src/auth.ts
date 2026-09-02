/**
 * Auth wire types for the security gate (`/api/auth/*` + gate semantics).
 * See `specs/017-secure-public-launch/contracts/auth-api.md`.
 */
export type AuthMode = 'open' | 'locked';
export type GateRole = 'owner' | 'invitee';
export type GateIdentityStatus = 'invited' | 'active' | 'revoked';
export type LoginAttemptOutcome = 'success' | 'bad_password' | 'bad_code' | 'unknown_identity';

export interface AuthIdentityDTO {
	label: string;
	role: GateRole;
}
export interface AuthSessionDTO {
	expiresAt: number;
}
export interface AuthSessionResponse {
	mode: AuthMode;
	setupRequired: boolean;
	authenticated: boolean;
	identity: AuthIdentityDTO | null;
	session: AuthSessionDTO | null;
}

export interface SetupRequest {
	label: string;
	password: string;
}
export interface SetupResponse {
	otpauthUri: string;
}
export interface SetupConfirmRequest {
	code: string;
}
export interface AuthSessionResult {
	authenticated: true;
	identity: AuthIdentityDTO;
	session: AuthSessionDTO;
}
export interface LoginRequest {
	label?: string;
	password: string;
	code?: string;
}
export interface MfaEnrollmentRequired {
	status: 'mfa_enrollment_required';
	enrollToken: string;
	otpauthUri: string;
}
export type LoginResponse = AuthSessionResult | MfaEnrollmentRequired;
export interface EnrollRequest {
	code: string;
}
export interface ModeChangeRequest {
	mode: AuthMode;
	password?: string;
}

export interface InviteDTO {
	id: string;
	label: string;
	status: GateIdentityStatus;
	createdAt: number;
}
export interface InviteCreateResponse {
	id: string;
	oneTimePassword: string;
}
export interface InvitesResponse {
	invites: InviteDTO[];
}
export interface SessionDTO {
	id: string;
	identityLabel: string;
	label: string | null;
	createdAt: number;
	expiresAt: number;
	lastSeenAt: number | null;
	current: boolean;
}
export interface SessionsResponse {
	sessions: SessionDTO[];
}
export interface AttemptDTO {
	identityLabel: string | null;
	source: string;
	outcome: LoginAttemptOutcome;
	at: number;
}
export interface AttemptsResponse {
	attempts: AttemptDTO[];
}

export type AuthErrorCode =
	| 'unauthenticated'
	| 'invalid credentials'
	| 'bad origin'
	| 'setup closed'
	| 'invalid code'
	| 'enrollment expired'
	| 'too many attempts';
export interface AuthErrorResponse {
	error: AuthErrorCode;
}
