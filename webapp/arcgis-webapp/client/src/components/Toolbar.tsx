interface ToolbarProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  lastUpdated?: Date | null;
}

export function Toolbar({ isRefreshing, onRefresh, lastUpdated }: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1>Summit County Rental Explorer</h1>
      <div className="toolbar__actions">
        {lastUpdated ? (
          <span className="toolbar__timestamp">
            Last updated: {lastUpdated.toLocaleString()}
          </span>
        ) : (
          <span className="toolbar__timestamp">No cached data</span>
        )}
        <button type="button" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing…' : 'Update All Data'}
        </button>
      </div>
    </header>
  );
}
