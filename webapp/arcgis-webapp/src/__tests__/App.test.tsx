import { render, screen } from '@testing-library/react';
import App from '@/App';

describe('App', () => {
  it('renders the heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /arcgis web app/i })
    ).toBeInTheDocument();
  });

  it('renders the filter sidebar', () => {
    render(<App />);
    expect(screen.getByLabelText(/filters/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by address/i)).toBeInTheDocument();
  });
});
