import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CommunityFeedPage } from './CommunityPages.jsx';
import { CreatorMembershipsPage, PublicMembershipsPage } from './MembershipsPages.jsx';
import { MembershipBuilderPage } from './MembershipBuilderPage.jsx';
import { CheckoutPage } from '../student/CheckoutPage.jsx';
import { communityApi, membershipsApi } from '../../services/api/community.js';
import { checkoutApi } from '../../services/api/commerce.js';

const learn = { posts: vi.fn(), createPost: vi.fn(), like: vi.fn() };
vi.mock('../../services/api/community.js', () => ({
  communityApi: vi.fn(() => learn),
  membershipsApi: { plans: vi.fn(), stats: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), members: vi.fn(), publicPlans: vi.fn(), mine: vi.fn() },
}));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'SQL Basics', status: 'PUBLISHED' }, { id: 'c2', title: 'Excel', status: 'PUBLISHED' }] })) } }));
vi.mock('../../services/api/commerce.js', () => ({ checkoutApi: { quote: vi.fn(), checkout: vi.fn(), pay: vi.fn(), confirm: vi.fn(), abandon: vi.fn() }, creatorCommerceApi: { gateway: vi.fn(async () => ({ configured: false })) } }));
vi.mock('../../components/forms/FileUpload.jsx', () => ({ FileUpload: ({ label }) => <button type="button">{label}</button> }));
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

it('memberships page shows totals, the payments banner and plan cards with filters', async () => {
  membershipsApi.plans.mockResolvedValue([{ ...plan, coverUrl: null, revenue: '998' }, { ...plan, id: 'p2', name: 'My Membership', description: 'Welcome to my membership community', status: 'DRAFT', priceAmount: '0', activeMembers: 0, revenue: '0' }]);
  membershipsApi.stats.mockResolvedValue({ totalMembers: 2, totalRevenue: '998', currency: 'INR' });
  membershipsApi.update.mockResolvedValue({ ...plan, id: 'p2', status: 'ACTIVE' });
  const router = wrap([{ path: '/creator/memberships', element: <CreatorMembershipsPage /> }, { path: '/creator/memberships/new', element: <p>builder</p> }], '/creator/memberships');
  expect(await screen.findByText('Set up payments to receive money')).toBeInTheDocument();
  expect(await screen.findByText('My Membership')).toBeInTheDocument();
  expect(screen.getByText('Draft')).toBeInTheDocument();
  expect(screen.getByText('Welcome to my membership community')).toBeInTheDocument();
  expect(screen.getByText('2 memberships')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Search'), 'my mem');
  await waitFor(() => expect(screen.queryByText('All access')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Actions for My Membership' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Publish' }));
  await waitFor(() => expect(membershipsApi.update).toHaveBeenCalledWith('p2', { status: 'ACTIVE' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(router.state.location.pathname).toBe('/creator/memberships/new');
});

it('builder: details with FAQs, courses from the picker, then pricing and publish', async () => {
  membershipsApi.stats.mockResolvedValue({ totalMembers: 0, totalRevenue: '0', currency: 'INR', pricing: { gstRegistered: true, taxRate: 18, pricesIncludeTax: false, commissionPercent: 5 } });
  membershipsApi.create.mockResolvedValue({ id: 'p9' });
  membershipsApi.update.mockResolvedValue({ id: 'p9' });
  const router = wrap([{ path: '/creator/memberships/new', element: <MembershipBuilderPage /> }, { path: '/creator/memberships', element: <p>list</p> }], '/creator/memberships/new');
  await userEvent.type(await screen.findByLabelText('Membership name'), 'My Membership');
  await userEvent.type(screen.getByLabelText('Description'), 'Welcome to my membership community');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  let dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Question'), 'What is included?');
  await userEvent.type(within(dialog).getByLabelText('Answer'), 'Every course listed.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('What is included?')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(membershipsApi.create).toHaveBeenCalledWith({ name: 'My Membership', description: 'Welcome to my membership community', coverFileId: null, faqs: [{ question: 'What is included?', answer: 'Every course listed.' }] }));

  // Step 2: empty state → picker → Select All → Add.
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  expect(await screen.findByText('Add at least one course')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add Course' }));
  dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByLabelText('Select All'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add (2)' }));
  expect(await screen.findByText('2 courses included')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(membershipsApi.update).toHaveBeenCalledWith('p9', { courseIds: ['c1', 'c2'] }));

  // Step 3: yearly, 1499 struck through, 999 charged → publish.
  expect(await screen.findByRole('heading', { name: 'Setup Pricing' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Plan name'), 'Yearly pass');
  await userEvent.type(screen.getByLabelText('Price'), '1499');
  await userEvent.type(screen.getByLabelText('Sale price'), '999');
  // GST on top (18%) and a 5% platform commission: effective price and what the academy receives.
  expect(screen.getByText('Price + 18% GST')).toBeInTheDocument();
  expect(screen.getByText('₹1,178.82')).toBeInTheDocument();
  expect(screen.getByText('₹949.05')).toBeInTheDocument();
  expect(screen.getByText('+ taxes')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
  await userEvent.type(screen.getByLabelText('Customize button text'), 'Join now');
  await userEvent.selectOptions(screen.getByLabelText('Access period per payment'), 'YEAR');
  expect(screen.getAllByText('Join now').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('radio', { name: 'Unlimited' }));
  expect(screen.getByText('Lifetime access')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Limited' }));
  await userEvent.click(screen.getByRole('switch', { name: 'Show taxes separately' }));
  expect(screen.queryByText('+ taxes')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(membershipsApi.update).toHaveBeenLastCalledWith('p9', { planName: 'Yearly pass', interval: 'YEAR', priceAmount: 999, compareAtAmount: 1499, buttonText: 'Join now', lifetime: false, taxExclusive: false, passTransactionFee: false, status: 'ACTIVE' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/creator/memberships'));
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
