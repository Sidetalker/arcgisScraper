import './ExportColumnSelector.css';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EXPORT_COLUMN_DEFINITIONS,
  type ExportColumnKey,
} from '@/services/mailingListExport';

interface ExportColumnSelectorProps {
  selectedColumns: ExportColumnKey[];
  onColumnsChange: (columns: ExportColumnKey[]) => void;
  onClose: () => void;
}

interface ColumnItem {
  key: ExportColumnKey;
  label: string;
  enabled: boolean;
}

export function ExportColumnSelector({
  selectedColumns,
  onColumnsChange,
  onClose,
}: ExportColumnSelectorProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const draggedItemRef = useRef<ExportColumnKey | null>(null);

  // Build the initial list: enabled columns in order, then disabled at the end
  const [items, setItems] = useState<ColumnItem[]>(() => {
    const columnMap = new Map(
      EXPORT_COLUMN_DEFINITIONS.map((def) => [def.key, def.label]),
    );

    // Enabled columns in the order they appear in selectedColumns
    const enabledItems: ColumnItem[] = selectedColumns.map((key) => ({
      key,
      label: columnMap.get(key) || key,
      enabled: true,
    }));

    // Disabled columns
    const selectedSet = new Set(selectedColumns);
    const disabledItems: ColumnItem[] = EXPORT_COLUMN_DEFINITIONS.filter(
      (def) => !selectedSet.has(def.key),
    ).map((def) => ({
      key: def.key,
      label: def.label,
      enabled: false,
    }));

    return [...enabledItems, ...disabledItems];
  });

  const handleToggle = useCallback((index: number) => {
    setItems((prevItems) => {
      const newItems = [...prevItems];
      const item = newItems[index];
      
      if (item.enabled) {
        // Disable: move to the end
        newItems.splice(index, 1);
        newItems.push({ ...item, enabled: false });
      } else {
        // Enable: move to the end of enabled items
        const enabledCount = newItems.filter((i) => i.enabled).length;
        newItems.splice(index, 1);
        newItems.splice(enabledCount, 0, { ...item, enabled: true });
      }
      
      return newItems;
    });
  }, []);

  const handleDragStart = useCallback((index: number) => {
    draggedItemRef.current = items[index].key;
    setDraggedIndex(index);
  }, [items]);

  const handleDragOver = useCallback(
    (event: React.DragEvent, index: number) => {
      event.preventDefault();
      if (draggedIndex === null || draggedIndex === index) {
        return;
      }
      setDragOverIndex(index);
    },
    [draggedIndex],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent, dropIndex: number) => {
      event.preventDefault();
      
      if (draggedIndex === null || draggedIndex === dropIndex) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        draggedItemRef.current = null;
        return;
      }

      setItems((prevItems) => {
        const newItems = [...prevItems];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        newItems.splice(dropIndex, 0, draggedItem);
        return newItems;
      });

      setDraggedIndex(null);
      setDragOverIndex(null);
      draggedItemRef.current = null;
    },
    [draggedIndex],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
    draggedItemRef.current = null;
  }, []);

  const handleSave = useCallback(() => {
    const newSelectedColumns = items
      .filter((item) => item.enabled)
      .map((item) => item.key);
    onColumnsChange(newSelectedColumns);
    onClose();
  }, [items, onColumnsChange, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="export-column-selector__overlay" onClick={onClose}>
      <div
        className="export-column-selector__modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="export-column-selector-title"
        aria-modal="true"
      >
        <header className="export-column-selector__header">
          <h2 id="export-column-selector-title">Select Export Columns</h2>
          <p>
            Choose which columns to include in the CSV export and drag to reorder them.
            Unchecked columns will be excluded.
          </p>
        </header>

        <div className="export-column-selector__body">
          <ul className="export-column-selector__list">
            {items.map((item, index) => (
              <li
                key={item.key}
                className={`export-column-selector__item${
                  draggedIndex === index ? ' export-column-selector__item--dragging' : ''
                }${dragOverIndex === index ? ' export-column-selector__item--drag-over' : ''}${
                  !item.enabled ? ' export-column-selector__item--disabled' : ''
                }`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              >
                <span
                  className="export-column-selector__drag-handle"
                  aria-label="Drag to reorder"
                >
                  ⋮⋮
                </span>
                <input
                  type="checkbox"
                  className="export-column-selector__checkbox"
                  checked={item.enabled}
                  onChange={() => handleToggle(index)}
                  id={`export-column-${item.key}`}
                  aria-label={`Include ${item.label} in export`}
                />
                <label
                  className="export-column-selector__label"
                  htmlFor={`export-column-${item.key}`}
                >
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <footer className="export-column-selector__footer">
          <button
            type="button"
            className="export-column-selector__button export-column-selector__button--secondary"
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="export-column-selector__button export-column-selector__button--primary"
            onClick={handleSave}
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ExportColumnSelector;
