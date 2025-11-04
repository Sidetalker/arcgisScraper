import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

import './PasswordModal.css';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
  title?: string;
  message?: string;
}

function PasswordModal({
  isOpen,
  onClose,
  onSubmit,
  title = 'Authentication Required',
  message = 'Please enter the password to continue.',
}: PasswordModalProps): JSX.Element | null {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    setPassword('');
    onClose();
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleCancel();
      }
    },
    [handleCancel],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (password.trim()) {
        onSubmit(password);
        setPassword('');
      }
    },
    [password, onSubmit],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="password-modal__overlay"
      onClick={handleOverlayClick}
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        className="password-modal__content"
        role="dialog"
        aria-labelledby="password-modal-title"
        aria-describedby="password-modal-message"
      >
        <h2 id="password-modal-title" className="password-modal__title">
          {title}
        </h2>
        <p id="password-modal-message" className="password-modal__message">
          {message}
        </p>
        <form onSubmit={handleSubmit} className="password-modal__form">
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="password-modal__input"
            autoComplete="off"
          />
          <div className="password-modal__actions">
            <button type="button" onClick={handleCancel} className="password-modal__button password-modal__button--cancel">
              Cancel
            </button>
            <button type="submit" className="password-modal__button password-modal__button--submit" disabled={!password.trim()}>
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PasswordModal;
