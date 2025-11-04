import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import PasswordModal from '@/components/PasswordModal';

describe('PasswordModal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <PasswordModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when isOpen is true', () => {
    render(<PasswordModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
  });

  it('renders custom title and message', () => {
    render(
      <PasswordModal
        isOpen={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        title="Custom Title"
        message="Custom message"
      />,
    );
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.getByText('Custom message')).toBeInTheDocument();
  });

  it('calls onSubmit with password when form is submitted', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PasswordModal isOpen={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText('Enter password');
    const submitButton = screen.getByRole('button', { name: 'Submit' });

    await user.type(input, 'testpassword');
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith('testpassword');
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PasswordModal isOpen={true} onClose={onClose} onSubmit={vi.fn()} />);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PasswordModal isOpen={true} onClose={onClose} onSubmit={vi.fn()} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('disables submit button when password is empty', () => {
    render(<PasswordModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const submitButton = screen.getByRole('button', { name: 'Submit' });
    expect(submitButton).toBeDisabled();
  });

  it('enables submit button when password is entered', async () => {
    const user = userEvent.setup();
    render(<PasswordModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText('Enter password');
    const submitButton = screen.getByRole('button', { name: 'Submit' });

    expect(submitButton).toBeDisabled();

    await user.type(input, 'password');

    expect(submitButton).not.toBeDisabled();
  });

  it('clears password when form is submitted', async () => {
    const user = userEvent.setup();
    render(<PasswordModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const input = screen.getByPlaceholderText('Enter password') as HTMLInputElement;
    const submitButton = screen.getByRole('button', { name: 'Submit' });

    await user.type(input, 'testpassword');
    expect(input.value).toBe('testpassword');

    await user.click(submitButton);
    expect(input.value).toBe('');
  });
});
