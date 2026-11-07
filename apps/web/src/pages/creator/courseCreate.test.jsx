import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CourseCreatePage, coursePricing } from './CourseCreatePage.jsx';
import { coursesApi } from '../../services/api/creator.js';

vi.mock('../../services/api/creator.js', () => ({ coursesApi: { create: vi.fn(async () => ({ id: 'c9' })) } }));
vi.mock('../../services/api/platform.js', () => ({ creatorApi: { billing: vi.fn(async () => ({ entitlements: { features: { 'commission.percent': { limit: 5 } } } })) } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../components/forms/RichTextEditor.jsx', () => ({
  RichTextEditor: ({ label, onChange, error }) => <label>{label}<textarea aria-label="Description" onChange={(e) => onChange(e.target.value ? { type: 'doc', text: e.target.value } : null)} />{error && <span>{error}</span>}</label>,
}));

function renderPage() {
  const router = createMemoryRouter([{ path: '/creator/courses/new', element: <CourseCreatePage /> }, { path: '*', element: <p>elsewhere</p> }], { initialEntries: ['/creator/courses/new'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

it('works out selling price, original price and % off', () => {
  expect(coursePricing({ plan: 'FREE', total: '999', discounted: '' })).toMatchObject({ isFree: true, priceAmount: null });
  expect(coursePricing({ plan: 'ONE_TIME', total: '1999', discounted: '999' })).toEqual({ isFree: false, priceAmount: 999, compareAtAmount: 1999, percentOff: 50 });
  expect(coursePricing({ plan: 'ONE_TIME', total: '500', discounted: '' })).toMatchObject({ priceAmount: 500, compareAtAmount: null, percentOff: 0 });
});

it('validates, shows what the creator receives and creates the course in one step', async () => {
  const router = renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Enter a title of at least 3 characters')).toBeInTheDocument();
  expect(screen.getByText('Enter the course price')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: /^Title/ }), 'GST Basics');
  await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Learn GST');
  await userEvent.type(screen.getByLabelText(/Total price/), '2000');
  await userEvent.type(screen.getByLabelText(/Discounted price/), '1000');
  expect(screen.getByLabelText(/50% off/)).toBeInTheDocument();
  expect(await screen.findByText('₹950.00')).toBeInTheDocument(); // 1000 − 5% fee
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(coursesApi.create).toHaveBeenCalledWith({ title: 'GST Basics', description: { type: 'doc', text: 'Learn GST' }, isFree: false, priceAmount: 1000, compareAtAmount: 2000 }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/creator/courses/c9'));
});

it('creates a free course without asking for prices', async () => {
  renderPage();
  await userEvent.type(screen.getByRole('textbox', { name: /^Title/ }), 'Free intro');
  await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Hello');
  await userEvent.click(screen.getByRole('radio', { name: /Free plan/ }));
  expect(screen.queryByLabelText(/Total price/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(coursesApi.create).toHaveBeenLastCalledWith(expect.objectContaining({ isFree: true, priceAmount: null })));
});
