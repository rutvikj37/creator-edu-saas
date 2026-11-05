import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CommunityFeedPage } from './CommunityPages.jsx';
import { CreatorMembershipsPage, PublicMembershipsPage } from './MembershipsPages.jsx';
import { CheckoutPage } from '../student/CheckoutPage.jsx';
import { communityApi, membershipsApi } from '../../services/api/community.js';
import { checkoutApi } from '../../services/api/commerce.js';

const learn = { posts: vi.fn(), createPost: vi.fn(), like: vi.fn() };
vi.mock('../../services/api/community.js', () => ({
  communityApi: vi.fn(() => learn),
  membershipsApi: { plans: vi.fn(), create: vi.fn(), update: vi.fn(), members: vi.fn(), publicPlans: vi.fn(), mine: vi.fn() },
}));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'SQL Basics', status: 'PUBLISHED' }, { id: 'c2', title: 'Excel', status: 'PUBLISHED' }] })) } }));
vi.mock('../../services/api/commerce.js', () => ({ checkoutApi: { quote: vi.fn(), checkout: vi.fn(), pay: vi.fn(), confirm: vi.fn(), abandon: vi.fn() } }));
vi.mock('../../services/api/learn.js', () => ({ catalogApi: { course: vi.fn() } }));
vi.mock('../../services/api/auth.js', () => ({ academyApi: { site: vi.fn(async () => ({ name: 'Acme', theme: {} })) } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', user: { fullName: 'Priya', email: 'p@example.test' } }) }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => null }));

const plan = { id: 'p1', name: 'All access', description: null, priceAmount: '499', currency: 'INR', interval: 'MONTH', courseIds: ['c1'], status: 'ACTIVE', activeMembers: 2, courses: [{ id: 'c1', title: 'SQL Basics', slug: 'sql' }] };

function wrap(routes, path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

it('student feed: hides the composer in staff-only spaces and posts in open ones', async () => {
  learn.posts.mockResolvedValueOnce({ community: { name: 'Announcements', staffOnlyPosts: true }, items: [], nextCursor: null });
  wrap([{ path: '/learn/communities/:id', element: <CommunityFeedPage /> }], '/learn/communities/a1');
  expect(await screen.findByText(/Only the academy team posts here/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Write a post')).toBeNull();
  expect(communityApi).toHaveBeenCalledWith('/learn/communities');
});

it('student feed: creates a post', async () => {
  learn.posts.mockResolvedValue({ community: { name: 'Lounge', staffOnlyPosts: false }, items: [], nextCursor: null });
  learn.createPost.mockResolvedValue({ id: 'x' });
  wrap([{ path: '/learn/communities/:id', element: <CommunityFeedPage /> }], '/learn/communities/l1');
  await userEvent.type(await screen.findByLabelText('Write a post'), 'Anyone studying SQL?');
  await userEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(learn.createPost).toHaveBeenCalledWith('l1', { title: null, body: 'Anyone studying SQL?' }));
});

it('creator creates a membership plan with the chosen courses', async () => {
  membershipsApi.plans.mockResolvedValue([]);
  membershipsApi.create.mockResolvedValue(plan);
  wrap([{ path: '/creator/memberships', element: <CreatorMembershipsPage /> }], '/creator/memberships');
  await userEvent.click((await screen.findAllByRole('button', { name: 'New plan' }))[0]);
  await userEvent.type(screen.getByLabelText(/Plan name/), 'All access');
  await userEvent.type(screen.getByLabelText(/Price/), '499');
  const create = screen.getByRole('button', { name: 'Create plan' });
  expect(create).toBeDisabled(); // no courses yet
  await userEvent.click(await screen.findByLabelText('SQL Basics'));
  await userEvent.click(create);
  await waitFor(() => expect(membershipsApi.create.mock.calls[0][0]).toEqual({ name: 'All access', description: null, priceAmount: 499, interval: 'MONTH', courseIds: ['c1'] }));
});

it('public plans show an active membership as Renew and link to the plan checkout', async () => {
  membershipsApi.publicPlans.mockResolvedValue([plan]);
  membershipsApi.mine.mockResolvedValue([{ plan: { id: 'p1' }, active: true, currentPeriodEnd: '2026-12-01T00:00:00Z' }]);
  wrap([{ path: '/memberships', element: <PublicMembershipsPage /> }], '/memberships');
  expect(await screen.findByText(/Active until/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Renew' }).closest('a')).toHaveAttribute('href', '/checkout/membership/p1');
});

it('membership checkout quotes and orders by plan id', async () => {
  membershipsApi.publicPlans.mockResolvedValue([plan]);
  checkoutApi.quote.mockResolvedValue({ kind: 'membership', currency: 'INR', subtotal: '499.00', discount: '0.00', tax: '0.00', total: '499.00', taxRate: 0, taxInclusive: true, paymentsEnabled: true });
  checkoutApi.checkout.mockResolvedValue({ id: 'o1', status: 'PAID' });
  wrap([{ path: '/checkout/membership/:planId', element: <CheckoutPage /> }, { path: '/learn/orders/:id', element: <p>order page</p> }], '/checkout/membership/p1');
  expect(await screen.findByText('All access')).toBeInTheDocument();
  expect(checkoutApi.quote).toHaveBeenCalledWith({ membershipPlanId: 'p1', couponCode: undefined });
  await userEvent.click(screen.getByRole('button', { name: /Pay/ }));
  await waitFor(() => expect(checkoutApi.checkout.mock.calls[0][0]).toMatchObject({ membershipPlanId: 'p1' }));
  expect(await screen.findByText('order page')).toBeInTheDocument();
});
