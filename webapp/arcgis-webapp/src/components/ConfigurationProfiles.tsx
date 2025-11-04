import './ConfigurationProfiles.css';

import type { ConfigurationProfile } from '@/types';

interface ConfigurationProfilesProps {
  profiles: ConfigurationProfile[];
  loading: boolean;
  error: string | null;
  selectedProfile: ConfigurationProfile | null;
  selectedProfileId: string | null;
  profileName: string;
  isDirty: boolean;
  canSave: boolean;
  saving: boolean;
  onProfileNameChange: (name: string) => void;
  onSelectProfile: (profileId: string | null) => void;
  onSaveProfile: () => void;
  onSaveProfileAsNew: () => void;
  onCreateProfile: () => void;
  onRefreshProfiles: () => void;
  supabaseAvailable: boolean;
}

function ConfigurationProfiles({
  profiles,
  loading,
  error,
  selectedProfile,
  selectedProfileId,
  profileName,
  isDirty,
  canSave,
  saving,
  onProfileNameChange,
  onSelectProfile,
  onSaveProfile,
  onSaveProfileAsNew,
  onCreateProfile,
  onRefreshProfiles,
  supabaseAvailable,
}: ConfigurationProfilesProps): JSX.Element {
  const hasProfiles = profiles.length > 0;
  const trimmedProfileName = profileName.trim();
  const selectDisabled = !supabaseAvailable || loading || !hasProfiles;

  const saveLabel = selectedProfileId ? 'Save changes' : 'Save profile';

  return (
    <section
      className="configuration-profiles"
      aria-label="Configuration profiles"
    >
      <div className="configuration-profiles__header">
        <div>
          <h2 className="configuration-profiles__title">Configuration Profiles</h2>
          <p className="configuration-profiles__subtitle">
            Save your filters and map regions so anyone can load them instantly.
          </p>
        </div>
        <div className="configuration-profiles__header-actions">
          <button
            type="button"
            className="configuration-profiles__button"
            onClick={onRefreshProfiles}
            disabled={!supabaseAvailable || loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="configuration-profiles__button"
            onClick={onCreateProfile}
            disabled={saving}
          >
            New profile
          </button>
        </div>
      </div>

      <div className="configuration-profiles__controls">
        <label className="configuration-profiles__field">
          <span className="configuration-profiles__label">Available profiles</span>
          <div className="configuration-profiles__select">
            <select
              value={selectedProfileId ?? ''}
              onChange={(event) =>
                onSelectProfile(event.target.value ? event.target.value : null)
              }
              disabled={selectDisabled}
            >
              <option value="">Local configuration</option>
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="configuration-profiles__field">
          <span className="configuration-profiles__label">Profile name</span>
          <input
            type="text"
            value={profileName}
            onChange={(event) => onProfileNameChange(event.target.value)}
            placeholder="Untitled profile"
            aria-describedby="configuration-profiles-status"
            autoComplete="off"
            spellCheck
          />
        </label>
      </div>

      <div className="configuration-profiles__footer">
        <div
          className={`configuration-profiles__status${
            isDirty ? ' configuration-profiles__status--dirty' : ''
          }`}
          id="configuration-profiles-status"
          role="status"
          aria-live="polite"
        >
          {supabaseAvailable ? (
            isDirty ? (
              'Unsaved changes'
            ) : selectedProfile ? (
              selectedProfile.updatedAt
                ? `Saved ${selectedProfile.updatedAt.toLocaleString()}`
                : 'Saved'
            ) : trimmedProfileName ? (
              'Local configuration'
            ) : (
              'Ready to customise'
            )
          ) : (
            'Supabase client not configured'
          )}
        </div>

        <div className="configuration-profiles__actions">
          <button
            type="button"
            className="configuration-profiles__button configuration-profiles__button--primary"
            onClick={onSaveProfile}
            disabled={
              !supabaseAvailable || !canSave || saving || Boolean(!trimmedProfileName)
            }
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
          {selectedProfileId ? (
            <button
              type="button"
              className="configuration-profiles__button"
              onClick={onSaveProfileAsNew}
              disabled={!supabaseAvailable || saving}
            >
              Save as new
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="configuration-profiles__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default ConfigurationProfiles;
