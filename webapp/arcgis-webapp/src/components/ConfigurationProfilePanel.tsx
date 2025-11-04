import './ConfigurationProfilePanel.css';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';

import type { ConfigurationProfile } from '@/types';

interface ConfigurationProfilePanelProps {
  profileName: string;
  onProfileNameChange: (name: string) => void;
  onSaveProfile: () => void;
  onSaveProfileAsNew: () => void;
  saving: boolean;
  hasUnsavedChanges: boolean;
  activeProfileId: string | null;
  profiles: ConfigurationProfile[];
  loadingProfiles: boolean;
  onLoadProfile: (profileId: string) => void;
  onRefreshProfiles: () => void;
  error?: string | null;
  lastSavedAt: Date | null;
}

function formatTimestamp(timestamp: Date | null): string {
  if (!timestamp) {
    return 'Never saved to Supabase';
  }
  return `Last saved ${timestamp.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export default function ConfigurationProfilePanel({
  profileName,
  onProfileNameChange,
  onSaveProfile,
  onSaveProfileAsNew,
  saving,
  hasUnsavedChanges,
  activeProfileId,
  profiles,
  loadingProfiles,
  onLoadProfile,
  onRefreshProfiles,
  error,
  lastSavedAt,
}: ConfigurationProfilePanelProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');

  useEffect(() => {
    setSelectedProfileId(activeProfileId ?? '');
  }, [activeProfileId]);

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedProfileId(event.target.value);
  };

  const handleProfileNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    onProfileNameChange(event.target.value);
  };

  const loadButtonDisabled = useMemo(
    () => selectedProfileId.length === 0 || loadingProfiles,
    [loadingProfiles, selectedProfileId],
  );

  const saveDisabled = saving || profileName.trim().length === 0;

  const statusText = hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved';

  return (
    <section className="profile-panel" aria-label="Configuration profiles">
      <header className="profile-panel__header">
        <div>
          <h2>Configuration profiles</h2>
          <p>Save and share map regions and table filters for quick access.</p>
        </div>
        <div className="profile-panel__actions">
          <button type="button" onClick={onRefreshProfiles} disabled={loadingProfiles || saving}>
            {loadingProfiles ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="profile-panel__error">
          {error}
        </p>
      ) : null}

      <div className="profile-panel__content">
        <div className="profile-panel__fieldset">
          <label htmlFor="profile-name">Local profile name</label>
          <input
            id="profile-name"
            type="text"
            value={profileName}
            onChange={handleProfileNameChange}
            placeholder="e.g. Downtown investors"
            disabled={saving}
          />
          <div className="profile-panel__status" aria-live="polite">
            <span className={hasUnsavedChanges ? 'profile-panel__status--warn' : ''}>{statusText}</span>
            <span>{formatTimestamp(lastSavedAt)}</span>
          </div>
          <div className="profile-panel__buttons">
            <button type="button" onClick={onSaveProfile} disabled={saveDisabled}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            <button type="button" onClick={onSaveProfileAsNew} disabled={saveDisabled}>
              {saving ? 'Saving…' : 'Save as new'}
            </button>
          </div>
        </div>

        <div className="profile-panel__fieldset">
          <label htmlFor="profile-select">Load a saved profile</label>
          <div className="profile-panel__loader">
            <select
              id="profile-select"
              value={selectedProfileId}
              onChange={handleSelectChange}
              disabled={loadingProfiles}
            >
              <option value="">Select a profile…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onLoadProfile(selectedProfileId)}
              disabled={loadButtonDisabled}
            >
              Load profile
            </button>
          </div>
          <p className="profile-panel__hint">
            {profiles.length > 0
              ? `${profiles.length} saved profile${profiles.length === 1 ? '' : 's'} available.`
              : 'No profiles saved yet.'}
          </p>
        </div>
      </div>
    </section>
  );
}
