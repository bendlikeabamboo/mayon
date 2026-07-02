import { DEFAULT_PROFILE, LEVEL_OPTIONS, MODE_OPTIONS, type LearnerProfile } from './brief';
import { isScopeStrategyId } from './strategies';
import { isPersonaId } from './personas';

const PROFILE_KEY = 'learnerProfile';

/** Read the learner profile, validating enums and falling back to DEFAULT_PROFILE. */
export async function getLearnerProfile(): Promise<LearnerProfile> {
	const { repos } = await import('$lib/db');
	const raw = await repos.settings.get<LearnerProfile>(PROFILE_KEY);
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_PROFILE };
	const profile: LearnerProfile = {};
	if (typeof raw.context === 'string' && raw.context.trim().length > 0)
		profile.context = raw.context;
	if (LEVEL_OPTIONS.includes(raw.level as never)) profile.level = raw.level;
	if (MODE_OPTIONS.includes(raw.mode as never)) profile.mode = raw.mode;
	if (isScopeStrategyId(raw.scopeStrategy)) profile.scopeStrategy = raw.scopeStrategy;
	if (isPersonaId(raw.persona)) profile.persona = raw.persona;
	return profile;
}

/** Persist the learner profile (overwrite). */
export async function setLearnerProfile(profile: LearnerProfile): Promise<void> {
	const { repos } = await import('$lib/db');
	await repos.settings.set(PROFILE_KEY, profile);
}
