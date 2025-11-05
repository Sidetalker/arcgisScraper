import { type ReactNode, useId, useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  defaultCollapsed?: boolean;
  collapsible?: boolean;
}

function CollapsibleSection({
  title,
  description,
  children,
  className = '',
  defaultCollapsed = true,
  collapsible = true,
}: CollapsibleSectionProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(() =>
    collapsible ? defaultCollapsed : false,
  );
  const sectionId = useId();
  const titleId = `${sectionId}-title`;
  const contentId = `${sectionId}-content`;
  const classes = [
    'collapsible-section',
    collapsible && collapsed ? 'collapsible-section--collapsed' : '',
    !collapsible ? 'collapsible-section--static' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} aria-labelledby={titleId}>
      <header className="collapsible-section__header">
        <div className="collapsible-section__summary">
          <h2 id={titleId}>{title}</h2>
          <p>{description}</p>
        </div>
        {collapsible ? (
          <button
            type="button"
            className="collapsible-section__toggle"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={() => {
              setCollapsed((previous) => !previous);
            }}
          >
            {collapsed ? 'Expand section' : 'Collapse section'}
          </button>
        ) : null}
      </header>
      <div
        id={contentId}
        className="collapsible-section__body"
        role="region"
        aria-labelledby={titleId}
        hidden={collapsible ? collapsed : false}
      >
        {children}
      </div>
    </section>
  );
}

export default CollapsibleSection;
